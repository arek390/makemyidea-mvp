import { initEngineDb } from '../engine/db.mjs'

try {
  const db = initEngineDb()
  db.prepare('select 1').get()
  db.close()
  console.log('engine/db.mjs ok')
} catch (error) {
  console.error('engine/db.mjs failed to initialize')
  console.error(error)
  process.exit(1)
}
