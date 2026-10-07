/**
 * tests/adversarial.test.js
 * Adversarial Stress Test Suite for Milestone 1: src/db.js and src/csvImporter.js
 * OLFU IT Olympics LAN Quiz Bee System (ITPM 311)
 *
 * EMPIRICAL CHALLENGER VERIFICATION:
 * 1. 60 concurrent worker threads / async tasks inserting into SQLite (WAL mode) without SQLITE_BUSY
 * 2. Duplicate submissions uniqueness and score idempotency under sequential and concurrent load
 * 3. CSV Importer malformed inputs: missing columns, unclosed quotes, empty lines, HTML/XSS, unicode, SQL injection, extreme payloads
 * 4. Concurrent readers (Quizmaster/Projector leaderboard) during active 60-worker write bursts
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { Worker } = require('node:worker_threads');

const dbMod = require('../src/db');
const {
  importQuestionsFromCsv,
  parseSynonyms,
  extractSynonyms,
  parseCsvContent,
  parseCsvBuffer
} = require('../src/csvImporter');

describe('Adversarial Stress Test: src/db.js & src/csvImporter.js', () => {
  let tempDbPath;

  beforeEach(() => {
    const rand = Math.random().toString(36).substring(2, 9);
    tempDbPath = path.join(os.tmpdir(), `quizbee_adversarial_${Date.now()}_${rand}.db`);
  });

  afterEach(() => {
    dbMod.closeDb();
    for (const ext of ['', '-wal', '-shm']) {
      const f = `${tempDbPath}${ext}`;
      if (fs.existsSync(f)) {
        try { fs.unlinkSync(f); } catch (_) {}
      }
    }
  });

  // =========================================================================
  // SECTION 1: CONCURRENT SUBMISSION WRITES TO SQLITE (WAL MODE)
  // =========================================================================

  describe('Section 1: SQLite WAL Concurrency (60 Simultaneous Workers & Tasks)', () => {
    it('1.1 Simulates 60 concurrent Worker Threads submitting simultaneously to WAL SQLite without SQLITE_BUSY', async () => {
      // 1. Initialize schema and baseline tables in WAL mode
      const db = dbMod.initDb(tempDbPath);
      assert.ok(db);
      const pragmaMode = db.pragma('journal_mode', { simple: true });
      assert.match(String(pragmaMode).toLowerCase(), /wal/, 'Database must be in WAL journal mode');

      // Seed round 1, question 1, and 60 contestants
      db.prepare(`
        INSERT INTO ROUNDS (id, name, weight_points, default_timer_sec, sequence_order)
        VALUES (1, 'Easy Round', 1, 15, 1)
      `).run();

      db.prepare(`
        INSERT INTO QUESTIONS (id, round_id, question_text, question_type, options_json, correct_answer, points, timer_seconds)
        VALUES (1, 1, 'Sample Question 1', 'MCQ', '{"A":"1","B":"2","C":"3","D":"4"}', 'A', 1, 15)
      `).run();

      const insertContestant = db.prepare(`
        INSERT INTO CONTESTANTS (id, pin, terminal_number, student_id, full_name, department_or_section)
        VALUES (?, ?, ?, ?, ?, 'BSIT')
      `);
      for (let i = 1; i <= 60; i++) {
        insertContestant.run(i, String(1000 + i), i, `2024-OLFU-${String(i).padStart(4, '0')}`, `Contestant ${i}`);
      }

      // Close main thread DB handle so worker threads have isolated connections
      dbMod.closeDb();

      // 2. Setup shared barrier for microsecond synchronization across 60 worker threads
      const NUM_WORKERS = 60;
      const barrierBuffer = new SharedArrayBuffer(4);
      const barrier = new Int32Array(barrierBuffer);
      barrier[0] = 0;

      const workerPath = path.resolve(__dirname, 'adversarial_worker.js');
      const workers = [];
      const readyPromises = [];
      const donePromises = [];

      for (let i = 1; i <= NUM_WORKERS; i++) {
        let resolveReady, resolveDone, rejectDone;
        const readyP = new Promise((res) => { resolveReady = res; });
        const doneP = new Promise((res, rej) => { resolveDone = res; rejectDone = rej; });

        readyPromises.push(readyP);
        donePromises.push(doneP);

        const w = new Worker(workerPath, {
          workerData: {
            dbPath: tempDbPath,
            contestantId: i,
            questionId: 1,
            answer: 'A',
            serverTimeMs: 1700000000000 + (i * 10),
            isCorrect: 1,
            judgeStatus: 'AUTO',
            points: 1,
            sharedBarrier: barrierBuffer,
            iterations: 1
          }
        });

        w.on('message', (msg) => {
          if (msg.status === 'READY') {
            resolveReady();
          } else if (msg.status === 'DONE') {
            resolveDone(msg);
          } else if (msg.status === 'FATAL') {
            rejectDone(new Error(`Worker ${msg.workerId} fatal: ${msg.error} (code: ${msg.code})`));
          }
        });

        w.on('error', (err) => rejectDone(err));
        workers.push(w);
      }

      // Wait for all 60 workers to initialize DB and reach barrier
      await Promise.all(readyPromises);

      // Release all 60 workers simultaneously
      const startTime = Date.now();
      Atomics.store(barrier, 0, 1);
      Atomics.notify(barrier, 0, NUM_WORKERS);

      // Wait for all 60 workers to complete writes
      const results = await Promise.all(donePromises);
      const elapsedMs = Date.now() - startTime;

      // Clean up workers
      await Promise.all(workers.map(w => w.terminate()));

      // 3. Analyze results
      let busyCount = 0;
      let errorCount = 0;
      let successCount = 0;

      for (const res of results) {
        for (const sub of res.results) {
          if (sub.isBusy) busyCount++;
          if (!sub.success) errorCount++;
          if (sub.success) successCount++;
        }
      }

      assert.equal(busyCount, 0, `Expected 0 SQLITE_BUSY errors, but found ${busyCount}`);
      assert.equal(errorCount, 0, `Expected 0 submission write errors, but found ${errorCount}`);
      assert.equal(successCount, 60, `Expected exactly 60 successful writes, got ${successCount}`);

      // 4. Verify SQLite database integrity and state
      const verifyDb = dbMod.initDb(tempDbPath);
      const totalSubmissions = verifyDb.prepare('SELECT COUNT(*) AS cnt FROM SUBMISSIONS').get().cnt;
      assert.equal(totalSubmissions, 60, 'All 60 submissions must be persisted');

      const contestantsWithScore = verifyDb.prepare('SELECT COUNT(*) AS cnt FROM CONTESTANTS WHERE total_score = 1').get().cnt;
      assert.equal(contestantsWithScore, 60, 'All 60 contestants must have total_score = 1');

      // Verify leaderboard calculation under 60 contestants
      const lb = dbMod.getLeaderboard();
      assert.equal(lb.length, 60, 'Leaderboard must contain all 60 contestants');
      assert.equal(lb[0].score, 1, 'Leaderboard rank 1 score must be 1');
      assert.equal(lb[59].score, 1, 'Leaderboard rank 60 score must be 1');
    });

    it('1.2 High-Throughput Burst: 60 Workers each writing 5 questions (300 writes) under WAL mode', async () => {
      const db = dbMod.initDb(tempDbPath);
      db.prepare("INSERT INTO ROUNDS (id, name, weight_points, default_timer_sec, sequence_order) VALUES (1, 'Easy', 1, 15, 1)").run();

      const insertQ = db.prepare(`
        INSERT INTO QUESTIONS (id, round_id, question_text, question_type, options_json, correct_answer, points, timer_seconds)
        VALUES (?, 1, 'Q' || ?, 'MCQ', '{"A":"1"}', 'A', 2, 15)
      `);
      for (let q = 1; q <= 5; q++) {
        insertQ.run(q, q);
      }

      const insertC = db.prepare(`
        INSERT INTO CONTESTANTS (id, pin, terminal_number, student_id, full_name, department_or_section)
        VALUES (?, ?, ?, ?, ?, 'BSIT')
      `);
      for (let c = 1; c <= 60; c++) {
        insertC.run(c, String(1000 + c), c, `2024-OLFU-${String(c).padStart(4, '0')}`, `Contestant ${c}`);
      }

      dbMod.closeDb();

      const NUM_WORKERS = 60;
      const barrierBuffer = new SharedArrayBuffer(4);
      const barrier = new Int32Array(barrierBuffer);
      barrier[0] = 0;

      const workerPath = path.resolve(__dirname, 'adversarial_worker.js');
      const workers = [];
      const readyPromises = [];
      const donePromises = [];

      for (let i = 1; i <= NUM_WORKERS; i++) {
        let resolveReady, resolveDone, rejectDone;
        const readyP = new Promise((res) => { resolveReady = res; });
        const doneP = new Promise((res, rej) => { resolveDone = res; rejectDone = rej; });

        readyPromises.push(readyP);
        donePromises.push(doneP);

        const w = new Worker(workerPath, {
          workerData: {
            dbPath: tempDbPath,
            contestantId: i,
            questionId: 1,
            answer: 'A',
            serverTimeMs: 1700000000000 + i,
            isCorrect: 1,
            judgeStatus: 'AUTO',
            points: 2,
            sharedBarrier: barrierBuffer,
            iterations: 5
          }
        });

        w.on('message', (msg) => {
          if (msg.status === 'READY') resolveReady();
          else if (msg.status === 'DONE') resolveDone(msg);
          else if (msg.status === 'FATAL') rejectDone(new Error(`Worker ${msg.workerId} fatal: ${msg.error}`));
        });
        w.on('error', (err) => rejectDone(err));
        workers.push(w);
      }

      await Promise.all(readyPromises);
      Atomics.store(barrier, 0, 1);
      Atomics.notify(barrier, 0, NUM_WORKERS);

      const results = await Promise.all(donePromises);
      await Promise.all(workers.map(w => w.terminate()));

      let busyCount = 0;
      let totalSuccess = 0;
      for (const res of results) {
        for (const sub of res.results) {
          if (sub.isBusy) busyCount++;
          if (sub.success) totalSuccess++;
        }
      }

      assert.equal(busyCount, 0, 'No SQLITE_BUSY under 300 write burst');
      assert.equal(totalSuccess, 300, 'All 300 writes must succeed');

      const verifyDb = dbMod.initDb(tempDbPath);
      const totalCount = verifyDb.prepare('SELECT COUNT(*) AS cnt FROM SUBMISSIONS').get().cnt;
      assert.equal(totalCount, 300);

      // Verify each contestant accumulated 5 questions * 2 points = 10 points
      const scoreCheck = verifyDb.prepare('SELECT DISTINCT total_score FROM CONTESTANTS').all();
      assert.equal(scoreCheck.length, 1);
      assert.equal(scoreCheck[0].total_score, 10);
    });

    it('1.3 Concurrent Readers (Projector/QM Leaderboard) operate smoothly during active 60-worker writes', async () => {
      const db = dbMod.initDb(tempDbPath);
      db.prepare("INSERT INTO ROUNDS (id, name, weight_points, default_timer_sec, sequence_order) VALUES (1, 'Easy', 1, 15, 1)").run();
      db.prepare("INSERT INTO QUESTIONS (id, round_id, question_text, question_type, options_json, correct_answer, points, timer_seconds) VALUES (1, 1, 'Q1', 'MCQ', '[]', 'A', 1, 15)").run();

      const insertC = db.prepare(`
        INSERT INTO CONTESTANTS (id, pin, terminal_number, student_id, full_name, department_or_section)
        VALUES (?, ?, ?, ?, ?, 'BSIT')
      `);
      for (let c = 1; c <= 60; c++) {
        insertC.run(c, String(1000 + c), c, `2024-OLFU-${String(c).padStart(4, '0')}`, `Contestant ${c}`);
      }
      dbMod.closeDb();

      // Launch 60 worker threads
      const NUM_WORKERS = 60;
      const barrierBuffer = new SharedArrayBuffer(4);
      const barrier = new Int32Array(barrierBuffer);
      barrier[0] = 0;

      const workerPath = path.resolve(__dirname, 'adversarial_worker.js');
      const workers = [];
      const readyPromises = [];
      const donePromises = [];

      for (let i = 1; i <= NUM_WORKERS; i++) {
        let resolveReady, resolveDone, rejectDone;
        const readyP = new Promise((res) => { resolveReady = res; });
        const doneP = new Promise((res, rej) => { resolveDone = res; rejectDone = rej; });
        readyPromises.push(readyP);
        donePromises.push(doneP);

        const w = new Worker(workerPath, {
          workerData: {
            dbPath: tempDbPath,
            contestantId: i,
            questionId: 1,
            answer: 'A',
            serverTimeMs: 1700000000000 + i,
            isCorrect: 1,
            judgeStatus: 'AUTO',
            points: 1,
            sharedBarrier: barrierBuffer,
            iterations: 2
          }
        });
        w.on('message', (msg) => {
          if (msg.status === 'READY') resolveReady();
          else if (msg.status === 'DONE') resolveDone(msg);
          else if (msg.status === 'FATAL') rejectDone(new Error(`Worker fatal: ${msg.error}`));
        });
        workers.push(w);
      }

      await Promise.all(readyPromises);

      // Start reader connection in main thread
      const readerDb = dbMod.initDb(tempDbPath);

      // Release writers
      Atomics.store(barrier, 0, 1);
      Atomics.notify(barrier, 0, NUM_WORKERS);

      // Perform 20 concurrent leaderboard reads while writers are actively committing
      let readSuccessCount = 0;
      for (let r = 0; r < 20; r++) {
        const lb = dbMod.getLeaderboard();
        assert.ok(Array.isArray(lb));
        readSuccessCount++;
      }

      const results = await Promise.all(donePromises);
      await Promise.all(workers.map(w => w.terminate()));

      assert.equal(readSuccessCount, 20, 'All 20 concurrent reads must succeed without blocking or SQLITE_BUSY');
    });

    it('1.4 Simulates 60 concurrent in-process asynchronous submission tasks', async () => {
      dbMod.initDb(tempDbPath);

      const tasks = [];
      for (let i = 1; i <= 60; i++) {
        tasks.push(new Promise((resolve) => {
          setImmediate(() => {
            try {
              const sub = dbMod.saveSubmission(i, 1, 'B', Date.now() + i, 1, 'AUTO', 1);
              resolve({ success: true, id: sub.id });
            } catch (err) {
              resolve({ success: false, error: err.message, code: err.code });
            }
          });
        }));
      }

      const results = await Promise.all(tasks);
      const failures = results.filter(r => !r.success);
      assert.equal(failures.length, 0, 'All 60 async tasks should succeed without errors');

      const count = dbMod.getDb().prepare('SELECT COUNT(*) AS cnt FROM SUBMISSIONS').get().cnt;
      assert.equal(count, 60);
    });
  });

  // =========================================================================
  // SECTION 2: DUPLICATE SUBMISSIONS & SCORE IDEMPOTENCY
  // =========================================================================

  describe('Section 2: Duplicate Submissions Uniqueness & Score Idempotency', () => {
    it('2.1 Sequential duplicate submission by same contestant for same question strictly rejects and preserves original score', () => {
      dbMod.initDb(tempDbPath);

      // Initial correct submission (3 points)
      const sub1 = dbMod.saveSubmission(1, 10, 'ANSWER_CORRECT', 1000, 1, 'AUTO', 3);
      assert.ok(sub1);
      assert.equal(sub1.is_correct, 1);
      assert.equal(sub1.awarded_points, 3);

      const contestantAfterFirst = dbMod.getContestantById(1);
      assert.equal(contestantAfterFirst.total_score, 3);

      // Attempt 1: Duplicate with same answer
      assert.throws(
        () => dbMod.saveSubmission(1, 10, 'ANSWER_CORRECT', 1200, 1, 'AUTO', 3),
        /UNIQUE constraint failed/i,
        'Duplicate submission must throw UNIQUE constraint'
      );

      // Attempt 2: Duplicate with different answer and 0 points
      assert.throws(
        () => dbMod.saveSubmission(1, 10, 'ANSWER_WRONG', 1500, 0, 'AUTO', 0),
        /UNIQUE constraint failed/i,
        'Second duplicate must also throw UNIQUE constraint'
      );

      // Attempt 3: Duplicate with different answer and higher points
      assert.throws(
        () => dbMod.saveSubmission(1, 10, 'ANSWER_HACK', 1800, 1, 'AUTO', 50),
        /UNIQUE constraint failed/i,
        'Third duplicate must also throw UNIQUE constraint'
      );

      // Verify contestant score is completely unaltered (remains 3)
      const contestantFinal = dbMod.getContestantById(1);
      assert.equal(contestantFinal.total_score, 3, 'Contestant score must remain 3');

      // Verify SUBMISSIONS table has exactly 1 record
      const rows = dbMod.getDb().prepare('SELECT * FROM SUBMISSIONS WHERE contestant_id = 1 AND question_id = 10').all();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].submitted_answer, 'ANSWER_CORRECT');
      assert.equal(rows[0].server_time_ms, 1000);
      assert.equal(rows[0].awarded_points, 3);
    });

    it('2.2 Race Condition: 20 concurrent threads attempting duplicate submission for the EXACT same (contestant_id, question_id)', async () => {
      const db = dbMod.initDb(tempDbPath);
      // Pre-seed contestant 1 and question 1
      db.prepare("INSERT INTO ROUNDS (id, name, weight_points, default_timer_sec, sequence_order) VALUES (1, 'Easy', 1, 15, 1)").run();
      db.prepare("INSERT INTO QUESTIONS (id, round_id, question_text, question_type, options_json, correct_answer, points, timer_seconds) VALUES (1, 1, 'Q1', 'MCQ', '[]', 'A', 2, 15)").run();
      db.prepare("INSERT INTO CONTESTANTS (id, pin, terminal_number, student_id, full_name, department_or_section) VALUES (1, '1001', 1, '2024-OLFU-0001', 'Contestant 1', 'BSIT')").run();
      dbMod.closeDb();

      const CONCURRENT_ATTEMPTS = 20;
      const barrierBuffer = new SharedArrayBuffer(4);
      const barrier = new Int32Array(barrierBuffer);
      barrier[0] = 0;

      const workerPath = path.resolve(__dirname, 'adversarial_worker.js');
      const workers = [];
      const readyPromises = [];
      const donePromises = [];

      for (let i = 1; i <= CONCURRENT_ATTEMPTS; i++) {
        let resolveReady, resolveDone, rejectDone;
        const readyP = new Promise((res) => { resolveReady = res; });
        const doneP = new Promise((res, rej) => { resolveDone = res; rejectDone = rej; });

        readyPromises.push(readyP);
        donePromises.push(doneP);

        const w = new Worker(workerPath, {
          workerData: {
            dbPath: tempDbPath,
            contestantId: 1, // EXACT SAME CONTESTANT
            questionId: 1,   // EXACT SAME QUESTION
            answer: `ANS_${i}`,
            serverTimeMs: 1700000000000 + i,
            isCorrect: 1,
            judgeStatus: 'AUTO',
            points: 2,
            sharedBarrier: barrierBuffer,
            iterations: 1
          }
        });

        w.on('message', (msg) => {
          if (msg.status === 'READY') resolveReady();
          else if (msg.status === 'DONE') resolveDone(msg);
          else if (msg.status === 'FATAL') rejectDone(new Error(`Worker fatal: ${msg.error}`));
        });
        w.on('error', (err) => rejectDone(err));
        workers.push(w);
      }

      await Promise.all(readyPromises);
      Atomics.store(barrier, 0, 1);
      Atomics.notify(barrier, 0, CONCURRENT_ATTEMPTS);

      const results = await Promise.all(donePromises);
      await Promise.all(workers.map(w => w.terminate()));

      let successes = 0;
      let uniqueErrors = 0;
      let busyErrors = 0;

      for (const res of results) {
        for (const sub of res.results) {
          if (sub.success) successes++;
          if (sub.isUnique) uniqueErrors++;
          if (sub.isBusy) busyErrors++;
        }
      }

      assert.equal(busyErrors, 0, 'No SQLITE_BUSY during race condition');
      assert.equal(successes, 1, `Exactly ONE thread must succeed in race condition, got ${successes}`);
      assert.equal(uniqueErrors, CONCURRENT_ATTEMPTS - 1, `Exactly 19 threads must fail with UNIQUE constraint, got ${uniqueErrors}`);

      // Verify database consistency
      const verifyDb = dbMod.initDb(tempDbPath);
      const rows = verifyDb.prepare('SELECT * FROM SUBMISSIONS WHERE contestant_id = 1 AND question_id = 1').all();
      assert.equal(rows.length, 1, 'Only 1 submission record must exist');

      const contestant = dbMod.getContestantById(1);
      assert.equal(contestant.total_score, 2, 'Contestant score must equal exactly 2 (not 40)');
    });

    it('2.3 Score recalculation idempotency across multiple rounds, re-evaluations, and judge updates', () => {
      dbMod.initDb(tempDbPath);

      // Submission 1: Question 1, 1 point
      const s1 = dbMod.saveSubmission(5, 1, 'A', 1000, 1, 'AUTO', 1);
      assert.equal(dbMod.getContestantById(5).total_score, 1);

      // Submission 2: Question 2, 2 points
      const s2 = dbMod.saveSubmission(5, 2, 'B', 2000, 1, 'AUTO', 2);
      assert.equal(dbMod.getContestantById(5).total_score, 3);

      // Submission 3: Question 3, Identification pending judge (0 points initial)
      const s3 = dbMod.saveSubmission(5, 3, 'UDP Proto', 3000, 0, 'PENDING', 0);
      assert.equal(dbMod.getContestantById(5).total_score, 3);

      // Judge approves Question 3 with 5 points -> total becomes 3 + 5 = 8
      dbMod.updateSubmissionRuling(s3.id, 'APPROVED', 5);
      assert.equal(dbMod.getContestantById(5).total_score, 8);

      // Idempotency: Judge re-affirms approval with same 5 points -> total remains 8
      dbMod.updateSubmissionRuling(s3.id, 'APPROVED', 5);
      assert.equal(dbMod.getContestantById(5).total_score, 8);

      // Judge changes ruling to REJECTED (0 points) -> total reverts to 3
      dbMod.updateSubmissionRuling(s3.id, 'REJECTED', 0);
      assert.equal(dbMod.getContestantById(5).total_score, 3);

      // Attempt duplicate on Question 3 -> rejects with UNIQUE constraint, total remains 3
      assert.throws(
        () => dbMod.saveSubmission(5, 3, 'UDP Proto Retry', 4000, 1, 'AUTO', 5),
        /UNIQUE constraint failed/i
      );
      assert.equal(dbMod.getContestantById(5).total_score, 3);
    });

    it('2.4 SQL injection resilience in submissions and rulings', () => {
      dbMod.initDb(tempDbPath);

      // Injected string in submitted_answer
      const sqlInjectionAns = "'; DROP TABLE SUBMISSIONS; --";
      const sub = dbMod.saveSubmission(1, 1, sqlInjectionAns, 1000, 1, 'AUTO', 2);

      assert.ok(sub);
      assert.equal(sub.submitted_answer, sqlInjectionAns);

      // Verify table was NOT dropped
      const subCount = dbMod.getDb().prepare('SELECT COUNT(*) AS cnt FROM SUBMISSIONS').get().cnt;
      assert.equal(subCount, 1);

      // Injected judge status - must fail CHECK constraint
      assert.throws(
        () => dbMod.updateSubmissionRuling(sub.id, "APPROVED' OR '1'='1", 2),
        /CHECK constraint failed/i
      );
    });
  });

  // =========================================================================
  // SECTION 3: CSV IMPORTER MALFORMED INPUTS & ROBUSTNESS
  // =========================================================================

  describe('Section 3: CSV Importer Malformed Inputs & Security', () => {
    it('3.1 Missing columns: handles CSVs with fewer columns or missing headers', () => {
      const db = dbMod.initDb(tempDbPath);
      const tempCsv = path.join(os.tmpdir(), `missing_cols_${Date.now()}.csv`);

      // Only 4 columns instead of 12
      const badCsv = `round,type,question,correct_answer
Easy,MCQ,"What is CSS?",A
Average,MCQ,"What is SQL?",B`;
      fs.writeFileSync(tempCsv, badCsv, 'utf8');

      try {
        const res = importQuestionsFromCsv(tempCsv, db);
        assert.equal(res.success, false);
        assert.ok(res.errors.length > 0, 'Must record errors for rows missing required columns');
        assert.match(res.errors[0], /Points must be a positive integer|Timer seconds must be a positive integer/i);
      } finally {
        if (fs.existsSync(tempCsv)) fs.unlinkSync(tempCsv);
      }
    });

    it('3.2 Unclosed quotes: handles unclosed quotes in fields without process crash', () => {
      const db = dbMod.initDb(tempDbPath);
      const tempCsv = path.join(os.tmpdir(), `unclosed_quotes_${Date.now()}.csv`);

      // Row with unclosed quote in question field
      const badCsv = `round,type,question,code_snippet,option_a,option_b,option_c,option_d,correct_answer,synonyms,points,timer_seconds
Easy,MCQ,"This is an unclosed quote question without closing quote,code,A,B,C,D,A,,1,15
Easy,MCQ,"Valid question",,A,B,C,D,B,,1,15`;
      fs.writeFileSync(tempCsv, badCsv, 'utf8');

      try {
        const res = importQuestionsFromCsv(tempCsv, db);
        // It must NOT crash, but report the parsing/row error safely
        assert.ok(res !== null);
        assert.ok(Array.isArray(res.errors));
        assert.equal(res.success, false);
      } finally {
        if (fs.existsSync(tempCsv)) fs.unlinkSync(tempCsv);
      }
    });

    it('3.3 Empty lines, blank whitespace rows, and mixed line endings (CRLF and LF)', () => {
      const db = dbMod.initDb(tempDbPath);
      const tempCsv = path.join(os.tmpdir(), `empty_lines_${Date.now()}.csv`);

      const csvData = [
        "", // Leading empty line
        "   ", // Whitespace line
        "round,type,question,code_snippet,option_a,option_b,option_c,option_d,correct_answer,synonyms,points,timer_seconds\r\n",
        "\r\n", // Blank CRLF line
        "Easy,MCQ,Question 1,,OptA,OptB,OptC,OptD,OptA,,1,15\r\n",
        "   \t   \r\n", // Tabs and spaces
        "\n",
        "Average,IDENTIFICATION,Question 2,,,,,,Answer2,syn1; syn2,2,30\n",
        "\n\n\n" // Trailing newlines
      ].join('');

      fs.writeFileSync(tempCsv, csvData, 'utf8');

      try {
        const res = importQuestionsFromCsv(tempCsv, db);
        assert.equal(res.success, true, `Expected success=true, errors: ${JSON.stringify(res.errors)}`);
        assert.equal(res.importedCount, 2, 'Exactly 2 valid questions must be imported, ignoring empty lines');

        const questions = dbMod.getAllQuestions();
        assert.equal(questions.length, 2);
        assert.equal(questions[0].question_text, 'Question 1');
        assert.equal(questions[1].question_text, 'Question 2');
        assert.deepEqual(questions[1].synonyms.sort(), ['answer2', 'syn1', 'syn2'].sort());
      } finally {
        if (fs.existsSync(tempCsv)) fs.unlinkSync(tempCsv);
      }
    });

    it('3.4 HTML & XSS tags: stores <script>alert(1)</script> and other tags safely without corruption', () => {
      const db = dbMod.initDb(tempDbPath);
      const tempCsv = path.join(os.tmpdir(), `xss_payload_${Date.now()}.csv`);

      const xssCsv = `round,type,question,code_snippet,option_a,option_b,option_c,option_d,correct_answer,synonyms,points,timer_seconds
Easy,MCQ,"Which tag is dangerous: <script>alert('XSS')</script>?","<iframe src='bad.html'></iframe>","<script>alert(1)</script>","<style>body{display:none}</style>","<img src=x onerror=alert(1)>","<b>safe</b>","<script>alert(1)</script>",,1,15
Average,IDENTIFICATION,"What tag is this: <script>alert(2)</script>?","let a = '<script>';","","","","","<script>","<script>;<script type='text/javascript'>",2,30`;

      fs.writeFileSync(tempCsv, xssCsv, 'utf8');

      try {
        const res = importQuestionsFromCsv(tempCsv, db);
        assert.equal(res.success, true);
        assert.equal(res.importedCount, 2);

        const q1 = dbMod.getQuestion(1);
        assert.ok(q1);
        assert.equal(q1.question_text, "Which tag is dangerous: <script>alert('XSS')</script>?");
        assert.equal(q1.code_snippet, "<iframe src='bad.html'></iframe>");
        assert.equal(q1.options.A, "<script>alert(1)</script>");
        assert.equal(q1.options.B, "<style>body{display:none}</style>");
        assert.equal(q1.options.C, "<img src=x onerror=alert(1)>");
        assert.equal(q1.correct_answer, "<script>alert(1)</script>");

        const q2 = dbMod.getQuestion(2);
        assert.ok(q2);
        assert.equal(q2.correct_answer, "<script>");
        assert.ok(q2.synonyms.includes("<script>"));
        assert.ok(q2.synonyms.includes("<script type='text/javascript'>"));
      } finally {
        if (fs.existsSync(tempCsv)) fs.unlinkSync(tempCsv);
      }
    });

    it('3.5 Unicode, international characters, and emojis are preserved faithfully', () => {
      const db = dbMod.initDb(tempDbPath);
      const tempCsv = path.join(os.tmpdir(), `unicode_${Date.now()}.csv`);

      const unicodeCsv = `round,type,question,code_snippet,option_a,option_b,option_c,option_d,correct_answer,synonyms,points,timer_seconds
Difficult,MCQ,"What does 🧠 + 💻 mean?","const emoji = '🚀';",A: Café,B: Über,C: Año,D: 🏆,A: Café,,3,45
Difficult,IDENTIFICATION,"Translate 'Hello' to Japanese: こんにちは / 中文 / Привет","print('こんにちは')","","","","","こんにちは","konnichiwa; こんにちは; 你好",3,45`;

      fs.writeFileSync(tempCsv, unicodeCsv, 'utf8');

      try {
        const res = importQuestionsFromCsv(tempCsv, db);
        assert.equal(res.success, true);
        assert.equal(res.importedCount, 2);

        const q1 = dbMod.getQuestion(1);
        assert.equal(q1.question_text, 'What does 🧠 + 💻 mean?');
        assert.equal(q1.code_snippet, "const emoji = '🚀';");
        assert.equal(q1.options.A, 'A: Café');
        assert.equal(q1.options.B, 'B: Über');
        assert.equal(q1.options.C, 'C: Año');
        assert.equal(q1.options.D, 'D: 🏆');

        const q2 = dbMod.getQuestion(2);
        assert.equal(q2.correct_answer, 'こんにちは');
        assert.ok(q2.synonyms.includes('konnichiwa'));
        assert.ok(q2.synonyms.includes('こんにちは'));
        assert.ok(q2.synonyms.includes('你好'));
      } finally {
        if (fs.existsSync(tempCsv)) fs.unlinkSync(tempCsv);
      }
    });

    it('3.6 Invalid types, negative points, and zero timer seconds produce specific validation errors', () => {
      const db = dbMod.initDb(tempDbPath);
      const tempCsv = path.join(os.tmpdir(), `invalid_vals_${Date.now()}.csv`);

      const invalidCsv = `round,type,question,code_snippet,option_a,option_b,option_c,option_d,correct_answer,synonyms,points,timer_seconds
Easy,TRUE_FALSE,Invalid type question,,T,F,,,T,,1,15
Easy,MCQ,Negative points question,,A,B,C,D,A,,-5,15
Easy,MCQ,Zero timer question,,A,B,C,D,A,,1,0
Easy,MCQ,Non-numeric points question,,A,B,C,D,A,,two,15
Easy,MCQ,"",,A,B,C,D,A,,1,15
Easy,MCQ,Missing answer question,,A,B,C,D,,,1,15`;

      fs.writeFileSync(tempCsv, invalidCsv, 'utf8');

      try {
        const res = importQuestionsFromCsv(tempCsv, db);
        assert.equal(res.success, false);
        assert.equal(res.importedCount, 0);
        assert.equal(res.errors.length, 6);

        assert.match(res.errors[0], /Invalid question type "TRUE_FALSE"/i);
        assert.match(res.errors[1], /Points must be a positive integer, got "-5"/i);
        assert.match(res.errors[2], /Timer seconds must be a positive integer, got "0"/i);
        assert.match(res.errors[3], /Points must be a positive integer, got "two"/i);
        assert.match(res.errors[4], /Question text is empty/i);
        assert.match(res.errors[5], /Correct answer is empty/i);
      } finally {
        if (fs.existsSync(tempCsv)) fs.unlinkSync(tempCsv);
      }
    });

    it('3.7 Semicolon synonym parsing edge cases: empty strings, extra semicolons, whitespace, duplicate entries', () => {
      assert.deepEqual(parseSynonyms(';; ; ; ;'), []);
      assert.deepEqual(parseSynonyms('  A  ;  B  ;  c  '), ['a', 'b', 'c']);
      assert.deepEqual(parseSynonyms('DROP TABLE; drop table; Drop Table;'), ['drop table', 'drop table', 'drop table']);
      assert.deepEqual(extractSynonyms('UDP; udp ; User Datagram Protocol', 'UDP', 'IDENTIFICATION').sort(), ['udp', 'user datagram protocol'].sort());
      // MCQ must never return synonyms
      assert.deepEqual(extractSynonyms('A; B; C', 'A', 'MCQ'), []);
    });

    it('3.8 SQL injection payloads in CSV columns are safely escaped by prepared statements', () => {
      const db = dbMod.initDb(tempDbPath);
      const tempCsv = path.join(os.tmpdir(), `sqli_${Date.now()}.csv`);

      const sqliCsv = `round,type,question,code_snippet,option_a,option_b,option_c,option_d,correct_answer,synonyms,points,timer_seconds
Easy,MCQ,"'); DROP TABLE QUESTIONS; --","'; DROP TABLE ROUNDS; --","' OR '1'='1","1; DELETE FROM QUESTIONS;","C","D","C",,1,15`;

      fs.writeFileSync(tempCsv, sqliCsv, 'utf8');

      try {
        const res = importQuestionsFromCsv(tempCsv, db);
        assert.equal(res.success, true);
        assert.equal(res.importedCount, 1);

        // Verify tables still exist and question was stored verbatim
        const q = dbMod.getQuestion(1);
        assert.ok(q);
        assert.equal(q.question_text, "'); DROP TABLE QUESTIONS; --");
        assert.equal(q.options.A, "' OR '1'='1");
      } finally {
        if (fs.existsSync(tempCsv)) fs.unlinkSync(tempCsv);
      }
    });

    it('3.9 Extreme payload stress: 100KB question text and 500 synonyms', () => {
      const db = dbMod.initDb(tempDbPath);
      const tempCsv = path.join(os.tmpdir(), `stress_payload_${Date.now()}.csv`);

      const hugeQuestion = 'Q'.repeat(100000);
      const synArray = [];
      for (let i = 0; i < 500; i++) synArray.push(`synonym_${i}`);
      const hugeSynonyms = synArray.join('; ');

      const stressCsv = `round,type,question,code_snippet,option_a,option_b,option_c,option_d,correct_answer,synonyms,points,timer_seconds
Difficult,IDENTIFICATION,"${hugeQuestion}",,,,,,ANS,"${hugeSynonyms}",3,45`;

      fs.writeFileSync(tempCsv, stressCsv, 'utf8');

      try {
        const res = importQuestionsFromCsv(tempCsv, db);
        assert.equal(res.success, true);
        assert.equal(res.importedCount, 1);

        const q = dbMod.getQuestion(1);
        assert.ok(q);
        assert.equal(q.question_text.length, 100000);
        assert.equal(q.synonyms.length, 501); // 500 synonyms + 1 canonical ans
      } finally {
        if (fs.existsSync(tempCsv)) fs.unlinkSync(tempCsv);
      }
    });

    it('3.10 Boundary inputs: non-existent file, empty file (0 bytes), and header-only CSV', () => {
      const db = dbMod.initDb(tempDbPath);

      // Non-existent file throws explicit error
      assert.throws(
        () => importQuestionsFromCsv('/non/existent/path/file.csv', db),
        /CSV file not found at/i
      );

      // Empty file (0 bytes)
      const emptyFile = path.join(os.tmpdir(), `empty_${Date.now()}.csv`);
      fs.writeFileSync(emptyFile, '', 'utf8');
      try {
        const res = importQuestionsFromCsv(emptyFile, db);
        assert.equal(res.success, true);
        assert.equal(res.importedCount, 0);
        assert.equal(res.errors.length, 0);
      } finally {
        if (fs.existsSync(emptyFile)) fs.unlinkSync(emptyFile);
      }

      // Header-only CSV
      const headerOnly = path.join(os.tmpdir(), `header_${Date.now()}.csv`);
      fs.writeFileSync(headerOnly, 'round,type,question,code_snippet,option_a,option_b,option_c,option_d,correct_answer,synonyms,points,timer_seconds\n', 'utf8');
      try {
        const res = importQuestionsFromCsv(headerOnly, db);
        assert.equal(res.success, true);
        assert.equal(res.importedCount, 0);
        assert.equal(res.errors.length, 0);
      } finally {
        if (fs.existsSync(headerOnly)) fs.unlinkSync(headerOnly);
      }
    });
  });
});
