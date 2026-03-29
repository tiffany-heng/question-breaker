import { NextRequest, NextResponse } from 'next/server';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const FLASH_MODEL = 'gemini-2.0-flash';
const FALLBACK_FLASH = 'gemini-1.5-flash';
const PRO_MODEL = 'gemini-3.1-flash-lite-preview';

async function fetchWithRetry(url: string, options: any, maxRetries = 3): Promise<Response> {
  let lastStatus = 0;
  for (let i = 0; i < maxRetries; i++) {
    const res = await fetch(url, options);
    lastStatus = res.status;
    if (res.status === 429) {
      const wait = Math.pow(2, i) * 3000; // 3s, 6s, 12s...
      console.log(`Rate limited (429). Retry ${i+1}/${maxRetries} in ${wait}ms...`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    return res;
  }
  // If we still fail, return the last response
  return fetch(url, options);
}

export async function POST(req: NextRequest) {
  try {
    const { questionImageUrl, solutionImageUrl, userSolutionText } = await req.json();
    if (!GEMINI_API_KEY) return NextResponse.json({ error: 'Key missing' });

    // 1. Fetch Question Image
    const qResp = await fetch(questionImageUrl);
    if (!qResp.ok) return NextResponse.json({ error: "Could not load question image" });
    const qBuffer = await qResp.arrayBuffer();
    const qBase64 = Buffer.from(qBuffer).toString('base64');

    // 2. Fetch Solution Image (Optional)
    let sBase64 = '';
    if (solutionImageUrl && solutionImageUrl.startsWith('http')) {
      try {
        const sResp = await fetch(solutionImageUrl);
        if (sResp.ok) {
          const sBuffer = await sResp.arrayBuffer();
          sBase64 = Buffer.from(sBuffer).toString('base64');
        }
      } catch (e) {
        console.warn("Optional solution image failed to load");
      }
    }

    // --- STEP 1: Full Extraction ---
    const flashParts: any[] = [
      { inline_data: { mime_type: 'image/jpeg', data: qBase64 } }
    ];
    if (sBase64) flashParts.push({ inline_data: { mime_type: 'image/jpeg', data: sBase64 } });
    
    flashParts.push({ text: "EXTRACT ALL TEXT FROM THESE IMAGES. DO NOT SOLVE. Preserve LaTeX." });

    let flashResp = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${FLASH_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ contents: [{ role: "user", parts: flashParts }] })
    });

    // Fallback if 2.0 is hitting specific quota limits
    if (!flashResp.ok && FLASH_MODEL !== FALLBACK_FLASH) {
      console.log("Switching to fallback model...");
      flashResp = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${FALLBACK_FLASH}:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ contents: [{ role: "user", parts: flashParts }] })
      });
    }
    
    const flashData = await flashResp.json();
    if (flashData.error) return NextResponse.json({ error: "Flash Quota Exceeded", raw: flashData.error.message });
    
    const extractedText = flashData.candidates?.[0]?.content?.parts?.[0]?.text || '[No text found]';

    // --- STEP 2: Variations ---
    const reasoningPrompt = `
      You are a Pedagogical Engineer. 
      QUESTION TEXT: "${extractedText}"
      PROVIDED SOLUTION HINT: "${userSolutionText || 'None'}"
      TASK: Generate 4 variations in JSON array: "category", "text", "solution".
    `;

    const proResp = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${PRO_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ 
        contents: [{ role: "user", parts: [{ text: reasoningPrompt }] }],
        generationConfig: { response_mime_type: "application/json" }
      })
    });

    const proData = await proResp.json();
    if (proData.error) return NextResponse.json({ error: "Pro Quota Exceeded", raw: proData.error.message });

    const rawText = proData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    try {
      let variations = JSON.parse(rawText);
      if (!Array.isArray(variations)) {
        const possibleArray = Object.values(variations).find(val => Array.isArray(val));
        variations = possibleArray || [variations];
      }
      return NextResponse.json({ extractedText, variations });
    } catch (e) {
      return NextResponse.json({ error: "JSON Parse Error", raw: rawText });
    }

  } catch (err: any) {
    return NextResponse.json({ error: "Server Crash", raw: err.message });
  }
}
