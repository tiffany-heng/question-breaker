import { NextRequest, NextResponse } from 'next/server';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OCR_MODEL = 'gemini-2.5-flash';
const REASONING_MODEL = 'gemini-3.1-flash-lite-preview';

async function fetchWithRetry(url: string, options: any, maxRetries = 3): Promise<Response> {
  for (let i = 0; i < maxRetries; i++) {
    const res = await fetch(url, options);
    if (res.status === 429) {
      const wait = Math.pow(2, i) * 3000; 
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    return res;
  }
  return fetch(url, options);
}

export async function POST(req: NextRequest) {
  try {
    const { questionImageUrl, questionText, solutionImageUrl, solutionText } = await req.json();
    if (!GEMINI_API_KEY) return NextResponse.json({ error: 'Key missing' });

    let finalQuestionText = questionText || '';
    let finalSolutionText = solutionText || '';

    // --- STEP 1: OCR (Only for parts provided as images) ---
    const imagesToProcess: { mime_type: string, data: string }[] = [];
    
    // 1a. Load Question Image if needed
    if (!finalQuestionText && questionImageUrl) {
      const qResp = await fetch(questionImageUrl);
      if (qResp.ok) {
        const qBuffer = await qResp.arrayBuffer();
        imagesToProcess.push({ mime_type: 'image/jpeg', data: Buffer.from(qBuffer).toString('base64') });
      }
    }

    // 1b. Load Solution Image if needed
    if (!finalSolutionText && solutionImageUrl && solutionImageUrl.startsWith('http')) {
      const sResp = await fetch(solutionImageUrl);
      if (sResp.ok) {
        const sBuffer = await sResp.arrayBuffer();
        imagesToProcess.push({ mime_type: 'image/jpeg', data: Buffer.from(sBuffer).toString('base64') });
      }
    }

    // Trigger OCR only if we have images and are missing text
    if (imagesToProcess.length > 0) {
      const flashParts: any[] = imagesToProcess.map(img => ({ inline_data: img }));
      const imageCount = imagesToProcess.length;
      flashParts.push({ text: `I have provided exactly ${imageCount} image(s). EXTRACT ALL TEXT FROM ALL IMAGES. DO NOT SOLVE. Preserve LaTeX. Output the text clearly.` });

      const flashResp = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${OCR_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: "user", parts: flashParts }] })
      });
      
      const flashData = await flashResp.json();
      if (flashData.error) return NextResponse.json({ error: "OCR Error", raw: flashData.error.message });
      
      const ocrResult = flashData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      // Distribute OCR results
      if (!finalQuestionText) finalQuestionText = ocrResult;
      // If we provided 2 images, the ocrResult usually contains both combined
    }

    if (!finalQuestionText) return NextResponse.json({ error: "No question content found" });

    // --- STEP 2: Variations (Gemini 3.1) ---
    const reasoningPrompt = `
      You are a Pedagogical Engineer. 
      QUESTION: "${finalQuestionText}"
      GROUND TRUTH SOLUTION: "${finalSolutionText || 'None provided'}"
      TASK: Generate 4 pedagogical variations in JSON array: "category", "text", "solution".
    `;

    const proResp = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${REASONING_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ 
        contents: [{ role: "user", parts: [{ text: reasoningPrompt }] }],
        generationConfig: { response_mime_type: "application/json" }
      })
    });

    const proData = await proResp.json();
    if (proData.error) return NextResponse.json({ error: "Reasoning Quota Exceeded", raw: proData.error.message });

    const rawText = proData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    try {
      let variations = JSON.parse(rawText);
      if (!Array.isArray(variations)) {
        const possibleArray = Object.values(variations).find(val => Array.isArray(val));
        variations = possibleArray || [variations];
      }
      return NextResponse.json({ extractedText: finalQuestionText, variations });
    } catch (e) {
      return NextResponse.json({ error: "JSON Parse Error", raw: rawText });
    }

  } catch (err: any) {
    return NextResponse.json({ error: "Server Crash", raw: err.message });
  }
}
