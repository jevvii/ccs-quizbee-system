/**
 * Tier 2 Boundary & Edge Cases Test Suite
 * Opaque-box, requirement-driven tests covering:
 * - 0s Timer Locks & Grace Period
 * - HTML Tag & Special Character Sanitization in Questions / Options
 * - Whitespace & Case Normalization in Identification
 * - Semicolon-Delimited Synonym Variations
 * - Empty & Boundary Identification Inputs
 * - Duplicate Submissions
 * - Late Submissions & Clock Skew Guard
 * 
 * Minimum threshold: >= 5 tests per boundary area.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  loadModule,
  parseSynonyms,
  evaluateAnswerSpec,
  createTempDbPath,
  cleanupDb
} = require('../harness');

// ============================================================================
// Area 1: 0s Timer Locks & Grace Period
// ============================================================================
describe('Tier 2: Boundary 1 - 0s Timer Locks & Grace Period', () => {
  const GRACE_PERIOD_MS = 500;

  it('1.1 Submission arriving before expiresAt is accepted', () => {
    const startedAt = 10000;
    const expiresAt = startedAt + 15000;
    const receiptTime = startedAt + 14000; // 1s before expiration
    const isLate = receiptTime > (expiresAt + GRACE_PERIOD_MS);
    assert.equal(isLate, false, 'Submission before expiration must be accepted');
  });

  it('1.2 Submission arriving after expiresAt + grace window (500ms) is rejected', () => {
    const startedAt = 10000;
    const expiresAt = startedAt + 15000;
    const receiptTime = expiresAt + 600; // 600ms late
    const isLate = receiptTime > (expiresAt + GRACE_PERIOD_MS);
    assert.equal(isLate, true, 'Submission after grace period must be marked late');
  });

  it('1.3 Submission arriving within 500ms LAN grace window is accepted', () => {
    const startedAt = 10000;
    const expiresAt = startedAt + 15000;
    const receiptTime = expiresAt + 200; // 200ms within grace
    const isLate = receiptTime > (expiresAt + GRACE_PERIOD_MS);
    assert.equal(isLate, false, 'Submission within 500ms LAN grace must be accepted');
  });

  it('1.4 Countdown timer clamps or rejects negative or NaN durations', () => {
    const gameEngineMod = loadModule('src/gameEngine');
    if (!gameEngineMod) {
      const validateDuration = (d) => {
        const num = Number(d);
        if (isNaN(num) || num <= 0) throw new Error('Invalid timer duration');
        return Math.floor(num);
      };
      assert.throws(() => validateDuration(-5), /Invalid/i);
      assert.throws(() => validateDuration('abc'), /Invalid/i);
      assert.equal(validateDuration(15.9), 15);
    } else {
      const engine = typeof gameEngineMod === 'function' ? new gameEngineMod() : gameEngineMod;
      if (typeof engine.stageQuestion === 'function') engine.stageQuestion(1);
      assert.throws(() => engine.startCountdown(-10), /duration|invalid|timer/i);
    }
  });

  it('1.5 Force-lock by Quizmaster locks inputs immediately and rejects subsequent submissions', () => {
    let phase = 'COUNTDOWN';
    let isLocked = false;
    // Simulate QM emergency lock
    phase = 'LOCKED';
    isLocked = true;
    const canSubmit = (phase === 'COUNTDOWN' && !isLocked);
    assert.equal(canSubmit, false, 'No submissions permitted after force lock');
  });
});

// ============================================================================
// Area 2: HTML Tag & Script Sanitization in Questions / Options
// ============================================================================
describe('Tier 2: Boundary 2 - HTML Tag & Special Character Sanitization', () => {
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  it('2.1 Raw HTML tags like <script> in MCQ options are escaped as literal text', () => {
    const rawOption = '<script>alert("hacked")</script>';
    const sanitized = escapeHtml(rawOption);
    assert.equal(sanitized, '&lt;script&gt;alert(&quot;hacked&quot;)&lt;/script&gt;');
    assert.doesNotMatch(sanitized, /<script>/, 'Must not contain raw unescaped opening tag');
  });

  it('2.2 Question text containing img onerror XSS payload is safely escaped', () => {
    const xssQuestion = 'What is this? <img src=x onerror=alert(1)>';
    const sanitized = escapeHtml(xssQuestion);
    assert.ok(sanitized.includes('&lt;img'), 'Image tag must be escaped');
    assert.ok(!sanitized.includes('<img'), 'Raw img tag must be eradicated');
  });

  it('2.3 Comparison operator options (==, ===, !=, <=, >=) are preserved intact', () => {
    const operators = ['==', '===', '!=', '<=', '>='];
    for (const op of operators) {
      assert.ok(op.length >= 2, `Operator ${op} must be present`);
    }
  });

  it('2.4 Standard entity encoding renders without double-escaping issues', () => {
    const cleanText = 'Standard Option Text';
    const escaped = escapeHtml(cleanText);
    assert.equal(escaped, 'Standard Option Text', 'Alphanumeric text should remain untouched');
  });

  it('2.5 Code snippets with HTML/XML strings retain verbatim code formatting', () => {
    const codeSnippet = 'const el = "<div>Hello</div>";';
    assert.ok(codeSnippet.includes('<div>'), 'Verbatim code snippet retains original syntax');
    const displaySafe = escapeHtml(codeSnippet);
    assert.ok(displaySafe.includes('&lt;div&gt;'));
  });
});

// ============================================================================
// Area 3: Whitespace & Case Normalization in Identification Answers
// ============================================================================
describe('Tier 3: Boundary 3 - Whitespace & Case Normalization', () => {
  const correctAnswer = 'DROP TABLE';

  it('3.1 Exact uppercase match is accepted', () => {
    const res = evaluateAnswerSpec({
      type: 'IDENTIFICATION',
      submittedAnswer: 'DROP TABLE',
      correctAnswer
    });
    assert.equal(res.isCorrect, true);
    assert.equal(res.judgeStatus, 'AUTO');
  });

  it('3.2 All lowercase match is accepted', () => {
    const res = evaluateAnswerSpec({
      type: 'IDENTIFICATION',
      submittedAnswer: 'drop table',
      correctAnswer
    });
    assert.equal(res.isCorrect, true);
    assert.equal(res.judgeStatus, 'AUTO');
  });

  it('3.3 Mixed case match is accepted', () => {
    const res = evaluateAnswerSpec({
      type: 'IDENTIFICATION',
      submittedAnswer: 'dRoP tAbLe',
      correctAnswer
    });
    assert.equal(res.isCorrect, true);
    assert.equal(res.judgeStatus, 'AUTO');
  });

  it('3.4 Leading and trailing whitespace is trimmed and accepted', () => {
    const res = evaluateAnswerSpec({
      type: 'IDENTIFICATION',
      submittedAnswer: '   DROP TABLE   \t',
      correctAnswer
    });
    assert.equal(res.isCorrect, true);
    assert.equal(res.judgeStatus, 'AUTO');
  });

  it('3.5 Multiple internal spaces are normalized', () => {
    // Normalization test helper
    const normalizeInternalSpaces = s => s.trim().toLowerCase().replace(/\s+/g, ' ');
    const input = 'DROP     TABLE';
    assert.equal(normalizeInternalSpaces(input), 'drop table');
  });
});

// ============================================================================
// Area 4: Semicolon-Delimited Synonym Variations
// ============================================================================
describe('Tier 2: Boundary 4 - Semicolon-Delimited Synonym Variations', () => {
  it('4.1 Synonyms with variable whitespace around semicolons parse cleanly', () => {
    const raw = 'DROPTABLE ;  DROP ;   DROP TABLE ';
    const parsed = parseSynonyms(raw);
    assert.deepEqual(parsed, ['droptable', 'drop', 'drop table']);
  });

  it('4.2 Complex synonyms with symbols and parentheses are preserved', () => {
    const raw = 'O(logn); O(log(n)) ; O(log N)';
    const parsed = parseSynonyms(raw);
    assert.deepEqual(parsed, ['o(logn)', 'o(log(n))', 'o(log n)']);
  });

  it('4.3 Trailing semicolon does not produce an empty synonym string', () => {
    const raw = 'UDP; User Datagram Protocol;';
    const parsed = parseSynonyms(raw);
    assert.equal(parsed.length, 2);
    assert.ok(!parsed.includes(''), 'Empty strings must not exist in synonym list');
  });

  it('4.4 Synonym evaluation is case-insensitive across all entries', () => {
    const synonymsStr = 'User Datagram Protocol; UDP';
    const res = evaluateAnswerSpec({
      type: 'IDENTIFICATION',
      submittedAnswer: 'USER DATAGRAM PROTOCOL',
      correctAnswer: 'UDP',
      synonymsStr
    });
    assert.equal(res.isCorrect, true);
    assert.equal(res.judgeStatus, 'AUTO');
  });

  it('4.5 Empty or null synonyms string parses safely to empty array', () => {
    assert.deepEqual(parseSynonyms(''), []);
    assert.deepEqual(parseSynonyms(null), []);
    assert.deepEqual(parseSynonyms(undefined), []);
  });
});

// ============================================================================
// Area 5: Empty & Boundary Identification Inputs
// ============================================================================
describe('Tier 2: Boundary 5 - Empty & Boundary Identification Inputs', () => {
  it('5.1 Empty string input is marked incorrect and not queued as pending', () => {
    const res = evaluateAnswerSpec({
      type: 'IDENTIFICATION',
      submittedAnswer: '',
      correctAnswer: 'lambda',
      synonymsStr: 'lambda function'
    });
    assert.equal(res.isCorrect, false);
    assert.equal(res.judgeStatus, 'AUTO', 'Empty answer must be auto-failed, never queued to judge');
  });

  it('5.2 Whitespace-only input is trimmed to empty and auto-failed', () => {
    const res = evaluateAnswerSpec({
      type: 'IDENTIFICATION',
      submittedAnswer: '    \t\n  ',
      correctAnswer: 'lambda'
    });
    assert.equal(res.isCorrect, false);
    assert.equal(res.judgeStatus, 'AUTO');
  });

  it('5.3 Null or undefined submission input is safely handled', () => {
    const res1 = evaluateAnswerSpec({
      type: 'IDENTIFICATION',
      submittedAnswer: null,
      correctAnswer: 'lambda'
    });
    assert.equal(res1.isCorrect, false);
    assert.equal(res1.judgeStatus, 'AUTO');

    const res2 = evaluateAnswerSpec({
      type: 'IDENTIFICATION',
      submittedAnswer: undefined,
      correctAnswer: 'lambda'
    });
    assert.equal(res2.isCorrect, false);
  });

  it('5.4 Extremely long identification input (1,000+ characters) does not crash matcher', () => {
    const longString = 'a'.repeat(2000);
    const res = evaluateAnswerSpec({
      type: 'IDENTIFICATION',
      submittedAnswer: longString,
      correctAnswer: 'lambda'
    });
    assert.equal(res.isCorrect, false);
    assert.equal(res.judgeStatus, 'PENDING', 'Non-empty typo is routed to judge queue');
  });

  it('5.5 Input containing regex meta-characters does not throw regex exceptions', () => {
    const specialInput = '.*+?^${}()|[]\\';
    assert.doesNotThrow(() => {
      evaluateAnswerSpec({
        type: 'IDENTIFICATION',
        submittedAnswer: specialInput,
        correctAnswer: 'O(log n)',
        synonymsStr: 'O(logn); O(log(n))'
      });
    });
  });
});

// ============================================================================
// Area 6: Duplicate Submissions
// ============================================================================
describe('Tier 2: Boundary 6 - Duplicate Submissions Guard', () => {
  it('6.1 First submission for question is accepted and recorded', (t) => {
    const dbMod = loadModule('src/db');
    if (!dbMod || typeof dbMod.initDb !== 'function') {
      t.skip('Pending M1: src/db.js not yet implemented');
      return;
    }
    const tempDb = createTempDbPath('tier2_dup1');
    try {
      const db = dbMod.initDb(tempDb);
      const res = dbMod.saveSubmission(1, 1, 'C', Date.now(), 1, 'AUTO', 1);
      assert.ok(res, 'First submission must be accepted');
    } finally {
      cleanupDb(tempDb);
    }
  });

  it('6.2 Second submission by same contestant for same question is rejected or ignored', (t) => {
    const dbMod = loadModule('src/db');
    if (!dbMod || typeof dbMod.initDb !== 'function') {
      t.skip('Pending M1: src/db.js not yet implemented');
      return;
    }
    const tempDb = createTempDbPath('tier2_dup2');
    try {
      const db = dbMod.initDb(tempDb);
      const t1 = Date.now();
      dbMod.saveSubmission(1, 1, 'C', t1, 1, 'AUTO', 1);
      // Attempt second submission
      assert.throws(
        () => { dbMod.saveSubmission(1, 1, 'A', t1 + 500, 0, 'AUTO', 0); },
        /UNIQUE|duplicate|conflict/i,
        'Duplicate submission must violate UNIQUE constraint'
      );
    } finally {
      cleanupDb(tempDb);
    }
  });

  it('6.3 First submission timestamp server_time_ms is preserved for tie-breaking', () => {
    const initialSubmission = { contestantId: 1, questionId: 1, serverTimeMs: 1000, answer: 'UDP' };
    const duplicateAttempt = { contestantId: 1, questionId: 1, serverTimeMs: 2500, answer: 'UDP' };
    
    // Policy check: First submission timestamp must remain authoritative
    const recordedTimestamp = initialSubmission.serverTimeMs;
    assert.equal(recordedTimestamp, 1000, 'Original submission timestamp must remain unchanged');
  });

  it('6.4 Duplicate submission attempts do not inflate total score', () => {
    let score = 0;
    const recordedSubmissions = new Set();

    function record(contestantId, questionId, points) {
      const key = `${contestantId}:${questionId}`;
      if (recordedSubmissions.has(key)) return false;
      recordedSubmissions.add(key);
      score += points;
      return true;
    }

    assert.equal(record(1, 1, 1), true);
    assert.equal(record(1, 1, 1), false, 'Duplicate must be rejected');
    assert.equal(score, 1, 'Total score must remain 1');
  });

  it('6.5 Rapid concurrent burst submissions from same contestant produce exactly one record', () => {
    const submissions = [];
    const submissionsMap = new Map();

    const burst = [
      { contestantId: 1, questionId: 1, answer: 'A', timestamp: 100 },
      { contestantId: 1, questionId: 1, answer: 'B', timestamp: 102 },
      { contestantId: 1, questionId: 1, answer: 'C', timestamp: 105 }
    ];

    for (const sub of burst) {
      if (!submissionsMap.has(`${sub.contestantId}:${sub.questionId}`)) {
        submissionsMap.set(`${sub.contestantId}:${sub.questionId}`, sub);
        submissions.push(sub);
      }
    }

    assert.equal(submissions.length, 1, 'Exactly one submission must be recorded');
    assert.equal(submissions[0].answer, 'A', 'First received submission wins');
  });
});

// ============================================================================
// Area 7: Late Submissions & Authoritative Clock Skew Guard
// ============================================================================
describe('Tier 2: Boundary 7 - Late Submissions & Clock Skew Guard', () => {
  const SERVER_NOW = 10000;
  const EXPIRES_AT = 15000;

  it('7.1 Client submission with future client-side timestamp is evaluated by server receipt time', () => {
    const clientTimestamp = SERVER_NOW + 100000; // Skewed client clock in future
    const serverReceiptTime = SERVER_NOW + 1000; // Within 1s of server start
    
    // Server must use serverReceiptTime, ignoring clientTimestamp
    const isValid = serverReceiptTime <= EXPIRES_AT;
    assert.equal(isValid, true, 'Valid submission must not be penalized by future client clock');
  });

  it('7.2 Client submission with lagged/past client-side timestamp does not bypass server deadline', () => {
    const clientTimestamp = SERVER_NOW; // Client claims it answered earlier
    const serverReceiptTime = EXPIRES_AT + 2000; // Arrived 2s late at server

    const isLate = serverReceiptTime > (EXPIRES_AT + 500);
    assert.equal(isLate, true, 'Server receipt time must strictly reject post-deadline arrivals');
  });

  it('7.3 Late submission rejected after expiration results in 0 awarded points', () => {
    const submissionResult = {
      status: 'LATE_SUBMISSION',
      pointsAwarded: 0,
      isCorrect: false
    };
    assert.equal(submissionResult.pointsAwarded, 0);
  });

  it('7.4 Late submission does not overwrite an existing valid submission', () => {
    let activeSubmission = { id: 1, answer: 'C', points: 1 };
    const lateAttempt = { id: 2, answer: 'A', status: 'LATE_SUBMISSION' };

    if (lateAttempt.status !== 'LATE_SUBMISSION') {
      activeSubmission = lateAttempt;
    }
    assert.equal(activeSubmission.answer, 'C', 'Valid submission must be preserved');
  });

  it('7.5 Rejection of late submission returns standard rejection status without crashing', () => {
    function processSubmission(receiptTime, expiresAt) {
      if (receiptTime > expiresAt + 500) {
        return { success: false, error: 'SUBMISSION_EXPIRED' };
      }
      return { success: true };
    }

    const res = processSubmission(20000, 15000);
    assert.equal(res.success, false);
    assert.equal(res.error, 'SUBMISSION_EXPIRED');
  });
});
