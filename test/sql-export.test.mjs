import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const exercises = JSON.parse(readFileSync(new URL('data/exercises.json', root), 'utf8'));
const languages = Object.keys(exercises[0].instructions).sort();

// Execute each page's real SQL templates and generator without requiring a DOM.
function loadExport(page) {
  const html = readFileSync(new URL(page, root), 'utf8');
  const templates = html.match(/const DB_SQL = \{[\s\S]*?\n\s*\};/);
  const generator = html.match(/function escStr\([\s\S]*?(?=\n\s*(?:async )?function generateInsertSql\()/);
  assert.ok(templates, `${page}: SQL templates exist`);
  assert.ok(generator, `${page}: SQL generator exists`);
  return runInNewContext(`${templates[0]}\n${generator[0]}\n({ DB_SQL, buildInserts });`);
}

for (const page of ['index.html', 'setup.html']) {
  const { DB_SQL, buildInserts } = loadExport(page);
  for (const dialect of ['mssql', 'postgresql', 'mysql', 'sqlite']) {
    test(`${page}: ${dialect} exports all instruction languages`, () => {
      for (const lang of languages) {
        assert.match(DB_SQL[dialect], new RegExp(`\\binstructions_${lang}\\s+`));
      }
      const sql = buildInserts([exercises[0]], dialect);
      for (const lang of languages) {
        assert.ok(sql.includes(`instructions_${lang}`), `${dialect}: ${lang} insert column`);
        assert.ok(sql.includes(exercises[0].instructions[lang].replaceAll("'", "''")), `${dialect}: ${lang} value`);
      }
    });
  }

  test(`${page}: SQLite round-trips all rows, languages, and muscle arrays`, () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(DB_SQL.sqlite);
      db.exec(buildInserts(exercises, 'sqlite'));
      assert.equal(db.prepare('SELECT count(*) AS count FROM exercises').get().count, exercises.length);
      const select = db.prepare('SELECT * FROM exercises WHERE id = ?');
      for (const exercise of exercises) {
        const row = select.get(exercise.id);
        assert.equal(row.name, exercise.name);
        for (const lang of languages) {
          assert.equal(row[`instructions_${lang}`], exercise.instructions[lang], `${exercise.id}: ${lang}`);
        }
        assert.deepEqual(JSON.parse(row.secondary_muscles), exercise.secondary_muscles);
      }
    } finally {
      db.close();
    }
  });
}
