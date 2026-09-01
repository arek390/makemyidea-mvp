export const isEngine2LocalDiagnosticsAllowed = (req, ip = '') => {
  const host = String(req?.headers?.host || '')
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    host.startsWith('localhost:') ||
    host.startsWith('127.0.0.1:')
  )
}

export const resolveEngine2DiagnosticsRequest = ({ req, ip, diagnosticsAdmin }) => {
  const debugHeader = Array.isArray(req?.headers?.['x-engine2-debug'])
    ? req.headers['x-engine2-debug'][0]
    : req?.headers?.['x-engine2-debug']
  const dryRunHeader = Array.isArray(req?.headers?.['x-engine2-debug-dry-run'])
    ? req.headers['x-engine2-debug-dry-run'][0]
    : req?.headers?.['x-engine2-debug-dry-run']
  const enabledByHeader = ['1', 'true', 'on', 'yes'].includes(String(debugHeader || '').toLowerCase().trim())
  const dryRunByHeader = ['1', 'true', 'on', 'yes'].includes(String(dryRunHeader || '').toLowerCase().trim())
  const accessAllowed = Boolean(diagnosticsAdmin || isEngine2LocalDiagnosticsAllowed(req, ip))
  const enabled = enabledByHeader && accessAllowed
  return {
    enabled,
    dryRun: enabled && (dryRunByHeader || Boolean(req?.body?.diagnostics?.dryRun)),
    includeRaw: enabled,
    localAllowed: isEngine2LocalDiagnosticsAllowed(req, ip),
    adminAllowed: Boolean(diagnosticsAdmin),
  }
}
