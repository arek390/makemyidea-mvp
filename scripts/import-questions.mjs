
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initEngineDb, ENGINE_DB_PATH } from '../engine/db.mjs'
import { insertQuestions } from '../engine/questionRepository.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

const parseCsvRow = (line) => {
  const result = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }
  result.push(current)
  return result.map((value) => value.trim())
}

const parseCsv = (contents) => {
  const lines = contents.split(/\r?\n/).filter((line) => line.trim())
  if (!lines.length) return []
  const headers = parseCsvRow(lines[0])
  return lines.slice(1).map((line) => {
    const values = parseCsvRow(line)
    return headers.reduce((acc, header, index) => {
      acc[header] = values[index] ?? ''
      return acc
    }, {})
  })
}

const resolveQuestionsSource = () => {
  const candidates = [
    '/data/questions_enriched.csv',
    path.join(repoRoot, 'data', 'questions_enriched.csv'),
    path.join(repoRoot, 'data', 'questions.csv'),
    path.join(repoRoot, 'questions_enriched.csv'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  const message = `No questions source found. Tried:
${candidates.join('\n')}`
  throw new Error(message)
}

const ensureLocalCopy = (sourcePath) => {
  const dataDir = path.join(repoRoot, 'data')
  if (!fs.existsSync(dataDir)) return
  const targetPath = path.join(dataDir, 'questions_enriched.csv')
  const sourceStat = fs.statSync(sourcePath)

  if (fs.existsSync(targetPath)) {
    const targetStat = fs.statSync(targetPath)
    if (targetStat.size === sourceStat.size) return
  }

  try {
    fs.copyFileSync(sourcePath, targetPath)
    console.log(`Ensured local data copy: ${targetPath}`)
  } catch (error) {
    console.warn(`Failed to copy ${sourcePath} to ${targetPath}: ${error?.message || error}`)
  }
}

const ensureLegacyCopy = (sourcePath) => {
  const dataDir = path.join(repoRoot, 'data')
  if (!fs.existsSync(dataDir)) return
  const targetPath = path.join(dataDir, 'questions.csv')
  const sourceStat = fs.statSync(sourcePath)

  if (fs.existsSync(targetPath)) {
    const targetStat = fs.statSync(targetPath)
    if (targetStat.size === sourceStat.size) return
  }

  try {
    fs.copyFileSync(sourcePath, targetPath)
  } catch (error) {
    console.warn(`Failed to copy ${sourcePath} to ${targetPath}: ${error?.message || error}`)
  }
}

const questionsPath = resolveQuestionsSource()
console.log(`Resolved questions source: ${questionsPath}`)

ensureLocalCopy(questionsPath)
ensureLegacyCopy(questionsPath)

const questionsCsv = fs.readFileSync(questionsPath, 'utf-8')
const rows = parseCsv(questionsCsv)

const questions = rows.map((row) => ({
  id: row.id,
  text: row.text,
  group_code: row.group_code,
  mode_code: Number(row.mode_code),
  category_code: row.category_code,
  intent_code: row.intent_code,
  difficulty: Number(row.difficulty),
  priority: row.priority ? Number(row.priority) : 50,
  is_active: row.is_active ? Number(row.is_active) : 1,
  lang: row.lang || 'pl',
}))

const db = initEngineDb()
console.log(`Engine DB path: ${ENGINE_DB_PATH}`)

const result = insertQuestions(questions)
const countRow = db.prepare('SELECT COUNT(*) as count FROM questions').get()
const counts = db
  .prepare('SELECT difficulty, COUNT(*) as count FROM questions GROUP BY difficulty ORDER BY difficulty')
  .all()
const countsText = counts.map((row) => `d${row.difficulty}=${row.count}`).join(', ')

console.log(`Imported ${result.inserted} questions into ${ENGINE_DB_PATH}`)
console.log(`Total questions: ${countRow.count}`)
if (countsText) {
  console.log(`Difficulty counts: ${countsText}`)
}
