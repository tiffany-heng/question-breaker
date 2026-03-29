# Question Breaker: Project Documentation

## Current Status: ✅ MVP LIVE & SECURED
The application is a cross-device pedagogical tool using Supabase Realtime and Gemini 3.1.

## Core Architecture
1.  **Persistent Room System:**
    *   **Auth:** `supabase.auth.signInAnonymously()` links Laptop, Phone, and iPad to the same User ID.
    *   **Tables:**
        *   `rooms`: Manages 6-digit pairing codes and ownership.
        *   `questions`: Stores images, raw text, and AI-generated variations.
    *   **Sync:** `postgres_changes` listener ensures that if you type on a laptop, the phone screen updates instantly.

2.  **Universal Dashboard:**
    *   All devices see the professional split-screen view.
    *   **Dual-Mode Input:** Toggle between "Snap Image" and "Type Text" for both Questions and Solutions.
    *   **Mode Syncing:** If one device switches to "Text Mode," all others follow suit upon hitting "Submit."

3.  **AI Logic (Gemini 3.1 + 2.5):**
    *   **OCR:** `gemini-2.5-flash-lite` extracts text from question/solution images.
    *   **Reasoning:** `gemini-3.1-flash-lite-preview` generates 4 variations (Conceptual Flip, Constraint Change, etc.).
    *   **Formatting:** Strict LaTeX support and option-by-option distractor analysis for MCQs.

## Deployment & Environment
*   **Vercel:** Deployed with `GEMINI_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
*   **Supabase Storage:** Public bucket `questions` with RLS policies allowing authenticated uploads.

## Technical Rules (For Future Reference)
*   **Dependency:** Always use `--legacy-peer-deps` for npm.
*   **Database Fixes:** If RLS fails, ensure policies include `WITH CHECK (true)` for inserts.
*   **Realtime:** Tables `rooms` and `questions` must be added to the `supabase_realtime` publication.
*   **Manual Trigger:** The AI only runs when the user clicks "Submit to Gemini" to prevent loopbacks.

## Next Steps
- [ ] Debug the "Handshaking with Gemini" hang (suspect Vercel timeout or model availability).
- [ ] Add QR Code generation for the 6-digit room code.
- [ ] Implement a "Session History" sidebar to toggle between previous questions.
