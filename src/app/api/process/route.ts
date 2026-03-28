import { NextRequest, NextResponse } from 'next/server';

// Note: In a real production app, you'd use the '@google/generative-ai' package.
// For this MVP, we'll use a clean fetch-based implementation to avoid dependency bloat.

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const FLASH_MODEL = 'gemini-1.5-flash';
const PRO_MODEL = 'gemini-1.5-pro';

export async function POST(req: NextRequest) {
  try {
    const { imageUrl, userSolution } = await req.json();

    if (!GEMINI_API_KEY) {
      return NextResponse.json({ error: 'Gemini API Key missing' }, { status: 500 });
    }

    // --- STEP 1: Image to Text (Gemini 3.1 Flash) ---
    // Extract text exactly as seen, no solving.
    
    const extractionPrompt = `
      EXTRACT ALL TEXT FROM THIS IMAGE.
      RULES:
      1. Do not solve anything.
      2. Do not infer missing info.
      3. Preserve all numbers, symbols, and formatting exactly.
      4. Use LaTeX for math symbols if possible.
      5. If a part is unclear, output [unclear].
      6. Return CLEAN TEXT ONLY.
    `;

    // Fetch the image as a buffer
    const imageResp = await fetch(imageUrl);
    const imageBlob = await imageResp.blob();
    const base64Image = Buffer.from(await imageBlob.arrayBuffer()).toString('base64');

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
    const extractedText = flashData.candidates?.[0]?.content?.parts?.[0]?.text || '[Error Extracting Text]';

    // --- STEP 2: Logic Variation Generation (Gemini 3.1 Pro) ---
    // Act as a Pedagogical Engineer.

    const reasoningPrompt = `
      ROLE: Pedagogical Engineer
      INPUT TEXT: "${extractedText}"
      OPTIONAL USER SOLUTION: "${userSolution || 'None provided'}"

      TASK:
      Analyze the core concept of this question and generate 4 distinct variations.
      Each variation should test the SAME logic but change the "surface" variables.
      
      CATEGORIES:
      1. Conceptual Flip (Reverse the target variable)
      2. Constraint Change (Change a limit or range)
      3. Edge Case (Test the extreme boundary)
      4. Hybrid Problem (Combine with a related concept)

      FORMAT:
      Return a JSON array of objects with keys: "category", "text", and "solution".
      All formulas MUST use LaTeX syntax ($inline$ or $$display$$).
      Be rigorous in the solution writing.
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

    return NextResponse.json({
      extractedText,
      variations
    });

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
