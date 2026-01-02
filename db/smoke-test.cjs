const { getDb } = require("./db.cjs");
const db = getDb();
const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;").all();
console.log("Tables:", row);
