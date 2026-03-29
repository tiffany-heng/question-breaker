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

    // --- STEP 1: OCR ---
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
      flashParts.push({ text: "EXTRACT ALL TEXT. QUESTION first, then SOLUTION. Preserve LaTeX. DO NOT SOLVE." });

      const flashResp = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${OCR_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: "user", parts: flashParts }] })
      });
      const flashData = await flashResp.json();
      const ocrResult = flashData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!finalQuestionText) finalQuestionText = ocrResult;
    }

    if (!finalQuestionText) return NextResponse.json({ error: "No content found" });

    // --- STEP 2: Reasoning (Pedagogical Architect) ---
    const reasoningPrompt = `
      You are a Senior Pedagogical Architect.
      
      INPUT QUESTION: "${finalQuestionText}"
      REFERENCE SOLUTION (Rigor Benchmark): "${finalSolutionText || 'Not provided'}"
      
      TASK:
      1. ANALYZE: Identify Core concepts, Constraints, and Hidden assumptions.
      2. GENERATE 4 variations: Conceptual Flip, Constraint Change, Edge Case, Hybrid Problem, or Abstraction Jump.
      
      3. QUESTION FORMATTING (STRICT):
         - Start every question with a type label: [MCQ - Choose only one], [MRQ - Select all that apply], or [SRQ - Short Response].
         - For MCQs/MRQs, put every option on a NEW LINE starting with "i.", "ii.", "iii.", "iv.".
         - Use actual newline characters between options.
         - Ensure math is in LaTeX.
      
      4. SOLUTION RIGOR (STRICT):
         - Provide a detailed step-by-step solution matching the reference rigor.
         - FOR MCQ/MRQ: You MUST explicitly address EVERY option. Explain why the correct ones are correct AND why every incorrect one is wrong.
      
      OUTPUT: JSON array of objects with keys "category", "text", "solution".
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
    const rawText = proData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    try {
      let variations = JSON.parse(rawText);
      if (!Array.isArray(variations)) {
        const possibleArray = Object.values(variations).find(val => Array.isArray(val));
        variations = possibleArray || [variations];
      }
      return NextResponse.json({ extractedText: finalQuestionText, variations });
    } catch (e) {
      return NextResponse.json({ error: "JSON Error", raw: rawText });
    }
  } catch (err: any) {
    return NextResponse.json({ error: "Server Crash", raw: err.message });
  }
}
