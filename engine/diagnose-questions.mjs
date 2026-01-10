import { initEngineDb } from './db.mjs'

const db = initEngineDb()

const countRow = db.prepare('SELECT COUNT(*) as count FROM questions').get()
const textCountRow = db.prepare('SELECT COUNT(*) as count FROM question_texts').get()
const langCounts = db
  .prepare('SELECT lang, COUNT(*) as count FROM question_texts GROUP BY lang ORDER BY lang')
  .all()
const distinctLangs = db
  .prepare('SELECT DISTINCT lang FROM question_texts ORDER BY lang')
  .all()
const enCountRow = db
  .prepare("SELECT COUNT(DISTINCT question_id) as count FROM question_texts WHERE lang = 'en'")
  .get()

const sampleIds = ['a1_001', 'a1_002', 'a1_003']
const samples = db
  .prepare(
    `SELECT question_id, lang, substr(text, 1, 80) as text
     FROM question_texts
     WHERE question_id IN (${sampleIds.map((_, idx) => `@id${idx}`).join(',')})
     ORDER BY question_id, lang`
  )
  .all({
    id0: sampleIds[0],
    id1: sampleIds[1],
    id2: sampleIds[2],
  })

console.log(`questions count: ${countRow?.count ?? 0}`)
console.log(`question_texts count: ${textCountRow?.count ?? 0}`)
console.log(
  `question_texts by lang: ${langCounts.map((row) => `${row.lang}=${row.count}`).join(', ')}`
)
console.log(`distinct langs: ${distinctLangs.map((row) => row.lang).join(', ')}`)
console.log(`question_ids with en translation: ${enCountRow?.count ?? 0}`)
console.log('samples (question_id, lang, text):')
samples.forEach((row) => {
  console.log(`${row.question_id}\t${row.lang}\t${row.text}`)
})
