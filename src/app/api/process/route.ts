import { NextRequest, NextResponse } from 'next/server';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Using the most stable model identifiers
const FLASH_MODEL = 'gemini-1.5-flash';
const PRO_MODEL = 'gemini-1.5-pro';

export async function POST(req: NextRequest) {
  try {
    const { imageUrl } = await req.json();
    if (!GEMINI_API_KEY) return NextResponse.json({ error: 'Key missing' });

    // 1. Fetch Image
    const imageResp = await fetch(imageUrl);
    const arrayBuffer = await imageResp.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString('base64');

    // 2. Extract Text (Flash)
    const flashBody = { contents: [{ parts: [{ text: "EXTRACT ALL TEXT FROM THIS IMAGE. DO NOT SOLVE. Preserve LaTeX." }, { inline_data: { mime_type: 'image/jpeg', data: base64Image } }] }] };
    
    // SWITCHING TO V1 STABLE API
    const flashResp = await fetch(`https://generativelanguage.googleapis.com/v1/models/${FLASH_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(flashBody)
    });
    
    const flashData = await flashResp.json();
    if (flashData.error) return NextResponse.json({ error: "Flash Error", raw: JSON.stringify(flashData.error) });
    
    const extractedText = flashData.candidates?.[0]?.content?.parts?.[0]?.text || '[No text found]';

    // 3. Generate Variations (Pro)
    const reasoningPrompt = `
      You are a Pedagogical Engineer. Generate 4 distinct variations of this question: "${extractedText}".
      Return a JSON array of objects with keys: "category", "text", "solution".
      Use LaTeX for math.
    `;

    const proBody = { 
      contents: [{ parts: [{ text: reasoningPrompt }] }],
      generationConfig: { response_mime_type: "application/json" } 
    };

    const proResp = await fetch(`https://generativelanguage.googleapis.com/v1/models/${PRO_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(proBody)
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
      return NextResponse.json({ error: "JSON Parse Error", raw: "RAW: " + rawText });
    }

  } catch (err: any) {
    return NextResponse.json({ error: "Server Crash", raw: err.message });
  }
}
