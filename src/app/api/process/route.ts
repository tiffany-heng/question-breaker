import { NextRequest, NextResponse } from 'next/server';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OCR_MODEL = 'gemini-2.5-flash-lite';
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
  console.log("AI Pipeline: Starting request...");
  try {
    const body = await req.json();
    const { mode, questionImageUrl, questionText, solutionImageUrl, solutionText, extractContent, subject, level } = body;
    
    if (!GEMINI_API_KEY) {
      console.error("AI Pipeline: Missing GEMINI_API_KEY");
      return NextResponse.json({ error: 'Key missing' });
    }

    if (mode === 'extract') {
      const { extractContent, subject, level, existingQuestions = [] } = body;
      console.log(`AI Pipeline: Starting Extraction for ${subject} at ${level} level. Existing questions: ${existingQuestions.length}`);
      
      const existingText = existingQuestions.length > 0 
        ? `\n\nALREADY GENERATED QUESTIONS (DO NOT REPEAT THESE):\n${JSON.stringify(existingQuestions.map((q: any) => q.question))}`
        : '';

      const extractPrompt = `
        You are an Expert Educator in ${subject || 'General Education'}.
        
        CONTEXT:
        Subject: ${subject}
        Target Level: ${level}
        Source Material:
        ${extractContent}
        ${existingText}

        TASK:
        1. CONCEPT GAP ANALYSIS: Analyze the 'ALREADY GENERATED QUESTIONS' list against the 'Source Material'.
        2. PRIORITIZATION:
           - STAGE 1 (Coverage): If there are UNTESTED concepts, you MUST generate questions for these uncovered topics first.
           - STAGE 2 (Synthesis): If ALL major concepts are already covered (allConceptsTested: true), generate "Hybrid Questions" that combine 2 or more concepts in complex, new ways.
        3. Create a COMPREHENSIVE CONCEPT TREE representing the main themes of the entire text in a directory-style format.
        4. GENERATE a diverse mix of 3-5 BRAND NEW high-quality questions.
        5. For each concept, STRATEGICALLY choose the format (MCQ, MRQ, Short, or Open) that most effectively tests that specific level of understanding.
        
        REQUIREMENTS:
        - DIRECT RELEVANCE: Every question MUST be directly derived from the provided 'Source Material' and strictly adhere to the '${subject}' syllabus at the '${level}' level.
        - Questions must test application, reasoning, or calculation.
        - Avoid simple definition-based questions.
        - Match difficulty to ${level} standards.
        - Ensure total clarity and precision in phrasing.
        - CRITICAL: Questions MUST explicitly state the required answer format where applicable (e.g., "Give your answer to 2 decimal places," "Include units in your response," or "Select exactly three options").
        - OPTION ANALYSIS (MCQ/MRQ): For every MCQ/MRQ, the 'solution' MUST include a dedicated analysis for EVERY option. Explain why the correct ones are correct and why every incorrect one is wrong. Add DOUBLE newline characters after each option's explanation for clarity.
        - SAFE LATEX: Wrap ALL mathematical expressions, formulas, and technical notations in $ delimiters (e.g., $E=mc^2$).
          - Use ONLY standard LaTeX commands. Avoid complex environments.
          - Use \frac{a}{b} for fractions, \sqrt{x} for roots, and ^ for exponents.
          - Ensure all opening $ have a corresponding closing $.
        
        OUTPUT FORMAT (STRICT JSON):
        {
          "allConceptsTested": true | false,
          "conceptTree": ["Root Concept", "├── Sub Concept A", "│   └── Detail 1", "└── Sub Concept B"],
          "questions": [
            {
              "type": "mcq | mrq | short | open",
              "question": "...",
              "options": ["i. ...", "ii. ...", "iii. ...", "iv. ..."], // ONLY for mcq/mrq
              "answer": "...",
              "solution": "..."
            }
          ]
        }
      `;

      const proResp = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${REASONING_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ 
          contents: [{ role: "user", parts: [{ text: extractPrompt }] }],
          generationConfig: { response_mime_type: "application/json" }
        })
      });

      const proData = await proResp.json();
      const rawText = proData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      try {
        // Find the first '{' and the last '}' to handle any surrounding text
        const firstBrace = rawText.indexOf('{');
        const lastBrace = rawText.lastIndexOf('}');
        
        if (firstBrace === -1 || lastBrace === -1) {
          throw new Error("No JSON object found in response");
        }
        
        const cleanJson = rawText.substring(firstBrace, lastBrace + 1);
        const result = JSON.parse(cleanJson);
        return NextResponse.json(result);
      } catch (e) {
        console.error("AI Pipeline: Extraction JSON Parse Error", e);
        return NextResponse.json({ error: "Extraction JSON Error", raw: rawText });
      }
    }

    // --- EXISTING BREAKER LOGIC ---
    let finalQuestionText = questionText || '';
    let finalSolutionText = solutionText || '';

    // --- STEP 1: OCR ---
    const imagesToProcess: { mime_type: string, data: string }[] = [];
    if (!finalQuestionText && questionImageUrl) {
      console.log("AI Pipeline: Fetching question image...");
      const qResp = await fetch(questionImageUrl);
      if (qResp.ok) {
        imagesToProcess.push({ mime_type: 'image/jpeg', data: Buffer.from(await qResp.arrayBuffer()).toString('base64') });
        console.log("AI Pipeline: Question image loaded.");
      }
    }

    if (!finalSolutionText && solutionImageUrl && solutionImageUrl.startsWith('http')) {
      console.log("AI Pipeline: Fetching solution image...");
      const sResp = await fetch(solutionImageUrl);
      if (sResp.ok) {
        imagesToProcess.push({ mime_type: 'image/jpeg', data: Buffer.from(await sResp.arrayBuffer()).toString('base64') });
        console.log("AI Pipeline: Solution image loaded.");
      }
    }

    if (imagesToProcess.length > 0) {
      console.log(`AI Pipeline: Starting OCR with ${OCR_MODEL}...`);
      const flashParts: any[] = imagesToProcess.map(img => ({ inline_data: img }));
      flashParts.push({ text: "EXTRACT ALL TEXT. QUESTION first, then SOLUTION. Preserve LaTeX. DO NOT SOLVE." });

      const flashResp = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${OCR_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: "user", parts: flashParts }] })
      });
      const flashData = await flashResp.json();
      const ocrResult = flashData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      console.log("AI Pipeline: OCR Complete. Length:", ocrResult.length);
      if (!finalQuestionText) finalQuestionText = ocrResult;
    }

    if (!finalQuestionText) {
      console.warn("AI Pipeline: No question text found after OCR.");
      return NextResponse.json({ error: "No content found" });
    }

    // --- STEP 2: Reasoning ---
    console.log(`AI Pipeline: Starting Reasoning with ${REASONING_MODEL}...`);
    const reasoningPrompt = `
      You are a Senior Pedagogical Architect.
      
      INPUT QUESTION: "${finalQuestionText}"
      REFERENCE SOLUTION (Rigor Benchmark): "${finalSolutionText || 'Not provided'}"
      
      TASK:
      1. ANALYZE: Identify Core concepts, Constraints, and Hidden assumptions.
      2. GENERATE 4 variations: Conceptual Flip, Constraint Change, Edge Case, Hybrid Problem, or Abstraction Jump.
      
      3. QUESTION FORMATTING (STRICT):
         - Start every question with a type label: [MCQ - Choose only one], [MRQ - Select all that apply], or [SRQ - Short Response Question].
         - For MCQs/MRQs, put every option on a NEW LINE starting with "i.", "ii.", "iii.", "iv.".
         - Use DOUBLE newline characters between options.
         - Ensure math is in LaTeX.
      
      4. SOLUTION RIGOR (STRICT):
         - Provide a detailed step-by-step solution matching the reference rigor.
         - FOR MCQ/MRQ: You MUST explicitly address EVERY option. Explain why the correct ones are correct AND why every incorrect one is wrong. Use DOUBLE newlines between each option's analysis.
      
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

    console.log("AI Pipeline: Reasoning Request Sent.");
    const proData = await proResp.json();
    console.log("AI Pipeline: Reasoning Response Received.");
    
    if (proData.error) {
      console.error("AI Pipeline: Gemini Error:", proData.error);
      return NextResponse.json({ error: "Gemini Error", raw: JSON.stringify(proData.error) });
    }

    const rawText = proData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log("AI Pipeline: Raw Text Length:", rawText.length);

    try {
      // Clean up the response in case it's wrapped in markdown backticks
      const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      let variations = JSON.parse(cleanJson);
      
      if (!Array.isArray(variations)) {
        const possibleArray = Object.values(variations).find(val => Array.isArray(val));
        variations = possibleArray || [variations];
      }
      return NextResponse.json({ extractedText: finalQuestionText, variations });
    } catch (e) {
      console.error("AI Pipeline: JSON Parse Error", e);
      return NextResponse.json({ error: "JSON Error", raw: rawText });
    }
  } catch (err: any) {
    return NextResponse.json({ error: "Server Crash", raw: err.message });
  }
}
