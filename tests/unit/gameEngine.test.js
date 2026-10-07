/**
 * tests/unit/gameEngine.test.js
 * Unit Test Suite for GameEngine Authoritative State Machine & Epoch Timer
 */

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const GameEngine = require('../../src/gameEngine');
const { PHASES, InvalidTransitionError } = GameEngine;

describe('GameEngine State Machine & Epoch Timer (src/gameEngine.js)', () => {
  let activeEngine = null;

  afterEach(() => {
    if (activeEngine) {
      activeEngine.resetRound();
      activeEngine = null;
    }
  });

  it('1. Initial state is LOBBY with null question and zeroed timer', () => {
    activeEngine = new GameEngine();
    const state = activeEngine.getState();

    assert.equal(state.phase, PHASES.LOBBY);
    assert.equal(state.currentQuestion, null);
    assert.equal(state.roundId, null);
    assert.equal(state.timer.startedAt, null);
    assert.equal(state.timer.expiresAt, null);
    assert.equal(state.timer.isPaused, false);
    assert.equal(state.timer.remainingMs, 0);
  });

  it('2. stageQuestion transitions to READING and initializes timer duration', () => {
    activeEngine = new GameEngine();
    const q = { id: 101, question_text: 'What is WAL?', timer_seconds: 30, points: 2, round_id: 1 };
    const state = activeEngine.stageQuestion(q);

    assert.equal(state.phase, PHASES.READING);
    assert.equal(state.currentQuestion.id, 101);
    assert.equal(state.roundId, 1);
    assert.equal(state.timer.durationMs, 30000);
    assert.equal(state.timer.remainingMs, 30000);
  });

  it('3. stageQuestion accepts numeric ID as argument', () => {
    activeEngine = new GameEngine();
    const state = activeEngine.stageQuestion(42);

    assert.equal(state.phase, PHASES.READING);
    assert.equal(state.currentQuestion.id, 42);
    assert.equal(state.timer.durationMs, 15000);
  });

  it('4. startCountdown calculates exact epoch deadline and transitions to COUNTDOWN', () => {
    activeEngine = new GameEngine();
    activeEngine.stageQuestion({ id: 1, timer_seconds: 15 });

    const before = Date.now();
    const state = activeEngine.startCountdown();
    const after = Date.now();

    assert.equal(state.phase, PHASES.COUNTDOWN);
    assert.ok(state.timer.startedAt >= before && state.timer.startedAt <= after);
    assert.equal(state.timer.durationMs, 15000);
    assert.equal(state.timer.expiresAt, state.timer.startedAt + 15000);
    assert.equal(state.timer.isPaused, false);
  });

  it('5. startCountdown allows custom duration override and rejects invalid durations', () => {
    activeEngine = new GameEngine();
    activeEngine.stageQuestion({ id: 1, timer_seconds: 15 });

    const state = activeEngine.startCountdown(45);
    assert.equal(state.timer.durationMs, 45000);
    assert.equal(state.timer.expiresAt, state.timer.startedAt + 45000);

    activeEngine.resetRound();
    activeEngine.stageQuestion(2);
    assert.throws(() => activeEngine.startCountdown(-5), /invalid|duration|timer/i);
    assert.throws(() => activeEngine.startCountdown('bad'), /invalid|duration|timer/i);
  });

  it('6. pauseCountdown and resumeCountdown preserve exact active time without drift', async () => {
    activeEngine = new GameEngine();
    activeEngine.stageQuestion({ id: 1, timer_seconds: 10 });
    activeEngine.startCountdown();

    await new Promise(r => setTimeout(r, 100));

    const pausedState = activeEngine.pauseCountdown();
    assert.equal(pausedState.phase, PHASES.PAUSED);
    assert.equal(pausedState.timer.isPaused, true);
    assert.ok(pausedState.timer.remainingMs <= 9950 && pausedState.timer.remainingMs >= 9700);

    await new Promise(r => setTimeout(r, 150));

    const resumedState = activeEngine.resumeCountdown();
    assert.equal(resumedState.phase, PHASES.COUNTDOWN);
    assert.equal(resumedState.timer.isPaused, false);
    assert.equal(resumedState.timer.expiresAt, resumedState.timer.startedAt + resumedState.timer.durationMs);
  });

  it('7. Transition guards prevent invalid state mutations', () => {
    activeEngine = new GameEngine();

    // Cannot countdown from LOBBY
    assert.throws(() => activeEngine.startCountdown(), InvalidTransitionError);
    // Cannot pause from LOBBY
    assert.throws(() => activeEngine.pauseCountdown(), InvalidTransitionError);
    // Cannot resume from LOBBY
    assert.throws(() => activeEngine.resumeCountdown(), InvalidTransitionError);
    // Cannot reveal from LOBBY
    assert.throws(() => activeEngine.revealAnswer(), InvalidTransitionError);

    activeEngine.stageQuestion({ id: 1, timer_seconds: 15 });
    // Cannot resume from READING
    assert.throws(() => activeEngine.resumeCountdown(), InvalidTransitionError);

    activeEngine.startCountdown();
    // Cannot stage new question during active countdown
    assert.throws(() => activeEngine.stageQuestion({ id: 2 }), InvalidTransitionError);

    activeEngine.lockQuestion();
    // Cannot resume from LOCKED
    assert.throws(() => activeEngine.resumeCountdown(), InvalidTransitionError);
    // Cannot countdown from LOCKED without staging
    assert.throws(() => activeEngine.startCountdown(), InvalidTransitionError);
  });

  it('8. canAcceptSubmission validates against countdown deadline and LAN grace window', () => {
    activeEngine = new GameEngine({ graceWindowMs: 300 });

    // In LOBBY
    assert.equal(activeEngine.canAcceptSubmission().allowed, false);

    // In READING
    activeEngine.stageQuestion({ id: 1, timer_seconds: 15 });
    assert.equal(activeEngine.canAcceptSubmission().allowed, false);

    // In COUNTDOWN
    activeEngine.startCountdown();
    const expiresAt = activeEngine.getState().timer.expiresAt;
    const now = Date.now();
    assert.equal(activeEngine.canAcceptSubmission(now).allowed, true);

    // Arriving within 300ms grace
    assert.equal(activeEngine.canAcceptSubmission(expiresAt + 200).allowed, true);

    // Arriving 350ms after expiresAt (exceeding 300ms grace)
    assert.equal(activeEngine.canAcceptSubmission(expiresAt + 350).allowed, false);

    // Lock and check late submission beyond grace window
    activeEngine.lockQuestion();
    assert.equal(activeEngine.canAcceptSubmission(expiresAt + 500).allowed, false);
  });

  it('9. Timer auto-expires and transitions to LOCKED automatically', async () => {
    activeEngine = new GameEngine({ tickIntervalMs: 20 });
    activeEngine.stageQuestion({ id: 1, timer_seconds: 0.05 }); // 50ms timer
    activeEngine.startCountdown();

    await new Promise(r => setTimeout(r, 100));

    const state = activeEngine.getState();
    assert.equal(state.phase, PHASES.LOCKED);
    assert.equal(state.timer.remainingMs, 0);
  });

  it('10. Full lifecycle flow from LOBBY to LEADERBOARD to NEXT QUESTION', () => {
    activeEngine = new GameEngine();

    // 1. Stage Q1
    activeEngine.stageQuestion({ id: 1, timer_seconds: 15, round_id: 1 });
    assert.equal(activeEngine.getState().phase, PHASES.READING);

    // 2. Start Countdown
    activeEngine.startCountdown();
    assert.equal(activeEngine.getState().phase, PHASES.COUNTDOWN);

    // 3. Lock
    activeEngine.lockQuestion();
    assert.equal(activeEngine.getState().phase, PHASES.LOCKED);

    // 4. Enter Review
    activeEngine.enterReview();
    assert.equal(activeEngine.getState().phase, PHASES.REVIEW);

    // 5. Reveal Answer
    activeEngine.revealAnswer();
    assert.equal(activeEngine.getState().phase, PHASES.REVEAL);

    // 6. Show Leaderboard
    activeEngine.showLeaderboard();
    assert.equal(activeEngine.getState().phase, PHASES.LEADERBOARD);

    // 7. Advance to Q2
    activeEngine.stageQuestion({ id: 2, timer_seconds: 30, round_id: 1 });
    assert.equal(activeEngine.getState().phase, PHASES.READING);
    assert.equal(activeEngine.getState().currentQuestion.id, 2);

    // 8. Reset round
    activeEngine.resetRound();
    assert.equal(activeEngine.getState().phase, PHASES.LOBBY);
    assert.equal(activeEngine.getState().currentQuestion, null);
  });

  it('11. Manual force-lock truncates timer.expiresAt and rejects submissions beyond 300ms grace window', () => {
    activeEngine = new GameEngine({ graceWindowMs: 300 });
    activeEngine.stageQuestion({ id: 99, timer_seconds: 30 });
    const countdownState = activeEngine.startCountdown();
    const originalExpiresAt = countdownState.timer.expiresAt;

    const lockTime = Date.now();
    const lockedState = activeEngine.lockQuestion();

    // 1. Phase transitions to LOCKED and remainingMs is zeroed
    assert.equal(lockedState.phase, PHASES.LOCKED);
    assert.equal(lockedState.timer.remainingMs, 0);

    // 2. expiresAt is truncated to approximately lockTime, strictly earlier than original future deadline
    assert.ok(Math.abs(lockedState.timer.expiresAt - lockTime) <= 15, 'expiresAt must equal lock time within clock tolerance');
    assert.ok(lockedState.timer.expiresAt < originalExpiresAt - 20000, 'expiresAt must not remain at original countdown deadline');

    // 3. In-flight submission within LAN grace window (lockTime + 150ms) is accepted
    const inFlight = activeEngine.canAcceptSubmission(lockTime + 150);
    assert.equal(inFlight.allowed, true);
    assert.equal(inFlight.reason, null);

    // 4. Submissions arriving beyond LAN grace window (lockTime + 301ms and lockTime + 2000ms) are strictly rejected
    const lateGrace = activeEngine.canAcceptSubmission(lockedState.timer.expiresAt + 301);
    assert.equal(lateGrace.allowed, false);
    assert.equal(lateGrace.reason, 'SUBMISSIONS_LOCKED');

    const latePostLock = activeEngine.canAcceptSubmission(lockTime + 2000);
    assert.equal(latePostLock.allowed, false);
    assert.equal(latePostLock.reason, 'SUBMISSIONS_LOCKED');
  });
});
