# Question Breaker: Project Documentation

## Goal
Build a web tool that helps users increase understanding of questions they got wrong by generating “question variations” and providing solutions, working seamlessly on both mobile and desktop.

## Core Features
1.  **Cross-Device Session Sync:** 
    *   Desktop generates a 6-character ID (e.g., `XJ3-921`).
    *   Mobile joins via ID to gain upload privileges.
    *   Uses **Supabase Realtime** for instant sync.
2.  **AI Processing (Gemini 3.1):**
    *   **Step 1 (Flash):** Image-to-Text extraction (No solving, preserve LaTeX).
    *   **Step 2 (Pro):** Pedagogical engineering to generate 4 variations (Conceptual flip, Constraint change, Edge case, Hybrid).
3.  **Stealth Mode:** Solutions are hidden by default and revealed via a "Show Solution" button.
4.  **Split View (Desktop):** Original image on the left, AI variations on the right.

## Technical Stack
*   **Frontend:** Next.js 15 (App Router), TypeScript, Tailwind CSS.
*   **Icons:** Lucide React.
*   **Real-time/Backend:** Supabase (Realtime, Storage).
*   **AI Models:** Gemini 1.5 Flash (Extraction) & Gemini 1.5 Pro (Reasoning).
*   **Math Rendering:** react-latex-next (KaTeX).

## Project Structure
*   `src/app/page.tsx`: Main entry point (Adaptive Desktop/Mobile UI).
*   `src/app/api/process/route.ts`: Secure API route for Gemini AI orchestration.
*   `src/lib/supabase.ts`: Supabase client and channel configuration.
*   `src/app/globals.css`: Tailwind base styles.

## Setup Instructions
1.  **Environment Variables:** Create `.env.local` and add:
    ```env
    NEXT_PUBLIC_SUPABASE_URL=your_url
    NEXT_PUBLIC_SUPABASE_ANON_KEY=your_key
    GEMINI_API_KEY=your_google_key
    ```
2.  **Supabase Config:** Create a public storage bucket named `questions`.
3.  **Run:** `npm run dev -- --legacy-peer-deps` (if peer-dep issues persist).

## Future Upgrades
*   Diagram/Shape support.
*   Weakness tracking (Postgres persistence).
*   QR Code for faster mobile joining.
