import fs from 'node:fs'
import path from 'node:path'
import { getEngineDb } from './db.mjs'

let cached = null

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

const normalizeLang = (value) => {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return 'pl'
  if (raw.startsWith('en')) return 'en'
  if (raw.startsWith('pl')) return 'pl'
  return raw
}

const resolveText = (row) => row.text ?? row.Text ?? row.TEXT ?? ''

const resolveCsvPath = () => {
  const candidate = path.join(process.cwd(), 'public', 'questions_enriched_pl_eng.csv')
  if (fs.existsSync(candidate)) return candidate
  const legacy = path.join(process.cwd(), 'data', 'questions_enriched_pl_eng.csv')
  if (fs.existsSync(legacy)) return legacy
  return null
}

const loadCsvDataset = () => {
  if (cached) return cached
  const csvPath = resolveCsvPath()
  if (!csvPath) {
    cached = { source: 'csv', questions: [], csvPath: null, csvRowCount: 0 }
    return cached
  }
  const contents = fs.readFileSync(csvPath, 'utf-8')
  const rows = parseCsv(contents)
  const byId = new Map()
  rows.forEach((row) => {
    const id = row.id
    if (!id) return
    const lang = normalizeLang(row.lang || row.Lang || row.LANG || 'pl')
    const text = resolveText(row)
    const entry = byId.get(id) || {
      id,
      group_code: row.group_code,
      mode_code: Number(row.mode_code),
      category_code: row.category_code,
      intent_code: row.intent_code,
      difficulty: Number(row.difficulty),
      priority: row.priority ? Number(row.priority) : 50,
      is_active: row.is_active ? Number(row.is_active) : 1,
      texts: {},
    }
    entry.texts[lang] = text
    if (!entry.lang || lang === 'pl') {
      entry.lang = lang
    }
    byId.set(id, entry)
  })
  cached = {
    source: 'csv',
    questions: Array.from(byId.values()),
    csvPath,
    csvRowCount: rows.length,
  }
  return cached
}

export const getCsvInfo = () => {
  const dataset = loadCsvDataset()
  return {
    csvPath: dataset.csvPath,
    csvRowCount: dataset.csvRowCount,
  }
}

export const getQuestionDataset = () => {
  const db = getEngineDb()
  const countRow = db.prepare('SELECT COUNT(*) as count FROM questions').get()
  const dbCount = countRow?.count ?? 0
  if (dbCount > 0) {
    return { source: 'db', questionsCount: dbCount, getQuestionsForLang: null, lookupById: null }
  }
  const dataset = loadCsvDataset()
  const getQuestionsForLang = (lang) => {
    const normalized = normalizeLang(lang)
    return dataset.questions
      .filter((q) => Number(q.is_active) === 1)
      .map((q) => {
        const text = q.texts[normalized] || q.texts.pl || ''
        return {
          ...q,
          text,
          lang_text: q.texts[normalized] || null,
          pl_text: q.texts.pl || null,
          tags: [],
        }
      })
  }
  const lookupById = (id) => dataset.questions.find((q) => q.id === id) || null
  return {
    source: 'csv',
    questionsCount: dataset.questions.length,
    getQuestionsForLang,
    lookupById,
  }
}
