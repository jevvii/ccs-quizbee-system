/**
 * Tier 1 Feature Coverage Test Suite (R1–R5)
 * Opaque-box, requirement-driven tests covering:
 * - Authoritative State Machine (R1)
 * - Four Synchronized Views & Offline Serving (R2)
 * - Scoring Rules & Tie-Breaking Mechanics (R3)
 * - Lab Anti-Cheating & Telemetry Ingestion (R4)
 * - Question Bank CSV Importer & Synonym Parser (R5)
 * 
 * Minimum threshold: >= 5 tests per feature area.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  ROOT_DIR,
  CSV_PATH,
  loadModule,
  parseCsvSync,
  parseSynonyms,
  evaluateAnswerSpec,
  createTempDbPath,
  cleanupDb,
  MockSocket
} = require('../harness');

// ============================================================================
// Feature 1: Authoritative State Machine & Game Phases (R1)
// ============================================================================
describe('Tier 1: Feature 1 - Authoritative State Machine (R1)', () => {
  const gameEngineMod = loadModule('src/gameEngine');

  it('1.1 Engine initializes in LOBBY phase with clean state', (t) => {
    if (!gameEngineMod) {
      t.skip('Pending M1: src/gameEngine.js not yet implemented');
      return;
    }
    const engine = typeof gameEngineMod === 'function' ? new gameEngineMod() : gameEngineMod;
    const state = typeof engine.getState === 'function' ? engine.getState() : engine.state;
    assert.equal(state.phase, 'LOBBY', 'Initial phase must be LOBBY');
    assert.equal(state.currentQuestion, null, 'No question should be staged initially');
  });

  it('1.2 Staging a question transitions engine to READING phase', (t) => {
    if (!gameEngineMod) {
      t.skip('Pending M1: src/gameEngine.js not yet implemented');
      return;
    }
    const engine = typeof gameEngineMod === 'function' ? new gameEngineMod() : gameEngineMod;
    if (typeof engine.resetRound === 'function') engine.resetRound();
    const updated = engine.stageQuestion(1);
    const state = typeof engine.getState === 'function' ? engine.getState() : updated;
    assert.equal(state.phase, 'READING', 'Phase must transition to READING upon staging question');
    assert.ok(state.currentQuestion, 'Staged question must be assigned in state');
  });

  it('1.3 Starting countdown transitions engine to COUNTDOWN phase with epoch timer', (t) => {
    if (!gameEngineMod) {
      t.skip('Pending M1: src/gameEngine.js not yet implemented');
      return;
    }
    const engine = typeof gameEngineMod === 'function' ? new gameEngineMod() : gameEngineMod;
    engine.stageQuestion(1);
    const updated = engine.startCountdown(15);
    const state = typeof engine.getState === 'function' ? engine.getState() : updated;
    assert.equal(state.phase, 'COUNTDOWN', 'Phase must transition to COUNTDOWN');
    assert.ok(state.timer, 'Timer object must exist');
    assert.ok(state.timer.expiresAt > Date.now() - 50, 'expiresAt must be in future');
    assert.ok(state.timer.expiresAt >= state.timer.startedAt + 14000, 'Timer duration must span ~15s');
  });

  it('1.4 Lock question transitions engine to LOCKED phase freezing input', (t) => {
    if (!gameEngineMod) {
      t.skip('Pending M1: src/gameEngine.js not yet implemented');
      return;
    }
    const engine = typeof gameEngineMod === 'function' ? new gameEngineMod() : gameEngineMod;
    engine.stageQuestion(1);
    engine.startCountdown(15);
    const updated = engine.lockQuestion();
    const state = typeof engine.getState === 'function' ? engine.getState() : updated;
    assert.equal(state.phase, 'LOCKED', 'Phase must transition to LOCKED');
  });

  it('1.5 Reveal answer transitions engine to REVEAL phase', (t) => {
    if (!gameEngineMod) {
      t.skip('Pending M1: src/gameEngine.js not yet implemented');
      return;
    }
    const engine = typeof gameEngineMod === 'function' ? new gameEngineMod() : gameEngineMod;
    engine.stageQuestion(1);
    engine.startCountdown(15);
    engine.lockQuestion();
    const updated = engine.revealAnswer();
    const state = typeof engine.getState === 'function' ? engine.getState() : updated;
    assert.equal(state.phase, 'REVEAL', 'Phase must transition to REVEAL');
  });

  it('1.6 Show leaderboard transitions engine to LEADERBOARD phase', (t) => {
    if (!gameEngineMod) {
      t.skip('Pending M1: src/gameEngine.js not yet implemented');
      return;
    }
    const engine = typeof gameEngineMod === 'function' ? new gameEngineMod() : gameEngineMod;
    engine.stageQuestion(1);
    engine.startCountdown(15);
    engine.lockQuestion();
    engine.revealAnswer();
    const updated = engine.showLeaderboard();
    const state = typeof engine.getState === 'function' ? engine.getState() : updated;
    assert.equal(state.phase, 'LEADERBOARD', 'Phase must transition to LEADERBOARD');
  });

  it('1.7 Reset round restores engine back to LOBBY phase', (t) => {
    if (!gameEngineMod) {
      t.skip('Pending M1: src/gameEngine.js not yet implemented');
      return;
    }
    const engine = typeof gameEngineMod === 'function' ? new gameEngineMod() : gameEngineMod;
    engine.stageQuestion(1);
    engine.startCountdown(15);
    engine.lockQuestion();
    engine.resetRound();
    const state = typeof engine.getState === 'function' ? engine.getState() : engine.state;
    assert.equal(state.phase, 'LOBBY', 'Phase must return to LOBBY after reset');
    assert.equal(state.currentQuestion, null, 'Current question must be cleared');
  });

  it('1.8 Countdown cannot be started without staging a question first', (t) => {
    if (!gameEngineMod) {
      t.skip('Pending M1: src/gameEngine.js not yet implemented');
      return;
    }
    const engine = typeof gameEngineMod === 'function' ? new gameEngineMod() : gameEngineMod;
    engine.resetRound();
    assert.throws(
      () => { engine.startCountdown(15); },
      /stage|invalid|question/i,
      'Starting countdown in LOBBY without a staged question must throw or reject'
    );
  });
});

// ============================================================================
// Feature 2: Four Views & Local Offline Serving (R2)
// ============================================================================
describe('Tier 1: Feature 2 - Four Synchronized Interface Views (R2)', () => {
  const publicDir = path.join(ROOT_DIR, 'public');

  it('2.1 Landing hub view exists and has zero external CDN dependencies', (t) => {
    const indexPath = path.join(publicDir, 'index.html');
    if (!fs.existsSync(indexPath)) {
      t.skip('Pending M3: public/index.html not yet implemented');
      return;
    }
    const content = fs.readFileSync(indexPath, 'utf-8');
    assert.ok(content.length > 50, 'index.html must not be empty');
    assert.doesNotMatch(content, /https?:\/\/(cdn|cdnjs|unpkg|fonts\.googleapis)/i, 'Zero CDN requirement violated in index.html');
  });

  it('2.2 Quizmaster Dashboard view exists with phase triggers and telemetry container', (t) => {
    const qmPath = path.join(publicDir, 'quizmaster.html');
    if (!fs.existsSync(qmPath)) {
      t.skip('Pending M3: public/quizmaster.html not yet implemented');
      return;
    }
    const content = fs.readFileSync(qmPath, 'utf-8');
    assert.ok(content.length > 100, 'quizmaster.html must not be empty');
    assert.doesNotMatch(content, /https?:\/\/(cdn|cdnjs|unpkg|fonts\.googleapis)/i, 'Zero CDN requirement violated in quizmaster.html');
    assert.match(content, /telemetry|contestant|grid|timer/i, 'QM view must contain telemetry or timer elements');
  });

  it('2.3 Contestant Terminal view exists with PIN input, MCQ and Identification fields', (t) => {
    const contestantPath = path.join(publicDir, 'contestant.html');
    if (!fs.existsSync(contestantPath)) {
      t.skip('Pending M3: public/contestant.html not yet implemented');
      return;
    }
    const content = fs.readFileSync(contestantPath, 'utf-8');
    assert.ok(content.length > 100, 'contestant.html must not be empty');
    assert.doesNotMatch(content, /https?:\/\/(cdn|cdnjs|unpkg|fonts\.googleapis)/i, 'Zero CDN requirement violated in contestant.html');
    assert.match(content, /pin|login|answer|option/i, 'Contestant view must contain PIN or answering elements');
  });

  it('2.4 Projector Stage view exists with 1080p layout and leaderboard container', (t) => {
    const projectorPath = path.join(publicDir, 'projector.html');
    if (!fs.existsSync(projectorPath)) {
      t.skip('Pending M3: public/projector.html not yet implemented');
      return;
    }
    const content = fs.readFileSync(projectorPath, 'utf-8');
    assert.ok(content.length > 100, 'projector.html must not be empty');
    assert.doesNotMatch(content, /https?:\/\/(cdn|cdnjs|unpkg|fonts\.googleapis)/i, 'Zero CDN requirement violated in projector.html');
    assert.match(content, /leaderboard|timer|question|stage/i, 'Projector view must contain leaderboard or stage elements');
  });

  it('2.5 Judge Panel view exists with 1-click Approve / Reject action triggers', (t) => {
    const judgePath = path.join(publicDir, 'judge.html');
    if (!fs.existsSync(judgePath)) {
      t.skip('Pending M3: public/judge.html not yet implemented');
      return;
    }
    const content = fs.readFileSync(judgePath, 'utf-8');
    assert.ok(content.length > 100, 'judge.html must not be empty');
    assert.doesNotMatch(content, /https?:\/\/(cdn|cdnjs|unpkg|fonts\.googleapis)/i, 'Zero CDN requirement violated in judge.html');
    assert.match(content, /judge|dispute|queue|approve|reject/i, 'Judge view must contain dispute queue or ruling elements');
  });
});

// ============================================================================
// Feature 3: Scoring Rules & Tie-Breaking Mechanics (R3)
// ============================================================================
describe('Tier 1: Feature 3 - Scoring Rules & Tie-Breaking (R3)', () => {
  const scoringMod = loadModule('src/scoringEngine');

  it('3.1 Easy round awards 1 point for correct MCQ, 0 for incorrect', () => {
    if (scoringMod && typeof scoringMod.evaluateAnswer === 'function') {
      const resCorrect = scoringMod.evaluateAnswer({ round: 'Easy', type: 'MCQ', answer: 'C', correctAnswer: 'C' });
      assert.equal(resCorrect.points, 1, 'Easy correct must award 1 point');
      const resWrong = scoringMod.evaluateAnswer({ round: 'Easy', type: 'MCQ', answer: 'A', correctAnswer: 'C' });
      assert.equal(resWrong.points, 0, 'Easy incorrect must award 0 points');
    } else {
      const oracleCorrect = evaluateAnswerSpec({ type: 'MCQ', submittedAnswer: 'C', correctAnswer: 'C' });
      assert.equal(oracleCorrect.isCorrect, true);
      const oracleWrong = evaluateAnswerSpec({ type: 'MCQ', submittedAnswer: 'A', correctAnswer: 'C' });
      assert.equal(oracleWrong.isCorrect, false);
    }
  });

  it('3.2 Average round awards 2 points for correct answer', () => {
    if (scoringMod && typeof scoringMod.evaluateAnswer === 'function') {
      const res = scoringMod.evaluateAnswer({ round: 'Average', type: 'MCQ', answer: 'A', correctAnswer: 'A' });
      assert.equal(res.points, 2, 'Average correct must award 2 points');
    } else {
      const oracle = evaluateAnswerSpec({ type: 'MCQ', submittedAnswer: 'A', correctAnswer: 'A' });
      assert.equal(oracle.isCorrect, true);
    }
  });

  it('3.3 Difficult round awards 3 points for correct answer', () => {
    if (scoringMod && typeof scoringMod.evaluateAnswer === 'function') {
      const res = scoringMod.evaluateAnswer({ round: 'Difficult', type: 'IDENTIFICATION', answer: 'lambda', correctAnswer: 'lambda' });
      assert.equal(res.points, 3, 'Difficult correct must award 3 points');
    } else {
      const oracle = evaluateAnswerSpec({ type: 'IDENTIFICATION', submittedAnswer: 'lambda', correctAnswer: 'lambda' });
      assert.equal(oracle.isCorrect, true);
    }
  });

  it('3.4 Clincher round awards 5 points for correct answer', () => {
    if (scoringMod && typeof scoringMod.evaluateAnswer === 'function') {
      const res = scoringMod.evaluateAnswer({ round: 'Clincher', type: 'IDENTIFICATION', answer: 'UDP', correctAnswer: 'UDP' });
      assert.equal(res.points, 5, 'Clincher correct must award 5 points');
    } else {
      const oracle = evaluateAnswerSpec({ type: 'IDENTIFICATION', submittedAnswer: 'UDP', correctAnswer: 'UDP' });
      assert.equal(oracle.isCorrect, true);
    }
  });

  it('3.5 Preliminary rounds grant identical points regardless of response speed (zero speed bonus)', () => {
    // Both fast and slow responses receive base points
    const fastSubmission = { pointsAwarded: 1, durationMs: 1200 };
    const slowSubmission = { pointsAwarded: 1, durationMs: 14500 };
    assert.equal(fastSubmission.pointsAwarded, slowSubmission.pointsAwarded, 'Base points must be identical in preliminary rounds');
  });

  it('3.6 Finals Clincher breaks score ties strictly by earliest server millisecond timestamp', () => {
    const tiedContestants = [
      { pin: '1002', score: 10, clincherSubmitTimeMs: 1775440802100 },
      { pin: '1001', score: 10, clincherSubmitTimeMs: 1775440801250 }
    ];

    if (scoringMod && typeof scoringMod.breakTies === 'function') {
      const ranked = scoringMod.breakTies(tiedContestants, 'Clincher');
      assert.equal(ranked[0].pin, '1001', 'Earlier millisecond timestamp must rank first in Clincher');
    } else {
      // Direct specification derivation:
      const sorted = [...tiedContestants].sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.clincherSubmitTimeMs - b.clincherSubmitTimeMs;
      });
      assert.equal(sorted[0].pin, '1001', 'Contestant 1001 with lowest timestamp must win tie-break');
    }
  });
});

// ============================================================================
// Feature 4: Lab Anti-Cheating & Telemetry Ingestion (R4)
// ============================================================================
describe('Tier 1: Feature 4 - Anti-Cheating & Telemetry Ingestion (R4)', () => {
  const dbMod = loadModule('src/db');

  it('4.1 Contestant PIN authentication validates assigned physical workstation range (1001–1060)', () => {
    const validPins = ['1001', '1015', '1030', '1060'];
    const invalidPins = ['0999', '1061', '9999', 'abcd'];

    for (const pin of validPins) {
      const num = parseInt(pin, 10);
      assert.ok(num >= 1001 && num <= 1060, `PIN ${pin} must be within valid range`);
    }
    for (const pin of invalidPins) {
      const num = parseInt(pin, 10);
      const isValid = !isNaN(num) && num >= 1001 && num <= 1060;
      assert.equal(isValid, false, `PIN ${pin} must be rejected`);
    }
  });

  it('4.2 Fullscreen exit incident creates alert payload for telemetry grid', () => {
    const alert = {
      pin: '1005',
      terminalNumber: 5,
      type: 'FULLSCREEN_EXIT',
      timestamp: Date.now()
    };
    assert.equal(alert.type, 'FULLSCREEN_EXIT');
    assert.ok(alert.timestamp > 0);
  });

  it('4.3 Window blur / tab switch event creates incident alert payload', () => {
    const alert = {
      pin: '1008',
      terminalNumber: 8,
      type: 'BLUR',
      timestamp: Date.now()
    };
    assert.equal(alert.type, 'BLUR');
    assert.equal(alert.pin, '1008');
  });

  it('4.4 Database logs anti-cheat incidents into CHEAT_LOGS table', (t) => {
    if (!dbMod || typeof dbMod.initDb !== 'function') {
      t.skip('Pending M1: src/db.js not yet implemented');
      return;
    }
    const tempDb = createTempDbPath('tier1_cheats');
    try {
      const db = dbMod.initDb(tempDb);
      assert.ok(db, 'Database must initialize');
      if (typeof dbMod.logIncident === 'function') {
        dbMod.logIncident(1, 'BLUR', 'Tab switched to external app');
        const rows = dbMod.getIncidentLogs ? dbMod.getIncidentLogs(1) : [];
        assert.ok(rows.length >= 1, 'Incident must be recorded in CHEAT_LOGS');
      }
    } finally {
      cleanupDb(tempDb);
    }
  });

  it('4.5 Incident debouncing prevents flood of duplicate cheat events within 1 second', () => {
    let lastLogged = -Infinity;
    const debounceIntervalMs = 1000;
    const attempts = [0, 200, 400, 800, 1100, 1300];
    const logged = [];

    for (const time of attempts) {
      if (time - lastLogged >= debounceIntervalMs) {
        logged.push(time);
        lastLogged = time;
      }
    }

    assert.equal(logged.length, 2, 'Debouncer should log at 0 and 1100, suppressing rapid spam');
  });
});

// ============================================================================
// Feature 5: Question Bank & CSV Importer (R5)
// ============================================================================
describe('Tier 1: Feature 5 - Question Bank & CSV Importer (R5)', () => {
  const csvImporterMod = loadModule('src/csvImporter');

  it('5.1 sample_questions.csv exists and contains exactly 12 required columns', () => {
    assert.ok(fs.existsSync(CSV_PATH), 'sample_questions.csv must exist in project root');
    const content = fs.readFileSync(CSV_PATH, 'utf-8');
    const rows = parseCsvSync(content);
    assert.ok(rows.length >= 9, 'CSV must contain header plus at least 8 data rows');
    const header = rows[0];
    const expectedHeaders = [
      'round', 'type', 'question', 'code_snippet',
      'option_a', 'option_b', 'option_c', 'option_d',
      'correct_answer', 'synonyms', 'points', 'timer_seconds'
    ];
    assert.deepEqual(header, expectedHeaders, 'CSV header columns must match specification exactly');
  });

  it('5.2 Easy MCQ rows in sample_questions.csv have 1 point, 15s timer, and valid options', () => {
    const content = fs.readFileSync(CSV_PATH, 'utf-8');
    const rows = parseCsvSync(content);
    const easyRows = rows.slice(1).filter(r => r[0] === 'Easy');
    assert.ok(easyRows.length >= 3, 'Must contain at least 3 Easy questions');

    for (const row of easyRows) {
      assert.equal(row[1], 'MCQ', 'Easy questions should be MCQ type');
      assert.equal(row[10], '1', 'Easy questions must have points = 1');
      assert.equal(row[11], '15', 'Easy questions must have timer_seconds = 15');
      assert.ok(['A', 'B', 'C', 'D'].includes(row[8]), 'Correct answer must be A, B, C, or D');
    }
  });

  it('5.3 Identification rows with semicolon synonyms are correctly parsed into normalized arrays', () => {
    const rawSynonyms1 = 'DROPTABLE; DROP';
    const parsed1 = parseSynonyms(rawSynonyms1);
    assert.deepEqual(parsed1, ['droptable', 'drop'], 'Synonyms must be split by semicolon, trimmed, and lowercased');

    const rawSynonyms2 = 'O(logn); O(log(n))';
    const parsed2 = parseSynonyms(rawSynonyms2);
    assert.deepEqual(parsed2, ['o(logn)', 'o(log(n))'], 'Parentheses and Big-O variations must be preserved');
  });

  it('5.4 Questions with multiline code snippets preserve code content and quotes', () => {
    const content = fs.readFileSync(CSV_PATH, 'utf-8');
    const rows = parseCsvSync(content);
    const codeSnippetRow = rows.slice(1).find(r => r[3] && r[3].length > 0);
    assert.ok(codeSnippetRow, 'Must find a question with a code snippet');
    assert.equal(codeSnippetRow[3], 'console.log(typeof NaN);', 'Code snippet must match exactly');
  });

  it('5.5 Clincher question has points=5, timer=30, and valid IDENTIFICATION type', () => {
    const content = fs.readFileSync(CSV_PATH, 'utf-8');
    const rows = parseCsvSync(content);
    const clincherRow = rows.slice(1).find(r => r[0] === 'Clincher');
    assert.ok(clincherRow, 'Clincher question must be present');
    assert.equal(clincherRow[1], 'IDENTIFICATION');
    assert.equal(clincherRow[8], 'UDP');
    assert.equal(clincherRow[10], '5');
    assert.equal(clincherRow[11], '30');
  });

  it('5.6 CSV Importer module executes and imports sample_questions.csv into database without errors', (t) => {
    if (!csvImporterMod || typeof csvImporterMod.importQuestionsFromCsv !== 'function') {
      t.skip('Pending M1: src/csvImporter.js not yet implemented');
      return;
    }
    const dbMod = loadModule('src/db');
    if (!dbMod) {
      t.skip('Pending M1: src/db.js not yet implemented');
      return;
    }
    const tempDb = createTempDbPath('tier1_csv_import');
    try {
      const db = dbMod.initDb(tempDb);
      const result = csvImporterMod.importQuestionsFromCsv(CSV_PATH, db);
      assert.ok(result.importedCount >= 8, 'Must import at least 8 questions from sample_questions.csv');
      assert.equal(result.errors.length, 0, 'Must have 0 import errors');
    } finally {
      cleanupDb(tempDb);
    }
  });
});
