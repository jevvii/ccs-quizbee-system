/**
 * src/server.js - Express & Socket.io Real-Time Server Bootstrap
 * OLFU IT Olympics LAN Quiz Bee Management System (ITPM 311)
 *
 * Coordinates:
 * - Express HTTP server & Socket.io WebSocket server on 0.0.0.0:3000
 * - Zero-CDN offline static asset hosting for public/
 * - /socket.io/socket.io.js local client bundle delivery
 * - REST monitoring endpoints (/api/health, /api/status, /api/questions, /api/telemetry, /api/leaderboard, /api/contestants)
 * - LAN auto-detection and startup banner
 * - Clean graceful shutdown (SIGINT / SIGTERM)
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { Server } = require('socket.io');

const config = require('./config');
const db = require('./db');
const GameEngine = require('./gameEngine');
const SocketHandler = require('./socketHandler');
const TelemetryManager = require('./telemetryManager');
const { importQuestionsFromContent } = require('./csvImporter');

const PORT = config.PORT || 3000;
const HOST = '0.0.0.0';
const LAN_IP = config.getLocalIpAddress();

// Initialize Express
const app = express();
const server = http.createServer(app);

// Initialize Authoritative Database
let dbInstance = null;
try {
  dbInstance = db.initDb();
} catch (_) {
  // If db already initialized or in test environment, continue
}

// Initialize Authoritative State Machine
const gameEngine = new GameEngine({
  graceWindowMs: config.TIMING?.GRACE_WINDOW_MS || 300,
  tickIntervalMs: config.TIMING?.TICK_INTERVAL_MS || 1000
});

// Initialize Socket.io Server with offline client delivery
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingInterval: 10000,
  pingTimeout: 5000,
  serveClient: true // Natively serves /socket.io/socket.io.js offline
});

// Initialize Telemetry Engine
const telemetryManager = new TelemetryManager({
  db,
  debounceMs: 1500,
  totalTerminals: config.TERMINAL_CONFIG?.TOTAL_TERMINALS || 60,
  pinStart: config.TERMINAL_CONFIG?.PIN_START || 1001
});

// Wire Socket Gateway
let socketHandler = null;
if (typeof SocketHandler === 'function') {
  socketHandler = new SocketHandler(io, gameEngine, db, telemetryManager);
} else if (SocketHandler && typeof SocketHandler.initSocketHandler === 'function') {
  socketHandler = SocketHandler.initSocketHandler(io, gameEngine, db, telemetryManager);
}

// -----------------------------------------------------------------------------
// Middleware Configuration
// -----------------------------------------------------------------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Permissive CORS headers for computer lab subnet
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Role');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Static assets directory
const publicDir = path.resolve(__dirname, '../public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

// -----------------------------------------------------------------------------
// View Route Handlers (Zero-CDN)
// -----------------------------------------------------------------------------
function serveView(res, fileName, title) {
  const filePath = path.join(publicDir, fileName);
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  // Fallback before Milestone 3 static HTML views land
  res.status(200).send(`
    <!DOCTYPE html>
    <html lang="en">
    <head><meta charset="UTF-8"><title>${title}</title></head>
    <body style="font-family:sans-serif; background:#0f172a; color:#f8fafc; padding:2rem; text-align:center;">
      <h1>OLFU IT Olympics Quiz Bee — ${title}</h1>
      <p>Interface template scheduled for Milestone 3 delivery.</p>
      <p>Server Status: Operational on LAN ${LAN_IP}:${PORT}</p>
    </body>
    </html>
  `);
}

app.get('/', (req, res) => serveView(res, 'index.html', 'Landing Hub'));
app.get('/quizmaster', (req, res) => serveView(res, 'quizmaster.html', 'Quizmaster Dashboard'));
app.get('/contestant', (req, res) => serveView(res, 'contestant.html', 'Contestant Terminal'));
app.get('/projector', (req, res) => serveView(res, 'projector.html', 'Stage Projector Display'));
app.get('/judge', (req, res) => serveView(res, 'judge.html', 'Judge Validation Panel'));

// -----------------------------------------------------------------------------
// REST API Endpoints
// -----------------------------------------------------------------------------

/**
 * GET /api/health - Fast server health & memory telemetry
 */
