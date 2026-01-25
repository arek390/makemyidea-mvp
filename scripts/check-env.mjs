const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']
const values = {
  VITE_SUPABASE_URL: String(process.env.VITE_SUPABASE_URL || ''),
  VITE_SUPABASE_ANON_KEY: String(process.env.VITE_SUPABASE_ANON_KEY || ''),
}
const missing = required.filter((key) => !values[key] || !values[key].trim())

if (missing.length) {
  console.error(
    `[env] Missing required build-time env: ${missing.join(
      ', '
    )}. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel Environment Variables (Preview/Production) and redeploy without build cache.`
  )
  process.exit(1)
}

console.log(
  `[env] OK: VITE_SUPABASE_URL present (len=${values.VITE_SUPABASE_URL.length}), VITE_SUPABASE_ANON_KEY present (len=${values.VITE_SUPABASE_ANON_KEY.length})`
)
