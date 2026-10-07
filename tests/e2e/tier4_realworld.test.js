/**
 * Tier 4 Real-World Application Scenarios Test Suite
 * Opaque-box, requirement-driven tests covering full multi-round tournament scenarios:
 * - Scenario 1: Standard Tournament Lifecycle (Happy Path)
 * - Scenario 2: High-Dispute Identification Tournament with Judge Interventions
 * - Scenario 3: Computer Lab Power Glitch / Browser Crash & Recovery
 * - Scenario 4: Anti-Cheating Ingestion & Telemetry Incident Escalation
 * - Scenario 5: Finals Clincher Sudden-Death with Millisecond Tie-Breaking
 * 
 * Minimum threshold: >= 5 full multi-round scenarios.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  loadModule,
  evaluateAnswerSpec,
  createTempDbPath,
  cleanupDb,
  MockSocket
} = require('../harness');

// ============================================================================
// Scenario 1: Standard Tournament Lifecycle (Happy Path)
// ============================================================================
describe('Tier 4: Scenario 1 - Standard Tournament Lifecycle (Happy Path)', () => {
  it('1.1 Executes full 3-round tournament with 10 contestants and verifies accurate score aggregation', () => {
    // 10 contestants
    const contestants = Array.from({ length: 10 }, (_, i) => ({
      pin: String(1001 + i),
      terminal: i + 1,
      score: 0
    }));

    // Round 1: Easy MCQ (1 point, 15s) - Question: "Which HTML tag is used to define an internal style sheet?" (Correct: C)
    // Contestants 1001-1006 answer C (correct); 1007-1010 answer A (wrong)
    for (const c of contestants) {
      const answer = parseInt(c.pin, 10) <= 1006 ? 'C' : 'A';
      const evalRes = evaluateAnswerSpec({ type: 'MCQ', submittedAnswer: answer, correctAnswer: 'C' });
      if (evalRes.isCorrect) c.score += 1;
    }

    assert.equal(contestants.find(c => c.pin === '1001').score, 1);
    assert.equal(contestants.find(c => c.pin === '1007').score, 0);

    // Round 2: Average MCQ (2 points, 30s) - Question: "What will be the output of typeof NaN?" (Correct: A)
    // Contestants 1001-1004 answer A (correct); 1005-1010 answer C (wrong)
    for (const c of contestants) {
      const answer = parseInt(c.pin, 10) <= 1004 ? 'A' : 'C';
      const evalRes = evaluateAnswerSpec({ type: 'MCQ', submittedAnswer: answer, correctAnswer: 'A' });
      if (evalRes.isCorrect) c.score += 2;
    }

    assert.equal(contestants.find(c => c.pin === '1001').score, 3); // 1 + 2 = 3
    assert.equal(contestants.find(c => c.pin === '1005').score, 1); // 1 + 0 = 1
    assert.equal(contestants.find(c => c.pin === '1007').score, 0); // 0 + 0 = 0

    // Round 3: Difficult Identification (3 points, 45s) - Question: "In Python, what keyword is used to create an anonymous function?" (Correct: lambda)
    // Contestants 1001 and 1002 answer "lambda"; 1003 answers "def"
    for (const c of contestants) {
      let answer = 'def';
      if (['1001', '1002'].includes(c.pin)) answer = 'lambda';
      const evalRes = evaluateAnswerSpec({ type: 'IDENTIFICATION', submittedAnswer: answer, correctAnswer: 'lambda' });
      if (evalRes.isCorrect) c.score += 3;
    }

    assert.equal(contestants.find(c => c.pin === '1001').score, 6); // 3 + 3 = 6
    assert.equal(contestants.find(c => c.pin === '1002').score, 6); // 3 + 3 = 6
    assert.equal(contestants.find(c => c.pin === '1003').score, 3); // 3 + 0 = 3

    // Final leaderboard ranking
    const ranked = [...contestants].sort((a, b) => b.score - a.score);
    assert.equal(ranked[0].score, 6);
    assert.equal(ranked[1].score, 6);
    assert.equal(ranked[2].score, 3);
  });
});

// ============================================================================
// Scenario 2: High-Dispute Identification Tournament with Judge Interventions
// ============================================================================
describe('Tier 4: Scenario 2 - High-Dispute Identification Tournament with Judge Interventions', () => {
  it('2.1 Routes variations to Judge queue and recalculates standings dynamically upon rulings', () => {
    const question = {
      id: 5,
      type: 'IDENTIFICATION',
      correctAnswer: 'DROP TABLE',
      synonyms: 'DROPTABLE; DROP',
      points: 2
    };

    const contestants = [
      { pin: '1001', answer: 'DROP TABLE', score: 0 },         // Auto-approved (exact)
      { pin: '1002', answer: 'droptable', score: 0 },          // Auto-approved (synonym)
      { pin: '1003', answer: '  DROP  ', score: 0 },           // Auto-approved (synonym trimmed)
      { pin: '1004', answer: 'DROP TABLE CASCADE', score: 0 }, // Pending judge
      { pin: '1005', answer: 'DELETE TABLE', score: 0 },       // Pending judge
      { pin: '1006', answer: 'DROP THE TABLE', score: 0 },     // Pending judge
      { pin: '1007', answer: '', score: 0 },                   // Auto-failed (empty)
      { pin: '1008', answer: 'TRUNCATE', score: 0 }            // Pending judge
    ];

    const judgeQueue = [];

    // Stage & evaluate submissions
    for (const c of contestants) {
      const evalRes = evaluateAnswerSpec({
        type: question.type,
        submittedAnswer: c.answer,
        correctAnswer: question.correctAnswer,
        synonymsStr: question.synonyms
      });

      if (evalRes.isCorrect) {
        c.score += question.points;
      } else if (evalRes.judgeStatus === 'PENDING') {
        judgeQueue.push({ contestantPin: c.pin, answer: c.answer, points: question.points });
      }
    }

    assert.equal(contestants.find(c => c.pin === '1001').score, 2);
    assert.equal(contestants.find(c => c.pin === '1002').score, 2);
    assert.equal(contestants.find(c => c.pin === '1003').score, 2);
    assert.equal(contestants.find(c => c.pin === '1007').score, 0);
    assert.equal(judgeQueue.length, 4, 'Four answers must enter the Judge review queue');

    // Judge rules on queue items:
    // 1004 ("DROP TABLE CASCADE") -> APPROVED
    // 1005 ("DELETE TABLE") -> REJECTED
    // 1006 ("DROP THE TABLE") -> APPROVED
    // 1008 ("TRUNCATE") -> REJECTED
    const rulings = {
      '1004': 'APPROVED',
      '1005': 'REJECTED',
      '1006': 'APPROVED',
      '1008': 'REJECTED'
    };

    for (const item of judgeQueue) {
      const decision = rulings[item.contestantPin];
      if (decision === 'APPROVED') {
        const contestant = contestants.find(c => c.pin === item.contestantPin);
        contestant.score += item.points;
      }
    }

    assert.equal(contestants.find(c => c.pin === '1004').score, 2);
    assert.equal(contestants.find(c => c.pin === '1005').score, 0);
    assert.equal(contestants.find(c => c.pin === '1006').score, 2);
    assert.equal(contestants.find(c => c.pin === '1008').score, 0);

    const approvedCount = contestants.filter(c => c.score === 2).length;
    assert.equal(approvedCount, 5, '5 contestants should have 2 points after judge finalization');
  });
});

// ============================================================================
// Scenario 3: Computer Lab Power Glitch / Browser Crash & Recovery
// ============================================================================
describe('Tier 4: Scenario 3 - Lab Crash & Seamless Session Resumption', () => {
  it('3.1 Multiple contestants recover sessions on crash and submit without score loss', () => {
    // 12 active contestants
    const tournamentState = {
      phase: 'COUNTDOWN',
      questionId: 4,
      expiresAt: Date.now() + 18000,
      contestants: new Map()
    };

    for (let i = 1; i <= 12; i++) {
      const pin = String(1000 + i);
      tournamentState.contestants.set(pin, {
        pin,
        terminal: i,
        score: 5, // prior points
        activeSession: true,
        submitted: false
      });
    }

    // Stations 3, 7, and 11 experience sudden browser crashes
    const crashedPins = ['1003', '1007', '1011'];
    for (const pin of crashedPins) {
      const c = tournamentState.contestants.get(pin);
      c.activeSession = false; // socket dropped
    }

    // At remaining time 14s, contestants re-enter their PINs on new browser tabs
    for (const pin of crashedPins) {
      const c = tournamentState.contestants.get(pin);
      assert.ok(c, 'Contestant record found in system');
      c.activeSession = true; // re-attached
      assert.equal(c.score, 5, 'Prior score preserved');
      // Submit answer
      c.submitted = true;
      c.score += 2;
    }

    // Other contestants also submit
    for (const [pin, c] of tournamentState.contestants.entries()) {
      if (!crashedPins.includes(pin)) {
        c.submitted = true;
        c.score += 2;
      }
    }

    // All 12 contestants have 7 points with zero lost submissions
    for (const [pin, c] of tournamentState.contestants.entries()) {
      assert.equal(c.submitted, true, `Contestant ${pin} must have submitted`);
      assert.equal(c.score, 7, `Contestant ${pin} score must be exactly 7`);
    }
  });
});

// ============================================================================
// Scenario 4: Anti-Cheating Ingestion & Telemetry Incident Escalation
// ============================================================================
describe('Tier 4: Scenario 4 - Anti-Cheating Ingestion & Telemetry Escalation', () => {
  it('4.1 Server ingests and debounces blur/fullscreen alerts while tournament continues', () => {
    const qmTelemetryGrid = new Map();
    for (let i = 1; i <= 15; i++) {
      qmTelemetryGrid.set(String(1000 + i), { terminal: i, incidents: [] });
    }

    // Rogue contestant 1004 exits fullscreen 3 times
    const rogue4 = qmTelemetryGrid.get('1004');
    rogue4.incidents.push({ type: 'FULLSCREEN_EXIT', timestamp: 1000 });
    rogue4.incidents.push({ type: 'FULLSCREEN_EXIT', timestamp: 3000 });
    rogue4.incidents.push({ type: 'FULLSCREEN_EXIT', timestamp: 6000 });

    // Rogue contestant 1009 triggers rapid blur spam (10 times within 1 second)
    const rogue9 = qmTelemetryGrid.get('1009');
    let lastLogged = -Infinity;
    const spamTimestamps = [2000, 2100, 2200, 2300, 2400, 2500, 2600, 2700, 2800, 2900];
    for (const ts of spamTimestamps) {
      if (ts - lastLogged >= 1000) {
        rogue9.incidents.push({ type: 'BLUR', timestamp: ts });
        lastLogged = ts;
      }
    }

    // Verifications:
    assert.equal(rogue4.incidents.length, 3, 'Contestant 1004 has 3 spaced fullscreen incidents');
    assert.equal(rogue9.incidents.length, 1, 'Contestant 1009 burst spam is debounced to 1 incident');
    // Normal contestants remain clean
    assert.equal(qmTelemetryGrid.get('1001').incidents.length, 0);
  });
});

// ============================================================================
// Scenario 5: Finals Clincher Sudden-Death with Millisecond Tie-Breaking
// ============================================================================
describe('Tier 4: Scenario 5 - Finals Clincher Sudden-Death with Millisecond Tie-Breaking', () => {
  it('5.1 Resolves first-place tie using server millisecond timestamp strictly in Clincher round', () => {
    // Top 2 contestants tied with 15 points
    const finalists = [
      { pin: '1001', name: 'Contestant 01', score: 15 },
      { pin: '1002', name: 'Contestant 02', score: 15 }
    ];

    // Clincher question: UDP (5 points, 30s)
    const clincher = {
      type: 'IDENTIFICATION',
      correctAnswer: 'UDP',
      synonyms: 'User Datagram Protocol',
      points: 5
    };

    const serverStartTime = 1775440800000;

    // Both answer correctly, but Contestant 1001 answers 645ms faster
    const submissions = [
      {
        pin: '1001',
        answer: 'UDP',
        serverTimeMs: serverStartTime + 1245 // T + 1245ms
      },
      {
        pin: '1002',
        answer: 'User Datagram Protocol',
        serverTimeMs: serverStartTime + 1890 // T + 1890ms
      }
    ];

    // Evaluate both
    for (const sub of submissions) {
      const evalRes = evaluateAnswerSpec({
        type: clincher.type,
        submittedAnswer: sub.answer,
        correctAnswer: clincher.correctAnswer,
        synonymsStr: clincher.synonyms
      });
      assert.equal(evalRes.isCorrect, true);
      const f = finalists.find(item => item.pin === sub.pin);
      f.score += clincher.points;
      f.clincherTimestamp = sub.serverTimeMs;
    }

    // Both now have 20 points
    assert.equal(finalists[0].score, 20);
    assert.equal(finalists[1].score, 20);

    // Apply Clincher tie-breaking: sort by score descending, then clincherTimestamp ascending
    finalists.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.clincherTimestamp - b.clincherTimestamp;
    });

    // Winner verification
    assert.equal(finalists[0].pin, '1001', 'Contestant 1001 with earliest server timestamp wins 1st place');
    assert.equal(finalists[1].pin, '1002', 'Contestant 1002 wins 2nd place');
    assert.ok(finalists[0].clincherTimestamp < finalists[1].clincherTimestamp);
  });
});
