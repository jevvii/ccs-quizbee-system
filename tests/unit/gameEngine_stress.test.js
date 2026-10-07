/**
 * tests/unit/gameEngine_stress.test.js
 * Adversarial Stress & Boundary Test Suite for GameEngine (src/gameEngine.js)
 * 
 * Verifies:
 * 1. Illegal state transitions across all 8 phases
 * 2. Double triggers and transition guards
 * 3. Question input boundaries and sanitization
 * 4. Authoritative timer precision and pause/resume drift resistance
 * 5. Late submission boundary enforcement (expiresAt - 1ms, expiresAt, +299ms, +300ms, +301ms)
 * 6. Phase-based submission rejection in non-active phases
 * 7. Force-lock early termination behavior
 */

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const GameEngine = require('../../src/gameEngine');
const { PHASES, InvalidTransitionError } = GameEngine;

describe('Adversarial Stress: GameEngine State Machine & Boundary Suite', () => {
  let activeEngine = null;

  afterEach(() => {
    if (activeEngine) {
      activeEngine.resetRound();
      activeEngine = null;
    }
  });

  // ==========================================================================
  // 1. ILLEGAL STATE TRANSITIONS ACROSS ALL 8 PHASES
  // ==========================================================================
  describe('1. Illegal State Transition Guards', () => {
    it('1.1 LOBBY rejects startCountdown, pause, resume, lock, review, reveal, showLeaderboard', () => {
      activeEngine = new GameEngine();

      assert.throws(() => activeEngine.startCountdown(), InvalidTransitionError);
      assert.throws(() => activeEngine.pauseCountdown(), InvalidTransitionError);
      assert.throws(() => activeEngine.resumeCountdown(), InvalidTransitionError);
      assert.throws(() => activeEngine.lockQuestion(), InvalidTransitionError);
      assert.throws(() => activeEngine.enterReview(), InvalidTransitionError);
      assert.throws(() => activeEngine.revealAnswer(), InvalidTransitionError);
      assert.throws(() => activeEngine.showLeaderboard(), InvalidTransitionError);
    });

    it('1.2 READING rejects pause, resume, review, reveal, showLeaderboard', () => {
      activeEngine = new GameEngine();
      activeEngine.stageQuestion(10);

      assert.throws(() => activeEngine.pauseCountdown(), InvalidTransitionError);
      assert.throws(() => activeEngine.resumeCountdown(), InvalidTransitionError);
      assert.throws(() => activeEngine.enterReview(), InvalidTransitionError);
      assert.throws(() => activeEngine.revealAnswer(), InvalidTransitionError);
      assert.throws(() => activeEngine.showLeaderboard(), InvalidTransitionError);
    });

    it('1.3 COUNTDOWN rejects double start, staging new question, resume, review, reveal, showLeaderboard', () => {
      activeEngine = new GameEngine();
      activeEngine.stageQuestion(10);
      activeEngine.startCountdown();

      assert.throws(() => activeEngine.startCountdown(), InvalidTransitionError, 'Double start must throw');
      assert.throws(() => activeEngine.stageQuestion(20), InvalidTransitionError, 'Staging during countdown must throw');
      assert.throws(() => activeEngine.resumeCountdown(), InvalidTransitionError, 'Resume while running must throw');
      assert.throws(() => activeEngine.enterReview(), InvalidTransitionError);
      assert.throws(() => activeEngine.revealAnswer(), InvalidTransitionError);
      assert.throws(() => activeEngine.showLeaderboard(), InvalidTransitionError);
    });

    it('1.4 PAUSED rejects double pause, start, staging new question, review, reveal, showLeaderboard', () => {
      activeEngine = new GameEngine();
      activeEngine.stageQuestion(10);
      activeEngine.startCountdown();
      activeEngine.pauseCountdown();

      assert.throws(() => activeEngine.pauseCountdown(), InvalidTransitionError, 'Double pause must throw');
      assert.throws(() => activeEngine.startCountdown(), InvalidTransitionError);
      assert.throws(() => activeEngine.stageQuestion(20), InvalidTransitionError);
      assert.throws(() => activeEngine.enterReview(), InvalidTransitionError);
      assert.throws(() => activeEngine.revealAnswer(), InvalidTransitionError);
      assert.throws(() => activeEngine.showLeaderboard(), InvalidTransitionError);
    });

    it('1.5 LOCKED rejects countdown, pause, resume; lockQuestion is idempotent', () => {
      activeEngine = new GameEngine();
      activeEngine.stageQuestion(10);
      activeEngine.lockQuestion();

      assert.throws(() => activeEngine.startCountdown(), InvalidTransitionError);
      assert.throws(() => activeEngine.pauseCountdown(), InvalidTransitionError);
      assert.throws(() => activeEngine.resumeCountdown(), InvalidTransitionError);

      const idempotentState = activeEngine.lockQuestion();
      assert.equal(idempotentState.phase, PHASES.LOCKED);
    });

    it('1.6 REVIEW rejects countdown, pause, resume, lock, and double enterReview', () => {
      activeEngine = new GameEngine();
      activeEngine.stageQuestion(10);
      activeEngine.lockQuestion();
      activeEngine.enterReview();

      assert.throws(() => activeEngine.startCountdown(), InvalidTransitionError);
      assert.throws(() => activeEngine.pauseCountdown(), InvalidTransitionError);
      assert.throws(() => activeEngine.resumeCountdown(), InvalidTransitionError);
      assert.throws(() => activeEngine.lockQuestion(), InvalidTransitionError);
      assert.throws(() => activeEngine.enterReview(), InvalidTransitionError, 'Double enterReview must throw');
    });

    it('1.7 REVEAL rejects countdown, pause, resume, lock, review, and double revealAnswer', () => {
      activeEngine = new GameEngine();
      activeEngine.stageQuestion(10);
      activeEngine.lockQuestion();
      activeEngine.revealAnswer();

      assert.throws(() => activeEngine.startCountdown(), InvalidTransitionError);
      assert.throws(() => activeEngine.pauseCountdown(), InvalidTransitionError);
      assert.throws(() => activeEngine.resumeCountdown(), InvalidTransitionError);
      assert.throws(() => activeEngine.lockQuestion(), InvalidTransitionError);
      assert.throws(() => activeEngine.enterReview(), InvalidTransitionError);
      assert.throws(() => activeEngine.revealAnswer(), InvalidTransitionError, 'Double revealAnswer must throw');
    });

    it('1.8 LEADERBOARD rejects countdown, pause, resume, lock, review, and double showLeaderboard', () => {
      activeEngine = new GameEngine();
      activeEngine.stageQuestion(10);
      activeEngine.lockQuestion();
      activeEngine.showLeaderboard();

      assert.throws(() => activeEngine.startCountdown(), InvalidTransitionError);
      assert.throws(() => activeEngine.pauseCountdown(), InvalidTransitionError);
      assert.throws(() => activeEngine.resumeCountdown(), InvalidTransitionError);
      assert.throws(() => activeEngine.lockQuestion(), InvalidTransitionError);
      assert.throws(() => activeEngine.enterReview(), InvalidTransitionError);
      assert.throws(() => activeEngine.showLeaderboard(), InvalidTransitionError, 'Double showLeaderboard must throw');
    });
  });

  // ==========================================================================
  // 2. QUESTION & DURATION INPUT SANITIZATION
  // ==========================================================================
  describe('2. Input Boundary Sanitization', () => {
    it('2.1 stageQuestion rejects null, undefined, empty object, null id, and empty string', () => {
      activeEngine = new GameEngine();

      assert.throws(() => activeEngine.stageQuestion(null), /invalid question/i);
      assert.throws(() => activeEngine.stageQuestion(undefined), /invalid question/i);
      assert.throws(() => activeEngine.stageQuestion({}), /invalid question/i);
      assert.throws(() => activeEngine.stageQuestion({ id: null }), /invalid question/i);
      assert.throws(() => activeEngine.stageQuestion(''), /invalid question/i);
      assert.throws(() => activeEngine.stageQuestion([]), /invalid question/i);
    });

    it('2.2 stageQuestion handles numeric 0 and object with id 0', () => {
      activeEngine = new GameEngine();

      // Primitive 0 is falsy, rejected by !question check
      assert.throws(() => activeEngine.stageQuestion(0), /invalid question/i);

      // Object { id: 0 } is truthy and has non-null id
      const s0 = activeEngine.stageQuestion({ id: 0, timer_seconds: 15 });
      assert.equal(s0.currentQuestion.id, 0);
    });

    it('2.3 stageQuestion defaults non-positive or non-numeric timer_seconds to 15s', () => {
      activeEngine = new GameEngine();

      const s1 = activeEngine.stageQuestion({ id: 1, timer_seconds: -10 });
      assert.equal(s1.timer.durationMs, 15000);

      const s2 = activeEngine.stageQuestion({ id: 2, timer_seconds: 0 });
      assert.equal(s2.timer.durationMs, 15000);

      const s3 = activeEngine.stageQuestion({ id: 3, timer_seconds: 'invalid' });
      assert.equal(s3.timer.durationMs, 15000);
    });

    it('2.4 startCountdown rejects negative, zero, and non-numeric duration arguments', () => {
      activeEngine = new GameEngine();
      activeEngine.stageQuestion(1);

      assert.throws(() => activeEngine.startCountdown(-1), /invalid timer duration/i);
      assert.throws(() => activeEngine.startCountdown(0), /invalid timer duration/i);
      assert.throws(() => activeEngine.startCountdown('not-a-number'), /invalid timer duration/i);
      assert.throws(() => activeEngine.startCountdown(NaN), /invalid timer duration/i);
    });
  });

  // ==========================================================================
  // 3. TIMER ACCURACY & DRIFT ACCUMULATION
  // ==========================================================================
  describe('3. Timer Accuracy, Rapid Pause/Resume & Drift Resistance', () => {
    it('3.1 Synchronous back-to-back pause/resume produces zero drift', () => {
      activeEngine = new GameEngine();
      activeEngine.stageQuestion({ id: 1, timer_seconds: 20 });
      activeEngine.startCountdown();

      const initialExpiresAt = activeEngine.getState().timer.expiresAt;

      for (let i = 0; i < 20; i++) {
        activeEngine.pauseCountdown();
        activeEngine.resumeCountdown();
      }

      const finalExpiresAt = activeEngine.getState().timer.expiresAt;
      assert.ok(
        Math.abs(finalExpiresAt - initialExpiresAt) <= 2,
        `Synchronous pause/resume must accumulate <= 2ms drift (got ${Math.abs(finalExpiresAt - initialExpiresAt)}ms)`
      );
    });

    it('3.2 50 rapid pause/resume cycles under setTimeout maintain precise remaining time', async () => {
      activeEngine = new GameEngine({ tickIntervalMs: 10 });
      activeEngine.stageQuestion({ id: 2, timer_seconds: 10 });
      activeEngine.startCountdown();

      for (let i = 0; i < 50; i++) {
        await new Promise(r => setTimeout(r, 4));

        const pauseState = activeEngine.pauseCountdown();
        assert.equal(pauseState.phase, PHASES.PAUSED);
        const frozenMs = pauseState.timer.remainingMs;

        await new Promise(r => setTimeout(r, 4));

        // State remains frozen while paused
        assert.equal(activeEngine.getState().timer.remainingMs, frozenMs);

        const resumedState = activeEngine.resumeCountdown();
        assert.equal(resumedState.phase, PHASES.COUNTDOWN);

        const diff = Math.abs(resumedState.timer.expiresAt - (Date.now() + frozenMs));
        assert.ok(diff <= 15, `Drift on cycle ${i} must be <= 15ms (got ${diff}ms)`);
      }
    });

    it('3.3 Auto-timeout triggers transition to LOCKED on expiry', async () => {
      activeEngine = new GameEngine({ tickIntervalMs: 10 });
      activeEngine.stageQuestion({ id: 3, timer_seconds: 0.1 }); // 100ms
      const t0 = Date.now();

      let autoLocked = false;
      let lockTimestamp = 0;
      activeEngine.on('phase:change', ({ newPhase, autoExpired }) => {
        if (newPhase === PHASES.LOCKED && autoExpired) {
          autoLocked = true;
          lockTimestamp = Date.now();
        }
      });

      activeEngine.startCountdown();
      await new Promise(r => setTimeout(r, 160));

      assert.equal(autoLocked, true, 'Auto-lock must fire on expiration');
      const elapsed = lockTimestamp - t0;
      assert.ok(elapsed >= 95 && elapsed <= 160, `Elapsed ${elapsed}ms must be close to 100ms`);
    });

    it('3.4 resumeCountdown throws if remainingMs is 0 or expired', () => {
      activeEngine = new GameEngine();
      activeEngine.stageQuestion(4);
      activeEngine.state.phase = PHASES.PAUSED;
      activeEngine.state.timer.remainingMs = 0;

      assert.throws(() => activeEngine.resumeCountdown(), /expired/i);
    });
  });

  // ==========================================================================
  // 4. LATE SUBMISSION GATE BOUNDARY TESTING
  // ==========================================================================
  describe('4. Late Submission Gate Boundary Enforcement', () => {
    const GRACE = 300;

    it('4.1 COUNTDOWN boundary: expiresAt - 1ms is ALLOWED', () => {
      activeEngine = new GameEngine({ graceWindowMs: GRACE });
      activeEngine.stageQuestion(1);
      activeEngine.startCountdown();
      const expiresAt = activeEngine.getState().timer.expiresAt;

      const res = activeEngine.canAcceptSubmission(expiresAt - 1);
      assert.equal(res.allowed, true);
      assert.equal(res.reason, null);
    });

    it('4.2 COUNTDOWN boundary: expiresAt is ALLOWED', () => {
      activeEngine = new GameEngine({ graceWindowMs: GRACE });
      activeEngine.stageQuestion(1);
      activeEngine.startCountdown();
      const expiresAt = activeEngine.getState().timer.expiresAt;

      const res = activeEngine.canAcceptSubmission(expiresAt);
      assert.equal(res.allowed, true);
      assert.equal(res.reason, null);
    });

    it('4.3 COUNTDOWN boundary: expiresAt + 299ms is ALLOWED', () => {
      activeEngine = new GameEngine({ graceWindowMs: GRACE });
      activeEngine.stageQuestion(1);
      activeEngine.startCountdown();
      const expiresAt = activeEngine.getState().timer.expiresAt;

      const res = activeEngine.canAcceptSubmission(expiresAt + 299);
      assert.equal(res.allowed, true);
      assert.equal(res.reason, null);
    });

    it('4.4 COUNTDOWN boundary: expiresAt + 300ms is ALLOWED (exact boundary edge)', () => {
      activeEngine = new GameEngine({ graceWindowMs: GRACE });
      activeEngine.stageQuestion(1);
      activeEngine.startCountdown();
      const expiresAt = activeEngine.getState().timer.expiresAt;

      const res = activeEngine.canAcceptSubmission(expiresAt + 300);
      assert.equal(res.allowed, true);
      assert.equal(res.reason, null);
    });

    it('4.5 COUNTDOWN boundary: expiresAt + 301ms is REJECTED with EXPIRED_LATE_SUBMISSION', () => {
      activeEngine = new GameEngine({ graceWindowMs: GRACE });
      activeEngine.stageQuestion(1);
      activeEngine.startCountdown();
      const expiresAt = activeEngine.getState().timer.expiresAt;

      const res = activeEngine.canAcceptSubmission(expiresAt + 301);
      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'EXPIRED_LATE_SUBMISSION');
    });

    it('4.6 LOCKED (autoExpired) boundary: expiresAt - 1ms, expiresAt, +299ms, +300ms ALLOWED; +301ms REJECTED', () => {
      activeEngine = new GameEngine({ graceWindowMs: GRACE });
      activeEngine.stageQuestion(1);
      activeEngine.startCountdown();
      const expiresAt = activeEngine.getState().timer.expiresAt;
      activeEngine.lockQuestion({ autoExpired: true });

      assert.equal(activeEngine.canAcceptSubmission(expiresAt - 1).allowed, true);
      assert.equal(activeEngine.canAcceptSubmission(expiresAt).allowed, true);
      assert.equal(activeEngine.canAcceptSubmission(expiresAt + 299).allowed, true);
      assert.equal(activeEngine.canAcceptSubmission(expiresAt + 300).allowed, true);

      const late = activeEngine.canAcceptSubmission(expiresAt + 301);
      assert.equal(late.allowed, false);
      assert.equal(late.reason, 'SUBMISSIONS_LOCKED');
    });

    it('4.7 Non-countdown phases strictly prohibit submissions', () => {
      activeEngine = new GameEngine();

      assert.equal(activeEngine.canAcceptSubmission().reason, 'SUBMISSIONS_PROHIBITED_IN_LOBBY');

      activeEngine.stageQuestion(1);
      assert.equal(activeEngine.canAcceptSubmission().reason, 'SUBMISSIONS_PROHIBITED_IN_READING');

      activeEngine.startCountdown(10);
      activeEngine.pauseCountdown();
      assert.equal(activeEngine.canAcceptSubmission().reason, 'SUBMISSIONS_PROHIBITED_IN_PAUSED');

      activeEngine.lockQuestion();
      activeEngine.enterReview();
      assert.equal(activeEngine.canAcceptSubmission().reason, 'SUBMISSIONS_PROHIBITED_IN_REVIEW');

      activeEngine.revealAnswer();
      assert.equal(activeEngine.canAcceptSubmission().reason, 'SUBMISSIONS_PROHIBITED_IN_REVEAL');

      activeEngine.showLeaderboard();
      assert.equal(activeEngine.canAcceptSubmission().reason, 'SUBMISSIONS_PROHIBITED_IN_LEADERBOARD');
    });
  });

  // ==========================================================================
  // 5. ADVERSARIAL FORCE-LOCK VULNERABILITY ANALYSIS & FIX VERIFICATION
  // ==========================================================================
  describe('5. Force-Lock Premature Closure Analysis', () => {
    it('5.1 Verifies Quizmaster manual force-lock truncates expiresAt and rejects late submissions beyond grace window', () => {
      activeEngine = new GameEngine({ graceWindowMs: 300 });
      activeEngine.stageQuestion({ id: 999, timer_seconds: 30 });
      const state0 = activeEngine.startCountdown();
      const originalExpiresAt = state0.timer.expiresAt;
      const forceLockTime = Date.now();

      // Quizmaster triggers manual force lock (opts.autoExpired is false)
      activeEngine.lockQuestion();

      const lockedState = activeEngine.getState();
      assert.equal(lockedState.phase, PHASES.LOCKED);

      // Truncated: expiresAt must be updated to approximately Date.now(), NOT originalExpiresAt
      assert.ok(
        Math.abs(lockedState.timer.expiresAt - forceLockTime) <= 15,
        `expiresAt must be truncated to current time on manual force lock (got ${lockedState.timer.expiresAt}, expected ~${forceLockTime})`
      );
      assert.ok(lockedState.timer.expiresAt < originalExpiresAt);

      // In-flight submission within 300ms LAN grace window is permitted
      const inFlightSubmission = activeEngine.canAcceptSubmission(forceLockTime + 150);
      assert.equal(inFlightSubmission.allowed, true, 'In-flight submission within 300ms grace window must be accepted');
      assert.equal(inFlightSubmission.reason, null);

      // Late submission >300ms post-lock is strictly rejected with SUBMISSIONS_LOCKED
      const postGraceSubmission = activeEngine.canAcceptSubmission(lockedState.timer.expiresAt + 301);
      assert.equal(postGraceSubmission.allowed, false, 'Submission >300ms post-lock must be rejected');
      assert.equal(postGraceSubmission.reason, 'SUBMISSIONS_LOCKED');

      const lateSubmission = activeEngine.canAcceptSubmission(forceLockTime + 2000);
      assert.equal(lateSubmission.allowed, false, 'Submission 2s after manual force lock must be rejected');
      assert.equal(lateSubmission.reason, 'SUBMISSIONS_LOCKED');
    });
  });
});
