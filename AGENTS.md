# Question Breaker: Collaborative Rules

## Project Overview
A web-based pedagogical tool that generates question variations using Gemini 3.1.

## Tech Stack
- **Framework:** Next.js 15 (App Router)
- **Real-time:** Supabase (Broadcast + Storage)
- **AI:** Gemini 1.5 Flash (Extraction) + Gemini 1.5 Pro (Reasoning)
- **Deployment:** Vercel

## Deployment Checklist
1. **GitHub:** Ensure all code is pushed to `main`.
2. **Vercel Env:** `GEMINI_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. **Supabase Storage:** Public bucket named `questions` with `Allow Public Uploads` policy (INSERT/SELECT for `anon`).

## Development Note
Next.js 15 requires `--legacy-peer-deps` for `react-latex-next` and `lucide-react` until they update their peer dependency lists for React 19.
