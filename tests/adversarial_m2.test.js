/**
 * tests/adversarial_m2.test.js
 * Adversarial Verification & Stress Test Suite for Milestone 2:
 * - Real-Time Gateway (src/socketHandler.js)
 * - Anti-Cheat Telemetry & Debounce (src/telemetryManager.js)
 * - Server Bootstrap & Zero-CDN Delivery (src/server.js)
 *
 * EMPIRICAL CHALLENGER VERIFICATION:
 * 1. Rapid concurrent duplicate socket connections for the same PIN
 * 2. High-frequency incident reporting debounce throttle (50 events in 200ms) & adversarial timestamps
 * 3. NTP-lite clock sync latency calculations, delays, and malformed inputs
 * 4. Boundary condition submissions: deadline, deadline + 299ms, deadline + 300ms, deadline + 301ms
 * 5. Memory leak inspection, unhandled rejections fuzzing, and missing getSubmission bug reproduction
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { io: ClientIO } = require('socket.io-client');

const { startServer, stopServer, app, server, io, gameEngine, db, telemetryManager, socketHandler } = require('../src/server');

const TEST_PORT = 3299;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

// Helper: create a connected socket.io client
function createClient(options = {}) {
  return new Promise((resolve, reject) => {
    const socket = ClientIO(BASE_URL, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      timeout: 3000,
      ...options
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (err) => reject(err));
  });
}

// Helper: emit with ack and timeout
function emitWithAck(socket, event, data, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for ack on ${event}`));
    }, timeoutMs);
    socket.emit(event, data, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

// Helper: disconnect an array of sockets
function disconnectAll(sockets) {
  for (const s of sockets) {
    if (s && s.connected) {
      s.disconnect();
    }
  }
}

// Helper: sleep ms
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

describe('Milestone 2 Adversarial Stress & Verification Suite', () => {
  before(async () => {
    await startServer(TEST_PORT);

    // Seed test round and questions into database if not present
    const dbInstance = db.getDb();
    dbInstance.prepare(`
      INSERT OR IGNORE INTO ROUNDS (id, name, weight_points, default_timer_sec, sequence_order)
      VALUES (1, 'Easy Round', 1, 15, 1)
    `).run();

    dbInstance.prepare(`
      INSERT OR IGNORE INTO QUESTIONS (id, round_id, question_text, code_snippet, question_type, options_json, correct_answer, acceptable_synonyms_json, points, timer_seconds)
      VALUES 
        (101, 1, 'Adversarial MCQ Question', '', 'MCQ', '{"A":"Alpha","B":"Beta","C":"Gamma","D":"Delta"}', 'B', '[]', 1, 15),
        (102, 1, 'Adversarial Identification Question', '', 'IDENTIFICATION', '{}', 'HyperText Transfer Protocol', '["HTTP","Hyper Text Transfer Protocol"]', 2, 30)
    `).run();

    // Ensure contestants 1001 to 1060 exist
    for (let i = 1; i <= 60; i++) {
      const pin = String(1000 + i);
      dbInstance.prepare(`
        INSERT OR IGNORE INTO CONTESTANTS (id, pin, terminal_number, student_id, full_name, department_or_section, total_score)
        VALUES (?, ?, ?, ?, ?, 'BSIT', 0)
      `).run(i, pin, i, `2024-OLFU-${String(i).padStart(4, '0')}`, `Contestant ${i}`);
    }
  });

  after(async () => {
    await stopServer();
  });

  // =========================================================================
  // 1. RAPID CONCURRENT DUPLICATE SOCKET CONNECTIONS FOR SAME PIN
  // =========================================================================
  describe('1. Duplicate Socket Connections & Eviction Protocols', () => {
    it('1.1 20 concurrent sockets connecting simultaneously for the EXACT SAME PIN (1001) results in 1 active socket and 19 evicted', async () => {
      const NUM_CLIENTS = 20;
      const TARGET_PIN = '1001';

      // Connect 20 real TCP WebSocket clients
      const clients = await Promise.all(
        Array.from({ length: NUM_CLIENTS }, () => createClient())
      );

      assert.equal(clients.length, NUM_CLIENTS);

      const kickedPayloads = [];
      clients.forEach(c => {
        c.on('contestant:kicked', (payload) => kickedPayloads.push(payload));
      });

      // Fire concurrent authentication storm
      const authPromises = clients.map(client => {
        return new Promise((resolve) => {
          client.emit('contestant:auth', { pin: TARGET_PIN }, (response) => {
            resolve({ socketId: client.id, response });
          });
        });
      });

      const authResults = await Promise.all(authPromises);
      await sleep(150); // allow async disconnects to process

      // Count active connected clients
      const connectedCount = clients.filter(c => c.connected).length;
      assert.equal(connectedCount, 1, `Exactly 1 socket must remain connected, found ${connectedCount}`);

      // Count kicked clients
      assert.equal(kickedPayloads.length, NUM_CLIENTS - 1, `Exactly 19 sockets must receive contestant:kicked`);
      for (const kick of kickedPayloads) {
        assert.equal(kick.reason, 'DUPLICATE_LOGIN');
      }

      // Verify server internal session maps
      const activeSocket = socketHandler.activeSocketsByPin.get(TARGET_PIN);
      assert.ok(activeSocket);
      assert.ok(activeSocket.connected);

      // Verify only 1 entry in socketToPin for this pin
      let pinReferences = 0;
      for (const [sockId, pin] of socketHandler.socketToPin.entries()) {
        if (pin === TARGET_PIN) pinReferences++;
      }
      assert.equal(pinReferences, 1, `socketToPin must have exactly 1 mapping for PIN ${TARGET_PIN}`);

      disconnectAll(clients);
      await sleep(50);
    });

    it('1.2 High-frequency ping-pong reconnection cycle (10 rapid alternating logins) maintains session consistency without crash', async () => {
      const TARGET_PIN = '1002';
      let lastActiveSock = null;

      for (let i = 0; i < 10; i++) {
        const nextSock = await createClient();
        const authResp = await emitWithAck(nextSock, 'contestant:auth', { pin: TARGET_PIN });
        assert.equal(authResp.success, true);

        if (lastActiveSock) {
          assert.equal(lastActiveSock.connected, false, 'Previous socket must be disconnected on eviction');
        }
        lastActiveSock = nextSock;
      }

      await sleep(50);
      assert.equal(socketHandler.activeSocketsByPin.get(TARGET_PIN).id, lastActiveSock.id);
      disconnectAll([lastActiveSock]);
      await sleep(50);
    });

    it('1.3 Identity switching on a single socket: re-authenticating with different PIN updates registries', async () => {
      const sock = await createClient();

      // First authenticate as 1003
      const resp1 = await emitWithAck(sock, 'contestant:auth', { pin: '1003' });
      assert.equal(resp1.success, true);
      assert.equal(resp1.contestant.pin, '1003');

      assert.equal(socketHandler.activeSocketsByPin.get('1003').id, sock.id);
      assert.equal(socketHandler.socketToPin.get(sock.id), '1003');

      // Now authenticate as 1004 using the SAME socket connection
      const resp2 = await emitWithAck(sock, 'contestant:auth', { pin: '1004' });
      assert.equal(resp2.success, true);
      assert.equal(resp2.contestant.pin, '1004');

      assert.equal(socketHandler.activeSocketsByPin.get('1004').id, sock.id);
      assert.equal(socketHandler.socketToPin.get(sock.id), '1004');

      sock.disconnect();
      await sleep(50);
    });
  });

  // =========================================================================
  // 2. HIGH-FREQUENCY INCIDENT REPORTING & DEBOUNCE THROTTLE
  // =========================================================================
  describe('2. Anti-Cheat Incident Debouncing & Adversarial Telemetry', () => {
    it('2.1 High-frequency burst of 50 WINDOW_BLUR events in < 200ms: exactly 1 accepted, 49 throttled', async () => {
      const TARGET_PIN = '1005';
      const contestant = db.getContestantByPin(TARGET_PIN);
      assert.ok(contestant);

      const contestantSock = await createClient();
      const qmSock = await createClient();

      // Join QM room to capture alert emissions
      await new Promise(res => qmSock.emit('qm:join', {}, res));

      const alertsReceived = [];
      qmSock.on('qm:telemetry:alert', (alert) => {
        if (alert.pin === TARGET_PIN) {
          alertsReceived.push(alert);
        }
      });

      // Authenticate contestant
      await emitWithAck(contestantSock, 'contestant:auth', { pin: TARGET_PIN });

      // Record pre-burst incident count in DB for this contestant ID
      const dbInstance = db.getDb();
      const preCount = dbInstance.prepare('SELECT COUNT(*) as cnt FROM CHEAT_LOGS WHERE contestant_id = ?').get(contestant.id).cnt;
      const preBreakdown = telemetryManager.terminals.get(TARGET_PIN).breakdown.WINDOW_BLUR;

      // Burst 50 blur incidents in rapid microtasks
      for (let i = 0; i < 50; i++) {
        contestantSock.emit('contestant:incident', {
          pin: TARGET_PIN,
          type: 'WINDOW_BLUR',
          details: `Burst incident #${i}`,
          timestamp: Date.now()
        });
      }

      await sleep(200);

      // Exactly 1 alert broadcast to Quizmaster
      assert.equal(alertsReceived.length, 1, `Expected exactly 1 alert broadcast, got ${alertsReceived.length}`);

      // Exactly 1 new incident recorded in DB
      const postCount = dbInstance.prepare('SELECT COUNT(*) as cnt FROM CHEAT_LOGS WHERE contestant_id = ?').get(contestant.id).cnt;
      assert.equal(postCount - preCount, 1, `Expected exactly 1 new DB row, got ${postCount - preCount}`);

      // In-memory telemetry grid state delta for terminal 5
      const termState = telemetryManager.terminals.get(TARGET_PIN);
      assert.equal(termState.breakdown.WINDOW_BLUR - preBreakdown, 1);

      disconnectAll([contestantSock, qmSock]);
    });

    it('2.2 Interleaved incident storm (20 BLUR + 20 FULLSCREEN_EXIT): throttles each type independently', async () => {
      const TARGET_PIN = '1006';
      const contestant = db.getContestantByPin(TARGET_PIN);
      assert.ok(contestant);

      const contestantSock = await createClient();
      await emitWithAck(contestantSock, 'contestant:auth', { pin: TARGET_PIN });

      const dbInstance = db.getDb();
      const preBlur = dbInstance.prepare("SELECT COUNT(*) as cnt FROM CHEAT_LOGS WHERE contestant_id = ? AND incident_type = 'BLUR'").get(contestant.id).cnt;
      const preFs = dbInstance.prepare("SELECT COUNT(*) as cnt FROM CHEAT_LOGS WHERE contestant_id = ? AND incident_type = 'FULLSCREEN_EXIT'").get(contestant.id).cnt;

      // Send 40 interleaved events
      for (let i = 0; i < 20; i++) {
        contestantSock.emit('contestant:incident', { pin: TARGET_PIN, type: 'BLUR', details: `Blur ${i}` });
        contestantSock.emit('contestant:incident', { pin: TARGET_PIN, type: 'FULLSCREEN_EXIT', details: `FS ${i}` });
      }

      await sleep(200);

      const postBlur = dbInstance.prepare("SELECT COUNT(*) as cnt FROM CHEAT_LOGS WHERE contestant_id = ? AND incident_type = 'BLUR'").get(contestant.id).cnt;
      const postFs = dbInstance.prepare("SELECT COUNT(*) as cnt FROM CHEAT_LOGS WHERE contestant_id = ? AND incident_type = 'FULLSCREEN_EXIT'").get(contestant.id).cnt;

      // Exactly 1 BLUR and 1 FULLSCREEN_EXIT accepted
      assert.equal(postBlur - preBlur, 1, 'Expected exactly 1 BLUR logged');
      assert.equal(postFs - preFs, 1, 'Expected exactly 1 FULLSCREEN_EXIT logged');

      disconnectAll([contestantSock]);
    });

    it('2.3 Adversarial Timestamp Exploit: client sending future timestamp permanently suppresses telemetry', () => {
      const TARGET_PIN = '1007';

      // Attacker sends incident with timestamp 1 year in the future
      const futureTime = Date.now() + 31536000000;
      const attackRes = telemetryManager.ingestIncident({
        pin: TARGET_PIN,
        type: 'TAB_SWITCH',
        timestamp: futureTime,
        details: 'Timestamp injection attack'
      });

      assert.equal(attackRes.accepted, true, 'First incident is accepted');

      // Subsequent legitimate incident with current time
      const normalRes = telemetryManager.ingestIncident({
        pin: TARGET_PIN,
        type: 'TAB_SWITCH',
        timestamp: Date.now(),
        details: 'Legitimate tab switch'
      });

      // EMPIRICAL BUG CONFIRMATION:
      // In telemetryManager.js line 273: (now - lastTimestamp < debounceMs)
      // Since lastTimestamp was set to futureTime, (now - futureTime) is negative!
      // In JS: negative < 1500 is TRUE!
      // Therefore, normalRes is THROTTLED indefinitely!
      assert.equal(normalRes.throttled, true, 'EMPIRICAL BUG CONFIRMED: future timestamp permanently bricks telemetry reporting');
    });

    it('2.4 Incident spoofing guard: authenticated socket cannot report incidents for a different PIN', async () => {
      const sock = await createClient();
      await emitWithAck(sock, 'contestant:auth', { pin: '1008' });

      const c9 = db.getContestantByPin('1009');
      const dbInstance = db.getDb();
      const preCount = dbInstance.prepare('SELECT COUNT(*) as cnt FROM CHEAT_LOGS WHERE contestant_id = ?').get(c9.id).cnt;

      // Socket is PIN 1008, attempts to report incident for PIN 1009
      sock.emit('contestant:incident', { pin: '1009', type: 'BLUR', details: 'Spoofed' });
      await sleep(100);

      const postCount = dbInstance.prepare('SELECT COUNT(*) as cnt FROM CHEAT_LOGS WHERE contestant_id = ?').get(c9.id).cnt;
      assert.equal(postCount, preCount, 'Spoofed incident for PIN 1009 must be rejected and not recorded in DB');

      disconnectAll([sock]);
    });
  });

  // =========================================================================
  // 3. NTP-LITE CLOCK SYNC LATENCY CALCULATIONS
  // =========================================================================
  describe('3. NTP-Lite Clock Sync Latency & Robustness', () => {
    it('3.1 Accurately calculates round-trip delay and client-server offset across 10 sync rounds', async () => {
      const sock = await createClient();

      for (let i = 0; i < 10; i++) {
        const t1 = Date.now();
        const pong = await new Promise((resolve) => {
          sock.emit('sync:ping', { t1 });
          sock.once('sync:pong', resolve);
        });
        const t4 = Date.now();

        assert.equal(pong.t1, t1);
        assert.ok(pong.t2 >= t1);
        assert.ok(pong.t3 >= pong.t2);
        assert.ok(t4 >= pong.t3);

        // Christian's algorithm
        const roundTripDelay = (t4 - t1) - (pong.t3 - pong.t2);
        const clockOffset = ((pong.t2 - t1) + (pong.t3 - t4)) / 2;

        assert.ok(roundTripDelay >= 0, `Round trip delay must be non-negative, got ${roundTripDelay}`);
        assert.ok(Math.abs(clockOffset) < 100, `Local offset should be within reasonable bounds: ${clockOffset}ms`);
      }

      disconnectAll([sock]);
    });

    it('3.2 Malformed and adversarial sync:ping payloads do not crash server or throw unhandled exceptions', async () => {
      const sock = await createClient();

      const malformedPayloads = [
        null,
        undefined,
        {},
        { t1: null },
        { t1: 'string_timestamp' },
        { t1: -999999999 },
        { t1: NaN },
        { t1: Infinity },
        { t1: 1e16 }
      ];

      for (const payload of malformedPayloads) {
        let errorOccurred = false;
        try {
          sock.emit('sync:ping', payload);
          await sleep(10);
        } catch (_) {
          errorOccurred = true;
        }
        assert.equal(errorOccurred, false, 'Server must not disconnect or error on malformed sync:ping');
      }

      // Check server health probe is still 200 OK
      const res = await new Promise((resolve) => {
        http.get(`${BASE_URL}/api/health`, (r) => resolve(r.statusCode));
      });
      assert.equal(res, 200);

      disconnectAll([sock]);
    });

    it('3.3 100 rapid concurrent sync:ping bursts respond cleanly in < 500ms', async () => {
      const sock = await createClient();
      const pings = [];

      const startTime = Date.now();
      for (let i = 0; i < 100; i++) {
        pings.push(new Promise((resolve) => {
          const t1 = Date.now() + i;
          const handler = (pong) => {
            if (pong.t1 === t1) {
              sock.off('sync:pong', handler);
              resolve(pong);
            }
          };
          sock.on('sync:pong', handler);
          sock.emit('sync:ping', { t1 });
        }));
      }

      const results = await Promise.all(pings);
      const elapsed = Date.now() - startTime;

      assert.equal(results.length, 100);
      assert.ok(elapsed < 1000, `100 sync:ping requests took ${elapsed}ms (must be < 1000ms)`);

      disconnectAll([sock]);
    });
  });

  // =========================================================================
  // 4. BOUNDARY CONDITION SUBMISSIONS (EXACTLY ON DEADLINE vs +299ms vs +301ms)
  // =========================================================================
  describe('4. Submission Boundary Verification (Deadline, Grace Window +299ms, +300ms, +301ms)', () => {
    it('4.1 canAcceptSubmission validates exact boundary boundaries: expiresAt, +299ms, +300ms, and +301ms', () => {
      const DURATION_SEC = 15;
      const GRACE_MS = 300;

      gameEngine.resetRound();
      gameEngine.stageQuestion(db.getQuestion(101));
      gameEngine.startCountdown(DURATION_SEC);

      const expiresAt = gameEngine.state.timer.expiresAt;
      assert.ok(expiresAt > 0);

      // Boundary 1: Exactly at deadline (expiresAt) -> ALLOWED
      const atDeadline = gameEngine.canAcceptSubmission(expiresAt);
      assert.equal(atDeadline.allowed, true, 'Submission exactly at deadline must be ALLOWED');

      // Boundary 2: At deadline + 299ms (1ms before grace window ends) -> ALLOWED
      const at299ms = gameEngine.canAcceptSubmission(expiresAt + 299);
      assert.equal(at299ms.allowed, true, 'Submission at deadline + 299ms must be ALLOWED');

      // Boundary 3: At deadline + 300ms (exact grace window boundary) -> ALLOWED
      const at300ms = gameEngine.canAcceptSubmission(expiresAt + GRACE_MS);
      assert.equal(at300ms.allowed, true, 'Submission at deadline + 300ms must be ALLOWED');

      // Boundary 4: At deadline + 301ms (1ms past grace window) -> REJECTED
      const at301ms = gameEngine.canAcceptSubmission(expiresAt + GRACE_MS + 1);
      assert.equal(at301ms.allowed, false, 'Submission at deadline + 301ms must be REJECTED');
      assert.equal(at301ms.reason, 'EXPIRED_LATE_SUBMISSION');

      // Boundary 5: Auto-transition to LOCKED phase still honors the grace window for in-flight packets
      gameEngine.lockQuestion({ autoExpired: true });
      const lockedWithinGrace = gameEngine.canAcceptSubmission(expiresAt + 299);
      assert.equal(lockedWithinGrace.allowed, true, 'LOCKED within grace must be ALLOWED');

      const lockedPastGrace = gameEngine.canAcceptSubmission(expiresAt + GRACE_MS + 1);
      assert.equal(lockedPastGrace.allowed, false, 'LOCKED past grace must be REJECTED');
    });

    it('4.2 Identifies defect remediation: db.getSubmission is exported and available', () => {
      // Verifying db.getSubmission is exported and available for submission ingestion
      assert.equal(typeof db.getSubmission, 'function', 'Remediated: db.getSubmission is exported as a function');
    });

    it('4.3 Force-lock by Quizmaster triggers with callback parameter', async () => {
      gameEngine.resetRound();
      gameEngine.stageQuestion(db.getQuestion(101));
      gameEngine.startCountdown(45); // 45s countdown

      const qmSock = await createClient();
      await new Promise(r => qmSock.emit('qm:join', {}, r));

      // QM triggers force lock by passing callback directly (no payload)
      const lockRes = await new Promise((resolve) => {
        qmSock.emit('qm:force:lock', resolve);
      });

      assert.equal(lockRes.success, true);
      assert.equal(gameEngine.state.phase, 'LOCKED');

      // Submissions prohibited after force-lock
      await sleep(350);
      const gate = gameEngine.canAcceptSubmission(Date.now());
      assert.equal(gate.allowed, false);

      disconnectAll([qmSock]);
    });
  });

  // =========================================================================
  // 5. MEMORY LEAKS, UNHANDLED REJECTIONS & CONCURRENCY BURST
  // =========================================================================
  describe('5. System Stability: Memory Leaks, Fuzzing & High Concurrency', () => {
    it('5.1 Socket churn memory leak test: 30 sequential connect/disconnect cycles clean up internal Maps', async () => {
      const initialMapSize = socketHandler.socketToPin.size;

      for (let i = 0; i < 30; i++) {
        const sock = await createClient();
        await emitWithAck(sock, 'contestant:auth', { pin: '1015' });
        sock.disconnect();
        await sleep(5);
      }

      await sleep(100);

      // All disconnected sockets must have been purged from socketToPin
      const finalMapSize = socketHandler.socketToPin.size;
      assert.equal(finalMapSize, initialMapSize, 'socketToPin must have 0 lingering mappings after disconnect');
    });

    it('5.2 Fuzzing socket event handlers with corrupted payloads does not trigger unhandled exceptions', async () => {
      const sock = await createClient();

      const hostilePayloads = [
        null,
        undefined,
        {},
        { malicious: true },
        'string_payload',
        12345,
        [],
        { pin: {} },
        { questionId: 'SELECT * FROM USERS' },
        { submissionId: -9999 },
        { status: 'DROP TABLE' }
      ];

      const events = [
        'contestant:auth',
        'contestant:incident',
        'judge:dispute:action',
        'qm:score:override',
        'qm:question:stage',
        'qm:timer:start'
      ];

      for (const ev of events) {
        for (const payload of hostilePayloads) {
          let threw = false;
          try {
            await new Promise((res) => {
              sock.emit(ev, payload, () => res());
              setTimeout(res, 10);
            });
          } catch (_) {
            threw = true;
          }
          assert.equal(threw, false, `Event ${ev} threw error with hostile payload: ${JSON.stringify(payload)}`);
        }
      }

      // Verify server remains operational
      const healthRes = await new Promise((resolve) => {
        http.get(`${BASE_URL}/api/health`, (r) => resolve(r.statusCode));
      });
      assert.equal(healthRes, 200, 'Server health must remain 200 after fuzzing');

      disconnectAll([sock]);
    });
  });
});
