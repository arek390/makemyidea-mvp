import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js'

const getEnvHost = () => {
  const url = process.env.SUPABASE_URL || ''
  try {
    return new URL(url).host || null
  } catch {
    return null
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED', allowed: ['GET'] })
    return
  }

  const steps = {
    adminCheck: { ok: false, error: null },
    insert: { ok: false, error: null },
    select: { ok: false, found: false, row: null, error: null },
    delete: { ok: false, error: null },
  }
  const envHost = getEnvHost()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  const hasServiceRoleKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
  const env = {
    hasUrl: Boolean(process.env.SUPABASE_URL),
    hasServiceRoleKey,
    serviceRoleKeyLen: hasServiceRoleKey ? key.length : null,
    serviceRoleKeyPrefix: hasServiceRoleKey ? key.slice(0, 6) : null,
  }
  let sessionId = ''
  try {
    const supabaseAdmin = getSupabaseAdmin()
    try {
      await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 })
      steps.adminCheck.ok = true
    } catch (error) {
      steps.adminCheck.error = {
        message: error?.message ?? null,
        status: error?.status ?? null,
        name: error?.name ?? null,
      }
    }
    sessionId = crypto.randomUUID()
    const name = `selftest-${sessionId.slice(0, 8)}`
    const userId = '00000000-0000-0000-0000-000000000000'

    const insertRes = await supabaseAdmin
      .schema('public')
      .from('sessions')
      .insert({ id: sessionId, user_id: userId, name })
    if (insertRes.error) {
      steps.insert.error = {
        code: insertRes.error?.code ?? null,
        message: insertRes.error?.message ?? null,
        details: insertRes.error?.details ?? null,
        hint: insertRes.error?.hint ?? null,
        status: insertRes.error?.status ?? null,
      }
    } else {
      steps.insert.ok = true
    }

    const selectRes = await supabaseAdmin
      .schema('public')
      .from('sessions')
      .select('id,user_id,name')
      .eq('id', sessionId)
      .maybeSingle()
    if (selectRes.error) {
      steps.select.error = {
        code: selectRes.error?.code ?? null,
        message: selectRes.error?.message ?? null,
        details: selectRes.error?.details ?? null,
        hint: selectRes.error?.hint ?? null,
        status: selectRes.error?.status ?? null,
      }
    } else {
      steps.select.ok = true
      steps.select.found = Boolean(selectRes.data)
      steps.select.row = selectRes.data || null
    }

    const deleteRes = await supabaseAdmin
      .schema('public')
      .from('sessions')
      .delete()
      .eq('id', sessionId)
    if (deleteRes.error) {
      steps.delete.error = {
        code: deleteRes.error?.code ?? null,
        message: deleteRes.error?.message ?? null,
        details: deleteRes.error?.details ?? null,
        hint: deleteRes.error?.hint ?? null,
        status: deleteRes.error?.status ?? null,
      }
    } else {
      steps.delete.ok = true
    }
  } catch (error) {
    if (!steps.insert.ok && !steps.insert.error) {
      steps.insert.error = {
        code: error?.code ?? null,
        message: error?.message ?? null,
        details: error?.details ?? null,
        hint: error?.hint ?? null,
        status: error?.status ?? null,
      }
    }
  }

  res.status(200).json({
    ok: steps.insert.ok && steps.select.ok && steps.delete.ok,
    envHost,
    env,
    steps,
  })
}
