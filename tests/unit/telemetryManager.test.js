/**
 * Unit Tests: TelemetryManager (src/telemetryManager.js)
 * OLFU IT Olympics LAN Quiz Bee System (ITPM 311)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const TelemetryManager = require('../../src/telemetryManager');
const dbMod = require('../../src/db');
const { createTempDbPath, cleanupDb } = require('../harness');

describe('TelemetryManager Unit Tests', () => {
  it('1. Initializes 60 terminals with correct PINs (1001-1060) and default state', () => {
    const tm = new TelemetryManager({ totalTerminals: 60, pinStart: 1001 });
    const snapshot = tm.getSnapshot();

    assert.equal(snapshot.terminals.length, 60);
    assert.equal(snapshot.summary.total, 60);
    assert.equal(snapshot.summary.online, 0);
    assert.equal(snapshot.summary.offline, 60);
    assert.equal(snapshot.summary.totalIncidents, 0);

    const first = snapshot.terminals[0];
    assert.equal(first.terminalNumber, 1);
    assert.equal(first.pin, '1001');
    assert.equal(first.status, 'OFFLINE');
    assert.equal(first.score, 0);

    const last = snapshot.terminals[59];
    assert.equal(last.terminalNumber, 60);
    assert.equal(last.pin, '1060');
    assert.equal(last.status, 'OFFLINE');
  });

  it('2. handleConnect and handleDisconnect update presence and emit presence:change', () => {
    const tm = new TelemetryManager({ totalTerminals: 10 });
    const events = [];

    tm.on('presence:change', (e) => events.push(e));

    const conn = tm.handleConnect('1002', 'socket_abc', '192.168.1.15');
    assert.ok(conn);
    assert.equal(conn.status, 'ONLINE');
    assert.equal(conn.socketId, 'socket_abc');
    assert.equal(conn.ipAddress, '192.168.1.15');
    assert.ok(conn.connectedAt > 0);

    let snap = tm.getSnapshot();
    assert.equal(snap.summary.online, 1);
    assert.equal(snap.summary.offline, 9);

    // Disconnect with wrong socketId should NOT set offline
    tm.handleDisconnect('1002', 'socket_other');
    assert.equal(tm.terminals.get('1002').status, 'ONLINE');

    // Disconnect with correct socketId sets offline
    const disconn = tm.handleDisconnect('1002', 'socket_abc');
    assert.equal(disconn.status, 'OFFLINE');
    assert.equal(disconn.socketId, null);
    assert.ok(disconn.disconnectedAt > 0);

    snap = tm.getSnapshot();
    assert.equal(snap.summary.online, 0);
    assert.equal(snap.summary.offline, 10);

    assert.equal(events.length, 2);
    assert.equal(events[0].status, 'ONLINE');
    assert.equal(events[1].status, 'OFFLINE');
  });

  it('3. recordPing updates latency and lastSeenAt', () => {
    const tm = new TelemetryManager({ totalTerminals: 5 });
    tm.recordPing('1003', 12.4);

    const term = tm.terminals.get('1003');
    assert.equal(term.lastPingMs, 12);
    assert.ok(term.lastSeenAt > 0);
  });

  it('4. updateScore updates score for workstation', () => {
    const tm = new TelemetryManager({ totalTerminals: 5 });
    tm.updateScore('1004', 15);

    const term = tm.terminals.get('1004');
    assert.equal(term.score, 15);
  });

  it('5. ingestIncident accepts valid types and rejects unknown types / PINs', () => {
    const tm = new TelemetryManager({ totalTerminals: 5 });

    // Unknown PIN
    const r1 = tm.ingestIncident({ pin: '9999', type: 'BLUR' });
    assert.equal(r1.accepted, false);
    assert.equal(r1.reason, 'INVALID_OR_UNKNOWN_PIN');

    // Unknown incident type
    const r2 = tm.ingestIncident({ pin: '1001', type: 'MALICIOUS_CHEAT' });
    assert.equal(r2.accepted, false);
    assert.equal(r2.reason, 'UNSUPPORTED_INCIDENT_TYPE');

    // Valid incident
    const r3 = tm.ingestIncident({ pin: '1001', type: 'FULLSCREEN_EXIT', details: 'Esc key' });
    assert.equal(r3.accepted, true);
    assert.equal(r3.throttled, false);
    assert.ok(r3.alert);
    assert.equal(r3.alert.pin, '1001');
    assert.equal(r3.alert.terminalNumber, 1);
    assert.equal(r3.alert.incidentType, 'FULLSCREEN_EXIT');
    assert.equal(r3.alert.type, 'FULLSCREEN_EXIT');
    assert.equal(r3.alert.totalIncidents, 1);
    assert.equal(r3.alert.breakdown.FULLSCREEN_EXIT, 1);
  });

  it('6. ingestIncident debounces rapid incidents within 1.5s window', () => {
    const tm = new TelemetryManager({ totalTerminals: 5, debounceMs: 1500 });
    const alerts = [];
    tm.on('incident:alert', (a) => alerts.push(a));

    const t0 = 10000;
    // 1st incident at t0 -> accepted
    const r1 = tm.ingestIncident({ pin: '1001', type: 'BLUR', timestamp: t0 });
    assert.equal(r1.accepted, true);

    // Burst at t0 + 200ms -> throttled
    const r2 = tm.ingestIncident({ pin: '1001', type: 'BLUR', timestamp: t0 + 200 });
    assert.equal(r2.accepted, false);
    assert.equal(r2.throttled, true);
    assert.equal(r2.reason, 'THROTTLED_BY_DEBOUNCE_WINDOW');

    // Burst at t0 + 1400ms -> throttled
    const r3 = tm.ingestIncident({ pin: '1001', type: 'BLUR', timestamp: t0 + 1400 });
    assert.equal(r3.accepted, false);
    assert.equal(r3.throttled, true);

    // Different incident type at t0 + 500ms -> accepted (independent debounce key)
    const r4 = tm.ingestIncident({ pin: '1001', type: 'FULLSCREEN_EXIT', timestamp: t0 + 500 });
    assert.equal(r4.accepted, true);

    // Different PIN at t0 + 600ms -> accepted (independent debounce key)
    const r5 = tm.ingestIncident({ pin: '1002', type: 'BLUR', timestamp: t0 + 600 });
    assert.equal(r5.accepted, true);

    // Incident after debounce window (t0 + 1500ms) -> accepted
    const r6 = tm.ingestIncident({ pin: '1001', type: 'BLUR', timestamp: t0 + 1500 });
    assert.equal(r6.accepted, true);

    assert.equal(alerts.length, 4); // r1, r4, r5, r6
  });

  it('7. ingestIncident persists to SQLite CHEAT_LOGS when db is provided', () => {
    const tempDb = createTempDbPath('tm_cheat_logs');
    try {
      dbMod.initDb(tempDb);
      const tm = new TelemetryManager({ db: dbMod, totalTerminals: 5 });

      const res = tm.ingestIncident({
        pin: '1001',
        type: 'WINDOW_BLUR',
        details: 'User switched window'
      });
      assert.equal(res.accepted, true);

      const logs = dbMod.getIncidentLogs(1);
      assert.ok(logs.length >= 1);
      assert.equal(logs[0].incident_type, 'BLUR');
      assert.equal(logs[0].details, 'User switched window');
    } finally {
      dbMod.closeDb();
      cleanupDb(tempDb);
    }
  });

  it('8. resetSubmissions and markSubmitted track per-question submission status', () => {
    const tm = new TelemetryManager({ totalTerminals: 3 });
    tm.markSubmitted('1001');
    tm.markSubmitted('1002');

    assert.equal(tm.terminals.get('1001').hasSubmitted, true);
    assert.equal(tm.terminals.get('1002').hasSubmitted, true);
    assert.equal(tm.terminals.get('1003').hasSubmitted, false);

    tm.resetSubmissions();
    assert.equal(tm.terminals.get('1001').hasSubmitted, false);
    assert.equal(tm.terminals.get('1002').hasSubmitted, false);
  });

  it('9. ingestIncident prevents negative delta lockout from future timestamp poisoning', () => {
    const tm = new TelemetryManager({ totalTerminals: 3, debounceMs: 1500 });

    // Ingest incident with future timestamp (attacker injection)
    const futureTime = Date.now() + 31536000000;
    const r1 = tm.ingestIncident({ pin: '1001', type: 'BLUR', timestamp: futureTime });
    assert.equal(r1.accepted, true, 'First incident should be accepted');

    // Debounce timestamp was clamped to serverNow
    const savedTime = tm.debounceMap.get('1001:BLUR');
    assert.ok(savedTime <= Date.now(), 'Debounce timestamp must be clamped to serverNow');

    // An incident with negative delta (earlier than savedTime) is NOT throttled
    const r2 = tm.ingestIncident({ pin: '1001', type: 'BLUR', timestamp: savedTime - 100 });
    assert.equal(r2.accepted, true, 'Negative delta incident must not be throttled by debounce window');
  });
});
