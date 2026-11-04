# Tourismo · Data Basis platform

Internal platform for the Data Basis team: stop sales, openings, tasks per system.

- **Website:** React + Vite, published automatically to GitHub Pages on every change (`.github/workflows/deploy.yml`).
- **Database & login:** Supabase project `tourismo-data-basis` (connection in `src/config.js`).
- **Database setup:** `supabase/sql/01_database_setup.sql` (already run once in Supabase).
- **Server function:** `supabase/functions/admin-users/index.ts` (deployed in Supabase → Edge Functions).

Nothing secret is stored in this repository.
