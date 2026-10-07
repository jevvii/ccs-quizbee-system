/**
 * src/gameEngine.js
 * Authoritative Server State Machine & Epoch Timer Engine
 * OLFU IT Olympics Quiz Bee System (ITPM 311)
 */

const { EventEmitter } = require('events');

/**
 * 8 Authorized Tournament Game Phases
 */
const PHASES = Object.freeze({
  LOBBY: 'LOBBY',             // Pre-game / tournament waiting room
  READING: 'READING',         // Question displayed; contestant input disabled
  COUNTDOWN: 'COUNTDOWN',     // Authoritative timer running; input enabled
  PAUSED: 'PAUSED',           // Timer paused; contestant input frozen
  LOCKED: 'LOCKED',           // Submissions closed; answers frozen
  REVIEW: 'REVIEW',           // Judge review queue active for ID disputes
  REVEAL: 'REVEAL',           // Stage displays dramatic correct answer card
  LEADERBOARD: 'LEADERBOARD'  // Stage displays calculated rankings & podium
});

class InvalidTransitionError extends Error {
  constructor(message, fromPhase, attemptedAction) {
    super(message);
    this.name = 'InvalidTransitionError';
    this.fromPhase = fromPhase;
    this.attemptedAction = attemptedAction;
  }
}

class GameEngine extends EventEmitter {
  /**
   * @param {Object} [options={}]
   * @param {number} [options.graceWindowMs=300] - LAN latency tolerance window in ms
   * @param {number} [options.tickIntervalMs=1000] - Server heartbeat tick frequency in ms
   */
  constructor(options = {}) {
    super();
    this.graceWindowMs = typeof options.graceWindowMs === 'number' ? options.graceWindowMs : 300;
    this.tickIntervalMs = options.tickIntervalMs || 1000;

    this._timeoutId = null;
    this._intervalId = null;

    this.state = {
      phase: PHASES.LOBBY,
      roundId: null,
      currentQuestion: null,
      timer: {
        startedAt: null,
        expiresAt: null,
        durationMs: 0,
        remainingMs: 0,
        isPaused: false
      }
    };
  }

  /**
   * Returns a snapshot of the current authoritative state.
   * Dynamically calculates remainingMs during COUNTDOWN to prevent drift.
   * @returns {Object}
   */
  getState() {
    const timerSnapshot = { ...this.state.timer };
    if (this.state.phase === PHASES.COUNTDOWN && !timerSnapshot.isPaused && timerSnapshot.expiresAt) {
      timerSnapshot.remainingMs = Math.max(0, timerSnapshot.expiresAt - Date.now());
    }

    return {
      phase: this.state.phase,
      roundId: this.state.roundId,
      currentQuestion: this.state.currentQuestion ? { ...this.state.currentQuestion } : null,
      timer: timerSnapshot
    };
  }