app.get('/api/health', (req, res) => {
  const mem = process.memoryUsage();
  res.json({
    status: 'healthy',
    service: 'fatima-quizbee-engine',
    timestamp: Date.now(),
    uptime: Math.round(process.uptime() * 10) / 10,
    database: {
      connected: true,
      mode: 'WAL'
    },
    memory: {
      rssMb: Math.round(mem.rss / 1024 / 1024 * 10) / 10,
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024 * 10) / 10
    }
  });
});

/**
 * Helper: Sanitize Question Data for Public / Contestant Endpoints
 */
function sanitizeQuestion(q) {
  if (!q) return null;
  const { correct_answer, acceptable_synonyms_json, synonyms, ...safeQuestion } = q;
  return safeQuestion;
}

/**
 * GET /api/status - Comprehensive tournament & operational status
 */
app.get('/api/status', (req, res) => {
  const gameState = gameEngine.getState();
  const telemetrySnapshot = telemetryManager.getSnapshot();

  const roleHeader = (req.headers['x-role'] || '').toLowerCase();
  const authHeader = (req.headers['authorization'] || '').toLowerCase();
  const roleQuery = (req.query.role || '').toLowerCase();
  const isAuthorized = roleHeader === 'quizmaster' ||
                       authHeader === 'bearer quizmaster' ||
                       roleQuery === 'quizmaster';

  const allowAnswer = isAuthorized || gameState.phase === 'REVEAL' || gameState.phase === 'LEADERBOARD';

  const currentQuestion = allowAnswer
    ? gameState.currentQuestion
    : sanitizeQuestion(gameState.currentQuestion);

  res.json({
    status: 'operational',
    game: {
      phase: gameState.phase,
      roundId: gameState.roundId,
      currentQuestion,
      timer: gameState.timer
    },
    telemetry: {
      totalTerminals: telemetrySnapshot.summary.total,
      onlineTerminals: telemetrySnapshot.summary.online,
      offlineTerminals: telemetrySnapshot.summary.offline,
      activeSockets: io.engine.clientsCount || 0,
      totalCheatIncidents: telemetrySnapshot.summary.totalIncidents
    },
    network: {
      lanIp: LAN_IP,
      port: PORT,
      lanUrl: `http://${LAN_IP}:${PORT}`
    }
  });
});

/**
 * GET /api/questions - Fetch question bank, optionally filtered by round
 */
