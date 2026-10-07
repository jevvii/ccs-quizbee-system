/**
 * src/telemetryManager.js
 * Authoritative Live Telemetry & Anti-Cheat Ingestion Engine
 * OLFU IT Olympics LAN Quiz Bee System (ITPM 311)
 *
 * Maintains real-time state for all 60 lab workstations:
 * - Online / Offline socket presence
 * - Socket ID and IP address tracking
 * - NTP-lite round-trip ping latencies
 * - Debounced anti-cheat incident ingestion (max 1 event per 1.5s per type per contestant)
 * - SQLite CHEAT_LOGS persistence & Quizmaster grid telemetry broadcasting
 */

const { EventEmitter } = require('events');
const config = require('./config');

// Canonical incident types
const INCIDENT_TYPES = Object.freeze({
  WINDOW_BLUR: 'WINDOW_BLUR',
  BLUR: 'BLUR',
  TAB_SWITCH: 'TAB_SWITCH',
  FULLSCREEN_EXIT: 'FULLSCREEN_EXIT',
  COPY_ATTEMPT: 'COPY_ATTEMPT',
  PASTE_ATTEMPT: 'PASTE_ATTEMPT',
  DEVTOOLS: 'DEVTOOLS',
  KEY_SHORTCUT: 'KEY_SHORTCUT',
  UNAUTHORIZED_INPUT: 'UNAUTHORIZED_INPUT',
  SHORTCUT_BLOCKED: 'SHORTCUT_BLOCKED'
});

// Map incident types to SQLite CHEAT_LOGS CHECK constraint types:
// CHECK(incident_type IN ('FULLSCREEN_EXIT', 'BLUR', 'TAB_SWITCH', 'DEVTOOLS', 'KEY_SHORTCUT', 'UNAUTHORIZED_INPUT', 'SHORTCUT_BLOCKED'))
const DB_TYPE_MAP = Object.freeze({
  WINDOW_BLUR: 'BLUR',
  BLUR: 'BLUR',
  TAB_SWITCH: 'TAB_SWITCH',
  FULLSCREEN_EXIT: 'FULLSCREEN_EXIT',
  COPY_ATTEMPT: 'SHORTCUT_BLOCKED',
  PASTE_ATTEMPT: 'SHORTCUT_BLOCKED',
  DEVTOOLS: 'DEVTOOLS',
  KEY_SHORTCUT: 'KEY_SHORTCUT',
  UNAUTHORIZED_INPUT: 'UNAUTHORIZED_INPUT',
  SHORTCUT_BLOCKED: 'SHORTCUT_BLOCKED'
});

class TelemetryManager extends EventEmitter {
  /**
   * @param {Object} [options={}]
   * @param {Object} [options.db=null] - Authoritative SQLite database layer (src/db.js)
   * @param {number} [options.debounceMs=1500] - Incident debounce window (1.5s per specification)
   * @param {number} [options.totalTerminals=60] - Number of lab workstations
   * @param {number} [options.pinStart=1001] - Starting PIN
   */
  constructor(options = {}) {
    super();
    this.db = options.db || null;
    this.debounceMs = options.debounceMs !== undefined ? options.debounceMs : 1500;
    this.totalTerminals = options.totalTerminals || config.TERMINAL_CONFIG?.TOTAL_TERMINALS || 60;
    this.pinStart = options.pinStart || config.TERMINAL_CONFIG?.PIN_START || 1001;

    // Terminal state map keyed by PIN: Map<string, WorkstationState>
    this.terminals = new Map();

    // Secondary index: Map<terminalNumber, pin>
    this.terminalToPin = new Map();

    // Debounce tracker: Map<`${pin}:${type}`, lastTimestampMs>
    this.debounceMap = new Map();

    this._initializeTerminals();
  }

  /**
   * Initialize in-memory state for all 60 workstations from database (or defaults)
   * @private
   */
  _initializeTerminals() {
    let rows = [];
    try {
      if (this.db && typeof this.db.getAllContestants === 'function') {
        rows = this.db.getAllContestants() || [];
      }
    } catch (_) {
      rows = [];
    }

    for (let i = 1; i <= this.totalTerminals; i++) {
      const pin = String(this.pinStart + i - 1);
      const row = rows.find(r => String(r.pin) === pin) || {};

      const terminalState = {
        terminalNumber: i,
        pin,
        studentId: row.student_id || `2024-OLFU-${String(i).padStart(4, '0')}`,
        fullName: row.full_name || `Contestant ${String(i).padStart(2, '0')}`,
        department: row.department_or_section || 'BSIT',
        status: row.is_connected ? 'ONLINE' : 'OFFLINE',
        socketId: row.last_socket_id || null,
        ipAddress: null,
        connectedAt: null,
        disconnectedAt: null,
        lastPingMs: null,
        lastSeenAt: null,
        score: row.total_score || 0,
        incidentCount: 0,
        breakdown: {
          FULLSCREEN_EXIT: 0,
          WINDOW_BLUR: 0,
          TAB_SWITCH: 0,
          COPY_ATTEMPT: 0,
          PASTE_ATTEMPT: 0,
          OTHER: 0
        },
        recentIncidents: [],
        hasSubmitted: false
      };

      this.terminals.set(pin, terminalState);
      this.terminalToPin.set(i, pin);
    }

    this._rehydrateHistoricalIncidents();
  }