  /**
   * Clear active node timers safely.
   * @private
   */
  _clearTimers() {
    if (this._timeoutId) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  /**
   * Stage Question (Transition -> READING)
   * Contestant screens lock into reading mode while Quizmaster reads question twice.
   * Permitted from: LOBBY, READING, LOCKED, REVIEW, REVEAL, LEADERBOARD
   *
   * @param {Object|number|string} question - Question object or question ID
   * @param {number|null} [roundId=null]
   * @returns {Object} Updated state
   */
  stageQuestion(question, roundId = null) {
    if ([PHASES.COUNTDOWN, PHASES.PAUSED].includes(this.state.phase)) {
      throw new InvalidTransitionError(
        `Cannot stage question while countdown is active (${this.state.phase}). Lock or pause first.`,
        this.state.phase,
        'stageQuestion'
      );
    }
    if (!question) {
      throw new Error('Invalid question: a question object with id or a numeric questionId is required.');
    }

    let qObj = null;
    if (typeof question === 'number' || typeof question === 'string') {
      qObj = { id: question, timer_seconds: 15, round_id: roundId || 1 };
    } else if (typeof question === 'object' && question.id !== undefined && question.id !== null) {
      qObj = { ...question };
    } else {
      throw new Error('Invalid question: a valid question object with non-null id is required.');
    }

    this._clearTimers();
    const prevPhase = this.state.phase;
    const durationSeconds = (typeof qObj.timer_seconds === 'number' && qObj.timer_seconds > 0)
      ? qObj.timer_seconds
      : 15;

    this.state.phase = PHASES.READING;
    this.state.currentQuestion = qObj;
    this.state.roundId = roundId || qObj.round_id || this.state.roundId || 1;

    this.state.timer = {
      startedAt: null,
      expiresAt: null,
      durationMs: durationSeconds * 1000,
      remainingMs: durationSeconds * 1000,
      isPaused: false
    };

    const currentState = this.getState();
    this.emit('phase:change', { prevPhase, newPhase: PHASES.READING, state: currentState });
    return currentState;
  }

  /**
   * Start Countdown (Transition -> COUNTDOWN)
   * Starts authoritative epoch timer, begins broadcast ticks, unlocks contestant screens.
   * Permitted from: READING
   *
   * @param {number|null} [durationSeconds=null]
   * @returns {Object} Updated state
   */
  startCountdown(durationSeconds = null) {
    if (this.state.phase !== PHASES.READING) {
      throw new InvalidTransitionError(
        `Cannot start countdown from phase "${this.state.phase}". Question must be staged in READING phase first.`,
        this.state.phase,
        'startCountdown'
      );
    }
    if (!this.state.currentQuestion) {
      throw new Error('Cannot start countdown without a staged question.');
    }

    if (durationSeconds !== null && durationSeconds !== undefined) {
      const num = Number(durationSeconds);
      if (isNaN(num) || num <= 0) {
        throw new Error(`Invalid timer duration: "${durationSeconds}". Duration must be a positive number.`);
      }
    }

    const duration = (durationSeconds && Number(durationSeconds) > 0)
      ? Number(durationSeconds)
      : (this.state.currentQuestion.timer_seconds || 15);

    const now = Date.now();
    const durationMs = duration * 1000;
    const expiresAt = now + durationMs;

    this._clearTimers();
    this.state.phase = PHASES.COUNTDOWN;
    this.state.timer = {
      startedAt: now,
      expiresAt: expiresAt,
      durationMs: durationMs,
      remainingMs: durationMs,
      isPaused: false
    };

    // Auto-lock callback when timer expires
    this._timeoutId = setTimeout(() => {
      this.lockQuestion({ autoExpired: true });
    }, durationMs);

    // Synchronized interval heartbeat
    this._intervalId = setInterval(() => {
      const remainingMs = Math.max(0, this.state.timer.expiresAt - Date.now());
      this.state.timer.remainingMs = remainingMs;
      const remainingSeconds = Math.ceil(remainingMs / 1000);

      this.emit('tick', {
        remainingMs,
        remainingSeconds,
        serverTime: Date.now(),
        questionId: this.state.currentQuestion ? this.state.currentQuestion.id : null
      });

      if (remainingMs <= 0) {
        this._clearTimers();
      }
    }, this.tickIntervalMs);

    const currentState = this.getState();
    this.emit('phase:change', { prevPhase: PHASES.READING, newPhase: PHASES.COUNTDOWN, state: currentState });
    return currentState;
  }

  /**
   * Pause Countdown (Transition -> PAUSED)
   * Freezes countdown timer, records exact remainingMs, freezes contestant input.
   * Permitted from: COUNTDOWN
   *
   * @returns {Object} Updated state
   */
  pauseCountdown() {
    if (this.state.phase !== PHASES.COUNTDOWN) {
      throw new InvalidTransitionError(
        `Cannot pause from phase "${this.state.phase}". Must be in COUNTDOWN.`,
        this.state.phase,
        'pauseCountdown'
      );
    }

    const now = Date.now();
    const remainingMs = Math.max(0, this.state.timer.expiresAt - now);
    this._clearTimers();

    this.state.phase = PHASES.PAUSED;
    this.state.timer.isPaused = true;
    this.state.timer.remainingMs = remainingMs;

    const currentState = this.getState();
    this.emit('phase:change', { prevPhase: PHASES.COUNTDOWN, newPhase: PHASES.PAUSED, state: currentState });
    return currentState;
  }

  /**
   * Resume Countdown (Transition -> COUNTDOWN)
   * Recalculates new expiresAt from current timestamp + frozen remainingMs.
   * Permitted from: PAUSED
   *
   * @returns {Object} Updated state
   */
  resumeCountdown() {
    if (this.state.phase !== PHASES.PAUSED) {
      throw new InvalidTransitionError(
        `Cannot resume from phase "${this.state.phase}". Must be in PAUSED.`,
        this.state.phase,
        'resumeCountdown'
      );
    }
    if (this.state.timer.remainingMs <= 0) {
      throw new Error('Cannot resume: remaining duration has expired.');
    }

    const now = Date.now();
    const remainingMs = this.state.timer.remainingMs;
    const expiresAt = now + remainingMs;
    const effectiveStartedAt = now - (this.state.timer.durationMs - remainingMs);

    this.state.phase = PHASES.COUNTDOWN;
    this.state.timer.startedAt = effectiveStartedAt;
    this.state.timer.expiresAt = expiresAt;
    this.state.timer.isPaused = false;

    this._clearTimers();
    this._timeoutId = setTimeout(() => {
      this.lockQuestion({ autoExpired: true });
    }, remainingMs);

    this._intervalId = setInterval(() => {
      const curRemaining = Math.max(0, this.state.timer.expiresAt - Date.now());
      this.state.timer.remainingMs = curRemaining;
      const remainingSeconds = Math.ceil(curRemaining / 1000);

      this.emit('tick', {
        remainingMs: curRemaining,
        remainingSeconds,
        serverTime: Date.now(),
        questionId: this.state.currentQuestion ? this.state.currentQuestion.id : null
      });

      if (curRemaining <= 0) {
        this._clearTimers();
      }
    }, this.tickIntervalMs);

    const currentState = this.getState();
    this.emit('phase:change', { prevPhase: PHASES.PAUSED, newPhase: PHASES.COUNTDOWN, state: currentState });
    return currentState;
  }

  /**
   * Lock Question (Transition -> LOCKED)
   * Closes submission window immediately. Invoked on auto-timeout or QM force-lock.
   * Permitted from: COUNTDOWN, PAUSED, READING (or idempotent if already LOCKED)
   *
   * @param {Object} [opts={}]
   * @param {boolean} [opts.autoExpired=false]
   * @returns {Object} Updated state
   */
  lockQuestion(opts = {}) {
    if (![PHASES.COUNTDOWN, PHASES.PAUSED, PHASES.READING].includes(this.state.phase)) {
      if (this.state.phase === PHASES.LOCKED) return this.getState();
      throw new InvalidTransitionError(
        `Cannot lock question from phase "${this.state.phase}".`,
        this.state.phase,
        'lockQuestion'
      );
    }

    const prevPhase = this.state.phase;
    this._clearTimers();

    this.state.phase = PHASES.LOCKED;
    this.state.timer.remainingMs = 0;
    this.state.timer.isPaused = false;

    if (!opts.autoExpired && this.state.timer.expiresAt) {
      this.state.timer.expiresAt = Date.now();
    }

    const currentState = this.getState();
    this.emit('phase:change', {
      prevPhase,
      newPhase: PHASES.LOCKED,
      autoExpired: !!opts.autoExpired,
      state: currentState
    });
    return currentState;
  }

  /**
   * Enter Judge Review Queue (Transition -> REVIEW)
   * Activates review queue for disputed/identification answers.
   * Permitted from: LOCKED
   *
   * @returns {Object} Updated state
   */
  enterReview() {
    if (this.state.phase !== PHASES.LOCKED) {
      throw new InvalidTransitionError(
        `Cannot enter review queue from phase "${this.state.phase}". Must be in LOCKED.`,
        this.state.phase,
        'enterReview'
      );
    }

    const prevPhase = this.state.phase;
    this.state.phase = PHASES.REVIEW;
    const currentState = this.getState();
    this.emit('phase:change', { prevPhase, newPhase: PHASES.REVIEW, state: currentState });
    return currentState;
  }

  /**
   * Reveal Correct Answer (Transition -> REVEAL)
   * Displays correct answer card and answer distribution on Projector display.
   * Permitted from: LOCKED, REVIEW, LEADERBOARD
   *
   * @returns {Object} Updated state
   */
  revealAnswer() {
    if (![PHASES.LOCKED, PHASES.REVIEW, PHASES.LEADERBOARD].includes(this.state.phase)) {
      throw new InvalidTransitionError(
        `Cannot reveal answer from phase "${this.state.phase}". Must be in LOCKED, REVIEW, or LEADERBOARD.`,
        this.state.phase,
        'revealAnswer'
      );
    }

    const prevPhase = this.state.phase;
    this.state.phase = PHASES.REVEAL;
    const currentState = this.getState();
    this.emit('phase:change', { prevPhase, newPhase: PHASES.REVEAL, state: currentState });
    return currentState;
  }

  /**
   * Broadcast Leaderboard (Transition -> LEADERBOARD)
   * Displays updated rank standings and podium on Projector display.
   * Permitted from: LOCKED, REVIEW, REVEAL
   *
   * @returns {Object} Updated state
   */
  showLeaderboard() {
    if (![PHASES.LOCKED, PHASES.REVIEW, PHASES.REVEAL].includes(this.state.phase)) {
      throw new InvalidTransitionError(
        `Cannot show leaderboard from phase "${this.state.phase}". Must be in LOCKED, REVIEW, or REVEAL.`,
        this.state.phase,
        'showLeaderboard'
      );
    }

    const prevPhase = this.state.phase;
    this.state.phase = PHASES.LEADERBOARD;
    const currentState = this.getState();
    this.emit('phase:change', { prevPhase, newPhase: PHASES.LEADERBOARD, state: currentState });
    return currentState;
  }

  /**
   * Reset Round (Transition -> LOBBY)
   * Emergency reset or round completion. Clears timers and resets state.
   * Permitted from: ALL phases
   *
   * @returns {Object} Updated state
   */
  resetRound() {
    this._clearTimers();
    const prevPhase = this.state.phase;
    this.state = {
      phase: PHASES.LOBBY,
      roundId: null,
      currentQuestion: null,
      timer: {
        startedAt: null,
        expiresAt: null,
        durationMs: 0,
        remainingMs: 0,
        isPaused: false
      }
    };

    const currentState = this.getState();
    this.emit('phase:change', { prevPhase, newPhase: PHASES.LOBBY, state: currentState });
    return currentState;
  }

  /**
   * Authoritative Submission Validation Gate
   * Enforces server timestamp deadline + LAN grace window.
   *
   * @param {number} [serverTimestamp=Date.now()]
   * @returns {{ allowed: boolean, serverTimeMs: number, reason: string|null }}
   */
  canAcceptSubmission(serverTimestamp = Date.now()) {
    if (this.state.phase === PHASES.COUNTDOWN) {
      const allowed = serverTimestamp <= (this.state.timer.expiresAt + this.graceWindowMs);
      return {
        allowed,
        serverTimeMs: serverTimestamp,
        reason: allowed ? null : 'EXPIRED_LATE_SUBMISSION'
      };
    }

    if (this.state.phase === PHASES.LOCKED) {
      const withinGrace = this.state.timer.expiresAt && (serverTimestamp <= this.state.timer.expiresAt + this.graceWindowMs);
      return {
        allowed: !!withinGrace,
        serverTimeMs: serverTimestamp,
        reason: withinGrace ? null : 'SUBMISSIONS_LOCKED'
      };
    }

    return {
      allowed: false,
      serverTimeMs: serverTimestamp,
      reason: `SUBMISSIONS_PROHIBITED_IN_${this.state.phase}`
    };
  }
}

// Support both require('.../gameEngine') as class and require('.../gameEngine').GameEngine
module.exports = GameEngine;
GameEngine.GameEngine = GameEngine;
GameEngine.PHASES = PHASES;
GameEngine.InvalidTransitionError = InvalidTransitionError;