app.get('/api/questions', (req, res) => {
  try {
    const roundId = req.query.roundId ? parseInt(req.query.roundId, 10) : undefined;
    const questions = db.getAllQuestions(roundId);

    const roleHeader = (req.headers['x-role'] || '').toLowerCase();
    const authHeader = (req.headers['authorization'] || '').toLowerCase();
    const roleQuery = (req.query.role || '').toLowerCase();
    const isAuthorized = roleHeader === 'quizmaster' ||
                         authHeader === 'bearer quizmaster' ||
                         roleQuery === 'quizmaster';

    const outputQuestions = questions.map(q => {
      if (isAuthorized) return q;
      return sanitizeQuestion(q);
    });

    res.json({
      success: true,
      count: outputQuestions.length,
      questions: outputQuestions
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/questions/template - Download question bank CSV template
 */
app.get('/api/questions/template', (req, res) => {
  try {
    const templatePath = path.join(__dirname, '..', 'sample_trial_questions.csv');
    let csvData = '';
    if (fs.existsSync(templatePath)) {
      csvData = fs.readFileSync(templatePath, 'utf8');
    } else {
      csvData = 'round,type,question,code_snippet,option_a,option_b,option_c,option_d,correct_answer,synonyms,points,timer_seconds\n' +
        'Trial,MCQ,"[WARM-UP / TRIAL] Sample trial question?","","Option A","Option B","Option C","Option D",B,,0,15\n' +
        'Easy,MCQ,"Sample easy question?","","A","B","C","D",A,,1,15\n' +
        'Average,IDENTIFICATION,"Sample average question?","","","","","",Answer,"answer;synonym",2,30\n';
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="quizbee_question_template.csv"');
    res.status(200).send(csvData);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/questions/import - Import questions from CSV string (Quizmaster only)
 */
app.post('/api/questions/import', (req, res) => {
  try {
    const roleHeader = (req.headers['x-role'] || '').toLowerCase();
    const authHeader = (req.headers['authorization'] || '').toLowerCase();
    const roleQuery = (req.query.role || '').toLowerCase();
    const isAuthorized = roleHeader === 'quizmaster' ||
                         authHeader === 'bearer quizmaster' ||
                         roleQuery === 'quizmaster';

    if (!isAuthorized) {
      return res.status(403).json({ success: false, error: 'Unauthorized: Quizmaster role required.' });
    }

    const { csvContent, mode } = req.body || {};
    if (!csvContent || typeof csvContent !== 'string') {
      return res.status(400).json({ success: false, error: 'Missing or invalid csvContent in request body.' });
    }

    const currentDb = db.getDb();
    const result = importQuestionsFromContent(csvContent, currentDb, { mode: mode || 'replace' });

    // Notify connected Quizmaster screens to refresh question list
    io.to('room:quizmaster').emit('qm:questions:updated', {
      count: result.importedCount,
      timestamp: Date.now()
    });

    res.json({
      success: result.success,
      importedCount: result.importedCount,
      errors: result.errors
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/tournament/reset-scores - Wipe submissions and reset contestant scores to 0 (Quizmaster only)
 */
app.post('/api/tournament/reset-scores', (req, res) => {
  try {
    const roleHeader = (req.headers['x-role'] || '').toLowerCase();
    const authHeader = (req.headers['authorization'] || '').toLowerCase();
    const roleQuery = (req.query.role || '').toLowerCase();
    const isAuthorized = roleHeader === 'quizmaster' ||
                         authHeader === 'bearer quizmaster' ||
                         roleQuery === 'quizmaster';

    if (!isAuthorized) {
      return res.status(403).json({ success: false, error: 'Unauthorized: Quizmaster role required.' });
    }

    db.resetTournamentScores();

    // Broadcast updated zeroed leaderboard & telemetry to all connected clients
    const freshLeaderboard = db.getLeaderboard();
    io.emit('leaderboard:update', { leaderboard: freshLeaderboard });
    io.to('room:quizmaster').emit('qm:telemetry:summary', telemetryManager.getSnapshot().summary);

    res.json({ success: true, message: 'Tournament scores reset to 0.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/telemetry - Live 60-workstation telemetry snapshot
 */
app.get('/api/telemetry', (req, res) => {
  res.json(telemetryManager.getSnapshot());
});

/**
 * GET /api/leaderboard - Real-time leaderboard standings
 */
app.get('/api/leaderboard', (req, res) => {
  try {
    const roundId = req.query.roundId ? parseInt(req.query.roundId, 10) : undefined;
    const leaderboard = db.getLeaderboard(roundId);
    res.json({
      success: true,
      count: leaderboard.length,
      leaderboard
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/contestants - Contestant roster
 */
app.get('/api/contestants', (req, res) => {
  try {
    const contestants = db.getAllContestants();
    res.json({
      success: true,
      count: contestants.length,
      contestants
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -----------------------------------------------------------------------------
// Terminal Startup Banner
// -----------------------------------------------------------------------------
function printStartupBanner(portToPrint = PORT) {
  console.log('========================================================================');
  console.log('   OLFU IT OLYMPICS LAN QUIZ BEE MANAGEMENT SYSTEM (ITPM 311)          ');
  console.log('   "Fatima QuizBee Engine" — Authoritative Offline LAN Gateway          ');
  console.log('========================================================================');
  console.log(` LAN Host IP:        ${LAN_IP}`);
  console.log(` Binding Address:    ${HOST}:${portToPrint}`);
  console.log(` Database:           quizbee.db (SQLite WAL Mode)`);
  console.log(` Workstation Range:  Terminals 1–60 (PIN 1001–1060)`);
  console.log('------------------------------------------------------------------------');
  console.log(' Role Interface URLs:');
  console.log(`   • Landing Hub:        http://${LAN_IP}:${portToPrint}/`);
  console.log(`   • Quizmaster:         http://${LAN_IP}:${portToPrint}/quizmaster`);
  console.log(`   • Contestant PCs:     http://${LAN_IP}:${portToPrint}/contestant`);
  console.log(`   • Stage Projector:    http://${LAN_IP}:${portToPrint}/projector`);
  console.log(`   • Judge Panel:        http://${LAN_IP}:${portToPrint}/judge`);
  console.log('------------------------------------------------------------------------');
  console.log(' API Telemetry & Monitoring:');
  console.log(`   • Health Probe:       http://${LAN_IP}:${portToPrint}/api/health`);
  console.log(`   • Engine Status:      http://${LAN_IP}:${portToPrint}/api/status`);
  console.log(`   • Questions Bank:     http://${LAN_IP}:${portToPrint}/api/questions`);
  console.log(`   • Telemetry Grid:     http://${LAN_IP}:${portToPrint}/api/telemetry`);
  console.log('========================================================================');
}

// -----------------------------------------------------------------------------
// Lifecycle & Graceful Shutdown
// -----------------------------------------------------------------------------
let isShuttingDown = false;

function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[Server] Received ${signal}. Initiating graceful shutdown...`);

  const forceTimer = setTimeout(() => {
    console.error('[Server] Forced shutdown due to timeout.');
    process.exit(1);
  }, 3000);
  forceTimer.unref();

  io.emit('server:shutdown', {
    message: 'QuizBee Server is restarting or shutting down.',
    timestamp: Date.now()
  });

  server.close(() => {
    console.log('[Server] HTTP and WebSocket listener closed.');

    if (typeof gameEngine._clearTimers === 'function') {
      gameEngine._clearTimers();
    }

    try {
      db.closeDb();
      console.log('[Server] SQLite database connection closed safely.');
    } catch (_) {}

    clearTimeout(forceTimer);
    console.log('[Server] Shutdown complete. Goodbye.');
    process.exit(0);
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

/**
 * Start server listener
 * @param {number} [customPort]
 * @returns {Promise<http.Server>}
 */
function startServer(customPort = PORT) {
  return new Promise((resolve, reject) => {
    // Ensure DB is initialized
    try {
      if (typeof db.getDb !== 'function' || !db.getDb()) {
        db.initDb();
      }
    } catch (_) {}

    server.listen(customPort, HOST, (err) => {
      if (err) return reject(err);
      printStartupBanner(customPort);
      resolve(server);
    });
  });
}

/**
 * Stop server listener
 * @returns {Promise<void>}
 */
function stopServer() {
  return new Promise((resolve) => {
    if (typeof gameEngine._clearTimers === 'function') {
      gameEngine._clearTimers();
    }
    io.close(() => {
      server.close(() => {
        try {
          db.closeDb();
        } catch (_) {}
        resolve();
      });
    });
  });
}

// Auto-start when executed directly from CLI
if (require.main === module) {
  startServer().catch((err) => {
    console.error('[Server] Failed to bind port:', err);
    process.exit(1);
  });
}

module.exports = {
  app,
  server,
  io,
  gameEngine,
  db,
  telemetryManager,
  socketHandler,
  startServer,
  stopServer
};
