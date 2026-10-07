/**
 * tests/unit/db.test.js
 * Unit Test Suite for Database Layer (src/db.js)
 * Covers SQLite WAL mode, schema tables, prepared statements, and transactions.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('os');
const dbMod = require('../../src/db');

describe('Database Layer (src/db.js)', () => {
  let tempDbPath;

  beforeEach(() => {
    const rand = Math.random().toString(36).substring(2, 8);
    tempDbPath = path.join(os.tmpdir(), `quizbee_unit_db_${Date.now()}_${rand}.db`);
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

  it('1. Initializes SQLite in WAL mode and creates all 5 tables', () => {
    const db = dbMod.initDb(tempDbPath);
    assert.ok(db, 'Database instance must be initialized');

    const walMode = db.pragma('journal_mode', { simple: true });
    assert.match(String(walMode).toLowerCase(), /wal|memory/, 'Journal mode should be WAL');

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
    assert.ok(tables.includes('ROUNDS'), 'ROUNDS table must exist');
    assert.ok(tables.includes('QUESTIONS'), 'QUESTIONS table must exist');
    assert.ok(tables.includes('CONTESTANTS'), 'CONTESTANTS table must exist');
    assert.ok(tables.includes('SUBMISSIONS'), 'SUBMISSIONS table must exist');
    assert.ok(tables.includes('CHEAT_LOGS'), 'CHEAT_LOGS table must exist');
  });

  it('2. Rounds table supports insertion, retrieval, and sequence ordering', () => {
    const db = dbMod.initDb(tempDbPath);
    const insert = db.prepare('INSERT INTO ROUNDS (name, weight_points, default_timer_sec, sequence_order) VALUES (?, ?, ?, ?)');
    insert.run('Easy', 1, 15, 1);
    insert.run('Average', 2, 30, 2);

    const rounds = dbMod.getDb().prepare('SELECT * FROM ROUNDS ORDER BY sequence_order ASC').all();
    assert.equal(rounds.length, 2);
    assert.equal(rounds[0].name, 'Easy');
    assert.equal(rounds[1].name, 'Average');
  });

  it('3. getQuestion parses options_json and acceptable_synonyms_json', () => {
    const db = dbMod.initDb(tempDbPath);
    db.prepare("INSERT INTO ROUNDS (id, name, weight_points, default_timer_sec, sequence_order) VALUES (1, 'Easy', 1, 15, 1)").run();
    db.prepare(`
      INSERT INTO QUESTIONS (id, round_id, question_text, question_type, options_json, correct_answer, acceptable_synonyms_json, points, timer_seconds)
      VALUES (10, 1, 'What is HTTP port?', 'MCQ', '{"A":"21","B":"22","C":"80","D":"443"}', 'C', '[]', 1, 15)
    `).run();

    const q = dbMod.getQuestion(10);
    assert.ok(q, 'Question must be returned');
    assert.equal(q.id, 10);
    assert.equal(q.options.C, '80');
    assert.deepEqual(q.synonyms, []);
  });

  it('4. saveSubmission atomically records submission and recomputes total score', () => {
    dbMod.initDb(tempDbPath);
    const sub = dbMod.saveSubmission(1, 1, 'C', 1500, 1, 'AUTO', 1);

    assert.ok(sub);
    assert.equal(sub.contestant_id, 1);
    assert.equal(sub.question_id, 1);
    assert.equal(sub.submitted_answer, 'C');
    assert.equal(sub.is_correct, 1);
    assert.equal(sub.awarded_points, 1);

    const contestant = dbMod.getContestantById(1);
    assert.equal(contestant.total_score, 1, 'Contestant total_score must reflect awarded points');
  });

  it('5. Duplicate submission for same (contestant_id, question_id) throws UNIQUE constraint error', () => {
    dbMod.initDb(tempDbPath);
    dbMod.saveSubmission(1, 1, 'C', 1000, 1, 'AUTO', 1);

    assert.throws(
      () => dbMod.saveSubmission(1, 1, 'A', 2000, 0, 'AUTO', 0),
      /UNIQUE|duplicate|conflict/i,
      'Duplicate submission must fail UNIQUE constraint'
    );
  });

  it('6. updateSubmissionRuling updates judge status and updates contestant total score', () => {
    dbMod.initDb(tempDbPath);
    const sub = dbMod.saveSubmission(2, 5, 'DROPTABLE', 1200, 0, 'PENDING', 0);
    assert.equal(sub.judge_status, 'PENDING');
    assert.equal(dbMod.getContestantById(2).total_score, 0);

    const updated = dbMod.updateSubmissionRuling(sub.id, 'APPROVED', 2);
    assert.equal(updated.judge_status, 'APPROVED');
    assert.equal(updated.is_correct, 1);
    assert.equal(updated.awarded_points, 2);

    const contestant = dbMod.getContestantById(2);
    assert.equal(contestant.total_score, 2, 'Contestant score must be updated to 2 points after approval');
  });

  it('7. logIncident and getIncidentLogs record and retrieve security incidents', () => {
    dbMod.initDb(tempDbPath);
    dbMod.logIncident(3, 'BLUR', 'Window lost focus');
    dbMod.logIncident(3, 'FULLSCREEN_EXIT', 'Contestant pressed ESC');

    const logs = dbMod.getIncidentLogs(3);
    assert.equal(logs.length, 2);
    assert.equal(logs[0].incident_type, 'FULLSCREEN_EXIT');
    assert.equal(logs[1].incident_type, 'BLUR');
  });

  it('8. getContestantByPin and updateContestantConnection track connection state', () => {
    const db = dbMod.initDb(tempDbPath);
    db.prepare(`
      INSERT INTO CONTESTANTS (pin, terminal_number, student_id, full_name, department_or_section)
      VALUES ('1001', 1, '2024-OLFU-0001', 'Contestant 01', 'BSIT')
    `).run();

    const contestant = dbMod.getContestantByPin('1001');
    assert.ok(contestant);
    assert.equal(contestant.pin, '1001');

    dbMod.updateContestantConnection('1001', true, 'socket_xyz');
    const updated = dbMod.getContestantByPin('1001');
    assert.equal(updated.is_connected, 1);
    assert.equal(updated.last_socket_id, 'socket_xyz');
  });

  it('9. getLeaderboard ranks contestants by score DESC and earliest submission ASC for tie breaks', () => {
    dbMod.initDb(tempDbPath);
    // Contestant 1: 2 points, submitTime 2000ms
    dbMod.saveSubmission(1, 1, 'A', 2000, 1, 'AUTO', 2);
    // Contestant 2: 2 points, submitTime 1200ms (earlier!)
    dbMod.saveSubmission(2, 1, 'A', 1200, 1, 'AUTO', 2);
    // Contestant 3: 1 point, submitTime 1000ms
    dbMod.saveSubmission(3, 1, 'B', 1000, 1, 'AUTO', 1);

    const lb = dbMod.getLeaderboard();
    assert.equal(lb[0].terminalNumber, 2, 'Contestant 2 wins tie with earlier submit time');
    assert.equal(lb[0].rank, 1);
    assert.equal(lb[1].terminalNumber, 1);
    assert.equal(lb[1].rank, 2);
    assert.equal(lb[2].terminalNumber, 3);
    assert.equal(lb[2].rank, 3);
  });

  it('10. getPendingRulings returns only submissions with judge_status = PENDING', () => {
    dbMod.initDb(tempDbPath);
    dbMod.saveSubmission(1, 1, 'DROP TABLE', 1000, 1, 'AUTO', 2);
    dbMod.saveSubmission(2, 1, 'DELETE TABLE', 1100, 0, 'PENDING', 0);

    const pending = dbMod.getPendingRulings();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].submitted_answer, 'DELETE TABLE');
  });

  it('11. getSubmission retrieves submission by contestantId and questionId or returns null', () => {
    dbMod.initDb(tempDbPath);
    assert.equal(dbMod.getSubmission(1, 1), null, 'Must return null when no submission exists');

    const saved = dbMod.saveSubmission(1, 1, 'C', 1500, 1, 'AUTO', 1);
    const retrieved = dbMod.getSubmission(1, 1);

    assert.ok(retrieved);
    assert.equal(retrieved.id, saved.id);
    assert.equal(retrieved.contestant_id, 1);
    assert.equal(retrieved.question_id, 1);
    assert.equal(retrieved.submitted_answer, 'C');
    assert.equal(retrieved.is_correct, 1);
    assert.equal(retrieved.awarded_points, 1);

    // Invalid parameters return null safely
    assert.equal(dbMod.getSubmission(null, 1), null);
    assert.equal(dbMod.getSubmission(1, null), null);
  });

  it('12. getSubmissionById retrieves submission by ID or returns null', () => {
    dbMod.initDb(tempDbPath);
    assert.equal(dbMod.getSubmissionById(999), null, 'Must return null for non-existent ID');

    const saved = dbMod.saveSubmission(2, 3, 'HTML', 1200, 0, 'PENDING', 0);
    const retrieved = dbMod.getSubmissionById(saved.id);

    assert.ok(retrieved);
    assert.equal(retrieved.id, saved.id);
    assert.equal(retrieved.submitted_answer, 'HTML');
    assert.equal(retrieved.judge_status, 'PENDING');

    // Invalid parameters return null safely
    assert.equal(dbMod.getSubmissionById(null), null);
  });

  it('13. getSubmissionsForQuestion retrieves all submissions for a question', () => {
    dbMod.initDb(tempDbPath);
    assert.deepEqual(dbMod.getSubmissionsForQuestion(1), [], 'Must return empty array for question with no submissions');

    dbMod.saveSubmission(1, 1, 'A', 1000, 1, 'AUTO', 1);
    dbMod.saveSubmission(2, 1, 'B', 1100, 0, 'AUTO', 0);
    dbMod.saveSubmission(3, 2, 'Answer', 1200, 1, 'AUTO', 2);

    const q1Subs = dbMod.getSubmissionsForQuestion(1);
    assert.equal(q1Subs.length, 2);
    assert.equal(q1Subs[0].contestant_id, 1);
    assert.equal(q1Subs[1].contestant_id, 2);

    const q2Subs = dbMod.getSubmissionsForQuestion(2);
    assert.equal(q2Subs.length, 1);
    assert.equal(q2Subs[0].contestant_id, 3);
  });
});

