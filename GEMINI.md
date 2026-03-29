# Question Breaker: Project Documentation

## Current Status: ✅ MVP LIVE
The application is fully functional and deployed on Vercel. 
- **Desktop:** Host sessions, generates ID, displays AI results.
- **Mobile:** Joins sessions, uploads photos via Supabase Storage.
- **AI:** Integrated with Gemini 2.5 Flash (OCR) and Gemini 3.1 Flash Lite (Reasoning).

## Core Features (Working)
1. **Real-time Sync:** Uses Supabase Broadcast for instant phone-to-laptop updates.
2. **JSON Mode AI:** Forced JSON output for reliable variation generation.
3. **LaTeX Support:** Math formulas rendered via `react-latex-next`.

## Deployment Info
- **URL:** [Your Vercel URL]
- **Environment Variables:** `GEMINI_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Tomorrow's Tasks (March 29, 2026)
- [ ] **Output Quality:** Refine the reasoning prompt for better "Pedagogical" variations.
- [ ] **Interface:** Polish the Tailwind styles and remove debug "Connection Doctor" UI.
- [ ] **Bugs:** Audit session cleanup and storage management.
- [ ] **Feature:** Add QR Code for faster mobile joining.
