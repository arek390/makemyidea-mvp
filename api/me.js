import { createSupabaseServerClient } from './_lib/supabaseServer.js'

export default async function handler(req, res) {
  try {
    const supabase = createSupabaseServerClient(req, res)
    const { data, error } = await supabase.auth.getUser()
    if (error || !data?.user) {
      res.status(401).json({ ok: false, error: 'UNAUTHORIZED' })
      return
    }
    res.status(200).json({
      ok: true,
      user: {
        id: data.user.id,
        email: data.user.email || null,
      },
    })
  } catch (error) {
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' })
  }
}
