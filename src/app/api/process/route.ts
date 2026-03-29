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
    const { questionImageUrl, questionText, solutionImageUrl, userSolutionText } = await req.json();
    if (!GEMINI_API_KEY) return NextResponse.json({ error: 'Key missing' });

    let finalQuestionText = questionText || '';

    // --- STEP 1: OCR (Only if text wasn't provided directly) ---
    if (!finalQuestionText && questionImageUrl) {
      const qResp = await fetch(questionImageUrl);
      if (!qResp.ok) return NextResponse.json({ error: "Could not load question image" });
      const qBuffer = await qResp.arrayBuffer();
      const qBase64 = Buffer.from(qBuffer).toString('base64');

      let sBase64 = '';
      if (solutionImageUrl && solutionImageUrl.startsWith('http')) {
        try {
          const sResp = await fetch(solutionImageUrl);
          if (sResp.ok) {
            const sBuffer = await sResp.arrayBuffer();
            sBase64 = Buffer.from(sBuffer).toString('base64');
          }
        } catch (e) {}
      }

      const flashParts: any[] = [{ inline_data: { mime_type: 'image/jpeg', data: qBase64 } }];
      if (sBase64) flashParts.push({ inline_data: { mime_type: 'image/jpeg', data: sBase64 } });
      flashParts.push({ text: "EXTRACT ALL TEXT FROM THESE IMAGES. DO NOT SOLVE. Preserve LaTeX." });

      const flashResp = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${OCR_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: "user", parts: flashParts }] })
      });
      
      const flashData = await flashResp.json();
      if (flashData.error) return NextResponse.json({ error: "OCR Error", raw: flashData.error.message });
      finalQuestionText = flashData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    if (!finalQuestionText) return NextResponse.json({ error: "No question content found" });

    // --- STEP 2: Variations (Gemini 3.1) ---
    const reasoningPrompt = `
      You are a Pedagogical Engineer. 
      QUESTION: "${finalQuestionText}"
      HINT: "${userSolutionText || 'None'}"
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
