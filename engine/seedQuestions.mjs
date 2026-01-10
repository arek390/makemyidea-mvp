import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getEngineDb } from './db.mjs'
import { insertQuestions } from './questionRepository.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

const detectDelimiter = (line) => {
  const commaCount = (line.match(/,/g) || []).length
  const semiCount = (line.match(/;/g) || []).length
  return semiCount > commaCount ? ';' : ','
}

const parseCsvRow = (line, delimiter) => {
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
    } else if (char === delimiter && !inQuotes) {
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
  const delimiter = detectDelimiter(lines[0])
  const headers = parseCsvRow(lines[0], delimiter)
  return lines.slice(1).map((line) => {
    const values = parseCsvRow(line, delimiter)
    return headers.reduce((acc, header, index) => {
      acc[header] = values[index] ?? ''
      return acc
    }, {})
  })
}

const resolveQuestionsSource = () => {
  const candidates = [
    path.join(repoRoot, 'data', 'questions_enriched_pl_eng.csv'),
    path.join(repoRoot, 'data', 'questions_enriched.csv'),
    path.join(repoRoot, 'data', 'questions.csv'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

const normalizeLang = (value) => {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return 'pl'
  if (raw.startsWith('en')) return 'en'
  if (raw.startsWith('pl')) return 'pl'
  return raw
}

const resolveText = (row) => row.text ?? row.Text ?? row.TEXT ?? ''

export const seedQuestionsIfEmpty = () => {
  const db = getEngineDb()
  const countRow = db.prepare('SELECT COUNT(*) as count FROM questions').get()
  if ((countRow?.count ?? 0) > 0) return { seeded: false, reason: 'already_seeded' }

  const sourcePath = resolveQuestionsSource()
  if (!sourcePath) return { seeded: false, reason: 'missing_source' }
  const contents = fs.readFileSync(sourcePath, 'utf-8')
  const rows = parseCsv(contents)
  const questions = rows.map((row) => ({
    id: row.id,
    text: resolveText(row),
    group_code: row.group_code,
    mode_code: Number(row.mode_code),
    category_code: row.category_code,
    intent_code: row.intent_code,
    difficulty: Number(row.difficulty),
    priority: row.priority ? Number(row.priority) : 50,
    is_active: row.is_active ? Number(row.is_active) : 1,
    lang: normalizeLang(row.lang || row.Lang || row.LANG || 'pl'),
  }))
  const result = insertQuestions(questions)
  return { seeded: true, inserted: result.inserted, sourcePath }
}
