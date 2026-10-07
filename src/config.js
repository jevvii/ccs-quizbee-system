/**
 * src/config.js - Authoritative System Configuration & LAN Detection
 * OLFU IT Olympics LAN Quiz Bee System (ITPM 311)
 */

const os = require('os');

/**
 * Auto-detect primary non-internal IPv4 LAN address
 * Prefers common private LAN subnets (192.168.x.x, 10.x.x.x, 172.16-31.x.x).
 * @returns {string} Detected IPv4 address or '127.0.0.1' fallback
 */
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(interfaces)) {
    const netList = interfaces[name] || [];
    for (const net of netList) {
      const family = typeof net.family === 'string' ? net.family : `IPv${net.family}`;
      if (family === 'IPv4' && !net.internal) {
        // Prioritize wlan/eth/en/wl interfaces
        const isLan = net.address.startsWith('192.168.') ||
                      net.address.startsWith('10.') ||
                      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(net.address);
        candidates.push({ address: net.address, isLan, interface: name });
      }
    }
  }

  const preferred = candidates.find(c => c.isLan) || candidates[0];
  return preferred ? preferred.address : '127.0.0.1';
}

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || getLocalIpAddress();

// Tournament Timing & Scoring Constants
const TIMING = Object.freeze({
  GRACE_WINDOW_MS: 300,        // LAN packet latency allowance
  TICK_INTERVAL_MS: 1000,      // Timer broadcast heartbeat interval
  DEBOUNCE_INCIDENT_MS: 1000,  // Anti-cheat incident throttle window
  ROUNDS: Object.freeze({
    Easy: { timerSeconds: 15, points: 1, sequence: 1 },
    Average: { timerSeconds: 30, points: 2, sequence: 2 },
    Difficult: { timerSeconds: 45, points: 3, sequence: 3 },
    Clincher: { timerSeconds: 30, points: 5, sequence: 4 }
  })
});

// Database Pragmas & Configuration
const DB_CONFIG = Object.freeze({
  DEFAULT_PATH: 'quizbee.db',
  PRAGMAS: [
    'PRAGMA journal_mode = WAL;',
    'PRAGMA synchronous = NORMAL;',
    'PRAGMA foreign_keys = ON;',
    'PRAGMA busy_timeout = 5000;'
  ]
});

// Workstation Terminal PIN range (Computer Lab 1 to 60)
const TERMINAL_CONFIG = Object.freeze({
  TOTAL_TERMINALS: 60,
  PIN_START: 1001,
  PIN_END: 1060
});

module.exports = {
  PORT,
  HOST,
  TIMING,
  DB_CONFIG,
  TERMINAL_CONFIG,
  getLocalIpAddress
};
