/**
 * tests/challenge_m3_ui.test.js
 * Empirical Challenge Verification Suite for Milestone 3 UI Deliverables
 *
 * Verifies:
 * 1. Zero-CDN compliance across all HTML, CSS, and JS files (strict regex audit)
 * 2. Static view and asset resolution via live Express HTTP server (status 200, text/html, text/css, text/javascript)
 * 3. Complete DOM element, ID, class, form, button assertion matrix for all 5 views
 * 4. JS-to-HTML DOM selector contract consistency (no missing IDs targeted by client JS)
 * 5. Relative link and asset reference integrity
 * 6. Web Audio Synthesizer interface and boundary validation
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const CSS_DIR = path.join(PUBLIC_DIR, 'css');
const JS_DIR = path.join(PUBLIC_DIR, 'js');

const { startServer, stopServer } = require('../src/server');

const TEST_PORT = 3288;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function fetchResponse(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE_URL}${urlPath}`, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    }).on('error', reject);
  });
}

// ============================================================================
// Suite 1: Zero-CDN Compliance & Asset Self-Sufficiency
// ============================================================================
describe('Milestone 3 Challenge Suite 1: Zero-CDN Compliance & Asset Self-Sufficiency', () => {
  const CDN_REGEX = /https?:\/\/(cdn|cdnjs|unpkg|fonts\.googleapis|jsdelivr|maxcdn|bootstrap|tailwindcss|font-awesome)/i;
  const EXTERNAL_URL_REGEX = /https?:\/\//i;

  const htmlFiles = ['index.html', 'quizmaster.html', 'contestant.html', 'projector.html', 'judge.html'];
  const cssFiles = ['shared.css', 'quizmaster.css', 'contestant.css', 'projector.css', 'judge.css'];
  const jsFiles = ['audio.js', 'quizmaster.js', 'contestant.js', 'projector.js', 'judge.js'];

  for (const file of htmlFiles) {
    it(`HTML file ${file} exists and contains zero external CDN dependencies`, () => {
      const filePath = path.join(PUBLIC_DIR, file);
      assert.ok(fs.existsSync(filePath), `${file} must exist`);
      const content = fs.readFileSync(filePath, 'utf-8');
      assert.doesNotMatch(content, CDN_REGEX, `${file} must not reference any external CDN`);
      assert.doesNotMatch(content, EXTERNAL_URL_REGEX, `${file} must not contain any external http/https URLs`);
    });
  }

  for (const file of cssFiles) {
    it(`CSS file ${file} exists and contains zero external imports or remote URLs`, () => {
      const filePath = path.join(CSS_DIR, file);
      assert.ok(fs.existsSync(filePath), `${file} must exist`);
      const content = fs.readFileSync(filePath, 'utf-8');
      assert.doesNotMatch(content, CDN_REGEX, `${file} must not reference any external CDN`);
      assert.doesNotMatch(content, /@import\s+['"]?https?:/i, `${file} must not @import remote resources`);
      assert.doesNotMatch(content, /url\(\s*['"]?https?:/i, `${file} must not load remote assets via url()`);
    });
  }

  for (const file of jsFiles) {
    it(`JS file ${file} exists and contains zero external CDN references`, () => {
      const filePath = path.join(JS_DIR, file);
      assert.ok(fs.existsSync(filePath), `${file} must exist`);
      const content = fs.readFileSync(filePath, 'utf-8');
      assert.doesNotMatch(content, CDN_REGEX, `${file} must not reference external CDNs`);
    });
  }

  it('All HTML views reference local Socket.io bundle at /socket.io/socket.io.js', () => {
    const viewsWithSocket = ['quizmaster.html', 'contestant.html', 'projector.html', 'judge.html'];
    for (const view of viewsWithSocket) {
      const content = fs.readFileSync(path.join(PUBLIC_DIR, view), 'utf-8');
      assert.ok(
        content.includes('src="/socket.io/socket.io.js"'),
        `${view} must link to local /socket.io/socket.io.js`
      );
    }
  });

  it('No HTML file has broken stylesheet or script references', () => {
    for (const view of htmlFiles) {
      const content = fs.readFileSync(path.join(PUBLIC_DIR, view), 'utf-8');
      // Extract <link rel="stylesheet" href="...">
      const linkMatches = [...content.matchAll(/<link[^>]+href="([^"]+)"/g)];
      for (const match of linkMatches) {
        const href = match[1];
        if (href.startsWith('/css/')) {
          const localPath = path.join(PUBLIC_DIR, href);
          assert.ok(fs.existsSync(localPath), `${view} links to non-existent stylesheet: ${href}`);
        }
      }

      // Extract <script src="...">
      const scriptMatches = [...content.matchAll(/<script[^>]+src="([^"]+)"/g)];
      for (const match of scriptMatches) {
        const src = match[1];
        if (src.startsWith('/js/')) {
          const localPath = path.join(PUBLIC_DIR, src);
          assert.ok(fs.existsSync(localPath), `${view} links to non-existent script: ${src}`);
        } else if (src === '/socket.io/socket.io.js') {
          // Handled dynamically by Socket.io engine
          assert.ok(true);
        } else {
          assert.fail(`Unexpected script src in ${view}: ${src}`);
        }
      }
    }
  });
});

// ============================================================================
// Suite 2: Express HTTP Live Serving & Content-Type Headers
// ============================================================================
describe('Milestone 3 Challenge Suite 2: Express HTTP Live Serving & Header Contracts', () => {
  before(async () => {
    await startServer(TEST_PORT);
  });

  after(async () => {
    await stopServer();
  });

  const routes = [
    { path: '/', titleCheck: 'Landing Hub', selectorCheck: 'role-grid' },
    { path: '/quizmaster', titleCheck: 'Quizmaster', selectorCheck: 'telemetry-grid' },
    { path: '/contestant', titleCheck: 'Contestant', selectorCheck: 'pin-input' },
    { path: '/projector', titleCheck: 'Projector', selectorCheck: 'stage-container' },
    { path: '/judge', titleCheck: 'Judge', selectorCheck: 'judge-queue' }
  ];

  for (const route of routes) {
    it(`GET ${route.path} responds with 200, Content-Type text/html, and proper body`, async () => {
      const res = await fetchResponse(route.path);
      assert.equal(res.statusCode, 200, `Route ${route.path} must return status 200`);
      assert.ok(
        res.headers['content-type'] && res.headers['content-type'].includes('text/html'),
        `Route ${route.path} Content-Type must be text/html (got ${res.headers['content-type']})`
      );
      assert.ok(res.body.includes('OLFU IT Olympics'), `Route ${route.path} must embed OLFU branding`);
      assert.ok(res.body.includes(route.titleCheck), `Route ${route.path} must contain ${route.titleCheck}`);
      assert.ok(res.body.includes(route.selectorCheck), `Route ${route.path} must contain ${route.selectorCheck}`);
    });
  }

  const staticAssets = [
    { path: '/css/shared.css', mime: 'text/css' },
    { path: '/css/quizmaster.css', mime: 'text/css' },
    { path: '/css/contestant.css', mime: 'text/css' },
    { path: '/css/projector.css', mime: 'text/css' },
    { path: '/css/judge.css', mime: 'text/css' },
    { path: '/js/audio.js', mime: 'javascript' },
    { path: '/js/quizmaster.js', mime: 'javascript' },
    { path: '/js/contestant.js', mime: 'javascript' },
    { path: '/js/projector.js', mime: 'javascript' },
    { path: '/js/judge.js', mime: 'javascript' },
    { path: '/socket.io/socket.io.js', mime: 'javascript' }
  ];

  for (const asset of staticAssets) {
    it(`GET ${asset.path} responds with status 200 and expected Content-Type`, async () => {
      const res = await fetchResponse(asset.path);
      assert.equal(res.statusCode, 200, `Asset ${asset.path} must return status 200`);
      assert.ok(
        res.headers['content-type'] && res.headers['content-type'].includes(asset.mime),
        `Asset ${asset.path} Content-Type must include ${asset.mime} (got ${res.headers['content-type']})`
      );
      assert.ok(res.body.length > 50, `Asset ${asset.path} must not be empty`);
    });
  }
});

// ============================================================================
// Suite 3: DOM Assertions Matrix Across All 5 Role Views
// ============================================================================
describe('Milestone 3 Challenge Suite 3: DOM Assertions Matrix Across All 5 Views', () => {

  it('3.1 Landing Hub (index.html) contains navigation links for all 4 roles', () => {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf-8');
    assert.ok(html.includes('href="/quizmaster"'), 'Must link to /quizmaster');
    assert.ok(html.includes('href="/contestant"'), 'Must link to /contestant');
    assert.ok(html.includes('href="/projector"'), 'Must link to /projector');
    assert.ok(html.includes('href="/judge"'), 'Must link to /judge');
    assert.ok(html.includes('role-card'), 'Must contain role-card classes');
  });

  it('3.2 Quizmaster Dashboard (quizmaster.html) contains all required controls, timers, and telemetry elements', () => {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, 'quizmaster.html'), 'utf-8');

    // Timer & Phase Controls
    const requiredIds = [
      'qm-connection-dot',
      'qm-connection-status',
      'current-phase-badge',
      'timer-display',
      'timer-status-hint',
      'btn-stage',
      'btn-start-timer',
      'btn-pause-timer',
      'btn-resume-timer',
      'btn-force-lock',
      'btn-reveal',
      'btn-leaderboard',
      'btn-reset',
      // Question Selector
      'question-select',
      'question-count-badge',
      'current-question-card',
      'preview-round-badge',
      'preview-points-badge',
      'preview-question-text',
      'preview-code-block',
      'preview-code-content',
      'preview-options-container',
      // Security Alerts & Feed
      'alert-feed',
      'btn-clear-alerts',
      // Telemetry Grid & Counters
      'telemetry-grid',
      'stat-online',
      'stat-offline',
      'stat-incidents',
      'submission-count',
      // Manual Score Override Modal
      'override-modal',
      'btn-open-override',
      'btn-close-override',
      'btn-cancel-override',
      'btn-submit-override',
      'override-pin',
      'override-score',
      'override-reason',
      // Audio controls
      'btn-audio-mute',
      'audio-volume-slider'
    ];

    for (const id of requiredIds) {
      assert.ok(
        html.includes(`id="${id}"`),
        `Quizmaster Dashboard is missing required DOM element id="${id}"`
      );
    }
  });

  it('3.3 Contestant Terminal (contestant.html) contains PIN keypad, active station, MCQ, and ID form elements', () => {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, 'contestant.html'), 'utf-8');

    const requiredIds = [
      'login-section',
      'pin-input',
      'btn-login',
      'login-error',
      'active-section',
      'terminal-dot',
      'terminal-status-text',
      'terminal-number-badge',
      'contestant-name',
      'contestant-dept',
      'current-score',
      'phase-label',
      'timer-bar',
      'timer-value',
      'question-section',
      'round-badge',
      'point-badge',
      'question-text',
      'code-snippet',
      'code-content',
      'reading-lock',
      'submission-status',
      'mcq-container',
      'opt-a',
      'opt-b',
      'opt-c',
      'opt-d',
      'text-opt-a',
      'text-opt-b',
      'text-opt-c',
      'text-opt-d',
      'id-container',
      'answer-input',
      'btn-submit-answer',
      'fullscreen-warning',
      'btn-reenter-fullscreen',
      'btn-audio-mute',
      'audio-volume-slider'
    ];

    for (const id of requiredIds) {
      assert.ok(
        html.includes(`id="${id}"`),
        `Contestant Terminal is missing required DOM element id="${id}"`
      );
    }

    // Keypad numeric keys
    const keypadKeys = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', 'backspace'];
    for (const key of keypadKeys) {
      assert.ok(
        html.includes(`data-key="${key}"`),
        `Contestant keypad missing data-key="${key}"`
      );
    }
  });

  it('3.4 Stage Projector (projector.html) contains 1080p container, animated timer, code block, reveal card, and podium', () => {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, 'projector.html'), 'utf-8');

    const requiredIds = [
      'stage-container',
      'stage-round-name',
      'audio-unlock-banner',
      'btn-audio-mute',
      'audio-volume-slider',
      'stage-lobby',
      'stage-question-card',
      'stage-phase-pill',
      'stage-timer',
      'stage-question-text',
      'stage-code-snippet',
      'stage-options-grid',
      'stage-opt-a',
      'stage-opt-b',
      'stage-opt-c',
      'stage-opt-d',
      'stage-text-a',
      'stage-text-b',
      'stage-text-c',
      'stage-text-d',
      'reveal-card',
      'correct-answer-text',
      'answer-explanation',
      'stage-leaderboard',
      'podium-container',
      'podium-name-1',
      'podium-score-1',
      'podium-name-2',
      'podium-score-2',
      'podium-name-3',
      'podium-score-3',
      'stage-roster-table',
      'stage-roster-tbody'
    ];

    for (const id of requiredIds) {
      assert.ok(
        html.includes(`id="${id}"`),
        `Stage Projector is missing required DOM element id="${id}"`
      );
    }
  });

  it('3.5 Judge Panel (judge.html) contains refresh button, dispute queue, empty placeholder, and resolved log', () => {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, 'judge.html'), 'utf-8');

    const requiredIds = [
      'judge-status-dot',
      'judge-status-text',
      'btn-refresh-queue',
      'pending-count',
      'judge-queue',
      'empty-queue',
      'resolved-queue',
      'resolved-count-badge'
    ];

    for (const id of requiredIds) {
      assert.ok(
        html.includes(`id="${id}"`),
        `Judge Panel is missing required DOM element id="${id}"`
      );
    }
  });
});

// ============================================================================
// Suite 4: JS-to-HTML DOM Selector Contract Integrity
// ============================================================================
describe('Milestone 3 Challenge Suite 4: JS-to-HTML DOM Selector Contract Integrity', () => {
  const pairings = [
    { js: 'quizmaster.js', html: 'quizmaster.html' },
    { js: 'contestant.js', html: 'contestant.html' },
    { js: 'projector.js', html: 'projector.html' },
    { js: 'judge.js', html: 'judge.html' }
  ];

  for (const pair of pairings) {
    it(`Every document.getElementById in ${pair.js} exists in ${pair.html}`, () => {
      const jsCode = fs.readFileSync(path.join(JS_DIR, pair.js), 'utf-8');
      const htmlCode = fs.readFileSync(path.join(PUBLIC_DIR, pair.html), 'utf-8');

      // Extract all getElementById strings: document.getElementById('...') or document.getElementById("...")
      const regex = /document\.getElementById\(['"]([a-zA-Z0-9_-]+)['"]\)/g;
      const matches = [...jsCode.matchAll(regex)];

      const missing = [];
      for (const match of matches) {
        const id = match[1];
        if (!htmlCode.includes(`id="${id}"`) && !htmlCode.includes(`id='${id}'`)) {
          missing.push(id);
        }
      }

      assert.deepEqual(
        missing,
        [],
        `${pair.js} targets DOM IDs that do not exist in ${pair.html}: ${missing.join(', ')}`
      );
    });
  }
});

// ============================================================================
// Suite 5: Web Audio Procedural Synthesizer Unit Verification
// ============================================================================
describe('Milestone 3 Challenge Suite 5: Web Audio Synthesizer Interface Validation', () => {
  const QuizAudio = require('../public/js/audio.js');

  it('QuizAudio singleton exists and exposes all procedural sound synthesis methods', () => {
    assert.ok(QuizAudio, 'QuizAudio module must export an instance');

    const expectedMethods = [
      'init',
      'resume',
      'setVolume',
      'toggleMute',
      'setMuted',
      'playTick',
      'playWarningTick',
      'playLock',
      'playPhaseChime',
      'playCorrect',
      'playIncorrect',
      'playFanfare',
      'playAlert'
    ];

    for (const method of expectedMethods) {
      assert.equal(
        typeof QuizAudio[method],
        'function',
        `QuizAudio must define method ${method}()`
      );
    }
  });

  it('Volume and mute controllers enforce strict boundary limits', () => {
    QuizAudio.setVolume(0.5);
    assert.equal(QuizAudio.volume, 0.5);

    QuizAudio.setVolume(1.5); // Clamped to 1.0
    assert.equal(QuizAudio.volume, 1.0);

    QuizAudio.setVolume(-0.5); // Clamped to 0.0
    assert.equal(QuizAudio.volume, 0.0);

    QuizAudio.setMuted(true);
    assert.equal(QuizAudio.isMuted, true);

    const toggled = QuizAudio.toggleMute();
    assert.equal(toggled, false);
    assert.equal(QuizAudio.isMuted, false);
  });

  it('Sound methods execute safely without errors in non-browser Node environment', () => {
    // Calling procedural sound methods when AudioContext is null should safely return without throwing
    assert.doesNotThrow(() => QuizAudio.playTick());
    assert.doesNotThrow(() => QuizAudio.playWarningTick());
    assert.doesNotThrow(() => QuizAudio.playLock());
    assert.doesNotThrow(() => QuizAudio.playPhaseChime());
    assert.doesNotThrow(() => QuizAudio.playCorrect());
    assert.doesNotThrow(() => QuizAudio.playIncorrect());
    assert.doesNotThrow(() => QuizAudio.playFanfare());
    assert.doesNotThrow(() => QuizAudio.playAlert());
  });
});
