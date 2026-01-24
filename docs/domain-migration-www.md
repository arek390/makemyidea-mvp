Domain migration: www canonical

Vercel
- Set https://www.makemyidea.work as the primary domain.
- Redirect apex -> www (makemyidea.work -> www.makemyidea.work).

Supabase Auth
- Site URL: https://www.makemyidea.work
- Redirect URLs:
  - https://www.makemyidea.work/auth/callback
  - https://makemyidea.work/auth/callback
  - http://localhost:5173/auth/callback

Notes
- Changing domains logs users out because auth storage is origin-bound (PKCE/code_verifier is tied to the original origin).
- Auth redirects in the app are origin-dynamic via window.location.origin.
- Canonical URL for non-auth links is VITE_CANONICAL_URL (defaults to https://www.makemyidea.work).
