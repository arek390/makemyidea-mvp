const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

function parseCsvRow(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result.map((value) => value.trim());
}

function parseCsv(contents) {
  const lines = contents.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const headers = parseCsvRow(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvRow(line);
    return headers.reduce((acc, header, index) => {
      acc[header] = values[index] ?? "";
      return acc;
    }, {});
  });
}

function main() {
  const dbPath = path.join(process.cwd(), "data", "engine.sqlite");
  const db = new Database(dbPath);

  const filePath = path.join(process.cwd(), "data", "questions.csv");
  if (!fs.existsSync(filePath)) {
    console.error("❌ Missing file:", filePath);
    process.exit(1);
  }

  const csv = fs.readFileSync(filePath, "utf8");
  const rows = parseCsv(csv);
  if (!Array.isArray(rows) || rows.length === 0) {
    console.error("❌ questions.csv is empty or invalid");
    process.exit(1);
  }

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
    lang: row.lang || "pl",
    tags: [],
  }));

  const insertQ = db.prepare(`
    INSERT INTO questions (
      id, text, group_code, mode_code,
      category_code, intent_code,
      difficulty, priority, is_active, lang
    )
    VALUES (
      @id, @text, @group_code, @mode_code,
      @category_code, @intent_code,
      @difficulty, @priority, @is_active, @lang
    )
    ON CONFLICT(id) DO UPDATE SET
      text=excluded.text,
      group_code=excluded.group_code,
      mode_code=excluded.mode_code,
      category_code=excluded.category_code,
      intent_code=excluded.intent_code,
      difficulty=excluded.difficulty,
      priority=excluded.priority,
      is_active=excluded.is_active,
      lang=excluded.lang;
  `);

  const deleteTags = db.prepare(`DELETE FROM question_tags WHERE question_id = ?`);
  const insertTag = db.prepare(`INSERT OR IGNORE INTO question_tags (question_id, tag) VALUES (?, ?)`);

  const tx = db.transaction(() => {
    for (const q of questions) {
      if (!q.id || !q.text) throw new Error(`Invalid question: ${JSON.stringify(q)}`);
      insertQ.run(q);
      deleteTags.run(q.id);
      for (const tag of q.tags ?? []) insertTag.run(q.id, String(tag).toLowerCase());
    }
  });

  tx();

  const count = db.prepare("SELECT COUNT(*) AS n FROM questions").get().n;
  console.log(`✅ Seed complete. questions=${count}`);
}

main();
