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
    const { questionImageUrl, questionText, solutionImageUrl, solutionText } = await req.json();
    if (!GEMINI_API_KEY) return NextResponse.json({ error: 'Key missing' });

    let finalQuestionText = questionText || '';
    let finalSolutionText = solutionText || '';

    // --- STEP 1: OCR (Only if text wasn't provided directly) ---
    const imagesToProcess: { mime_type: string, data: string }[] = [];
    if (!finalQuestionText && questionImageUrl) {
      const qResp = await fetch(questionImageUrl);
      if (qResp.ok) imagesToProcess.push({ mime_type: 'image/jpeg', data: Buffer.from(await qResp.arrayBuffer()).toString('base64') });
    }
    if (!finalSolutionText && solutionImageUrl && solutionImageUrl.startsWith('http')) {
      const sResp = await fetch(solutionImageUrl);
      if (sResp.ok) imagesToProcess.push({ mime_type: 'image/jpeg', data: Buffer.from(await sResp.arrayBuffer()).toString('base64') });
    }

    if (imagesToProcess.length > 0) {
      const flashParts: any[] = imagesToProcess.map(img => ({ inline_data: img }));
      flashParts.push({ text: "EXTRACT ALL TEXT. The first image is a QUESTION, the second (if exists) is a SOLUTION. Preserve LaTeX. DO NOT SOLVE." });

      const flashResp = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${OCR_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: "user", parts: flashParts }] })
      });
      const flashData = await flashResp.json();
      const ocrResult = flashData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!finalQuestionText) finalQuestionText = ocrResult;
    }

    if (!finalQuestionText) return NextResponse.json({ error: "No question content found" });

    // --- STEP 2: Advanced Pedagogical Reasoning (Gemini 3.1) ---
    const reasoningPrompt = `
      You are a Senior Pedagogical Architect. 
      
      INPUT QUESTION: 
      "${finalQuestionText}"
      
      USER'S PROVIDED SOLUTION (Reference for Rigor & Structure ONLY):
      "${finalSolutionText || 'Not provided'}"
      
      TASK:
      1. INTERNAL INTERPRETATION (Deconstruct):
         - Identify Core concept(s) and Sub-concepts.
         - Map out Constraints and Hidden assumptions.
      
      2. APPLY "NEAR-MISS" LOGIC:
         - Identify where a student would fail or take a shortcut.
         - Design variations that specifically target those insights.
      
      3. VARIATION STRATEGY:
         - Change only ONE or TWO dimensions while testing the SAME core concept.
         - Increase conceptual difficulty or abstraction.
      
      4. GENERATE 4 VARIATIONS based on these types:
         - Conceptual Flip (Reverse objective or solve for a different parameter)
         - Constraint Change (Change a physical/logical limit to force a new approach)
         - Edge Case (Testing the boundaries where standard logic is challenged)
         - Hybrid Problem (Inject a concept from a related sub-topic)
         - Abstraction Jump (Generalize the problem or move to a higher-order system)
      
      5. RIGOR MATCHING:
         - The resulting solutions MUST match the academic rigor, depth, and step-by-step sophistication of the user's provided solution.
      
      OUTPUT FORMAT: JSON array of 4 objects.
      Keys: "category", "text", "solution". 
      Use LaTeX for all math.
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
    if (proData.error) return NextResponse.json({ error: "Reasoning Error", raw: proData.error.message });

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
