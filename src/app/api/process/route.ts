import { NextRequest, NextResponse } from 'next/server';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Using the Cutting Edge models you requested
const FLASH_MODEL = 'gemini-2.5-flash';
const PRO_MODEL = 'gemini-3.1-flash-lite-preview'; // Using Lite for ultra-efficiency as you noted

export async function POST(req: NextRequest) {
  try {
    const { imageUrl } = await req.json();
    if (!GEMINI_API_KEY) return NextResponse.json({ error: 'Key missing' });

    const imageResp = await fetch(imageUrl);
    const arrayBuffer = await imageResp.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString('base64');

    // --- STEP 1: Extraction (Gemini 2.5 Flash) ---
    const flashBody = { contents: [{ parts: [{ text: "EXTRACT ALL TEXT FROM THIS IMAGE. DO NOT SOLVE. Preserve LaTeX." }, { inline_data: { mime_type: 'image/jpeg', data: base64Image } }] }] };
    
    const flashResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${FLASH_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(flashBody)
    });
    
    const flashData = await flashResp.json();
    if (flashData.error) return NextResponse.json({ error: "Gemini 2.5 Error", raw: JSON.stringify(flashData.error) });
    
    const extractedText = flashData.candidates?.[0]?.content?.parts?.[0]?.text || '[No text found]';

    // --- STEP 2: Variations (Gemini 3.1 Flash Lite) ---
    const reasoningPrompt = `
      You are a Pedagogical Engineer. Generate 4 variations of this question: "${extractedText}".
      Return a JSON array of objects with keys: "category", "text", "solution".
      Use LaTeX for math.
    `;

    const proBody = { 
      contents: [{ parts: [{ text: reasoningPrompt }] }],
      generationConfig: { response_mime_type: "application/json" } 
    };

    const proResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${PRO_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(proBody)
    });

    const proData = await proResp.json();
    if (proData.error) return NextResponse.json({ error: "Gemini 3.1 Error", raw: JSON.stringify(proData.error) });

    const rawText = proData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    try {
      let variations = JSON.parse(rawText);
      if (!Array.isArray(variations)) {
        const possibleArray = Object.values(variations).find(val => Array.isArray(val));
        variations = possibleArray || [variations];
      }
      return NextResponse.json({ extractedText, variations });
    } catch (e) {
      return NextResponse.json({ error: "JSON Parse Error", raw: "RAW: " + rawText });
    }

  } catch (err: any) {
    return NextResponse.json({ error: "Server Crash", raw: err.message });
  }
}
