import { NextRequest, NextResponse } from 'next/server';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OCR_MODEL = 'gemini-2.5-flash-lite';
const REASONING_MODEL = 'gemini-3.1-flash-lite-preview';

export const maxDuration = 60; // Increase timeout for Vercel

async function fetchWithRetry(url: string, options: any, maxRetries = 3): Promise<Response> {
  for (let i = 0; i < maxRetries; i++) {
    const res = await fetch(url, options);
    // Retry on Rate Limit (429) OR Service Unavailable (503)
    if (res.status === 429 || res.status === 503) {
      const wait = Math.pow(2, i) * 1000; // Start with 1s instead of 3s
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    return res;
  }
  return fetch(url, options);
}

// Robust JSON extraction helper
function extractAndCleanJson(raw: string) {
  try {
    // 1. Remove markdown blocks if present
    let clean = raw.replace(/```json/g, '').replace(/```/g, '').trim();
    
    // 2. Find the bounds of the actual JSON object or array
    const firstBrace = clean.indexOf('{');
    const firstBracket = clean.indexOf('[');
    const startIdx = (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) ? firstBrace : firstBracket;
    
    const lastBrace = clean.lastIndexOf('}');
    const lastBracket = clean.lastIndexOf(']');
    const endIdx = Math.max(lastBrace, lastBracket);

    if (startIdx === -1 || endIdx === -1) throw new Error("No JSON found");
    
    clean = clean.substring(startIdx, endIdx + 1);

    // 3. Common AI JSON sins: Trailing commas
    clean = clean.replace(/,(\s*[\]}])/g, '$1');
    
    // 4. Handle escaped newlines that are sometimes broken - ONLY if they are inside strings
    // Actually, with response_mime_type: 'application/json', we should trust the model more.
    // The previous blanket replace(/\n/g, '\\n') was breaking valid JSON structure.
    
    // Attempt parse
    return JSON.parse(clean);
  } catch (e) {
    // Last ditch: just try basic parse if cleaning failed logic
    try {
      return JSON.parse(raw.trim());
    } catch (finalError) {
      throw new Error(`Parse failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  }
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
        - OPTION ANALYSIS (MCQ/MRQ): For every MCQ/MRQ, the 'solution' MUST include a dedicated analysis for EVERY option. Use labels A, B, C, D to refer to the options. Explain why the correct ones are correct and why every incorrect one is wrong. Add DOUBLE newline characters (\\n\\n) after each option's explanation for clear separation.
        - SAFE LATEX: Wrap ALL mathematical expressions, formulas, and technical notations in $ delimiters (e.g., $E=mc^2$).
          - Use ONLY standard LaTeX commands. Avoid complex environments.
          - Use \\frac{a}{b} for fractions, \\sqrt{x} for roots, and ^ for exponents.
          - Ensure all opening $ have a corresponding closing $.
        
        OUTPUT FORMAT (STRICT JSON):
        {
          "allConceptsTested": true | false,
          "conceptTree": ["Root Concept", "├── Sub Concept A", "│   └── Detail 1", "└── Sub Concept B"],
          "questions": [
            {
              "type": "mcq | mrq | short | open",
              "concept": "Name of the specific concept being tested",
              "question": "...",
              "options": ["Option text content ONLY", "Option text content ONLY", "Option text content ONLY", "Option text content ONLY"], 
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
          generationConfig: { 
            response_mime_type: "application/json",
            max_output_tokens: 2048
          }
        })
      });

      if (!proResp.ok) {
        const errorText = await proResp.text();
        console.error("AI Pipeline: Gemini API HTTP Error:", proResp.status, errorText);
        return NextResponse.json({ 
          error: "Gemini API HTTP Error", 
          status: proResp.status,
          message: `The AI service returned an error (${proResp.status}). It might be overloaded.`
        });
      }

      const proData = await proResp.json();
      
      if (proData.error) {
        console.error("AI Pipeline: Extraction API Error:", JSON.stringify(proData.error, null, 2));
        return NextResponse.json({ 
          error: "Gemini API Error", 
          message: proData.error.message || "Unknown API Error",
          code: proData.error.code || 500
        });
      }

      const rawText = proData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!rawText) {
        console.error("AI Pipeline: No candidates returned. Finish Reason:", proData.candidates?.[0]?.finishReason);
        return NextResponse.json({ error: "Safety/Limit Block", detail: proData.candidates?.[0]?.finishReason });
      }
      
      try {
        const result = extractAndCleanJson(rawText);
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
         - For MCQs/MRQs, put every option on a NEW LINE. DO NOT include internal labels like "i." or "A.". Just provide the option text.
         - Use DOUBLE newline characters between options.
         - Ensure math is in LaTeX.
      
      4. SOLUTION RIGOR (STRICT):
         - Provide a detailed step-by-step solution matching the reference rigor.
         - FOR MCQ/MRQ: You MUST explicitly address EVERY option using labels A, B, C, D. Explain why the correct ones are correct AND why every incorrect one is wrong. Use DOUBLE newlines (\\n\\n) between each option's analysis.
      
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