  /**
   * Rehydrate historical incident tallies from SQLite CHEAT_LOGS if available
   * @private
   */
  _rehydrateHistoricalIncidents() {
    if (!this.db) return;
    try {
      const dbInstance = typeof this.db.getDb === 'function' ? this.db.getDb() : null;
      if (!dbInstance) return;

      const incidentStats = dbInstance.prepare(`
        SELECT contestant_id, incident_type, COUNT(*) as count
        FROM CHEAT_LOGS
        GROUP BY contestant_id, incident_type
      `).all();

      for (const stat of incidentStats) {
        const contestant = typeof this.db.getContestantById === 'function'
          ? this.db.getContestantById(stat.contestant_id)
          : null;
        if (contestant && this.terminals.has(contestant.pin)) {
          const term = this.terminals.get(contestant.pin);
          term.incidentCount += stat.count;

          const cat = stat.incident_type === 'BLUR' ? 'WINDOW_BLUR' : stat.incident_type;
          if (term.breakdown[cat] !== undefined) {
            term.breakdown[cat] += stat.count;
          } else {
            term.breakdown.OTHER = (term.breakdown.OTHER || 0) + stat.count;
          }
        }
      }
    } catch (_) {
      // Table may be empty or uninitialized
    }
  }

  /**
   * Record workstation connection
   * @param {string} pin
   * @param {string} socketId
   * @param {string} [ipAddress=null]
   * @returns {Object|null} Updated terminal state
   */
  handleConnect(pin, socketId, ipAddress = null) {
    const term = this.terminals.get(String(pin));
    if (!term) return null;

    term.status = 'ONLINE';
    term.socketId = socketId;
    term.ipAddress = ipAddress;
    term.connectedAt = Date.now();
    term.lastSeenAt = Date.now();

    if (this.db && typeof this.db.updateContestantConnection === 'function') {
      try {
        this.db.updateContestantConnection(pin, true, socketId);
      } catch (_) {}
    }

    this.emit('presence:change', { pin, status: 'ONLINE', terminal: { ...term } });
    return { ...term };
  }

  /**
   * Record workstation disconnection
   * @param {string} pin
   * @param {string} socketId
   * @returns {Object|null} Updated terminal state
   */
  handleDisconnect(pin, socketId) {
    const term = this.terminals.get(String(pin));
    if (!term) return null;

    // Only set OFFLINE if disconnecting socket matches active socket or no active socket
    if (term.socketId === socketId || !term.socketId) {
      term.status = 'OFFLINE';
      term.disconnectedAt = Date.now();
      term.socketId = null;

      if (this.db && typeof this.db.updateContestantConnection === 'function') {
        try {
          this.db.updateContestantConnection(pin, false, null);
        } catch (_) {}
      }

      this.emit('presence:change', { pin, status: 'OFFLINE', terminal: { ...term } });
    }

    return { ...term };
  }

  /**
   * Update ping latency for workstation
   * @param {string} pin
   * @param {number} latencyMs
   */
  recordPing(pin, latencyMs) {
    const term = this.terminals.get(String(pin));
    if (!term) return;

    term.lastPingMs = Math.round(latencyMs);
    term.lastSeenAt = Date.now();
  }

  /**
   * Update contestant score in telemetry grid
   * @param {string} pin
   * @param {number} newScore
   */
  updateScore(pin, newScore) {
    const term = this.terminals.get(String(pin));
    if (term) {
      term.score = newScore;
    }
  }

