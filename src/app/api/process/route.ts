import { NextRequest, NextResponse } from 'next/server';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const FLASH_MODEL = 'gemini-1.5-flash';
const PRO_MODEL = 'gemini-1.5-pro';

export async function POST(req: NextRequest) {
  try {
    const { imageUrl, userSolution } = await req.json();
    console.log("Processing image URL:", imageUrl);

    if (!GEMINI_API_KEY) {
      console.error("CRITICAL: GEMINI_API_KEY is missing!");
      return NextResponse.json({ error: 'Gemini API Key missing' }, { status: 500 });
    }

    // --- STEP 1: Fetch the image ---
    let base64Image = '';
    try {
      const imageResp = await fetch(imageUrl);
      if (!imageResp.ok) throw new Error("Could not fetch image: " + imageResp.statusText);
      const imageBlob = await imageResp.blob();
      const arrayBuffer = await imageBlob.arrayBuffer();
      base64Image = Buffer.from(arrayBuffer).toString('base64');
    } catch (fetchErr: any) {
      return NextResponse.json({ error: "Image fetch failed: " + fetchErr.message }, { status: 500 });
    }

    // --- STEP 2: Extraction (Flash) ---
    const extractionPrompt = `EXTRACT ALL TEXT FROM THIS IMAGE. DO NOT SOLVE. Preserve LaTeX formatting.`;

    const flashBody = {
      contents: [{
        parts: [
          { text: extractionPrompt },
          { inline_data: { mime_type: 'image/jpeg', data: base64Image } }
        ]
      }]
    };

    const flashResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${FLASH_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(flashBody)
    });

    const flashData = await flashResp.json();
    const extractedText = flashData.candidates?.[0]?.content?.parts?.[0]?.text || '[No text found]';

    // --- STEP 3: Reasoning (Pro) ---
    const reasoningPrompt = `
      ROLE: Pedagogical Engineer
      QUESTION: "${extractedText}"
      TASK: Generate 4 variations (Conceptual flip, Constraint change, Edge case, Hybrid) with step-by-step LaTeX solutions.
      FORMAT: Return JSON array: [{category, text, solution}].
    `;

    const proBody = {
      contents: [{
        parts: [{ text: reasoningPrompt }]
      }],
      generationConfig: {
        response_mime_type: "application/json"
      }
    };

    const proResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${PRO_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(proBody)
    });

    const proData = await proResp.json();
    const rawVariations = proData.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    const variations = JSON.parse(rawVariations);

    return NextResponse.json({ extractedText, variations });

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
