module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json')
  res.statusCode = 200
  res.end(
    JSON.stringify({
      ok: true,
      ts: new Date().toISOString(),
      node: process.version,
      cwd: process.cwd(),
    })
  )
}
