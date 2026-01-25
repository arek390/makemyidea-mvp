const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']
const missing = required.filter((key) => !process.env[key] || !String(process.env[key]).trim())

if (missing.length) {
  console.error(
    `[env] Missing required build-time env: ${missing.join(
      ', '
    )}. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel Environment Variables (Preview/Production) and redeploy without build cache.`
  )
  process.exit(1)
}

console.log('[env] Supabase build-time env present.')
