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
    const flashBody = { contents: [{ parts: [{ text: "EXTRACT ALL TEXT FROM THIS IMAGE. DO NOT SOLVE." }, { inline_data: { mime_type: 'image/jpeg', data: base64Image } }] }] };
    const flashResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${FLASH_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(flashBody)
    });
    const flashData = await flashResp.json();
    const extractedText = flashData.candidates?.[0]?.content?.parts?.[0]?.text || '[No text]';

    // 3. Generate Variations (Pro)
    const reasoningPrompt = `
      You are a Pedagogical Engineer. 
      Analyze this question: "${extractedText}"
      Generate 4 variations (Conceptual flip, Constraint change, Edge case, Hybrid) with step-by-step solutions.
      
      CRITICAL: You MUST output ONLY a valid JSON array. No text before or after.
      FORMAT: [{"category": "...", "text": "...", "solution": "..."}]
    `;

    const proBody = { contents: [{ parts: [{ text: reasoningPrompt }] }] };
    const proResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${PRO_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(proBody)
    });

    const proData = await proResp.json();
    const rawText = proData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // ROBUST PARSER
    try {
      const start = rawText.indexOf('[');
      const end = rawText.lastIndexOf(']') + 1;
      if (start === -1) throw new Error("No array found");
      const jsonStr = rawText.slice(start, end);
      const variations = JSON.parse(jsonStr);
      return NextResponse.json({ extractedText, variations });
    } catch (e) {
      // If parsing fails, send the raw text back so we can see what happened
      return NextResponse.json({ 
        error: "AI Formatting Error", 
        raw: rawText.substring(0, 500) 
      });
    }

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
