const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']
const rawValues = {
  VITE_SUPABASE_URL: String(process.env.VITE_SUPABASE_URL || ''),
  VITE_SUPABASE_ANON_KEY: String(process.env.VITE_SUPABASE_ANON_KEY || ''),
}
const values = {
  VITE_SUPABASE_URL: rawValues.VITE_SUPABASE_URL.trim(),
  VITE_SUPABASE_ANON_KEY: rawValues.VITE_SUPABASE_ANON_KEY.trim(),
}
if (rawValues.VITE_SUPABASE_URL.length !== values.VITE_SUPABASE_URL.length) {
  console.warn('[env] Warning: VITE_SUPABASE_URL had leading/trailing whitespace (trimmed).')
}
if (rawValues.VITE_SUPABASE_ANON_KEY.length !== values.VITE_SUPABASE_ANON_KEY.length) {
  console.warn('[env] Warning: VITE_SUPABASE_ANON_KEY had leading/trailing whitespace (trimmed).')
}
const missing = required.filter((key) => !values[key])

if (missing.length) {
  console.warn(
    `[env] Missing build-time env: ${missing.join(
      ', '
    )}. Supabase auth will be disabled for this build.`
  )
  process.exit(0)
}

let parsedUrl
try {
  parsedUrl = new URL(values.VITE_SUPABASE_URL)
} catch {
  console.error(
    '[env] VITE_SUPABASE_URL must include https:// (e.g., https://<project-ref>.supabase.co)'
  )
  process.exit(1)
}

if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
  console.error(
    '[env] VITE_SUPABASE_URL must include https:// (e.g., https://<project-ref>.supabase.co)'
  )
  process.exit(1)
}

console.log(
  `[env] OK: VITE_SUPABASE_URL valid (protocol=${parsedUrl.protocol.replace(':', '')}, len=${values.VITE_SUPABASE_URL.length}), VITE_SUPABASE_ANON_KEY present (len=${values.VITE_SUPABASE_ANON_KEY.length})`
)