  /**
   * Ingest and validate security incident from contestant terminal
   * Enforces 1.5s rate-limit/debounce per contestant per incident type
   *
   * @param {Object} payload
   * @param {string} payload.pin - Contestant PIN (1001-1060)
   * @param {string} payload.type - Incident type (WINDOW_BLUR, FULLSCREEN_EXIT, etc.)
   * @param {string} [payload.details=''] - Additional diagnostic details
   * @returns {{ accepted: boolean, throttled: boolean, reason?: string, alert?: Object }}
   */
  ingestIncident(payload = {}) {
    const pin = String(payload.pin || payload.terminalPin || '');
    const rawType = String(payload.type || payload.incidentType || '').toUpperCase().trim();
    const details = String(payload.details || '');

    // 1. Validate PIN
    const term = this.terminals.get(pin);
    if (!term) {
      return { accepted: false, throttled: false, reason: 'INVALID_OR_UNKNOWN_PIN' };
    }

    // 2. Validate Incident Type
    if (!rawType || !INCIDENT_TYPES[rawType]) {
      return { accepted: false, throttled: false, reason: 'UNSUPPORTED_INCIDENT_TYPE' };
    }

    // 3. Leading-Edge Debounce Guard (max 1 event per 1.5s per type per contestant)
    const serverNow = Date.now();
    let now = (typeof payload.timestamp === 'number' && Number.isFinite(payload.timestamp))
      ? payload.timestamp
      : serverNow;

    // Defense: Clamp future timestamps to current server time to prevent debounceMap poisoning
    if (now > serverNow) {
      now = serverNow;
    }

    const debounceKey = `${pin}:${rawType}`;
    const lastTimestamp = this.debounceMap.get(debounceKey) || 0;
    const delta = now - lastTimestamp;

    // Only throttle if delta is non-negative and falls within debounceMs window
    // (Prevents negative delta from locking out normal incidents)
    if (delta >= 0 && delta < this.debounceMs) {
      return {
        accepted: false,
        throttled: true,
        reason: 'THROTTLED_BY_DEBOUNCE_WINDOW',
        waitMs: this.debounceMs - delta
      };
    }

    // Update debounce timestamp
    this.debounceMap.set(debounceKey, now);

    // 4. Log to SQLite CHEAT_LOGS
    const dbType = DB_TYPE_MAP[rawType] || 'SHORTCUT_BLOCKED';
    if (this.db && typeof this.db.logIncident === 'function') {
      try {
        let contestantId = null;
        if (typeof this.db.getContestantByPin === 'function') {
          const contestant = this.db.getContestantByPin(pin);
          if (contestant) contestantId = contestant.id;
        }
        if (!contestantId) {
          contestantId = term.terminalNumber;
        }
        this.db.logIncident(contestantId, dbType, details);
      } catch (err) {
        // Log failure non-fatal to telemetry
      }
    }

    // 5. Update In-Memory Telemetry State
    term.incidentCount += 1;
    const cat = (rawType === 'BLUR' || rawType === 'WINDOW_BLUR') ? 'WINDOW_BLUR' : rawType;
    if (term.breakdown[cat] !== undefined) {
      term.breakdown[cat] += 1;
    } else {
      term.breakdown.OTHER = (term.breakdown.OTHER || 0) + 1;
    }

    const incidentRecord = {
      type: rawType,
      incidentType: rawType,
      timestamp: now,
      details
    };

    term.recentIncidents.unshift(incidentRecord);
    if (term.recentIncidents.length > 10) {
      term.recentIncidents.pop();
    }

    // 6. Formulate Outbound Alert Payload for Quizmaster
    const alert = {
      pin,
      terminalNumber: term.terminalNumber,
      studentId: term.studentId,
      fullName: term.fullName,
      incidentType: rawType,
      type: rawType,
      timestamp: now,
      details,
      totalIncidents: term.incidentCount,
      breakdown: { ...term.breakdown }
    };

    this.emit('incident:alert', alert);
    this.emit('terminal:update', { ...term });

    return { accepted: true, throttled: false, alert };
  }

  /**
   * Generate complete telemetry grid snapshot for Quizmaster dashboard
   * @returns {Object}
   */
  getSnapshot() {
    const list = Array.from(this.terminals.values()).sort((a, b) => a.terminalNumber - b.terminalNumber);
    const onlineCount = list.filter(t => t.status === 'ONLINE').length;
    const totalIncidents = list.reduce((sum, t) => sum + t.incidentCount, 0);

    return {
      terminals: list.map(t => ({ ...t })),
      summary: {
        total: this.totalTerminals,
        online: onlineCount,
        offline: this.totalTerminals - onlineCount,
        totalIncidents
      },
      timestamp: Date.now()
    };
  }

  /**
   * Reset question submission indicators on new round / question
   */
  resetSubmissions() {
    for (const term of this.terminals.values()) {
      term.hasSubmitted = false;
    }
  }

  /**
   * Mark contestant as having submitted active question
   * @param {string} pin
   */
  markSubmitted(pin) {
    const term = this.terminals.get(String(pin));
    if (term) {
      term.hasSubmitted = true;
    }
  }
}

TelemetryManager.INCIDENT_TYPES = INCIDENT_TYPES;
TelemetryManager.DB_TYPE_MAP = DB_TYPE_MAP;

module.exports = TelemetryManager;
