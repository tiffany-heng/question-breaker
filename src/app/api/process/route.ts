import { NextRequest, NextResponse } from 'next/server';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const FLASH_MODEL = 'gemini-2.0-flash';
const PRO_MODEL = 'gemini-3.1-flash-lite-preview';

export async function POST(req: NextRequest) {
  try {
    const { questionImageUrl, solutionImageUrl, userSolutionText } = await req.json();
    if (!GEMINI_API_KEY) return NextResponse.json({ error: 'Key missing' });

    // 1. Fetch Question Image (Required)
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
        console.warn("Optional solution image failed to load, skipping...");
      }
    }

    // --- STEP 1: Full Extraction (Flash 2.0) ---
    const flashParts = [
      { text: "EXTRACT ALL TEXT FROM THE QUESTION IMAGE. DO NOT SOLVE. Preserve LaTeX." },
      { inline_data: { mime_type: 'image/jpeg', data: qBase64 } }
    ];
    
    // Only add solution image if we actually have one
    if (sBase64) {
      flashParts.push({ text: "REFER TO THIS SOLUTION IMAGE IF NEEDED FOR CONTEXT:" });
      flashParts.push({ inline_data: { mime_type: 'image/jpeg', data: sBase64 } });
    }

    const flashResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${FLASH_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: flashParts }] })
    });
    
    const flashData = await flashResp.json();
    if (flashData.error) return NextResponse.json({ error: "Flash Error", raw: JSON.stringify(flashData.error) });
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
    if (proData.error) return NextResponse.json({ error: "Pro Error", raw: JSON.stringify(proData.error) });

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
