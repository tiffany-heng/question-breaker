import { NextRequest, NextResponse } from 'next/server';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const FLASH_MODEL = 'gemini-1.5-flash';
const PRO_MODEL = 'gemini-1.5-pro';

export async function POST(req: NextRequest) {
  try {
    const { imageUrl } = await req.json();
    if (!GEMINI_API_KEY) return NextResponse.json({ error: 'Key missing' }, { status: 500 });

    // 1. Fetch Image
    const imageResp = await fetch(imageUrl);
    const imageBlob = await imageResp.blob();
    const base64Image = Buffer.from(await imageBlob.arrayBuffer()).toString('base64');

    // 2. Extract Text (Flash)
    const flashBody = { contents: [{ parts: [{ text: "EXTRACT ALL TEXT FROM THIS IMAGE. DO NOT SOLVE. Preserve LaTeX." }, { inline_data: { mime_type: 'image/jpeg', data: base64Image } }] }] };
    const flashResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${FLASH_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(flashBody)
    });
    const flashData = await flashResp.json();
    const extractedText = flashData.candidates?.[0]?.content?.parts?.[0]?.text || '[No text found]';

    // 3. Generate Variations (Pro) with FORCED JSON MODE
    const reasoningPrompt = `
      You are a Pedagogical Engineer. Generate 4 distinct variations of this question: "${extractedText}".
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
    const rawText = proData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    try {
      const variations = JSON.parse(rawText);
      return NextResponse.json({ extractedText, variations });
    } catch (e) {
      return NextResponse.json({ error: "JSON Parse Error", raw: rawText.substring(0, 300) });
    }

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
