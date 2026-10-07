/**
 * tests/stress_gameEngine.js
 * Empirical Adversarial Stress Test Script for src/gameEngine.js
 * 
 * Tests:
 * 1. Illegal state transitions across all 8 phases (exhaustive matrix)
 * 2. Double triggers (double start, double pause, double resume, etc.)
 * 3. Question input boundaries and invalid inputs
 * 4. Timer accuracy, rapid pause/resume cycles, and drift accumulation
 * 5. Late submission boundary testing (expiresAt - 1, expiresAt, expiresAt + 299, +300, +301)
 * 6. Force-lock behavior and post-lock submission window analysis
 */

const GameEngine = require('../src/gameEngine');
const { PHASES, InvalidTransitionError } = GameEngine;

async function runAdversarialStress() {
  console.log('====================================================');
  console.log('STARTING EMPIRICAL STRESS TEST OF src/gameEngine.js');
  console.log('====================================================\n');

  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    findings: []
  };

  function test(name, fn) {
    results.total++;
    try {
      fn();
      results.passed++;
      console.log(`  [PASS] ${name}`);
    } catch (err) {
      results.failed++;
      console.error(`  [FAIL] ${name}: ${err.message}`);
      results.findings.push({ name, error: err.message, stack: err.stack });
    }
  }

  async function testAsync(name, fn) {
    results.total++;
    try {
      await fn();
      results.passed++;
      console.log(`  [PASS] ${name}`);
    } catch (err) {
      results.failed++;
      console.error(`  [FAIL] ${name}: ${err.message}`);
      results.findings.push({ name, error: err.message, stack: err.stack });
    }
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 1: ILLEGAL STATE TRANSITIONS
  // --------------------------------------------------------------------------
  console.log('--- TEST SUITE 1: ILLEGAL STATE TRANSITIONS ---');

  // 1.1 LOBBY Illegal Transitions
  test('1.1.1 LOBBY -> startCountdown() must throw InvalidTransitionError', () => {
    const engine = new GameEngine();
    let threw = false;
    try {
      engine.startCountdown();
    } catch (e) {
      if (e instanceof InvalidTransitionError) threw = true;
    }
    if (!threw) throw new Error('Expected InvalidTransitionError');
  });

  test('1.1.2 LOBBY -> pauseCountdown() must throw InvalidTransitionError', () => {
    const engine = new GameEngine();
    let threw = false;
    try {
      engine.pauseCountdown();
    } catch (e) {
      if (e instanceof InvalidTransitionError) threw = true;
    }
    if (!threw) throw new Error('Expected InvalidTransitionError');
  });

  test('1.1.3 LOBBY -> resumeCountdown() must throw InvalidTransitionError', () => {
    const engine = new GameEngine();
    let threw = false;
    try {
      engine.resumeCountdown();
    } catch (e) {
      if (e instanceof InvalidTransitionError) threw = true;
    }
    if (!threw) throw new Error('Expected InvalidTransitionError');
  });

  test('1.1.4 LOBBY -> lockQuestion() must throw InvalidTransitionError', () => {
    const engine = new GameEngine();
    let threw = false;
    try {
      engine.lockQuestion();
    } catch (e) {
      if (e instanceof InvalidTransitionError) threw = true;
    }
    if (!threw) throw new Error('Expected InvalidTransitionError');
  });

  test('1.1.5 LOBBY -> enterReview() must throw InvalidTransitionError', () => {
    const engine = new GameEngine();
    let threw = false;
    try {
      engine.enterReview();
    } catch (e) {
      if (e instanceof InvalidTransitionError) threw = true;
    }
    if (!threw) throw new Error('Expected InvalidTransitionError');
  });

  test('1.1.6 LOBBY -> revealAnswer() must throw InvalidTransitionError', () => {
    const engine = new GameEngine();
    let threw = false;
    try {
      engine.revealAnswer();
    } catch (e) {
      if (e instanceof InvalidTransitionError) threw = true;
    }
    if (!threw) throw new Error('Expected InvalidTransitionError');
  });

  test('1.1.7 LOBBY -> showLeaderboard() must throw InvalidTransitionError', () => {
    const engine = new GameEngine();
    let threw = false;
    try {
      engine.showLeaderboard();
    } catch (e) {
      if (e instanceof InvalidTransitionError) threw = true;
    }
    if (!threw) throw new Error('Expected InvalidTransitionError');
  });

  // 1.2 READING Illegal Transitions
  test('1.2.1 READING -> pauseCountdown() must throw InvalidTransitionError', () => {
    const engine = new GameEngine();
    engine.stageQuestion(1);
    let threw = false;
    try {
      engine.pauseCountdown();
    } catch (e) {
      if (e instanceof InvalidTransitionError) threw = true;
    }
    if (!threw) throw new Error('Expected InvalidTransitionError');
  });

  test('1.2.2 READING -> resumeCountdown() must throw InvalidTransitionError', () => {
    const engine = new GameEngine();
    engine.stageQuestion(1);
    let threw = false;
    try {
      engine.resumeCountdown();
    } catch (e) {
      if (e instanceof InvalidTransitionError) threw = true;
    }
    if (!threw) throw new Error('Expected InvalidTransitionError');
  });

  test('1.2.3 READING -> enterReview() must throw InvalidTransitionError', () => {
    const engine = new GameEngine();
    engine.stageQuestion(1);
    let threw = false;
    try {
      engine.enterReview();
    } catch (e) {
      if (e instanceof InvalidTransitionError) threw = true;
    }
    if (!threw) throw new Error('Expected InvalidTransitionError');
  });

  test('1.2.4 READING -> revealAnswer() must throw InvalidTransitionError', () => {
    const engine = new GameEngine();
    engine.stageQuestion(1);
    let threw = false;
    try {
      engine.revealAnswer();
    } catch (e) {
      if (e instanceof InvalidTransitionError) threw = true;
    }
    if (!threw) throw new Error('Expected InvalidTransitionError');
  });

  test('1.2.5 READING -> showLeaderboard() must throw InvalidTransitionError', () => {
    const engine = new GameEngine();
    engine.stageQuestion(1);
    let threw = false;
    try {
      engine.showLeaderboard();
    } catch (e) {
      if (e instanceof InvalidTransitionError) threw = true;
    }
    if (!threw) throw new Error('Expected InvalidTransitionError');
  });

  // 1.3 COUNTDOWN Illegal Transitions
  test('1.3.1 COUNTDOWN -> Double start startCountdown() must throw InvalidTransitionError', () => {
    const engine = new GameEngine();
    engine.stageQuestion(1);
    engine.startCountdown();
    let threw = false;
    try {
      engine.startCountdown();
    } catch (e) {
      if (e instanceof InvalidTransitionError) threw = true;
    }
    engine.resetRound();
    if (!threw) throw new Error('Expected InvalidTransitionError on double start');
  });

  test('1.3.2 COUNTDOWN -> stageQuestion() must throw InvalidTransitionError', () => {
    const engine = new GameEngine();
    engine.stageQuestion(1);
    engine.startCountdown();
    let threw = false;
    try {
      engine.stageQuestion(2);
    } catch (e) {
      if (e instanceof InvalidTransitionError) threw = true;
    }
    engine.resetRound();
    if (!threw) throw new Error('Expected InvalidTransitionError when staging during countdown');
  });

  test('1.3.3 COUNTDOWN -> resumeCountdown() must throw InvalidTransitionError', () => {
    const engine = new GameEngine();
    engine.stageQuestion(1);
    engine.startCountdown();
    let threw = false;
    try {
      engine.resumeCountdown();
    } catch (e) {
      if (e instanceof InvalidTransitionError) threw = true;
    }
    engine.resetRound();
    if (!threw) throw new Error('Expected InvalidTransitionError when resuming already running countdown');
  });

  test('1.3.4 COUNTDOWN -> enterReview() must throw InvalidTransitionError', () => {
    const engine = new GameEngine();
    engine.stageQuestion(1);
    engine.startCountdown();
    let threw = false;
    try {
      engine.enterReview();
    } catch (e) {
      if (e instanceof InvalidTransitionError) threw = true;
    }
    engine.resetRound();
    if (!threw) throw new Error('Expected InvalidTransitionError');
  });

  test('1.3.5 COUNTDOWN -> revealAnswer() must throw InvalidTransitionError', () => {
    const engine = new GameEngine();
    engine.stageQuestion(1);
    engine.startCountdown();
    let threw = false;
    try {
      engine.revealAnswer();
    } catch (e) {
      if (e instanceof InvalidTransitionError) threw = true;
    }
    engine.resetRound();
    if (!threw) throw new Error('Expected InvalidTransitionError');
  });

  test('1.3.6 COUNTDOWN -> showLeaderboard() must throw InvalidTransitionError', () => {
    const engine = new GameEngine();
    engine.stageQuestion(1);
    engine.startCountdown();
    let threw = false;
    try {
      engine.showLeaderboard();
    } catch (e) {
      if (e instanceof InvalidTransitionError) threw = true;
    }
    engine.resetRound();
    if (!threw) throw new Error('Expected InvalidTransitionError');
  });

  // 1.4 PAUSED Illegal Transitions
  test('1.4.1 PAUSED -> Double pause pauseCountdown() must throw InvalidTransitionError', () => {
    const engine = new GameEngine();
    engine.stageQuestion(1);
    engine.startCountdown();
    engine.pauseCountdown();
    let threw = false;
    try {
      engine.pauseCountdown();
    } catch (e) {
      if (e instanceof InvalidTransitionError) threw = true;
    }
    engine.resetRound();
    if (!threw) throw new Error('Expected InvalidTransitionError on double pause');
  });

  test('1.4.2 PAUSED -> startCountdown() must throw InvalidTransitionError', () => {
    const engine = new GameEngine();
    engine.stageQuestion(1);
    engine.startCountdown();
    engine.pauseCountdown();
    let threw = false;
    try {
      engine.startCountdown();
    } catch (e) {
      if (e instanceof InvalidTransitionError) threw = true;
    }
    engine.resetRound();
    if (!threw) throw new Error('Expected InvalidTransitionError');
  });

  test('1.4.3 PAUSED -> stageQuestion() must throw InvalidTransitionError', () => {
    const engine = new GameEngine();
    engine.stageQuestion(1);
    engine.startCountdown();
    engine.pauseCountdown();
    let threw = false;
    try {
      engine.stageQuestion(2);
    } catch (e) {
      if (e instanceof InvalidTransitionError) threw = true;
    }
    engine.resetRound();
    if (!threw) throw new Error('Expected InvalidTransitionError');
  });

  // 1.5 LOCKED Transitions
  test('1.5.1 LOCKED -> startCountdown() must throw InvalidTransitionError', () => {
    const engine = new GameEngine();
    engine.stageQuestion(1);
    engine.lockQuestion();
    let threw = false;
    try {
      engine.startCountdown();
    } catch (e) {
      if (e instanceof InvalidTransitionError) threw = true;
    }
    if (!threw) throw new Error('Expected InvalidTransitionError');
  });

  test('1.5.2 LOCKED -> pauseCountdown() must throw InvalidTransitionError', () => {
    const engine = new GameEngine();
    engine.stageQuestion(1);
    engine.lockQuestion();
    let threw = false;
    try {
      engine.pauseCountdown();
    } catch (e) {
      if (e instanceof InvalidTransitionError) threw = true;
    }
    if (!threw) throw new Error('Expected InvalidTransitionError');
  });

  test('1.5.3 LOCKED -> resumeCountdown() must throw InvalidTransitionError', () => {
    const engine = new GameEngine();
    engine.stageQuestion(1);
    engine.lockQuestion();
    let threw = false;
    try {
      engine.resumeCountdown();
    } catch (e) {
      if (e instanceof InvalidTransitionError) threw = true;
    }
    if (!threw) throw new Error('Expected InvalidTransitionError');
  });

  test('1.5.4 LOCKED -> lockQuestion() is idempotent and returns current state', () => {
    const engine = new GameEngine();
    engine.stageQuestion(1);
    engine.lockQuestion();
    const state = engine.lockQuestion();
    if (state.phase !== PHASES.LOCKED) throw new Error('Expected idempotent LOCKED phase');
  });

  // 1.6 REVIEW Transitions
  test('1.6.1 REVIEW -> startCountdown() must throw InvalidTransitionError', () => {
    const engine = new GameEngine();
    engine.stageQuestion(1);
    engine.lockQuestion();
    engine.enterReview();
    let threw = false;
    try {
      engine.startCountdown();
    } catch (e) {
      if (e instanceof InvalidTransitionError) threw = true;
    }
    if (!threw) throw new Error('Expected InvalidTransitionError');
  });

  test('1.6.2 REVIEW -> lockQuestion() must throw InvalidTransitionError', () => {
    const engine = new GameEngine();
    engine.stageQuestion(1);
    engine.lockQuestion();
    engine.enterReview();
    let threw = false;
    try {
      engine.lockQuestion();
    } catch (e) {
      if (e instanceof InvalidTransitionError) threw = true;
    }
    if (!threw) throw new Error('Expected InvalidTransitionError');
  });

  test('1.6.3 REVIEW -> enterReview() double call must throw InvalidTransitionError', () => {
    const engine = new GameEngine();
    engine.stageQuestion(1);
    engine.lockQuestion();
    engine.enterReview();
    let threw = false;
    try {
      engine.enterReview();
    } catch (e) {
      if (e instanceof InvalidTransitionError) threw = true;
    }
    if (!threw) throw new Error('Expected InvalidTransitionError');
  });

  // 1.7 REVEAL Transitions
  test('1.7.1 REVEAL -> revealAnswer() double call must throw InvalidTransitionError', () => {
    const engine = new GameEngine();
    engine.stageQuestion(1);
    engine.lockQuestion();
    engine.revealAnswer();
    let threw = false;
    try {
      engine.revealAnswer();
    } catch (e) {
      if (e instanceof InvalidTransitionError) threw = true;
    }
    if (!threw) throw new Error('Expected InvalidTransitionError');
  });

  test('1.7.2 REVEAL -> enterReview() must throw InvalidTransitionError', () => {
    const engine = new GameEngine();
    engine.stageQuestion(1);
    engine.lockQuestion();
    engine.revealAnswer();
    let threw = false;
    try {
      engine.enterReview();
    } catch (e) {
      if (e instanceof InvalidTransitionError) threw = true;
    }
    if (!threw) throw new Error('Expected InvalidTransitionError');
  });

  // 1.8 LEADERBOARD Transitions
  test('1.8.1 LEADERBOARD -> showLeaderboard() double call must throw InvalidTransitionError', () => {
    const engine = new GameEngine();
    engine.stageQuestion(1);
    engine.lockQuestion();
    engine.showLeaderboard();
    let threw = false;
    try {
      engine.showLeaderboard();
    } catch (e) {
      if (e instanceof InvalidTransitionError) threw = true;
    }
    if (!threw) throw new Error('Expected InvalidTransitionError');
  });

  // 1.9 Question Input Boundary Tests
  test('1.9.1 stageQuestion(null) must throw Error', () => {
    const engine = new GameEngine();
    let threw = false;
    try {
      engine.stageQuestion(null);
    } catch (e) {
      threw = true;
    }
    if (!threw) throw new Error('Expected error on null question');
  });

  test('1.9.2 stageQuestion(undefined) must throw Error', () => {
    const engine = new GameEngine();
    let threw = false;
    try {
      engine.stageQuestion(undefined);
    } catch (e) {
      threw = true;
    }
    if (!threw) throw new Error('Expected error on undefined question');
  });

  test('1.9.3 stageQuestion({}) must throw Error', () => {
    const engine = new GameEngine();
    let threw = false;
    try {
      engine.stageQuestion({});
    } catch (e) {
      threw = true;
    }
    if (!threw) throw new Error('Expected error on empty question object');
  });

  test('1.9.4 stageQuestion({ id: null }) must throw Error', () => {
    const engine = new GameEngine();
    let threw = false;
    try {
      engine.stageQuestion({ id: null });
    } catch (e) {
      threw = true;
    }
    if (!threw) throw new Error('Expected error on null id');
  });

  test('1.9.5 stageQuestion("") must throw Error', () => {
    const engine = new GameEngine();
    let threw = false;
    try {
      engine.stageQuestion('');
    } catch (e) {
      threw = true;
    }
    if (!threw) throw new Error('Expected error on empty string');
  });

  test('1.9.6 stageQuestion(0) - test behavior with numeric 0', () => {
    const engine = new GameEngine();
    let threw = false;
    try {
      engine.stageQuestion(0);
    } catch (e) {
      threw = true;
    }
    // Document whether 0 throws because 0 is falsy
    console.log(`    Note: stageQuestion(0) threw error? ${threw}`);
  });

  test('1.9.7 stageQuestion({ id: 0 }) - test behavior with object id 0', () => {
    const engine = new GameEngine();
    const state = engine.stageQuestion({ id: 0 });
    if (state.currentQuestion.id !== 0) throw new Error('Failed to retain id: 0');
  });

  test('1.9.8 stageQuestion with non-positive timer_seconds defaults to 15s', () => {
    const engine = new GameEngine();
    const s1 = engine.stageQuestion({ id: 1, timer_seconds: -10 });
    if (s1.timer.durationMs !== 15000) throw new Error(`Expected 15000, got ${s1.timer.durationMs}`);
    const s2 = engine.stageQuestion({ id: 2, timer_seconds: 0 });
    if (s2.timer.durationMs !== 15000) throw new Error(`Expected 15000, got ${s2.timer.durationMs}`);
    const s3 = engine.stageQuestion({ id: 3, timer_seconds: 'invalid' });
    if (s3.timer.durationMs !== 15000) throw new Error(`Expected 15000, got ${s3.timer.durationMs}`);
  });

  console.log('\n--- TEST SUITE 2: TIMER ACCURACY, RAPID PAUSE/RESUME & DRIFT ---');

  // 2.1 Rapid Pause/Resume stress testing (50 cycles)
  await testAsync('2.1.1 50 rapid pause/resume cycles with active intervals to measure drift', async () => {
    const engine = new GameEngine({ tickIntervalMs: 10 });
    const initialDuration = 10; // 10 seconds = 10000ms
    engine.stageQuestion({ id: 99, timer_seconds: initialDuration });
    engine.startCountdown();

    const startWallTime = Date.now();
    let totalActiveRunExpected = 0;

    for (let i = 0; i < 50; i++) {
      // Let it run for 5ms
      await new Promise(r => setTimeout(r, 5));
      
      const pauseState = engine.pauseCountdown();
      if (pauseState.phase !== PHASES.PAUSED) throw new Error('Not paused');
      if (!pauseState.timer.isPaused) throw new Error('timer.isPaused is false');
      
      const frozenMs = pauseState.timer.remainingMs;

      // Stay paused for 5ms
      await new Promise(r => setTimeout(r, 5));

      // Check remainingMs during pause does NOT drift
      const checkPaused = engine.getState();
      if (checkPaused.timer.remainingMs !== frozenMs) {
        throw new Error(`Drift detected during pause! Expected ${frozenMs}, got ${checkPaused.timer.remainingMs}`);
      }

      const resumedState = engine.resumeCountdown();
      if (resumedState.phase !== PHASES.COUNTDOWN) throw new Error('Not countdown');
      if (resumedState.timer.isPaused) throw new Error('timer.isPaused is true');
      
      // Check that expiresAt was shifted by pause duration
      const expectedRemaining = frozenMs;
      const actualRemaining = resumedState.timer.expiresAt - Date.now();
      const diff = Math.abs(expectedRemaining - actualRemaining);
      if (diff > 15) {
        throw new Error(`Drift at resume step ${i}: ${diff}ms (expected ~${expectedRemaining}, actual ~${actualRemaining})`);
      }
    }

    const finalState = engine.getState();
    console.log(`    50 cycles completed: remainingMs = ${finalState.timer.remainingMs}ms (started with 10000ms)`);
    engine.resetRound();
  });

  // 2.2 Synchronous back-to-back pause/resume (20 cycles)
  test('2.2.1 20 synchronous back-to-back pause/resume cycles (zero execution delay)', () => {
    const engine = new GameEngine();
    engine.stageQuestion({ id: 100, timer_seconds: 15 });
    engine.startCountdown();

    const initialExpiresAt = engine.getState().timer.expiresAt;

    for (let i = 0; i < 20; i++) {
      engine.pauseCountdown();
      engine.resumeCountdown();
    }

    const finalExpiresAt = engine.getState().timer.expiresAt;
    const driftMs = Math.abs(finalExpiresAt - initialExpiresAt);
    console.log(`    Synchronous pause/resume drift over 20 iterations: ${driftMs}ms`);
    if (driftMs > 5) {
      throw new Error(`Excessive drift in synchronous pause/resume: ${driftMs}ms`);
    }
    engine.resetRound();
  });

  // 2.3 Auto-timeout accuracy
  await testAsync('2.3.1 Auto-timeout accuracy for 100ms countdown', async () => {
    const engine = new GameEngine({ tickIntervalMs: 10 });
    engine.stageQuestion({ id: 101, timer_seconds: 0.1 }); // 100ms
    const t0 = Date.now();
    
    let lockFired = false;
    let lockTime = 0;
    engine.on('phase:change', ({ newPhase, autoExpired }) => {
      if (newPhase === PHASES.LOCKED && autoExpired) {
        lockFired = true;
        lockTime = Date.now();
      }
    });

    engine.startCountdown();
    await new Promise(r => setTimeout(r, 180));

    if (!lockFired) throw new Error('Auto-lock timeout did not fire');
    const elapsed = lockTime - t0;
    console.log(`    Auto-timeout fired at ${elapsed}ms (target: 100ms)`);
    if (Math.abs(elapsed - 100) > 40) {
      throw new Error(`Auto-timeout drift too high: elapsed ${elapsed}ms for 100ms duration`);
    }
    engine.resetRound();
  });

  // 2.4 Resuming an expired countdown must throw
  test('2.4.1 Resuming a countdown with remainingMs <= 0 must throw', () => {
    const engine = new GameEngine();
    engine.stageQuestion({ id: 102, timer_seconds: 10 });
    engine.state.phase = PHASES.PAUSED;
    engine.state.timer.remainingMs = 0;
    let threw = false;
    try {
      engine.resumeCountdown();
    } catch (e) {
      threw = true;
    }
    if (!threw) throw new Error('Expected resumeCountdown to throw when remainingMs <= 0');
  });

  console.log('\n--- TEST SUITE 3: LATE SUBMISSION GATE BOUNDARY TESTING ---');

  // 3.1 Boundaries during COUNTDOWN phase (graceWindowMs = 300)
  test('3.1.1 Boundary: submit at expiresAt - 1ms during COUNTDOWN -> allowed=true, reason=null', () => {
    const engine = new GameEngine({ graceWindowMs: 300 });
    engine.stageQuestion(1);
    engine.startCountdown();
    const expiresAt = engine.getState().timer.expiresAt;

    const res = engine.canAcceptSubmission(expiresAt - 1);
    if (!res.allowed || res.reason !== null) {
      throw new Error(`Expected allowed=true, reason=null; got allowed=${res.allowed}, reason=${res.reason}`);
    }
    engine.resetRound();
  });

  test('3.1.2 Boundary: submit at expiresAt during COUNTDOWN -> allowed=true, reason=null', () => {
    const engine = new GameEngine({ graceWindowMs: 300 });
    engine.stageQuestion(1);
    engine.startCountdown();
    const expiresAt = engine.getState().timer.expiresAt;

    const res = engine.canAcceptSubmission(expiresAt);
    if (!res.allowed || res.reason !== null) {
      throw new Error(`Expected allowed=true, reason=null; got allowed=${res.allowed}, reason=${res.reason}`);
    }
    engine.resetRound();
  });

  test('3.1.3 Boundary: submit at expiresAt + 299ms during COUNTDOWN -> allowed=true, reason=null', () => {
    const engine = new GameEngine({ graceWindowMs: 300 });
    engine.stageQuestion(1);
    engine.startCountdown();
    const expiresAt = engine.getState().timer.expiresAt;

    const res = engine.canAcceptSubmission(expiresAt + 299);
    if (!res.allowed || res.reason !== null) {
      throw new Error(`Expected allowed=true, reason=null; got allowed=${res.allowed}, reason=${res.reason}`);
    }
    engine.resetRound();
  });

  test('3.1.4 Boundary: submit at expiresAt + 300ms during COUNTDOWN -> allowed=true, reason=null', () => {
    const engine = new GameEngine({ graceWindowMs: 300 });
    engine.stageQuestion(1);
    engine.startCountdown();
    const expiresAt = engine.getState().timer.expiresAt;

    const res = engine.canAcceptSubmission(expiresAt + 300);
    if (!res.allowed || res.reason !== null) {
      throw new Error(`Expected allowed=true, reason=null; got allowed=${res.allowed}, reason=${res.reason}`);
    }
    engine.resetRound();
  });

  test('3.1.5 Boundary: submit at expiresAt + 301ms during COUNTDOWN -> allowed=false, reason=EXPIRED_LATE_SUBMISSION', () => {
    const engine = new GameEngine({ graceWindowMs: 300 });
    engine.stageQuestion(1);
    engine.startCountdown();
    const expiresAt = engine.getState().timer.expiresAt;

    const res = engine.canAcceptSubmission(expiresAt + 301);
    if (res.allowed !== false || res.reason !== 'EXPIRED_LATE_SUBMISSION') {
      throw new Error(`Expected allowed=false, reason='EXPIRED_LATE_SUBMISSION'; got allowed=${res.allowed}, reason=${res.reason}`);
    }
    engine.resetRound();
  });

  // 3.2 Boundaries during LOCKED phase (auto-expired or locked)
  test('3.2.1 Boundary: submit at expiresAt - 1ms during LOCKED -> allowed=true, reason=null', () => {
    const engine = new GameEngine({ graceWindowMs: 300 });
    engine.stageQuestion(1);
    engine.startCountdown();
    const expiresAt = engine.getState().timer.expiresAt;
    engine.lockQuestion({ autoExpired: true });

    const res = engine.canAcceptSubmission(expiresAt - 1);
    if (!res.allowed || res.reason !== null) {
      throw new Error(`Expected allowed=true, reason=null; got allowed=${res.allowed}, reason=${res.reason}`);
    }
  });

  test('3.2.2 Boundary: submit at expiresAt during LOCKED -> allowed=true, reason=null', () => {
    const engine = new GameEngine({ graceWindowMs: 300 });
    engine.stageQuestion(1);
    engine.startCountdown();
    const expiresAt = engine.getState().timer.expiresAt;
    engine.lockQuestion({ autoExpired: true });

    const res = engine.canAcceptSubmission(expiresAt);
    if (!res.allowed || res.reason !== null) {
      throw new Error(`Expected allowed=true, reason=null; got allowed=${res.allowed}, reason=${res.reason}`);
    }
  });

  test('3.2.3 Boundary: submit at expiresAt + 299ms during LOCKED -> allowed=true, reason=null', () => {
    const engine = new GameEngine({ graceWindowMs: 300 });
    engine.stageQuestion(1);
    engine.startCountdown();
    const expiresAt = engine.getState().timer.expiresAt;
    engine.lockQuestion({ autoExpired: true });

    const res = engine.canAcceptSubmission(expiresAt + 299);
    if (!res.allowed || res.reason !== null) {
      throw new Error(`Expected allowed=true, reason=null; got allowed=${res.allowed}, reason=${res.reason}`);
    }
  });

  test('3.2.4 Boundary: submit at expiresAt + 300ms during LOCKED -> allowed=true, reason=null', () => {
    const engine = new GameEngine({ graceWindowMs: 300 });
    engine.stageQuestion(1);
    engine.startCountdown();
    const expiresAt = engine.getState().timer.expiresAt;
    engine.lockQuestion({ autoExpired: true });

    const res = engine.canAcceptSubmission(expiresAt + 300);
    if (!res.allowed || res.reason !== null) {
      throw new Error(`Expected allowed=true, reason=null; got allowed=${res.allowed}, reason=${res.reason}`);
    }
  });

  test('3.2.5 Boundary: submit at expiresAt + 301ms during LOCKED -> allowed=false, reason=SUBMISSIONS_LOCKED', () => {
    const engine = new GameEngine({ graceWindowMs: 300 });
    engine.stageQuestion(1);
    engine.startCountdown();
    const expiresAt = engine.getState().timer.expiresAt;
    engine.lockQuestion({ autoExpired: true });

    const res = engine.canAcceptSubmission(expiresAt + 301);
    if (res.allowed !== false || res.reason !== 'SUBMISSIONS_LOCKED') {
      throw new Error(`Expected allowed=false, reason='SUBMISSIONS_LOCKED'; got allowed=${res.allowed}, reason=${res.reason}`);
    }
  });

  // 3.3 Submissions rejected in non-countdown phases
  test('3.3.1 Submissions prohibited in all non-countdown/non-grace phases', () => {
    const engine = new GameEngine();
    
    // LOBBY
    const r1 = engine.canAcceptSubmission();
    if (r1.allowed !== false || r1.reason !== 'SUBMISSIONS_PROHIBITED_IN_LOBBY') {
      throw new Error(`LOBBY fail: ${JSON.stringify(r1)}`);
    }

    // READING
    engine.stageQuestion(1);
    const r2 = engine.canAcceptSubmission();
    if (r2.allowed !== false || r2.reason !== 'SUBMISSIONS_PROHIBITED_IN_READING') {
      throw new Error(`READING fail: ${JSON.stringify(r2)}`);
    }

    // PAUSED
    engine.startCountdown(15);
    engine.pauseCountdown();
    const r3 = engine.canAcceptSubmission();
    if (r3.allowed !== false || r3.reason !== 'SUBMISSIONS_PROHIBITED_IN_PAUSED') {
      throw new Error(`PAUSED fail: ${JSON.stringify(r3)}`);
    }

    // LOCKED from PAUSED (expiresAt is past or future)
    engine.lockQuestion();
    // REVIEW
    engine.enterReview();
    const r4 = engine.canAcceptSubmission();
    if (r4.allowed !== false || r4.reason !== 'SUBMISSIONS_PROHIBITED_IN_REVIEW') {
      throw new Error(`REVIEW fail: ${JSON.stringify(r4)}`);
    }

    // REVEAL
    engine.revealAnswer();
    const r5 = engine.canAcceptSubmission();
    if (r5.allowed !== false || r5.reason !== 'SUBMISSIONS_PROHIBITED_IN_REVEAL') {
      throw new Error(`REVEAL fail: ${JSON.stringify(r5)}`);
    }

    // LEADERBOARD
    engine.showLeaderboard();
    const r6 = engine.canAcceptSubmission();
    if (r6.allowed !== false || r6.reason !== 'SUBMISSIONS_PROHIBITED_IN_LEADERBOARD') {
      throw new Error(`LEADERBOARD fail: ${JSON.stringify(r6)}`);
    }
  });

  // --------------------------------------------------------------------------
  // TEST SUITE 4: ADVERSARIAL EDGE CASES & VULNERABILITY ANALYSIS
  // --------------------------------------------------------------------------
  console.log('\n--- TEST SUITE 4: ADVERSARIAL EDGE CASES & VULNERABILITY ANALYSIS ---');

  // 4.1 Force Lock Early Submission Gate Window
  test('4.1 Force-lock analysis: When QM force-locks early, how long are submissions accepted?', () => {
    const engine = new GameEngine({ graceWindowMs: 300 });
    engine.stageQuestion({ id: 1, timer_seconds: 30 }); // 30s timer
    const state0 = engine.startCountdown();
    const originalExpiresAt = state0.timer.expiresAt;
    const now = Date.now();

    // QM force locks 1000ms into the 30s countdown
    engine.lockQuestion(); // manual force lock, not autoExpired

    // What is expiresAt now?
    const stateLocked = engine.getState();
    const afterLockExpiresAt = stateLocked.timer.expiresAt;

    // Check submission 2000ms after lock (3000ms from start)
    const subAt3000 = engine.canAcceptSubmission(now + 3000);
    console.log(`    Original expiresAt: ${originalExpiresAt}`);
    console.log(`    State expiresAt after manual force lock: ${afterLockExpiresAt}`);
    console.log(`    Submission 2s after QM force-lock allowed?: ${subAt3000.allowed} (reason: ${subAt3000.reason})`);

    // In the current implementation, because expiresAt is not adjusted to Date.now(),
    // subAt3000.allowed is TRUE! Submissions are accepted for another 27 seconds after force lock!
    if (subAt3000.allowed) {
      console.log('    [VULNERABILITY DETECTED]: Manual lockQuestion() does NOT set expiresAt to current time, allowing contestants to submit answers long after Quizmaster force-locked!');
    }
  });

  // 4.2 Reading lockQuestion then submission
  test('4.2 Lock from READING phase (timer never started) -> canAcceptSubmission()', () => {
    const engine = new GameEngine();
    engine.stageQuestion(1);
    engine.lockQuestion(); // lock from READING
    const res = engine.canAcceptSubmission();
    if (res.allowed !== false || res.reason !== 'SUBMISSIONS_LOCKED') {
      throw new Error(`Expected allowed=false, reason='SUBMISSIONS_LOCKED', got ${JSON.stringify(res)}`);
    }
  });

  // 4.3 Custom grace window
  test('4.3 Custom grace window (e.g. graceWindowMs = 0)', () => {
    const engine = new GameEngine({ graceWindowMs: 0 });
    engine.stageQuestion(1);
    engine.startCountdown(10);
    const expiresAt = engine.getState().timer.expiresAt;

    const rAt = engine.canAcceptSubmission(expiresAt);
    const rAfter = engine.canAcceptSubmission(expiresAt + 1);

    if (!rAt.allowed) throw new Error('Submission exactly at expiresAt with 0ms grace should be allowed');
    if (rAfter.allowed) throw new Error('Submission at expiresAt + 1ms with 0ms grace should be rejected');
    engine.resetRound();
  });

  console.log('\n====================================================');
  console.log(`STRESS TEST SUMMARY: ${results.passed}/${results.total} passed, ${results.failed} failed`);
  console.log('====================================================\n');
}

runAdversarialStress().catch(console.error);
