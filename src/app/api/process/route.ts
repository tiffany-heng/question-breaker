import { NextRequest, NextResponse } from 'next/server';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const FLASH_MODEL = 'gemini-2.0-flash';
const PRO_MODEL = 'gemini-3.1-flash-lite-preview';

export async function POST(req: NextRequest) {
  try {
    const { questionImageUrl, solutionImageUrl, userSolutionText } = await req.json();
    if (!GEMINI_API_KEY) return NextResponse.json({ error: 'Key missing' });

    // 1. Fetch Question Image
    const qResp = await fetch(questionImageUrl);
    const qBuffer = await qResp.arrayBuffer();
    const qBase64 = Buffer.from(qBuffer).toString('base64');

    // 2. Fetch Solution Image (Optional)
    let sBase64 = '';
    if (solutionImageUrl) {
      const sResp = await fetch(solutionImageUrl);
      const sBuffer = await sResp.arrayBuffer();
      sBase64 = Buffer.from(sBuffer).toString('base64');
    }

    // --- STEP 1: Full Extraction (Flash 2.0) ---
    const extractionPrompt = `
      EXTRACT ALL TEXT FROM THE QUESTION IMAGE. 
      IF A SOLUTION IMAGE IS PROVIDED, EXTRACT THAT TOO. 
      DO NOT SOLVE. Preserve LaTeX.
    `;

    const flashParts = [
      { text: extractionPrompt },
      { inline_data: { mime_type: 'image/jpeg', data: qBase64 } }
    ];
    if (sBase64) flashParts.push({ inline_data: { mime_type: 'image/jpeg', data: sBase64 } });

    const flashResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${FLASH_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: flashParts }] })
    });
    
    const flashData = await flashResp.json();
    if (flashData.error) return NextResponse.json({ error: "Gemini Error", raw: JSON.stringify(flashData.error) });
    const extractedText = flashData.candidates?.[0]?.content?.parts?.[0]?.text || '[No text found]';

    // --- STEP 2: Variations (Gemini 3.1 Flash Lite) ---
    const reasoningPrompt = `
      You are a Pedagogical Engineer. 
      QUESTION TEXT: "${extractedText}"
      PROVIDED SOLUTION HINT: "${userSolutionText || 'None'}"
      
      TASK: Generate 4 distinct variations (Conceptual flip, Constraint change, Edge case, Hybrid) with step-by-step LaTeX solutions.
      Return a JSON array of objects with keys: "category", "text", "solution".
    `;

    const proResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${PRO_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: reasoningPrompt }] }],
        generationConfig: { response_mime_type: "application/json" }
      })
    });

    const proData = await proResp.json();
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
