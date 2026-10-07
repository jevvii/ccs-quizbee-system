/**
 * tests/challenger_m3_stress.test.js
 * Empirical Challenger Adversarial Verification & Stress Suite for Milestone 3
 * 
 * Verifies:
 * 1. public/js/audio.js Web Audio procedural sound synthesis & edge cases
 * 2. public/js/contestant.js client controller & anti-cheat hooks
 * 3. public/js/quizmaster.js telemetry grid & phase controls
 * 4. public/js/projector.js 1080p stage display & leaderboard podium
 * 5. public/js/judge.js review queue & 1-click evaluation actions
 * 6. Zero-CDN offline asset integrity
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT_DIR = path.resolve(__dirname, '..');

// =============================================================================
// Helper: Lightweight Mock DOM & Browser Environment
// =============================================================================

class MockClassList {
  constructor(initial = []) {
    this._classes = new Set(initial);
  }
  add(...classes) {
    classes.forEach((c) => this._classes.add(c));
  }
  remove(...classes) {
    classes.forEach((c) => this._classes.delete(c));
  }
  contains(c) {
    return this._classes.has(c);
  }
  toggle(c) {
    if (this._classes.has(c)) {
      this._classes.delete(c);
      return false;
    }
    this._classes.add(c);
    return true;
  }
  toString() {
    return Array.from(this._classes).join(' ');
  }
}

class MockElement {
  constructor(tagName = 'div', id = '', classNames = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.classList = new MockClassList(classNames ? classNames.split(' ').filter(Boolean) : []);
    this.textContent = '';
    this.innerHTML = '';
    this.style = {};
    this.dataset = {};
    this.disabled = false;
    this.value = '';
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
  }

  get className() {
    return this.classList.toString();
  }

  set className(val) {
    this.classList = new MockClassList(val ? String(val).split(' ').filter(Boolean) : []);
  }

  addEventListener(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(fn);
  }

  removeEventListener(event, fn) {
    if (this.listeners.has(event)) {
      this.listeners.set(event, this.listeners.get(event).filter((f) => f !== fn));
    }
  }

  dispatchEvent(event) {
    if (!event.target) event.target = this;
    const fns = this.listeners.get(event.type) || [];
    fns.forEach((fn) => fn(event));
  }

  click() {
    this.dispatchEvent({
      type: 'click',
      target: this,
      preventDefault: () => {}
    });
  }

  focus() {
    this._focused = true;
  }

  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  prepend(child) {
    this.children.unshift(child);
    child.parentNode = this;
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const traverse = (node) => {
      for (const child of node.children) {
        if (matchesSelector(child, selector)) {
          results.push(child);
        }
        traverse(child);
      }
    };
    traverse(this);
    return results;
  }
}

function matchesSelector(el, selector) {
  if (selector.startsWith('#')) return el.id === selector.slice(1);
  if (selector.startsWith('.')) return el.classList.contains(selector.slice(1));
  if (selector.toLowerCase() === el.tagName.toLowerCase()) return true;
  if (selector.includes('.')) {
    const [tag, cls] = selector.split('.');
    return (!tag || el.tagName.toLowerCase() === tag.toLowerCase()) && el.classList.contains(cls);
  }
  return false;
}

class MockDocument {
  constructor() {
    this.elementsById = new Map();
    this.elementsByClass = new Map();
    this.listeners = new Map();
    this.readyState = 'complete';
    this.documentElement = new MockElement('html');
    this.documentElement.requestFullscreen = () => Promise.resolve();
    this.fullscreenElement = null;
    this.hidden = false;
  }

  register(el) {
    if (el.id) this.elementsById.set(el.id, el);
    return el;
  }

  getElementById(id) {
    return this.elementsById.get(id) || null;
  }

  createElement(tag) {
    const el = new MockElement(tag);
    return el;
  }

  querySelectorAll(selector) {
    const all = Array.from(this.elementsById.values());
    return all.filter((el) => matchesSelector(el, selector));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  addEventListener(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(fn);
  }

  removeEventListener(event, fn) {
    if (this.listeners.has(event)) {
      this.listeners.set(event, this.listeners.get(event).filter((f) => f !== fn));
    }
  }

  dispatchEvent(event) {
    const fns = this.listeners.get(event.type) || [];
    fns.forEach((fn) => fn(event));
  }
}

class MockSocket {
  constructor() {
    this.connected = true;
    this.events = new Map();
    this.emitted = [];
    let _customEmit = null;

    Object.defineProperty(this, 'emit', {
      get() {
        return (event, data, ack) => {
          this.emitted.push({ event, data, ack });
          if (typeof _customEmit === 'function') {
            return _customEmit(event, data, ack);
          }
          if (typeof ack === 'function') {
            ack({ success: true });
          }
        };
      },
      set(fn) {
        _customEmit = fn;
      },
      configurable: true
    });
  }

  on(event, handler) {
    if (!this.events.has(event)) this.events.set(event, []);
    this.events.get(event).push(handler);
  }

  trigger(event, data) {
    const handlers = this.events.get(event) || [];
    handlers.forEach((h) => h(data));
  }

  getLastEmit(event) {
    for (let i = this.emitted.length - 1; i >= 0; i--) {
      if (this.emitted[i].event === event) return this.emitted[i];
    }
    return null;
  }
}

// =============================================================================
// Helper: Web Audio API Mock for Node.js
// =============================================================================

class MockAudioParam {
  constructor(initial = 1) {
    this.value = initial;
    this.history = [];
  }
  setValueAtTime(val, time) {
    this.value = val;
    this.history.push({ op: 'set', val, time });
  }
  exponentialRampToValueAtTime(val, time) {
    if (val <= 0) {
      throw new RangeError('The non-zero value is invalid for exponential ramp.');
    }
    this.value = val;
    this.history.push({ op: 'expRamp', val, time });
  }
  linearRampToValueAtTime(val, time) {
    this.value = val;
    this.history.push({ op: 'linRamp', val, time });
  }
}

class MockOscillatorNode {
  constructor(ctx) {
    this.ctx = ctx;
    this.type = 'sine';
    this.frequency = new MockAudioParam(440);
    this.connections = [];
    this.started = false;
    this.stopped = false;
    this.startTime = null;
    this.stopTime = null;
  }
  connect(dest) {
    this.connections.push(dest);
    return dest;
  }
  start(time) {
    this.started = true;
    this.startTime = time;
  }
  stop(time) {
    this.stopped = true;
    this.stopTime = time;
  }
}

class MockGainNode {
  constructor(ctx) {
    this.ctx = ctx;
    this.gain = new MockAudioParam(1);
    this.connections = [];
  }
  connect(dest) {
    this.connections.push(dest);
    return dest;
  }
}

class MockBiquadFilterNode {
  constructor(ctx) {
    this.ctx = ctx;
    this.type = 'lowpass';
    this.frequency = new MockAudioParam(350);
    this.connections = [];
  }
  connect(dest) {
    this.connections.push(dest);
    return dest;
  }
}

class MockAudioContext {
  constructor() {
    this.currentTime = 1.0;
    this.destination = { name: 'destination' };
    this.state = 'suspended';
    this.oscillators = [];
    this.gains = [];
    this.filters = [];
  }
  createGain() {
    const node = new MockGainNode(this);
    this.gains.push(node);
    return node;
  }
  createOscillator() {
    const node = new MockOscillatorNode(this);
    this.oscillators.push(node);
    return node;
  }
  createBiquadFilter() {
    const node = new MockBiquadFilterNode(this);
    this.filters.push(node);
    return node;
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
}

// =============================================================================
// Test Suites
// =============================================================================

describe('Milestone 3 Empirical Challenge: Procedural Audio & UI Controllers', () => {

  // ---------------------------------------------------------------------------
  // Suite 1: Web Audio Procedural Synthesizer (public/js/audio.js)
  // ---------------------------------------------------------------------------
  describe('Suite 1: Web Audio Procedural Synthesizer (public/js/audio.js)', () => {
    const audioPath = path.join(ROOT_DIR, 'public/js/audio.js');

    it('1.1 Headless Node environment: exports singleton, methods safe without window/ctx', () => {
      delete require.cache[require.resolve(audioPath)];
      const audio = require(audioPath);

      assert.ok(audio, 'Audio synthesizer must export cleanly');
      assert.strictEqual(typeof audio.init, 'function');
      assert.strictEqual(typeof audio.playTick, 'function');
      assert.strictEqual(typeof audio.playWarningTick, 'function');
      assert.strictEqual(typeof audio.playLock, 'function');
      assert.strictEqual(typeof audio.playPhaseChime, 'function');
      assert.strictEqual(typeof audio.playCorrect, 'function');
      assert.strictEqual(typeof audio.playIncorrect, 'function');
      assert.strictEqual(typeof audio.playFanfare, 'function');
      assert.strictEqual(typeof audio.playAlert, 'function');

      // Calling all sound methods in headless Node without window/ctx must NOT throw
      const soundMethods = [
        'playTick', 'playWarningTick', 'playLock', 'playPhaseChime',
        'playCorrect', 'playIncorrect', 'playFanfare', 'playAlert'
      ];
      soundMethods.forEach((method) => {
        assert.doesNotThrow(() => audio[method](), `Calling ${method} without context must not throw`);
      });
    });

    it('1.2 Master volume clamping & sanitization boundary stress', () => {
      delete require.cache[require.resolve(audioPath)];
      const audio = require(audioPath);

      // Normal value
      audio.setVolume(0.5);
      assert.strictEqual(audio.volume, 0.5);

      // Negative boundary clamping
      audio.setVolume(-1.5);
      assert.strictEqual(audio.volume, 0);

      // Upper boundary clamping
      audio.setVolume(2.5);
      assert.strictEqual(audio.volume, 1);

      // Exact boundaries
      audio.setVolume(0);
      assert.strictEqual(audio.volume, 0);
      audio.setVolume(1);
      assert.strictEqual(audio.volume, 1);

      // Non-numeric strings and NaN fallbacks
      audio.setVolume('0.75');
      assert.strictEqual(audio.volume, 0.75);

      audio.setVolume('invalid');
      assert.strictEqual(audio.volume, 0);

      audio.setVolume(NaN);
      assert.strictEqual(audio.volume, 0);

      audio.setVolume(null);
      assert.strictEqual(audio.volume, 0);

      audio.setVolume(undefined);
      assert.strictEqual(audio.volume, 0);
    });

    it('1.3 Mute toggling & master gain ramp behavior', () => {
      delete require.cache[require.resolve(audioPath)];
      const audio = require(audioPath);

      assert.strictEqual(audio.isMuted, false);

      // Toggle mute
      const state1 = audio.toggleMute();
      assert.strictEqual(state1, true);
      assert.strictEqual(audio.isMuted, true);

      const state2 = audio.toggleMute();
      assert.strictEqual(state2, false);
      assert.strictEqual(audio.isMuted, false);

      // Explicit setMuted
      audio.setMuted(true);
      assert.strictEqual(audio.isMuted, true);
      audio.setMuted(false);
      assert.strictEqual(audio.isMuted, false);
    });

    it('1.4 Mock AudioContext: full synthesis lifecycle for all 8 procedural sounds', () => {
      const mockCtx = new MockAudioContext();
      const mockWindow = {
        AudioContext: function () {
          return mockCtx;
        }
      };

      // Create new instance via factory execution in VM
      const code = fs.readFileSync(audioPath, 'utf8');
      const sandbox = {
        window: mockWindow,
        self: mockWindow,
        module: { exports: {} }
      };
      vm.createContext(sandbox);
      vm.runInContext(code, sandbox);

      const audio = sandbox.module.exports;
      audio.init();

      assert.strictEqual(audio.isInitialized, true);
      assert.ok(audio.ctx, 'AudioContext must be initialized');
      assert.ok(audio.masterGain, 'Master gain node must be created');

      // 1. playTick
      mockCtx.oscillators = [];
      audio.playTick();
      assert.strictEqual(mockCtx.oscillators.length, 1);
      assert.strictEqual(mockCtx.oscillators[0].type, 'sine');
      assert.strictEqual(mockCtx.oscillators[0].started, true);
      assert.strictEqual(mockCtx.oscillators[0].stopped, true);

      // 2. playWarningTick
      mockCtx.currentTime += 0.5;
      mockCtx.oscillators = [];
      audio.playWarningTick();
      assert.strictEqual(mockCtx.oscillators.length, 1);
      assert.strictEqual(mockCtx.oscillators[0].type, 'triangle');

      // 3. playLock
      mockCtx.currentTime += 0.5;
      mockCtx.oscillators = [];
      audio.playLock();
      assert.strictEqual(mockCtx.oscillators.length, 1);
      assert.strictEqual(mockCtx.oscillators[0].type, 'sawtooth');
      assert.strictEqual(mockCtx.filters.length, 1);
      assert.strictEqual(mockCtx.filters[0].type, 'lowpass');

      // 4. playPhaseChime (2 notes)
      mockCtx.currentTime += 0.5;
      mockCtx.oscillators = [];
      audio.playPhaseChime();
      assert.strictEqual(mockCtx.oscillators.length, 2, 'Phase chime must synthesize 2 tones');

      // 5. playCorrect (4 notes arpeggio)
      mockCtx.currentTime += 0.5;
      mockCtx.oscillators = [];
      audio.playCorrect();
      assert.strictEqual(mockCtx.oscillators.length, 4, 'Correct chime must synthesize 4-note arpeggio');

      // 6. playIncorrect (2 dissonant sawtooth buzzers)
      mockCtx.currentTime += 0.5;
      mockCtx.oscillators = [];
      audio.playIncorrect();
      assert.strictEqual(mockCtx.oscillators.length, 2, 'Incorrect buzzer must synthesize 2 frequencies');

      // 7. playFanfare (4-note victory sequence)
      mockCtx.currentTime += 0.5;
      mockCtx.oscillators = [];
      audio.playFanfare();
      assert.strictEqual(mockCtx.oscillators.length, 4, 'Fanfare must synthesize 4 sequential notes');

      // 8. playAlert (2 warning pips)
      mockCtx.currentTime += 0.5;
      mockCtx.oscillators = [];
      audio.playAlert();
      assert.strictEqual(mockCtx.oscillators.length, 2, 'Alert must synthesize 2 chirp pips');
    });

    it('1.5 Web Audio exponential ramp safety (non-zero target values & valid intervals)', () => {
      const mockCtx = new MockAudioContext();
      const mockWindow = {
        AudioContext: function () {
          return mockCtx;
        }
      };

      const code = fs.readFileSync(audioPath, 'utf8');
      const sandbox = {
        window: mockWindow,
        self: mockWindow,
        module: { exports: {} }
      };
      vm.createContext(sandbox);
      vm.runInContext(code, sandbox);
      const audio = sandbox.module.exports;
      audio.init();

      // Trigger all methods and assert MockAudioParam never received <= 0 for exponential ramp
      const methods = [
        'playTick', 'playWarningTick', 'playLock', 'playPhaseChime',
        'playCorrect', 'playIncorrect', 'playFanfare', 'playAlert'
      ];

      methods.forEach((m) => {
        mockCtx.currentTime += 1.0;
        assert.doesNotThrow(() => audio[m](), `Method ${m} must not trigger invalid ramp exceptions`);
      });

      // Verify all stopped times are strictly after started times
      mockCtx.oscillators.forEach((osc) => {
        assert.ok(osc.startTime !== null, 'Oscillator must have startTime');
        assert.ok(osc.stopTime !== null, 'Oscillator must have stopTime');
        assert.ok(osc.stopTime > osc.startTime, 'Oscillator stopTime must be strictly greater than startTime');
      });
    });

    it('1.6 High-frequency tick throttling (<300ms suppression)', () => {
      const mockCtx = new MockAudioContext();
      const mockWindow = {
        AudioContext: function () {
          return mockCtx;
        }
      };

      const code = fs.readFileSync(audioPath, 'utf8');
      const sandbox = {
        window: mockWindow,
        self: mockWindow,
        module: { exports: {} }
      };
      vm.createContext(sandbox);
      vm.runInContext(code, sandbox);
      const audio = sandbox.module.exports;
      audio.init();

      mockCtx.currentTime = 5.0;
      mockCtx.oscillators = [];

      audio.playTick();
      assert.strictEqual(mockCtx.oscillators.length, 1, 'First tick must execute');

      // Rapid call at same currentTime (0ms delta)
      audio.playTick();
      assert.strictEqual(mockCtx.oscillators.length, 1, 'Rapid tick at same timestamp must be throttled');

      // Call at +100ms delta (<300ms)
      mockCtx.currentTime = 5.1;
      audio.playTick();
      assert.strictEqual(mockCtx.oscillators.length, 1, 'Tick at +100ms must be throttled');

      // Call at +310ms delta (>300ms)
      mockCtx.currentTime = 5.31;
      audio.playTick();
      assert.strictEqual(mockCtx.oscillators.length, 2, 'Tick after 310ms must execute');
    });

    it('1.7 Muted mode: zero oscillator/gain allocations', () => {
      const mockCtx = new MockAudioContext();
      const mockWindow = {
        AudioContext: function () {
          return mockCtx;
        }
      };

      const code = fs.readFileSync(audioPath, 'utf8');
      const sandbox = {
        window: mockWindow,
        self: mockWindow,
        module: { exports: {} }
      };
      vm.createContext(sandbox);
      vm.runInContext(code, sandbox);
      const audio = sandbox.module.exports;
      audio.init();

      audio.setMuted(true);
      mockCtx.oscillators = [];

      const methods = [
        'playTick', 'playWarningTick', 'playLock', 'playPhaseChime',
        'playCorrect', 'playIncorrect', 'playFanfare', 'playAlert'
      ];
      methods.forEach((m) => {
        mockCtx.currentTime += 0.5;
        audio[m]();
      });

      assert.strictEqual(mockCtx.oscillators.length, 0, 'Muted audio synthesizer must create 0 oscillators');
    });

    it('1.8 Audio hardware failure resilience (graceful catch on AudioContext throw)', () => {
      const mockWindow = {
        AudioContext: function () {
          throw new Error('Hardware audio device not available');
        }
      };

      const code = fs.readFileSync(audioPath, 'utf8');
      const sandbox = {
        window: mockWindow,
        self: mockWindow,
        module: { exports: {} }
      };
      vm.createContext(sandbox);
      vm.runInContext(code, sandbox);
      const audio = sandbox.module.exports;

      assert.doesNotThrow(() => audio.init(), 'init() must catch hardware errors gracefully');
      assert.strictEqual(audio.isInitialized, false);
      assert.strictEqual(audio.ctx, null);

      // Sound calls must still safely no-op
      assert.doesNotThrow(() => audio.playTick());
    });

    it('1.9 Browser autoplay policy unlock event handlers', () => {
      const windowListeners = new Map();
      const mockWindow = {
        addEventListener: (event, fn, opts) => {
          if (!windowListeners.has(event)) windowListeners.set(event, []);
          windowListeners.get(event).push(fn);
        },
        removeEventListener: (event, fn) => {
          if (windowListeners.has(event)) {
            windowListeners.set(event, windowListeners.get(event).filter((f) => f !== fn));
          }
        },
        AudioContext: MockAudioContext
      };
      const mockDoc = {};

      const code = fs.readFileSync(audioPath, 'utf8');
      const sandbox = {
        window: mockWindow,
        document: mockDoc,
        self: mockWindow,
        module: { exports: {} }
      };
      vm.createContext(sandbox);
      vm.runInContext(code, sandbox);

      assert.ok(windowListeners.has('pointerdown'), 'Must register pointerdown unlock listener');
      assert.ok(windowListeners.has('keydown'), 'Must register keydown unlock listener');

      // Trigger unlock listener
      const unlockFn = windowListeners.get('pointerdown')[0];
      unlockFn();

      const audio = sandbox.module.exports;
      assert.strictEqual(audio.isInitialized, true, 'Synthesizer must be initialized on interaction gesture');
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 2: Contestant Terminal Client Controller (public/js/contestant.js)
  // ---------------------------------------------------------------------------
  describe('Suite 2: Contestant Terminal Client Controller (public/js/contestant.js)', () => {
    let doc;
    let win;
    let mockSocket;
    let localStorageMap;
    let alerts;

    beforeEach(() => {
      doc = new MockDocument();
      mockSocket = new MockSocket();
      localStorageMap = new Map();
      alerts = [];

      // Create necessary DOM elements
      doc.register(new MockElement('section', 'login-section'));
      doc.register(new MockElement('input', 'pin-input'));
      doc.register(new MockElement('button', 'btn-login'));
      doc.register(new MockElement('div', 'login-error', 'hidden'));
      doc.register(new MockElement('section', 'active-section', 'hidden'));
      doc.register(new MockElement('span', 'terminal-dot', 'offline'));
      doc.register(new MockElement('span', 'terminal-status-text'));
      doc.register(new MockElement('div', 'terminal-number-badge'));
      doc.register(new MockElement('div', 'contestant-name'));
      doc.register(new MockElement('div', 'contestant-dept'));
      doc.register(new MockElement('span', 'current-score'));

      let audioEvents = [];

      doc.register(new MockElement('section', 'question-section', 'question-card'));
      doc.register(new MockElement('span', 'phase-label'));
      doc.register(new MockElement('div', 'timer-bar'));
      doc.register(new MockElement('span', 'timer-value'));
      doc.register(new MockElement('span', 'round-badge'));
      doc.register(new MockElement('span', 'item-badge', 'hidden'));
      doc.register(new MockElement('span', 'point-badge'));
      doc.register(new MockElement('div', 'question-text'));
      doc.register(new MockElement('pre', 'code-snippet', 'hidden'));
      doc.register(new MockElement('code', 'code-content'));
      doc.register(new MockElement('div', 'reading-lock', 'hidden'));
      doc.register(new MockElement('div', 'submission-status', 'hidden'));

      doc.register(new MockElement('div', 'mcq-container', 'hidden'));
      ['a', 'b', 'c', 'd'].forEach((l) => {
        const btn = new MockElement('button', `btn-opt-${l}`, 'mcq-option-btn');
        btn.dataset.option = l.toUpperCase();
        doc.register(btn);
        doc.register(new MockElement('span', `text-opt-${l}`));
      });

      doc.register(new MockElement('div', 'id-container', 'hidden'));
      doc.register(new MockElement('input', 'answer-input'));
      doc.register(new MockElement('button', 'btn-submit-answer'));

      doc.register(new MockElement('div', 'fullscreen-warning', 'hidden'));
      doc.register(new MockElement('button', 'btn-reenter-fullscreen'));
      doc.register(new MockElement('button', 'btn-audio-mute'));
      doc.register(new MockElement('input', 'audio-volume-slider'));

      // Keypad buttons
      ['1', '2', '3', '4', 'clear', 'backspace'].forEach((key) => {
        const btn = new MockElement('button', `keypad-${key}`, 'keypad-btn');
        btn.dataset.key = key;
        doc.register(btn);
      });

      win = {
        document: doc,
        window: null,
        audioEvents,
        io: () => mockSocket,
        localStorage: {
          getItem: (k) => localStorageMap.get(k) || null,
          setItem: (k, v) => localStorageMap.set(k, String(v)),
          removeItem: (k) => localStorageMap.delete(k)
        },
        alert: (msg) => alerts.push(msg),
        location: { reload: () => {} },
        QuizAudio: {
          toggleMute: () => true,
          setVolume: () => {},
          playTick: () => audioEvents.push('tick'),
          playWarningTick: () => audioEvents.push('warningTick'),
          playLock: () => audioEvents.push('lock'),
          playPhaseChime: () => audioEvents.push('phaseChime'),
          playCorrect: () => audioEvents.push('correct'),
          playIncorrect: () => audioEvents.push('incorrect')
        },
        addEventListener: (event, fn) => doc.addEventListener(event, fn),
        removeEventListener: (event, fn) => doc.removeEventListener(event, fn)
      };
      win.window = win;
    });

    function loadContestantController() {
      const code = fs.readFileSync(path.join(ROOT_DIR, 'public/js/contestant.js'), 'utf8');
      const sandbox = {
        window: win,
        document: doc,
        localStorage: win.localStorage,
        io: win.io,
        alert: win.alert,
        location: win.location,
        QuizAudio: win.QuizAudio,
        self: win,
        console
      };
      vm.createContext(sandbox);
      vm.runInContext(code, sandbox);
    }

    it('2.1 Keypad input mechanics (digits, backspace, CLR, auto-auth at 4 digits)', () => {
      loadContestantController();

      const inputPin = doc.getElementById('pin-input');
      const btn1 = doc.getElementById('keypad-1');
      const btn2 = doc.getElementById('keypad-2');
      const btn3 = doc.getElementById('keypad-3');
      const btn4 = doc.getElementById('keypad-4');
      const btnClr = doc.getElementById('keypad-clear');
      const btnBack = doc.getElementById('keypad-backspace');

      btn1.click();
      btn2.click();
      assert.strictEqual(inputPin.value, '12');

      btnBack.click();
      assert.strictEqual(inputPin.value, '1');

      btnClr.click();
      assert.strictEqual(inputPin.value, '');

      // Enter 4 digits -> should trigger attemptLogin
      btn1.click();
      btn2.click();
      btn3.click();
      btn4.click();
      assert.strictEqual(inputPin.value, '1234');

      const emit = mockSocket.getLastEmit('contestant:auth');
      assert.ok(emit, 'Must emit contestant:auth on 4-digit keypad entry');
      assert.strictEqual(emit.data.pin, '1234');
    });

    it('2.2 Disconnected guard on login attempt', () => {
      mockSocket.connected = false;
      loadContestantController();

      const inputPin = doc.getElementById('pin-input');
      inputPin.value = '1001';
      const btnLogin = doc.getElementById('btn-login');
      btnLogin.click();

      const err = doc.getElementById('login-error');
      assert.strictEqual(err.classList.contains('hidden'), false);
      assert.match(err.textContent, /Not connected to LAN/);
    });

    it('2.3 Authentication ack handling (invalid PIN vs success rehydration)', () => {
      loadContestantController();

      const inputPin = doc.getElementById('pin-input');
      inputPin.value = '9999';

      // Override emit to simulate invalid PIN
      mockSocket.emit = (event, data, ack) => {
        if (event === 'contestant:auth' && typeof ack === 'function') {
          ack({ success: false, error: 'INVALID_PIN' });
        }
      };

      const btnLogin = doc.getElementById('btn-login');
      btnLogin.click();

      const err = doc.getElementById('login-error');
      assert.strictEqual(err.classList.contains('hidden'), false);
      assert.match(err.textContent, /Invalid PIN/);

      // Now simulate successful auth
      mockSocket.emit = (event, data, ack) => {
        if (event === 'contestant:auth' && typeof ack === 'function') {
          ack({
            success: true,
            contestant: {
              pin: '1005',
              terminalNumber: 5,
              fullName: 'Maria Santos',
              department: 'Information Technology',
              totalScore: 12
            },
            gameState: {
              phase: 'COUNTDOWN',
              currentQuestion: {
                id: 1,
                round: 'easy',
                points: 1,
                question: 'What does HTML stand for?',
                type: 'MCQ',
                options: JSON.stringify({ A: 'Hyper Text', B: 'High Tech', C: 'Home Tool', D: 'None' })
              }
            }
          });
        }
      };

      inputPin.value = '1005';
      btnLogin.click();

      assert.strictEqual(doc.getElementById('login-section').classList.contains('hidden'), true);
      assert.strictEqual(doc.getElementById('active-section').classList.contains('hidden'), false);
      assert.strictEqual(doc.getElementById('terminal-number-badge').textContent, 'T05');
      assert.strictEqual(doc.getElementById('contestant-name').textContent, 'Maria Santos');
      assert.strictEqual(doc.getElementById('current-score').textContent, '12 PTS');
      assert.strictEqual(localStorageMap.get('quizbee_pin'), '1005', 'PIN must be stored in localStorage');
    });

    it('2.4 State machine phase reactions and input locking', () => {
      loadContestantController();

      // Trigger game:phase:change to READING
      mockSocket.trigger('game:phase:change', { phase: 'READING' });
      assert.strictEqual(doc.getElementById('reading-lock').classList.contains('hidden'), false);
      assert.strictEqual(doc.getElementById('btn-opt-a').disabled, true);

      // Trigger game:phase:change to COUNTDOWN
      mockSocket.trigger('game:phase:change', { phase: 'COUNTDOWN' });
      assert.strictEqual(doc.getElementById('reading-lock').classList.contains('hidden'), true);
      assert.strictEqual(doc.getElementById('btn-opt-a').disabled, false);

      // Trigger game:phase:change to PAUSED
      mockSocket.trigger('game:phase:change', { phase: 'PAUSED' });
      assert.strictEqual(doc.getElementById('btn-opt-a').disabled, true);

      // Trigger game:question:lock
      mockSocket.trigger('game:question:lock');
      assert.strictEqual(doc.getElementById('btn-opt-a').disabled, true);
      assert.strictEqual(doc.getElementById('submission-status').classList.contains('hidden'), false);
    });

    it('2.5 MCQ submission, duplicate submission prevention, and input locking', () => {
      loadContestantController();

      // Simulate logged in and question presented
      mockSocket.emit = (event, data, ack) => {
        if (event === 'contestant:auth' && typeof ack === 'function') {
          ack({
            success: true,
            contestant: { pin: '1001', terminalNumber: 1, fullName: 'Alice' },
            gameState: {
              phase: 'COUNTDOWN',
              currentQuestion: { id: 42, type: 'MCQ', options: { A: 'A', B: 'B', C: 'C', D: 'D' } }
            }
          });
        } else if (event === 'contestant:submit' && typeof ack === 'function') {
          ack({ success: true, totalScore: 3 });
        }
      };

      doc.getElementById('pin-input').value = '1001';
      doc.getElementById('btn-login').click();

      const btnOptB = doc.getElementById('btn-opt-b');
      btnOptB.click();

      // Verify submission
      const subEmit = mockSocket.getLastEmit('contestant:submit');
      assert.ok(subEmit, 'Must emit contestant:submit');
      assert.strictEqual(subEmit.data.questionId, 42);
      assert.strictEqual(subEmit.data.answer, 'B');

      // Verify buttons locked
      assert.strictEqual(btnOptB.disabled, true);

      // Attempt second submission
      const emittedCountBefore = mockSocket.emitted.length;
      doc.getElementById('btn-opt-c').click();
      assert.strictEqual(mockSocket.emitted.length, emittedCountBefore, 'Double submission must be blocked');
    });

    it('2.6 Identification submission, empty input rejection, and Enter key trigger', () => {
      loadContestantController();

      mockSocket.emit = (event, data, ack) => {
        if (event === 'contestant:auth' && typeof ack === 'function') {
          ack({
            success: true,
            contestant: { pin: '1002', terminalNumber: 2 },
            gameState: {
              phase: 'COUNTDOWN',
              currentQuestion: { id: 10, type: 'IDENTIFICATION', question: 'Fill in blank' }
            }
          });
        } else if (event === 'contestant:submit' && typeof ack === 'function') {
          ack({ success: true, totalScore: 2 });
        }
      };

      doc.getElementById('pin-input').value = '1002';
      doc.getElementById('btn-login').click();

      const inputAnswer = doc.getElementById('answer-input');
      const btnSubmit = doc.getElementById('btn-submit-answer');

      // 1. Submit empty answer -> alerts
      inputAnswer.value = '   ';
      btnSubmit.click();
      assert.strictEqual(alerts.length, 1);
      assert.match(alerts[0], /enter an answer/i);

      // 2. Submit valid answer via Enter key
      inputAnswer.value = 'polymorphism';
      inputAnswer.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault: () => {} });

      const emit = mockSocket.getLastEmit('contestant:submit');
      assert.ok(emit, 'Must emit submission on Enter key');
      assert.strictEqual(emit.data.answer, 'polymorphism');
    });

    it('2.7 Anti-cheat incident reporting: fullscreen exit, blur, tab switch, debounce window', () => {
      loadContestantController();

      // Log in first
      mockSocket.emit = (event, data, ack) => {
        if (event === 'contestant:auth' && typeof ack === 'function') {
          ack({ success: true, contestant: { pin: '1003' } });
        }
      };
      doc.getElementById('pin-input').value = '1003';
      doc.getElementById('btn-login').click();

      // 1. Fullscreen exit
      doc.fullscreenElement = null;
      doc.dispatchEvent({ type: 'fullscreenchange' });

      let incident = mockSocket.getLastEmit('contestant:incident');
      assert.ok(incident, 'Must report FULLSCREEN_EXIT');
      assert.strictEqual(incident.data.type, 'FULLSCREEN_EXIT');
      assert.strictEqual(incident.data.pin, '1003');
      assert.strictEqual(doc.getElementById('fullscreen-warning').classList.contains('hidden'), false);

      // Rapid consecutive fullscreen incident within 1500ms must be debounced
      mockSocket.emitted = [];
      doc.dispatchEvent({ type: 'fullscreenchange' });
      assert.strictEqual(mockSocket.emitted.length, 0, 'Consecutive incident within 1500ms must be throttled');

      // 2. Window blur
      doc.dispatchEvent({ type: 'blur' });
      incident = mockSocket.getLastEmit('contestant:incident');
      assert.ok(incident, 'Must report WINDOW_BLUR');
      assert.strictEqual(incident.data.type, 'WINDOW_BLUR');

      // 3. Tab switch
      doc.hidden = true;
      doc.dispatchEvent({ type: 'visibilitychange' });
      incident = mockSocket.getLastEmit('contestant:incident');
      assert.ok(incident, 'Must report TAB_SWITCH');
      assert.strictEqual(incident.data.type, 'TAB_SWITCH');
    });

    it('2.8 Anti-cheat key intercept: DevTools, view source, refresh, clipboard shortcuts', () => {
      loadContestantController();

      let prevented = false;
      const fakeEvent = (key, ctrl = false, shift = false, targetTag = 'BODY') => {
        prevented = false;
        return {
          type: 'keydown',
          key,
          ctrlKey: ctrl,
          shiftKey: shift,
          target: { tagName: targetTag },
          preventDefault: () => { prevented = true; }
        };
      };

      // F12 DevTools
      doc.dispatchEvent(fakeEvent('F12'));
      assert.strictEqual(prevented, true, 'F12 must be blocked');

      // Ctrl+Shift+I
      doc.dispatchEvent(fakeEvent('I', true, true));
      assert.strictEqual(prevented, true, 'Ctrl+Shift+I must be blocked');

      // Ctrl+U (View Source)
      doc.dispatchEvent(fakeEvent('u', true));
      assert.strictEqual(prevented, true, 'Ctrl+U must be blocked');

      // F5 (Refresh)
      doc.dispatchEvent(fakeEvent('F5'));
      assert.strictEqual(prevented, true, 'F5 must be blocked');

      // Ctrl+C outside input
      doc.dispatchEvent(fakeEvent('c', true, false, 'DIV'));
      assert.strictEqual(prevented, true, 'Ctrl+C outside input must be blocked');

      // Ctrl+C inside input allowed
      doc.dispatchEvent(fakeEvent('c', true, false, 'INPUT'));
      assert.strictEqual(prevented, false, 'Ctrl+C inside input must be allowed');
    });

    it('2.9 Duplicate session eviction handling (contestant:kicked)', () => {
      loadContestantController();
      localStorageMap.set('quizbee_pin', '1010');

      let reloaded = false;
      win.location.reload = () => { reloaded = true; };

      mockSocket.trigger('contestant:kicked', { message: 'Duplicate login' });

      assert.strictEqual(localStorageMap.has('quizbee_pin'), false, 'PIN must be cleared on kick');
      assert.strictEqual(reloaded, true, 'Workstation must reload on kick');
      assert.strictEqual(alerts.length, 1);
    });

    it('2.10 Live score and judge ruling updates', () => {
      loadContestantController();

      // Score update
      mockSocket.trigger('contestant:score:update', { totalScore: 18 });
      assert.strictEqual(doc.getElementById('current-score').textContent, '18 PTS');

      // Judge ruling approved
      mockSocket.trigger('contestant:ruling:update', { status: 'APPROVED', awardedPoints: 2 });
      assert.match(doc.getElementById('submission-status').textContent, /Judge Approved/);

      // Judge ruling rejected
      mockSocket.trigger('contestant:ruling:update', { status: 'REJECTED' });
      assert.match(doc.getElementById('submission-status').textContent, /not accepted/);
    });

    it('2.11 Correctness evaluation is deferred until Quizmaster reveals answer and does not invert to incorrect on reveal', () => {
      loadContestantController();

      mockSocket.emit = (event, data, ack) => {
        if (event === 'contestant:auth' && typeof ack === 'function') {
          ack({
            success: true,
            contestant: { pin: '1001', terminalNumber: 1, fullName: 'Alice', totalScore: 0 },
            gameState: {
              phase: 'COUNTDOWN',
              currentQuestion: { id: 101, type: 'MCQ', options: { A: 'Alpha', B: 'Beta', C: 'Gamma', D: 'Delta' }, points: 1 }
            }
          });
        } else if (event === 'contestant:submit' && typeof ack === 'function') {
          ack({ success: true, pointsAwarded: 1, totalScore: 1 });
        }
      };

      doc.getElementById('pin-input').value = '1001';
      doc.getElementById('btn-login').click();

      const btnOptB = doc.getElementById('btn-opt-b');
      const questionCard = doc.getElementById('question-section');
      const statusText = doc.getElementById('submission-status');

      // Contestant submits 'B' during COUNTDOWN
      btnOptB.click();

      // DURING COUNTDOWN:
      // 1. Border MUST remain neutral (no status-correct or status-incorrect)
      assert.strictEqual(questionCard.className, 'question-card', 'Card must remain neutral during countdown');
      assert.strictEqual(questionCard.classList.contains('status-correct'), false);
      assert.strictEqual(questionCard.classList.contains('status-incorrect'), false);
      // 2. Selected button must have .selected but NOT .is-correct or .is-incorrect
      assert.strictEqual(btnOptB.classList.contains('selected'), true);
      assert.strictEqual(btnOptB.classList.contains('is-correct'), false);
      assert.strictEqual(btnOptB.classList.contains('is-incorrect'), false);
      // 3. Status shows neutral recorded message
      assert.match(statusText.textContent, /Awaiting Quizmaster reveal/i);
      // 4. No premature correct/incorrect audio
      assert.strictEqual(win.audioEvents.includes('correct'), false);
      assert.strictEqual(win.audioEvents.includes('incorrect'), false);

      // Quizmaster transitions phase to LOCKED
      mockSocket.trigger('game:phase:change', {
        phase: 'LOCKED',
        state: {
          phase: 'LOCKED',
          currentQuestion: { id: 101, type: 'MCQ', options: { A: 'Alpha', B: 'Beta', C: 'Gamma', D: 'Delta' }, points: 1 }
        }
      });
      mockSocket.trigger('game:question:lock');

      // ON LOCK:
      assert.strictEqual(questionCard.className, 'question-card', 'Card must remain neutral on lock');
      assert.strictEqual(btnOptB.classList.contains('selected'), true, 'Selected option must stay selected');

      // Quizmaster transitions phase to REVEAL and reveals official answer
      mockSocket.trigger('game:phase:change', {
        phase: 'REVEAL',
        state: {
          phase: 'REVEAL',
          currentQuestion: { id: 101, type: 'MCQ', options: { A: 'Alpha', B: 'Beta', C: 'Gamma', D: 'Delta' }, points: 1 }
        }
      });
      mockSocket.trigger('game:answer:reveal', {
        questionId: 101,
        correctAnswer: 'B'
      });

      // ON REVEAL:
      // 1. Card border must turn green (.status-correct)
      assert.strictEqual(questionCard.classList.contains('status-correct'), true, 'Card border must be green on reveal');
      assert.strictEqual(questionCard.classList.contains('status-incorrect'), false, 'Card border must NOT be red');
      // 2. Option B turns green (.is-correct)
      assert.strictEqual(btnOptB.classList.contains('is-correct'), true);
      // 3. Status confirms correctness
      assert.match(statusText.textContent, /Correct!/i);
      // 4. Audio plays correct chime
      assert.strictEqual(win.audioEvents.includes('correct'), true);
      // 5. Header score updates
      assert.strictEqual(doc.getElementById('current-score').textContent, '1 PTS');
    });

    it('2.12 Incorrect answer evaluation highlights wrong choice in red and official answer in green upon reveal', () => {
      loadContestantController();

      mockSocket.emit = (event, data, ack) => {
        if (event === 'contestant:auth' && typeof ack === 'function') {
          ack({
            success: true,
            contestant: { pin: '1002', terminalNumber: 2, fullName: 'Bob', totalScore: 0 },
            gameState: {
              phase: 'COUNTDOWN',
              currentQuestion: { id: 102, type: 'MCQ', options: { A: 'Alpha', B: 'Beta', C: 'Gamma', D: 'Delta' }, points: 1 }
            }
          });
        } else if (event === 'contestant:submit' && typeof ack === 'function') {
          ack({ success: true, pointsAwarded: 0, totalScore: 0 });
        }
      };

      doc.getElementById('pin-input').value = '1002';
      doc.getElementById('btn-login').click();

      const btnOptA = doc.getElementById('btn-opt-a');
      const btnOptC = doc.getElementById('btn-opt-c');
      const questionCard = doc.getElementById('question-section');
      const statusText = doc.getElementById('submission-status');

      // Contestant submits 'A' (incorrect) during COUNTDOWN
      btnOptA.click();

      assert.strictEqual(questionCard.className, 'question-card', 'Card must remain neutral during countdown');
      assert.strictEqual(win.audioEvents.includes('incorrect'), false);

      // Quizmaster reveals official answer 'C'
      mockSocket.trigger('game:phase:change', {
        phase: 'REVEAL',
        state: {
          phase: 'REVEAL',
          currentQuestion: { id: 102, type: 'MCQ', options: { A: 'Alpha', B: 'Beta', C: 'Gamma', D: 'Delta' }, points: 1 }
        }
      });
      mockSocket.trigger('game:answer:reveal', {
        questionId: 102,
        correctAnswer: 'C'
      });

      // ON REVEAL:
      assert.strictEqual(questionCard.classList.contains('status-incorrect'), true, 'Card border must be red on reveal');
      assert.strictEqual(btnOptA.classList.contains('is-incorrect'), true, 'Contestant choice must be red');
      assert.strictEqual(btnOptC.classList.contains('is-correct'), true, 'Official answer must be green');
      assert.match(statusText.textContent, /Incorrect/i);
      assert.strictEqual(win.audioEvents.includes('incorrect'), true);
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 3: Quizmaster Dashboard Controller (public/js/quizmaster.js)
  // ---------------------------------------------------------------------------
  describe('Suite 3: Quizmaster Dashboard Controller (public/js/quizmaster.js)', () => {
    let doc;
    let win;
    let mockSocket;
    let alerts;

    beforeEach(() => {
      doc = new MockDocument();
      mockSocket = new MockSocket();
      alerts = [];

      doc.register(new MockElement('span', 'qm-connection-dot'));
      doc.register(new MockElement('span', 'qm-connection-status'));
      doc.register(new MockElement('span', 'current-phase-badge'));
      doc.register(new MockElement('div', 'timer-display'));
      doc.register(new MockElement('p', 'timer-status-hint'));

      // Buttons
      ['stage', 'start-timer', 'pause-timer', 'resume-timer', 'force-lock', 'reveal', 'leaderboard', 'reset'].forEach((id) => {
        doc.register(new MockElement('button', `btn-${id}`));
      });

      // Question select
      doc.register(new MockElement('select', 'question-select'));
      doc.register(new MockElement('span', 'question-count-badge'));
      doc.register(new MockElement('span', 'preview-round-badge'));
      doc.register(new MockElement('span', 'preview-points-badge'));
      doc.register(new MockElement('div', 'preview-question-text'));
      doc.register(new MockElement('pre', 'preview-code-block', 'hidden'));
      doc.register(new MockElement('code', 'preview-code-content'));
      doc.register(new MockElement('div', 'preview-options-container', 'hidden'));

      // Telemetry grid
      doc.register(new MockElement('div', 'telemetry-grid'));
      doc.register(new MockElement('span', 'stat-online'));
      doc.register(new MockElement('span', 'stat-offline'));
      doc.register(new MockElement('span', 'stat-incidents'));
      doc.register(new MockElement('span', 'submission-count'));
      doc.register(new MockElement('div', 'alert-feed'));
      doc.register(new MockElement('button', 'btn-clear-alerts'));

      // Override modal
      doc.register(new MockElement('div', 'override-modal', 'hidden'));
      doc.register(new MockElement('button', 'btn-open-override'));
      doc.register(new MockElement('button', 'btn-close-override'));
      doc.register(new MockElement('button', 'btn-cancel-override'));
      doc.register(new MockElement('button', 'btn-submit-override'));
      doc.register(new MockElement('input', 'override-pin'));
      doc.register(new MockElement('input', 'override-score'));
      doc.register(new MockElement('input', 'override-reason'));

      doc.register(new MockElement('button', 'btn-audio-mute'));
      doc.register(new MockElement('input', 'audio-volume-slider'));

      win = {
        document: doc,
        window: null,
        io: () => mockSocket,
        alert: (msg) => alerts.push(msg),
        confirm: () => true,
        fetch: async () => ({
          json: async () => ({
            success: true,
            questions: [
              { id: 1, round: 'easy', points: 1, question: 'What is SQLite?', type: 'MCQ', options: { A: 'Database', B: 'OS' }, correct_answer: 'A' },
              { id: 2, round: 'average', points: 2, question: 'What is WAL?', type: 'IDENTIFICATION', code_snippet: 'PRAGMA journal_mode = WAL;' }
            ]
          })
        }),
        QuizAudio: {
          toggleMute: () => true,
          setVolume: () => {},
          playTick: () => {},
          playWarningTick: () => {},
          playLock: () => {},
          playPhaseChime: () => {},
          playCorrect: () => {},
          playFanfare: () => {},
          playAlert: () => {}
        }
      };
      win.window = win;
    });

    function loadQuizmasterController() {
      const code = fs.readFileSync(path.join(ROOT_DIR, 'public/js/quizmaster.js'), 'utf8');
      const sandbox = {
        window: win,
        document: doc,
        io: win.io,
        alert: win.alert,
        confirm: win.confirm,
        fetch: win.fetch,
        QuizAudio: win.QuizAudio,
        self: win,
        console
      };
      vm.createContext(sandbox);
      vm.runInContext(code, sandbox);
    }

    it('3.1 60-workstation telemetry matrix DOM generation (PINs 1001-1060)', () => {
      loadQuizmasterController();

      const grid = doc.getElementById('telemetry-grid');
      assert.strictEqual(grid.children.length, 60, 'Telemetry grid must render exactly 60 tiles');

      // Verify bounds
      const firstTile = grid.children[0];
      assert.strictEqual(firstTile.id, 'terminal-1001');
      assert.strictEqual(firstTile.dataset.pin, '1001');

      const lastTile = grid.children[59];
      assert.strictEqual(lastTile.id, 'terminal-1060');
      assert.strictEqual(lastTile.dataset.pin, '1060');
    });

    it('3.2 Telemetry snapshot parsing, presence dots, online/offline count updates', () => {
      loadQuizmasterController();

      // Emit qm:telemetry:snapshot
      mockSocket.trigger('qm:telemetry:snapshot', {
        terminals: [
          { pin: '1001', isConnected: true, fullName: 'Bob', score: 5, hasSubmitted: true, incidentCount: 0 },
          { pin: '1002', isConnected: false, fullName: 'Charlie', score: 2, hasSubmitted: false, incidentCount: 1 }
        ],
        summary: { totalConnected: 1, totalIncidents: 1 }
      });

      assert.strictEqual(doc.getElementById('stat-online').textContent, 1);
      assert.strictEqual(doc.getElementById('stat-offline').textContent, 59);
      assert.strictEqual(doc.getElementById('stat-incidents').textContent, 1);
    });

    it('3.3 Cheat incident alert ingestion, badge counter, and alert feed prepending', () => {
      loadQuizmasterController();

      mockSocket.trigger('qm:telemetry:alert', {
        pin: '1003',
        terminalNumber: 3,
        incidentType: 'DEVTOOLS',
        totalIncidents: 2
      });

      const feed = doc.getElementById('alert-feed');
      assert.ok(feed.children.length > 0, 'Alert must be prepended to feed');
      assert.match(feed.children[0].textContent, /T03.*PIN: 1003.*DEVTOOLS/);
    });

    it('3.4 Phase-dependent control button enable/disable state machine', () => {
      loadQuizmasterController();

      // In LOBBY: btn-stage enabled, others disabled
      mockSocket.trigger('game:phase:change', { phase: 'LOBBY' });
      assert.strictEqual(doc.getElementById('btn-stage').disabled, false);
      assert.strictEqual(doc.getElementById('btn-start-timer').disabled, true);

      // In READING: btn-start-timer enabled
      mockSocket.trigger('game:phase:change', { phase: 'READING' });
      assert.strictEqual(doc.getElementById('btn-start-timer').disabled, false);

      // In COUNTDOWN: btn-pause-timer & btn-force-lock enabled
      mockSocket.trigger('game:phase:change', { phase: 'COUNTDOWN' });
      assert.strictEqual(doc.getElementById('btn-pause-timer').disabled, false);
      assert.strictEqual(doc.getElementById('btn-force-lock').disabled, false);

      // In LOCKED: btn-reveal enabled
      mockSocket.trigger('game:phase:change', { phase: 'LOCKED' });
      assert.strictEqual(doc.getElementById('btn-reveal').disabled, false);
    });

    it('3.5 Phase control button socket event emissions', () => {
      loadQuizmasterController();

      doc.getElementById('btn-start-timer').click();
      assert.strictEqual(mockSocket.getLastEmit('qm:timer:start') !== null, true);

      doc.getElementById('btn-pause-timer').click();
      assert.strictEqual(mockSocket.getLastEmit('qm:timer:pause') !== null, true);

      doc.getElementById('btn-resume-timer').click();
      assert.strictEqual(mockSocket.getLastEmit('qm:timer:resume') !== null, true);

      doc.getElementById('btn-force-lock').click();
      assert.strictEqual(mockSocket.getLastEmit('qm:force:lock') !== null, true);

      doc.getElementById('btn-reveal').click();
      assert.strictEqual(mockSocket.getLastEmit('qm:answer:reveal') !== null, true);

      doc.getElementById('btn-leaderboard').click();
      assert.strictEqual(mockSocket.getLastEmit('qm:leaderboard:show') !== null, true);

      doc.getElementById('btn-reset').click();
      assert.strictEqual(mockSocket.getLastEmit('qm:round:reset') !== null, true);
    });

    it('3.6 Manual score override input validation and socket emit', () => {
      loadQuizmasterController();

      const btnSubmit = doc.getElementById('btn-submit-override');
      const inputPin = doc.getElementById('override-pin');
      const inputScore = doc.getElementById('override-score');

      // 1. Missing PIN
      inputPin.value = '';
      inputScore.value = '5';
      btnSubmit.click();
      assert.strictEqual(alerts.length, 1);
      assert.match(alerts[0], /PIN is required/i);

      // 2. Negative score
      inputPin.value = '1005';
      inputScore.value = '-2';
      btnSubmit.click();
      assert.strictEqual(alerts.length, 2);
      assert.match(alerts[1], /non-negative/i);

      // 3. Valid score override
      mockSocket.emit = (event, data, ack) => {
        if (event === 'qm:score:override' && typeof ack === 'function') {
          ack({ success: true });
        }
      };
      inputScore.value = '10';
      btnSubmit.click();

      assert.strictEqual(doc.getElementById('override-modal').classList.contains('hidden'), true);
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 4: Projector Stage Display Controller (public/js/projector.js)
  // ---------------------------------------------------------------------------
  describe('Suite 4: Projector Stage Display Controller (public/js/projector.js)', () => {
    let doc;
    let win;
    let mockSocket;

    beforeEach(() => {
      doc = new MockDocument();
      mockSocket = new MockSocket();

      doc.register(new MockElement('section', 'stage-lobby'));
      doc.register(new MockElement('section', 'stage-question-card', 'hidden'));
      doc.register(new MockElement('section', 'stage-leaderboard', 'hidden'));

      doc.register(new MockElement('span', 'stage-round-name'));
      doc.register(new MockElement('span', 'stage-phase-pill'));
      doc.register(new MockElement('div', 'stage-timer'));

      doc.register(new MockElement('div', 'stage-question-text'));
      const snippet = new MockElement('pre', 'stage-code-snippet', 'hidden');
      snippet.appendChild(new MockElement('code'));
      doc.register(snippet);

      doc.register(new MockElement('div', 'stage-options-grid', 'hidden'));
      ['a', 'b', 'c', 'd'].forEach((l) => {
        doc.register(new MockElement('div', `stage-opt-${l}`));
        doc.register(new MockElement('span', `stage-text-${l}`));
      });

      doc.register(new MockElement('div', 'reveal-card', 'hidden'));
      doc.register(new MockElement('div', 'correct-answer-text'));
      doc.register(new MockElement('div', 'answer-explanation'));

      // Podium
      [1, 2, 3].forEach((rank) => {
        doc.register(new MockElement('div', `podium-name-${rank}`));
        doc.register(new MockElement('div', `podium-score-${rank}`));
      });

      doc.register(new MockElement('tbody', 'stage-roster-tbody'));
      doc.register(new MockElement('div', 'audio-unlock-banner'));
      doc.register(new MockElement('button', 'btn-audio-mute'));
      doc.register(new MockElement('input', 'audio-volume-slider'));

      win = {
        document: doc,
        window: null,
        io: () => mockSocket,
        QuizAudio: {
          init: () => {},
          resume: () => {},
          toggleMute: () => true,
          setVolume: () => {},
          playTick: () => {},
          playWarningTick: () => {},
          playLock: () => {},
          playPhaseChime: () => {},
          playCorrect: () => {},
          playFanfare: () => {}
        }
      };
      win.window = win;
    });

    function loadProjectorController() {
      const code = fs.readFileSync(path.join(ROOT_DIR, 'public/js/projector.js'), 'utf8');
      const sandbox = {
        window: win,
        document: doc,
        io: win.io,
        QuizAudio: win.QuizAudio,
        self: win,
        console
      };
      vm.createContext(sandbox);
      vm.runInContext(code, sandbox);
    }

    it('4.1 Stage arena section visibility switching across all 7 FSM phases', () => {
      loadProjectorController();

      // LOBBY
      mockSocket.trigger('game:phase:change', { phase: 'LOBBY' });
      assert.strictEqual(doc.getElementById('stage-lobby').classList.contains('hidden'), false);
      assert.strictEqual(doc.getElementById('stage-question-card').classList.contains('hidden'), true);

      // READING
      mockSocket.trigger('game:phase:change', { phase: 'READING' });
      assert.strictEqual(doc.getElementById('stage-lobby').classList.contains('hidden'), true);
      assert.strictEqual(doc.getElementById('stage-question-card').classList.contains('hidden'), false);

      // LEADERBOARD
      mockSocket.trigger('game:phase:change', { phase: 'LEADERBOARD' });
      assert.strictEqual(doc.getElementById('stage-leaderboard').classList.contains('hidden'), false);
      assert.strictEqual(doc.getElementById('stage-question-card').classList.contains('hidden'), true);
    });

    it('4.2 Question rendering (round badge, question text, code snippet, MCQ grid)', () => {
      loadProjectorController();

      mockSocket.trigger('game:phase:change', {
        phase: 'COUNTDOWN',
        state: {
          phase: 'COUNTDOWN',
          currentQuestion: {
            round: 'average',
            points: 2,
            question: 'Identify output:',
            code_snippet: 'console.log(typeof null);',
            type: 'MCQ',
            options: { A: 'null', B: 'object', C: 'undefined', D: 'number' }
          }
        }
      });

      assert.strictEqual(doc.getElementById('stage-round-name').textContent, 'AVERAGE • 2 POINTS');
      assert.strictEqual(doc.getElementById('stage-question-text').textContent, 'Identify output:');
      assert.strictEqual(doc.getElementById('stage-code-snippet').classList.contains('hidden'), false);
      assert.strictEqual(doc.getElementById('stage-options-grid').classList.contains('hidden'), false);
      assert.strictEqual(doc.getElementById('stage-text-b').textContent, 'object');
    });

    it('4.3 Answer dramatic reveal card & correct option highlighting', () => {
      loadProjectorController();

      // Stage question first
      mockSocket.trigger('game:phase:change', {
        phase: 'COUNTDOWN',
        state: {
          phase: 'COUNTDOWN',
          currentQuestion: {
            type: 'MCQ',
            correct_answer: 'B'
          }
        }
      });

      // Reveal
      mockSocket.trigger('game:answer:reveal', {
        correctAnswer: 'B',
        explanation: 'In JavaScript, typeof null returns object.'
      });

      assert.strictEqual(doc.getElementById('reveal-card').classList.contains('hidden'), false);
      assert.strictEqual(doc.getElementById('correct-answer-text').textContent, 'B');
      assert.strictEqual(doc.getElementById('stage-opt-b').classList.contains('correct'), true);
      assert.strictEqual(doc.getElementById('stage-opt-a').classList.contains('dimmed'), true);
    });

    it('4.4 Leaderboard podium (top-3) and table roster for ranks 4+', () => {
      loadProjectorController();

      const leaderboardData = [
        { terminalNumber: 1, fullName: 'Gold Winner', totalScore: 25 },
        { terminalNumber: 2, fullName: 'Silver Medal', totalScore: 22 },
        { terminalNumber: 3, fullName: 'Bronze Medal', totalScore: 19 },
        { terminalNumber: 4, fullName: 'Rank 4 Student', totalScore: 15, department: 'CS' },
        { terminalNumber: 5, fullName: 'Rank 5 Student', totalScore: 12, department: 'IT' }
      ];

      mockSocket.trigger('leaderboard:update', { leaderboard: leaderboardData });

      assert.strictEqual(doc.getElementById('podium-name-1').textContent, 'Gold Winner');
      assert.strictEqual(doc.getElementById('podium-score-1').textContent, '25 PTS');
      assert.strictEqual(doc.getElementById('podium-name-2').textContent, 'Silver Medal');
      assert.strictEqual(doc.getElementById('podium-name-3').textContent, 'Bronze Medal');

      const tbody = doc.getElementById('stage-roster-tbody');
      assert.strictEqual(tbody.children.length, 2, 'Roster must contain 2 entries for ranks 4 and 5');
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 5: Judge Evaluation Panel Controller (public/js/judge.js)
  // ---------------------------------------------------------------------------
  describe('Suite 5: Judge Evaluation Panel Controller (public/js/judge.js)', () => {
    let doc;
    let win;
    let mockSocket;
    let alerts;

    beforeEach(() => {
      doc = new MockDocument();
      mockSocket = new MockSocket();
      alerts = [];

      doc.register(new MockElement('span', 'judge-status-dot'));
      doc.register(new MockElement('span', 'judge-status-text'));
      doc.register(new MockElement('button', 'btn-refresh-queue'));
      doc.register(new MockElement('span', 'pending-count'));
      doc.register(new MockElement('span', 'resolved-count-badge'));
      doc.register(new MockElement('div', 'judge-queue'));
      doc.register(new MockElement('div', 'empty-queue'));
      doc.register(new MockElement('div', 'resolved-queue'));

      win = {
        document: doc,
        window: null,
        io: () => mockSocket,
        alert: (msg) => alerts.push(msg)
      };
      win.window = win;
    });

    function loadJudgeController() {
      const code = fs.readFileSync(path.join(ROOT_DIR, 'public/js/judge.js'), 'utf8');
      const sandbox = {
        window: win,
        document: doc,
        io: win.io,
        alert: win.alert,
        self: win,
        console
      };
      vm.createContext(sandbox);
      vm.runInContext(code, sandbox);
    }

    it('5.1 Dispute queue synchronization and card creation', () => {
      loadJudgeController();

      mockSocket.trigger('judge:init', {
        success: true,
        pendingDisputes: [
          {
            submissionId: 101,
            terminalNumber: 4,
            fullName: 'John Doe',
            pin: '1004',
            questionText: 'What protocol does LAN Quiz Bee use?',
            correctAnswer: 'WebSocket',
            submittedAnswer: 'web sockets',
            acceptableSynonyms: ['ws', 'sockets'],
            maxPoints: 2
          }
        ]
      });

      const queue = doc.getElementById('judge-queue');
      assert.strictEqual(doc.getElementById('empty-queue').classList.contains('hidden'), true);
      assert.strictEqual(doc.getElementById('pending-count').textContent, '1 Pending');

      const card = doc.getElementById('dispute-101');
      assert.ok(card, 'Card dispute-101 must exist');
      assert.match(card.textContent, /John Doe/);
      assert.match(card.textContent, /web sockets/);
    });

    it('5.2 Acceptable synonyms parsing (handles array and JSON string representations)', () => {
      loadJudgeController();

      mockSocket.trigger('judge:dispute:new', {
        submissionId: 102,
        terminalNumber: 7,
        fullName: 'Jane Doe',
        correctAnswer: 'RAM',
        submittedAnswer: 'random access memory',
        acceptableSynonyms: JSON.stringify(['main memory', 'primary storage'])
      });

      const card = doc.getElementById('dispute-102');
      assert.ok(card);
      assert.match(card.textContent, /main memory/);
      assert.match(card.textContent, /primary storage/);
    });

    it('5.3 1-Click Approve action: emits judge:dispute:action (APPROVED) and updates resolved queue', () => {
      loadJudgeController();

      mockSocket.trigger('judge:dispute:new', {
        submissionId: 105,
        terminalNumber: 8,
        fullName: 'Mark Cruz',
        submittedAnswer: 'OOP',
        correctAnswer: 'Object Oriented Programming',
        maxPoints: 3
      });

      mockSocket.emit = (event, data, ack) => {
        if (event === 'judge:dispute:action' && typeof ack === 'function') {
          ack({ success: true });
        }
      };

      const card = doc.getElementById('dispute-105');
      const btnApprove = card.querySelector('.btn-approve');
      btnApprove.click();

      const emit = mockSocket.getLastEmit('judge:dispute:action');
      assert.ok(emit, 'Must emit judge:dispute:action');
      assert.strictEqual(emit.data.submissionId, 105);
      assert.strictEqual(emit.data.status, 'APPROVED');
      assert.strictEqual(emit.data.points, 3);
    });

    it('5.4 1-Click Reject action: emits judge:dispute:action (REJECTED, 0 pts)', () => {
      loadJudgeController();

      mockSocket.trigger('judge:dispute:new', {
        submissionId: 106,
        terminalNumber: 9,
        fullName: 'Pedro Gil',
        submittedAnswer: 'completely wrong answer',
        correctAnswer: 'Compiler',
        maxPoints: 2
      });

      mockSocket.emit = (event, data, ack) => {
        if (event === 'judge:dispute:action' && typeof ack === 'function') {
          ack({ success: true });
        }
      };

      const card = doc.getElementById('dispute-106');
      const btnReject = card.querySelector('.btn-reject');
      btnReject.click();

      const emit = mockSocket.getLastEmit('judge:dispute:action');
      assert.ok(emit);
      assert.strictEqual(emit.data.submissionId, 106);
      assert.strictEqual(emit.data.status, 'REJECTED');
      assert.strictEqual(emit.data.points, 0);
    });

    it('5.5 Inbound dispute resolution sync (judge:dispute:resolved by peer judge)', () => {
      loadJudgeController();

      mockSocket.trigger('judge:dispute:new', {
        submissionId: 108,
        terminalNumber: 12,
        fullName: 'Peer Contestant',
        submittedAnswer: 'python',
        correctAnswer: 'Python'
      });

      assert.strictEqual(doc.getElementById('judge-queue').children.length > 0, true);

      // Resolved by another judge in computer lab
      mockSocket.trigger('judge:dispute:resolved', {
        submissionId: 108,
        status: 'APPROVED',
        awardedPoints: 2
      });

      // Resolved card must be added to resolved queue
      const resolvedContainer = doc.getElementById('resolved-queue');
      assert.ok(resolvedContainer.children.length > 0);
      assert.match(resolvedContainer.children[0].textContent, /APPROVED \(\+2 PTS\)/);
    });

    it('5.6 HTML sanitization / XSS immunity in dispute card rendering', () => {
      loadJudgeController();

      mockSocket.trigger('judge:dispute:new', {
        submissionId: 110,
        terminalNumber: 15,
        fullName: '<script>alert("pwn")</script>',
        questionText: '<img src=x onerror=alert(1)>',
        submittedAnswer: '"><script>alert(2)</script>',
        correctAnswer: '<b>test</b>'
      });

      const card = doc.getElementById('dispute-110');
      assert.ok(card);
      // Raw HTML tags must NOT be present unescaped
      assert.strictEqual(card.innerHTML.includes('<script>'), false);
      assert.strictEqual(card.innerHTML.includes('<img src=x'), false);
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 6: Zero-CDN and Offline Asset Compliance
  // ---------------------------------------------------------------------------
  describe('Suite 6: Zero-CDN and Offline Asset Compliance', () => {
    const publicDir = path.join(ROOT_DIR, 'public');

    it('6.1 Zero-CDN audit across all HTML views', () => {
      const htmlFiles = fs.readdirSync(publicDir).filter((f) => f.endsWith('.html'));
      assert.ok(htmlFiles.length >= 5, 'Must contain at least 5 HTML views');

      const cdnRegex = /https?:\/\/(cdn|cdnjs|unpkg|fonts\.googleapis|ajax\.googleapis)/i;

      htmlFiles.forEach((file) => {
        const content = fs.readFileSync(path.join(publicDir, file), 'utf8');
        assert.doesNotMatch(content, cdnRegex, `${file} must contain zero external CDN references`);
      });
    });

    it('6.2 Zero-CDN audit across CSS stylesheets', () => {
      const cssDir = path.join(publicDir, 'css');
      const cssFiles = fs.readdirSync(cssDir).filter((f) => f.endsWith('.css'));
      assert.ok(cssFiles.length >= 5, 'Must contain at least 5 CSS stylesheets');

      const cdnRegex = /https?:\/\/(cdn|cdnjs|unpkg|fonts\.googleapis|ajax\.googleapis)/i;

      cssFiles.forEach((file) => {
        const content = fs.readFileSync(path.join(cssDir, file), 'utf8');
        assert.doesNotMatch(content, cdnRegex, `CSS ${file} must contain zero external CDN references`);
      });
    });

    it('6.3 Zero-CDN audit across client JS modules', () => {
      const jsDir = path.join(publicDir, 'js');
      const jsFiles = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js'));
      assert.ok(jsFiles.length >= 5, 'Must contain at least 5 client JS files');

      const cdnRegex = /https?:\/\/(cdn|cdnjs|unpkg|fonts\.googleapis|ajax\.googleapis)/i;

      jsFiles.forEach((file) => {
        const content = fs.readFileSync(path.join(jsDir, file), 'utf8');
        assert.doesNotMatch(content, cdnRegex, `JS ${file} must contain zero external CDN references`);
      });
    });

    it('6.4 Verified local font stacks and inline SVGs', () => {
      const sharedCss = fs.readFileSync(path.join(publicDir, 'css/shared.css'), 'utf8');
      assert.match(sharedCss, /--font-sans:/, 'Shared CSS must define system font stacks');
      assert.match(sharedCss, /system-ui|-apple-system|Segoe UI/, 'Shared CSS must use local system fonts');
      assert.doesNotMatch(sharedCss, /@import\s+url\(["']?https?:\/\//i, 'Shared CSS must not import remote fonts');
    });
  });
});
