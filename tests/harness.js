/**
 * Test Harness & Utilities: OLFU IT Olympics LAN Quiz Bee System
 * Provides fixture generation, module resolution, DB isolation, and network helpers.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { EventEmitter } = require('node:events');

const ROOT_DIR = path.resolve(__dirname, '..');
const CSV_PATH = path.join(ROOT_DIR, 'sample_questions.csv');
const DOCS_DIR = path.join(ROOT_DIR, 'docs');

/**
 * Safely resolve and require a module from the project root.
 * Returns null if the module does not exist or fails to load.
 */
function loadModule(relativePath) {
  const fullPath = path.join(ROOT_DIR, relativePath);
  if (!fs.existsSync(fullPath)) {
    return null;
  }
  try {
    delete require.cache[require.resolve(fullPath)];
    return require(fullPath);
  } catch (err) {
    return null;
  }
}

/**
 * Check if a file exists relative to the project root.
 */
function fileExists(relativePath) {
  return fs.existsSync(path.join(ROOT_DIR, relativePath));
}

/**
 * Creates an isolated temporary SQLite database path.
 */
function createTempDbPath(prefix = 'quizbee_test') {
  const rand = Math.random().toString(36).substring(2, 8);
  const dbPath = path.join(os.tmpdir(), `${prefix}_${Date.now()}_${rand}.db`);
  return dbPath;
}

/**
 * Cleans up a temporary SQLite database and its WAL / SHM files.
 */
function cleanupDb(dbPath) {
  if (!dbPath) return;
  for (const ext of ['', '-wal', '-shm']) {
    const file = `${dbPath}${ext}`;
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (_) {}
  }
}

/**
 * Authoritative RFC-4180 CSV parser for expected output derivation.
 */
function parseCsvSync(content) {
  const lines = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        row.push(field);
        field = '';
      } else if (char === '\r') {
        // ignore CR
      } else if (char === '\n') {
        row.push(field);
        lines.push(row);
        row = [];
        field = '';
      } else {
        field += char;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    lines.push(row);
  }
  return lines;
}

/**
 * Specification Reference Oracle: Parse Semicolon Synonyms
 */
function parseSynonyms(synonymsStr) {
  if (!synonymsStr || typeof synonymsStr !== 'string') return [];
  return synonymsStr
    .split(';')
    .map(s => s.trim().toLowerCase())
    .filter(s => s.length > 0);
}

/**
 * Specification Reference Oracle: Evaluate Answer
 */
function evaluateAnswerSpec({ type, submittedAnswer, correctAnswer, synonymsStr }) {
  if (type === 'MCQ') {
    const isCorrect = String(submittedAnswer).trim().toUpperCase() === String(correctAnswer).trim().toUpperCase();
    return {
      isCorrect,
      judgeStatus: 'AUTO'
    };
  }

  // IDENTIFICATION
  const cleaned = String(submittedAnswer || '').trim().toLowerCase();
  if (!cleaned) {
    return { isCorrect: false, judgeStatus: 'AUTO' };
  }

  const target = String(correctAnswer || '').trim().toLowerCase();
  const syns = parseSynonyms(synonymsStr);

  if (cleaned === target || syns.includes(cleaned)) {
    return { isCorrect: true, judgeStatus: 'AUTO' };
  }

  // Non-matching identification answer enters Judge Queue
  return { isCorrect: false, judgeStatus: 'PENDING' };
}

/**
 * Check if HTTP server is responding on a given port
 */
async function checkHttp(port, pathName = '/') {
  return new Promise((resolve) => {
    const req = http.get({
      hostname: '127.0.0.1',
      port,
      path: pathName,
      timeout: 1000
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body: data });
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * In-memory / Mock WebSocket Socket for contract testing if server is offline
 */
class MockSocket extends EventEmitter {
  constructor(id) {
    super();
    this.id = id || `mock_socket_${Math.random().toString(36).slice(2, 8)}`;
    this.rooms = new Set();
    this.connected = true;
  }

  join(room) {
    this.rooms.add(room);
  }

  leave(room) {
    this.rooms.delete(room);
  }

  emit(event, ...args) {
    super.emit(event, ...args);
  }

  disconnect() {
    this.connected = false;
    this.emit('disconnect');
  }
}

module.exports = {
  ROOT_DIR,
  CSV_PATH,
  DOCS_DIR,
  loadModule,
  fileExists,
  createTempDbPath,
  cleanupDb,
  parseCsvSync,
  parseSynonyms,
  evaluateAnswerSpec,
  checkHttp,
  MockSocket
};
