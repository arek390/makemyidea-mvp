module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }))
    return
  }
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ ok: true, ts: new Date().toISOString() }))
}
