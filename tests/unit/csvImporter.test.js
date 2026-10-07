/**
 * tests/unit/csvImporter.test.js
 * Unit Test Suite for Question Bank CSV Importer (src/csvImporter.js)
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {
  importQuestionsFromCsv,
  parseSynonyms,
  extractSynonyms,
  parseCsvContent
} = require('../../src/csvImporter');
const dbMod = require('../../src/db');

describe('CSV Importer (src/csvImporter.js)', () => {
  let tempDbPath;
  const sampleCsvPath = path.resolve(__dirname, '../../sample_questions.csv');

  beforeEach(() => {
    const rand = Math.random().toString(36).substring(2, 8);
    tempDbPath = path.join(os.tmpdir(), `quizbee_unit_csv_${Date.now()}_${rand}.db`);
  });

  afterEach(() => {
    dbMod.closeDb();
    for (const ext of ['', '-wal', '-shm']) {
      const file = `${tempDbPath}${ext}`;
      if (fs.existsSync(file)) {
        try { fs.unlinkSync(file); } catch (_) {}
      }
    }
  });

  it('1. parseSynonyms splits semicolon-separated tokens into trimmed lowercase arrays', () => {
    const res1 = parseSynonyms('DROPTABLE; DROP');
    assert.deepEqual(res1, ['droptable', 'drop']);

    const res2 = parseSynonyms('  O(logn) ;  O(log(n)) ; O(log n)  ');
    assert.deepEqual(res2, ['o(logn)', 'o(log(n))', 'o(log n)']);

    const res3 = parseSynonyms('UDP; User Datagram Protocol;');
    assert.deepEqual(res3, ['udp', 'user datagram protocol']);

    assert.deepEqual(parseSynonyms(''), []);
    assert.deepEqual(parseSynonyms(null), []);
    assert.deepEqual(parseSynonyms(undefined), []);
  });

  it('2. extractSynonyms returns empty array for MCQ and combines canonical answer for IDENTIFICATION', () => {
    const mcqSyns = extractSynonyms('A; B', 'C', 'MCQ');
    assert.deepEqual(mcqSyns, []);

    const idSyns = extractSynonyms('DROPTABLE; DROP', 'DROP TABLE', 'IDENTIFICATION');
    assert.ok(idSyns.includes('droptable'));
    assert.ok(idSyns.includes('drop'));
    assert.ok(idSyns.includes('drop table'));
  });

  it('3. parseCsvContent correctly handles commas inside quotes and escaped quotes', () => {
    const csvData = `round,type,question,code_snippet,option_a,option_b,option_c,option_d,correct_answer,synonyms,points,timer_seconds
Easy,MCQ,"Which HTML tag, if any, is used?",code,A,B,C,D,C,,1,15`;
    const rows = parseCsvContent(csvData);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].question, 'Which HTML tag, if any, is used?');
  });

  it('4. importQuestionsFromCsv imports sample_questions.csv cleanly into database', () => {
    const db = dbMod.initDb(tempDbPath);
    const result = importQuestionsFromCsv(sampleCsvPath, db);

    assert.equal(result.success, true);
    assert.equal(result.errors.length, 0);
    assert.equal(result.importedCount, 8);

    const questions = dbMod.getAllQuestions();
    assert.equal(questions.length, 8);
  });

  it('5. HTML tags in options are preserved safely in options_json', () => {
    const db = dbMod.initDb(tempDbPath);
    importQuestionsFromCsv(sampleCsvPath, db);

    const q1 = dbMod.getQuestion(1);
    assert.ok(q1);
    assert.equal(q1.options.A, '<script>');
    assert.equal(q1.options.B, '<css>');
    assert.equal(q1.options.C, '<style>');
    assert.equal(q1.options.D, '<stylesheet>');
  });

  it('6. Questions with code snippets preserve multiline code text', () => {
    const db = dbMod.initDb(tempDbPath);
    importQuestionsFromCsv(sampleCsvPath, db);

    const questions = dbMod.getAllQuestions();
    const snippetQ = questions.find(q => q.code_snippet && q.code_snippet.length > 0);
    assert.ok(snippetQ);
    assert.equal(snippetQ.code_snippet, 'console.log(typeof NaN);');
  });

  it('7. Identification questions have empty options_json object/array', () => {
    const db = dbMod.initDb(tempDbPath);
    importQuestionsFromCsv(sampleCsvPath, db);

    const questions = dbMod.getAllQuestions();
    const idQ = questions.find(q => q.question_type === 'IDENTIFICATION');
    assert.ok(idQ);
    assert.deepEqual(idQ.options, []);
    assert.ok(idQ.synonyms.length > 0);
  });

  it('8. Clincher question has points=5, timer=30, and valid IDENTIFICATION type', () => {
    const db = dbMod.initDb(tempDbPath);
    importQuestionsFromCsv(sampleCsvPath, db);

    const questions = dbMod.getAllQuestions();
    const clincher = questions.find(q => q.correct_answer === 'UDP');
    assert.ok(clincher);
    assert.equal(clincher.points, 5);
    assert.equal(clincher.timer_seconds, 30);
    assert.equal(clincher.question_type, 'IDENTIFICATION');
  });

  it('9. Rejects invalid rows with missing required fields or invalid points', () => {
    const db = dbMod.initDb(tempDbPath);
    const tempCsv = path.join(os.tmpdir(), `invalid_${Date.now()}.csv`);
    const badCsvContent = `round,type,question,code_snippet,option_a,option_b,option_c,option_d,correct_answer,synonyms,points,timer_seconds
Easy,MCQ,"",,A,B,C,D,C,,1,15
Easy,MCQ,Valid Question,,A,B,C,D,C,,-5,15`;
    fs.writeFileSync(tempCsv, badCsvContent, 'utf8');

    try {
      const res = importQuestionsFromCsv(tempCsv, db);
      assert.equal(res.success, false);
      assert.equal(res.errors.length, 2);
      assert.equal(res.importedCount, 0);
    } finally {
      if (fs.existsSync(tempCsv)) fs.unlinkSync(tempCsv);
    }
  });

  it('10. Successfully imports Trial round questions with points=0 and assigns sequence_order=0', () => {
    const db = dbMod.initDb(tempDbPath);
    const trialCsv = `round,type,question,code_snippet,option_a,option_b,option_c,option_d,correct_answer,synonyms,points,timer_seconds
Trial,MCQ,"Practice warm up question?","",A,B,C,D,B,,0,15`;

    const { importQuestionsFromContent } = require('../../src/csvImporter');
    const res = importQuestionsFromContent(trialCsv, db);
    assert.equal(res.success, true);
    assert.equal(res.importedCount, 1);

    const questions = dbMod.getAllQuestions();
    assert.equal(questions.length, 1);
    assert.equal(questions[0].points, 0);
    assert.equal(questions[0].round, 'Trial');

    const round = dbMod.getDb().prepare("SELECT * FROM ROUNDS WHERE name = 'Trial'").get();
    assert.ok(round);
    assert.equal(round.sequence_order, 0);
  });

  it('11. importQuestionsFromContent supports replace mode to clear existing bank', () => {
    const db = dbMod.initDb(tempDbPath);
    const { importQuestionsFromContent } = require('../../src/csvImporter');

    const csv1 = `round,type,question,code_snippet,option_a,option_b,option_c,option_d,correct_answer,synonyms,points,timer_seconds
Easy,MCQ,"Old Question 1","",A,B,C,D,A,,1,15`;
    importQuestionsFromContent(csv1, db);
    assert.equal(dbMod.getAllQuestions().length, 1);

    const csv2 = `round,type,question,code_snippet,option_a,option_b,option_c,option_d,correct_answer,synonyms,points,timer_seconds
Trial,MCQ,"New Staged Question 1","",A,B,C,D,C,,0,15
Easy,MCQ,"New Staged Question 2","",A,B,C,D,B,,1,15`;
    const res = importQuestionsFromContent(csv2, db, { mode: 'replace' });
    assert.equal(res.success, true);
    assert.equal(res.importedCount, 2);

    const updated = dbMod.getAllQuestions();
    assert.equal(updated.length, 2);
    assert.equal(updated[0].round, 'Trial');
    assert.equal(updated[1].round, 'Easy');
  });
});
