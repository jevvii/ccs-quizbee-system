/**
 * tests/challenger_m2_it2_stress.test.js
 * Empirical Challenger Stress & Verification Suite for Milestone 2 Iteration 2
 *
 * Specific Verification Objectives:
 * 1. Concurrency: 60 terminals connecting and disconnecting simultaneously & churn stability.
 * 2. Role Guards: Exhaustive verification that unauthenticated and contestant sockets
 *    CANNOT emit qm:score:override, qm:join, or other administrative controls.
 * 3. WAL Concurrency: Simultaneous submissions and score tallies without SQLITE_BUSY.
 * 4. Telemetry Storm: 60-terminal concurrent anti-cheat incident storm & debounce immunity.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { io: ClientIO } = require('socket.io-client');

const {
  startServer,
  stopServer,
  app,
  server,
  io,
  gameEngine,
  db,
  telemetryManager,
  socketHandler
} = require('../src/server');

const TEST_PORT = 3555;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

// Helper: create a connected socket.io client
function createClient(options = {}) {
  return new Promise((resolve, reject) => {
    const socket = ClientIO(BASE_URL, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      timeout: 5000,
      ...options
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (err) => reject(err));
  });
}

// Helper: emit with ack and timeout
function emitWithAck(socket, event, data, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Timeout (${timeoutMs}ms) waiting for ack on event "${event}"`));
      }
    }, timeoutMs);

    socket.emit(event, data, (response) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(response);
      }
    });
  });
}

// Helper: disconnect all sockets cleanly
function disconnectAll(sockets) {
  for (const s of sockets) {
    if (s && s.connected) {
      s.disconnect();
    }
  }
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

describe('Milestone 2 Iteration 2: Empirical Challenger Verification Suite', () => {
  before(async () => {
    await startServer(TEST_PORT);

    const dbInstance = db.getDb();

    // Ensure ROUND 1 exists
    dbInstance.prepare(`
      INSERT OR IGNORE INTO ROUNDS (id, name, weight_points, default_timer_sec, sequence_order)
      VALUES (1, 'Easy Round', 1, 15, 1)
    `).run();

    // Ensure test questions exist
    dbInstance.prepare(`
      INSERT OR IGNORE INTO QUESTIONS (id, round_id, question_text, code_snippet, question_type, options_json, correct_answer, acceptable_synonyms_json, points, timer_seconds)
      VALUES 
        (201, 1, 'Stress Test MCQ', '', 'MCQ', '{"A":"Alpha","B":"Beta","C":"Gamma","D":"Delta"}', 'B', '[]', 1, 15),
        (202, 1, 'Stress Test ID', '', 'IDENTIFICATION', '{}', 'SQLite', '["sqlite","SQLITE"]', 2, 30)
    `).run();

    // Ensure all 60 contestants (PIN 1001-1060) exist in database
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
  // SUITE 1: 60 CONCURRENT TERMINALS CONNECT / DISCONNECT STRESS
  // =========================================================================
  describe('1. Concurrency: 60 Terminals Simultaneous Connect, Auth & Disconnect', () => {
    it('1.1 Simultaneously connects 60 WebSocket clients and authenticates all 60 PINs', async () => {
      // Spawn 60 concurrent clients
      const clients = await Promise.all(
        Array.from({ length: 60 }, () => createClient())
      );
      assert.equal(clients.length, 60, 'Exactly 60 clients connected');

      // Authenticate all 60 simultaneously
      const authPromises = clients.map((sock, idx) => {
        const pin = String(1001 + idx);
        return emitWithAck(sock, 'contestant:auth', { pin });
      });

      const authResults = await Promise.all(authPromises);

      // Verify all 60 succeeded
      for (let i = 0; i < 60; i++) {
        const res = authResults[i];
        const expectedPin = String(1001 + i);
        assert.equal(res.success, true, `Client ${i} authentication must succeed`);
        assert.equal(res.contestant.pin, expectedPin, `Client ${i} PIN mismatch`);
        assert.equal(res.contestant.terminalNumber, i + 1, `Client ${i} terminalNumber mismatch`);
        assert.ok(res.gameState, `Client ${i} must receive gameState`);
      }

      // Check server internal state
      assert.equal(socketHandler.activeSocketsByPin.size, 60, 'activeSocketsByPin must hold 60 entries');
      assert.equal(socketHandler.socketToPin.size, 60, 'socketToPin must hold 60 entries');

      const snapshot = telemetryManager.getSnapshot();
      assert.equal(snapshot.summary.online, 60, 'TelemetryManager must show 60 online terminals');

      // Verify DB connection state
      const dbContestants = db.getAllContestants();
      const connectedCount = dbContestants.filter(c => c.is_connected === 1).length;
      assert.equal(connectedCount, 60, 'Database CONTESTANTS table must reflect 60 connected terminals');

      // Clean disconnect of all 60
      disconnectAll(clients);
      await sleep(150);

      assert.equal(socketHandler.activeSocketsByPin.size, 0, 'activeSocketsByPin must be empty after disconnect');
      assert.equal(socketHandler.socketToPin.size, 0, 'socketToPin must be empty after disconnect');

      const afterSnapshot = telemetryManager.getSnapshot();
      assert.equal(afterSnapshot.summary.online, 0, 'TelemetryManager must show 0 online terminals after disconnect');
    });

    it('1.2 High-churn stress: 3 rapid back-to-back cycles of 60 connect/auth/disconnect (180 total lifecycles)', async () => {
      for (let cycle = 1; cycle <= 3; cycle++) {
        const clients = await Promise.all(
          Array.from({ length: 60 }, () => createClient())
        );

        const authPromises = clients.map((sock, idx) => {
          const pin = String(1001 + idx);
          return emitWithAck(sock, 'contestant:auth', { pin });
        });

        const results = await Promise.all(authPromises);
        assert.equal(results.every(r => r.success), true, `Cycle ${cycle}: All 60 authentications must succeed`);

        // Disconnect immediately
        disconnectAll(clients);
        await sleep(60);

        assert.equal(socketHandler.socketToPin.size, 0, `Cycle ${cycle}: socketToPin must be completely clean`);
        assert.equal(socketHandler.activeSocketsByPin.size, 0, `Cycle ${cycle}: activeSocketsByPin must be clean`);
      }
    });
  });

  // =========================================================================
  // SUITE 2: ROLE GUARD VERIFICATION (CONTESTANT & UNAUTHENTICATED SOCKETS)
  // =========================================================================
  describe('2. Role Guards: Unauthenticated & Contestant Socket Isolation', () => {
    let unauthSocket;
    let contestantSocket;
    let qmSocket;

    before(async () => {
      unauthSocket = await createClient();
      contestantSocket = await createClient();
      await emitWithAck(contestantSocket, 'contestant:auth', { pin: '1001' });

      qmSocket = await createClient();
      await emitWithAck(qmSocket, 'qm:join', {});
    });

    after(() => {
      disconnectAll([unauthSocket, contestantSocket, qmSocket]);
    });

    it('2.1 Unauthenticated socket CANNOT emit qm:score:override', async () => {
      const initialContestant = db.getContestantByPin('1001');
      const initialScore = initialContestant.total_score;

      const overrideRes = await emitWithAck(unauthSocket, 'qm:score:override', {
        pin: '1001',
        newScore: 888,
        reason: 'Unauthenticated exploit attempt'
      });

      assert.equal(overrideRes.success, false, 'qm:score:override must fail for unauthenticated socket');
      assert.equal(overrideRes.error, 'UNAUTHORIZED_ROLE', 'Error code must be UNAUTHORIZED_ROLE');

      // Verify DB total_score was NOT altered
      const verifyContestant = db.getContestantByPin('1001');
      assert.equal(verifyContestant.total_score, initialScore, 'Database total_score must NOT change');
    });

    it('2.2 Authenticated Contestant socket CANNOT emit qm:score:override', async () => {
      const initialScore = db.getContestantByPin('1001').total_score;

      const overrideSelf = await emitWithAck(contestantSocket, 'qm:score:override', {
        pin: '1001',
        newScore: 777
      });
      assert.equal(overrideSelf.success, false, 'qm:score:override must fail for contestant socket');
      assert.equal(overrideSelf.error, 'UNAUTHORIZED_ROLE', 'Error must be UNAUTHORIZED_ROLE');

      const overrideOther = await emitWithAck(contestantSocket, 'qm:score:override', {
        pin: '1002',
        newScore: 777
      });
      assert.equal(overrideOther.success, false, 'qm:score:override on peer must fail');
      assert.equal(overrideOther.error, 'UNAUTHORIZED_ROLE');

      assert.equal(db.getContestantByPin('1001').total_score, initialScore);
    });

    it('2.3 Authenticated Contestant socket CANNOT escalate privilege via qm:join', async () => {
      const joinRes = await emitWithAck(contestantSocket, 'qm:join', {});

      assert.equal(joinRes.success, false, 'qm:join must fail for contestant socket');
      assert.equal(joinRes.error, 'UNAUTHORIZED_ROLE', 'Must reject with UNAUTHORIZED_ROLE');
      assert.equal(joinRes.message, 'Contestants cannot join Quizmaster room');

      // Verify server socket role did not escalate to QUIZMASTER
      const serverSocket = socketHandler.activeSocketsByPin.get('1001');
      assert.ok(serverSocket, 'Server socket must exist for PIN 1001');
      assert.equal(serverSocket.data?.role, 'CONTESTANT', 'Server socket role must remain CONTESTANT');
    });

    it('2.4 Authenticated Contestant socket CANNOT join Judge or Projector rooms', async () => {
      const judgeRes = await emitWithAck(contestantSocket, 'judge:join', {});
      assert.equal(judgeRes.success, false, 'judge:join must fail for contestant');
      assert.equal(judgeRes.error, 'UNAUTHORIZED_ROLE');

      const projRes = await emitWithAck(contestantSocket, 'projector:join', {});
      assert.equal(projRes.success, false, 'projector:join must fail for contestant');
      assert.equal(projRes.error, 'UNAUTHORIZED_ROLE');
    });

    it('2.5 Authenticated Contestant socket CANNOT execute Quizmaster tournament controls', async () => {
      const controls = [
        { event: 'qm:question:stage', payload: { questionId: 201 } },
        { event: 'qm:timer:start', payload: { durationSeconds: 15 } },
        { event: 'qm:timer:pause', payload: {} },
        { event: 'qm:timer:resume', payload: {} },
        { event: 'qm:question:lock', payload: {} },
        { event: 'qm:force:lock', payload: {} },
        { event: 'qm:answer:reveal', payload: {} },
        { event: 'qm:reveal:answer', payload: {} },
        { event: 'qm:leaderboard:show', payload: {} },
        { event: 'qm:round:reset', payload: {} }
      ];

      for (const ctrl of controls) {
        const res = await emitWithAck(contestantSocket, ctrl.event, ctrl.payload);
        assert.equal(res.success, false, `${ctrl.event} must reject contestant execution`);
        assert.equal(res.error, 'UNAUTHORIZED_ROLE', `${ctrl.event} must return UNAUTHORIZED_ROLE`);
      }
    });

    it('2.6 Authenticated Contestant socket CANNOT execute Judge dispute actions', async () => {
      const disputeRes = await emitWithAck(contestantSocket, 'judge:dispute:action', {
        submissionId: 1,
        status: 'APPROVED'
      });
      assert.equal(disputeRes.success, false);
      assert.equal(disputeRes.error, 'UNAUTHORIZED_ROLE');

      const queueRes = await emitWithAck(contestantSocket, 'judge:queue:get', {});
      assert.equal(queueRes.success, false);
      assert.equal(queueRes.error, 'UNAUTHORIZED_ROLE');
    });

    it('2.7 Unauthenticated socket CANNOT execute Quizmaster tournament controls directly', async () => {
      const controls = [
        { event: 'qm:question:stage', payload: { questionId: 201 } },
        { event: 'qm:timer:start', payload: { durationSeconds: 15 } },
        { event: 'qm:timer:pause', payload: {} },
        { event: 'qm:timer:resume', payload: {} },
        { event: 'qm:force:lock', payload: {} },
        { event: 'qm:answer:reveal', payload: {} },
        { event: 'qm:leaderboard:show', payload: {} },
        { event: 'qm:round:reset', payload: {} }
      ];

      for (const ctrl of controls) {
        const res = await emitWithAck(unauthSocket, ctrl.event, ctrl.payload);
        assert.equal(res.success, false, `${ctrl.event} must fail for unauthenticated socket`);
        assert.equal(res.error, 'UNAUTHORIZED_ROLE');
      }
    });

    it('2.8 Unauthenticated socket CANNOT submit answers or report incidents', async () => {
      // Stage question and start timer
      await emitWithAck(qmSocket, 'qm:round:reset', {});
      await emitWithAck(qmSocket, 'qm:question:stage', { questionId: 201 });
      await emitWithAck(qmSocket, 'qm:timer:start', { durationSeconds: 15 });

      const subRes = await emitWithAck(unauthSocket, 'contestant:submit', {
        pin: '1001',
        answer: 'B'
      });
      assert.equal(subRes.success, false, 'Unauthenticated submission must fail');
      assert.equal(subRes.error, 'UNAUTHORIZED');

      // Incident from unauthenticated socket must not log
      const initialIncidents = db.getIncidentLogs('1001').length;
      unauthSocket.emit('contestant:incident', {
        pin: '1001',
        incidentType: 'WINDOW_BLUR'
      });
      await sleep(50);
      assert.equal(db.getIncidentLogs('1001').length, initialIncidents, 'Unauthenticated incident must not be logged');
    });

    it('2.9 Authenticated contestant CANNOT submit or spoof incidents for another PIN', async () => {
      // Contestant 1001 tries to submit on behalf of PIN 1002
      const spoofSub = await emitWithAck(contestantSocket, 'contestant:submit', {
        pin: '1002',
        answer: 'B'
      });
      assert.equal(spoofSub.success, false, 'Mismatched PIN submission must be rejected');
      assert.equal(spoofSub.error, 'PIN_MISMATCH');

      // Contestant 1001 tries to report cheat incident for PIN 1002
      const initialLogs1002 = db.getIncidentLogs('1002').length;
      contestantSocket.emit('contestant:incident', {
        pin: '1002',
        incidentType: 'FULLSCREEN_EXIT'
      });
      await sleep(50);
      assert.equal(db.getIncidentLogs('1002').length, initialLogs1002, 'Spoofed incident must not be logged for PIN 1002');
    });

    it('2.10 Authorized Quizmaster can legitimately execute score override', async () => {
      const overrideRes = await emitWithAck(qmSocket, 'qm:score:override', {
        pin: '1001',
        newScore: 42,
        reason: 'Authorized Bonus'
      });

      assert.equal(overrideRes.success, true, 'Authorized QM score override must succeed');
      assert.equal(overrideRes.newScore, 42);

      const updatedContestant = db.getContestantByPin('1001');
      assert.equal(updatedContestant.total_score, 42, 'Database total_score must reflect override');
    });
  });

  // =========================================================================
  // SUITE 3: 60-TERMINAL CONCURRENT SUBMISSION BURST & WAL INTEGRITY
  // =========================================================================
  describe('3. WAL Concurrency: 60 Concurrent Submissions and Dynamic Score Computation', () => {
    let clients = [];
    let qmSocket;

    before(async () => {
      qmSocket = await createClient();
      await emitWithAck(qmSocket, 'qm:join', {});

      clients = await Promise.all(
        Array.from({ length: 60 }, () => createClient())
      );

      await Promise.all(
        clients.map((c, i) => emitWithAck(c, 'contestant:auth', { pin: String(1001 + i) }))
      );
    });

    after(async () => {
      disconnectAll([qmSocket, ...clients]);
      await sleep(150);
    });

    it('3.1 60 simultaneous contestant submissions during COUNTDOWN record cleanly without SQLITE_BUSY', async () => {
      // Clear any prior test submissions for question 201 to ensure test idempotency
      db.getDb().prepare('DELETE FROM SUBMISSIONS WHERE question_id = 201').run();
      db.getDb().prepare('UPDATE CONTESTANTS SET total_score = 0').run();

      // Stage Q201 (MCQ: correct answer B, 1 pt)
      await emitWithAck(qmSocket, 'qm:round:reset', {});
      await emitWithAck(qmSocket, 'qm:question:stage', { questionId: 201 });
      await emitWithAck(qmSocket, 'qm:timer:start', { durationSeconds: 20 });

      // First 40 submit correct 'B'; remaining 20 submit incorrect 'A'
      const submissionPromises = clients.map((sock, idx) => {
        const answer = idx < 40 ? 'B' : 'A';
        return emitWithAck(sock, 'contestant:submit', { questionId: 201, answer });
      });

      const results = await Promise.all(submissionPromises);

      // Verify all 60 received clean ack with success = true
      assert.equal(results.every(r => r.success), true, 'All 60 concurrent submissions must succeed');

      // Verify scoring
      const awardedPoints = results.map(r => r.pointsAwarded);
      const correctCount = awardedPoints.filter(p => p === 1).length;
      const incorrectCount = awardedPoints.filter(p => p === 0).length;
      assert.equal(correctCount, 40, 'Exactly 40 submissions must receive 1 point');
      assert.equal(incorrectCount, 20, 'Exactly 20 submissions must receive 0 points');

      // Verify duplicate submission rejection
      const dupPromises = clients.slice(0, 10).map((sock) => {
        return emitWithAck(sock, 'contestant:submit', { questionId: 201, answer: 'B' });
      });
      const dupResults = await Promise.all(dupPromises);
      assert.equal(dupResults.every(r => !r.success && r.error === 'DUPLICATE_SUBMISSION'), true, 'Duplicate submissions must be rejected with DUPLICATE_SUBMISSION');

      // Verify leaderboard accuracy
      const leaderboard = db.getLeaderboard(1);
      assert.equal(leaderboard.length, 60, 'Leaderboard must contain all 60 contestants');
      const topScorers = leaderboard.filter(c => c.score >= 1);
      assert.equal(topScorers.length, 40, 'Top scorers count must match correct submissions');
    });
  });

  // =========================================================================
  // SUITE 4: TELEMETRY DEBOUNCE UNDER 60-TERMINAL INCIDENT STORM
  // =========================================================================
  describe('4. Telemetry Resilience: 60 Concurrent Terminals Incident Storm', () => {
    let clients = [];
    let qmSocket;

    before(async () => {
      qmSocket = await createClient();
      await emitWithAck(qmSocket, 'qm:join', {});

      clients = await Promise.all(
        Array.from({ length: 60 }, () => createClient())
      );

      const authResults = await Promise.all(
        clients.map((c, i) => emitWithAck(c, 'contestant:auth', { pin: String(1001 + i) }))
      );
      assert.equal(authResults.every(r => r.success), true, 'All 60 clients must authenticate');
    });

    after(async () => {
      disconnectAll([qmSocket, ...clients]);
      await sleep(150);
    });

    it('4.1 60 terminals simultaneously emit rapid bursts of 5 incidents each (300 total incidents in 100ms)', async () => {
      let alertsReceived = 0;
      qmSocket.on('qm:telemetry:alert', () => {
        alertsReceived++;
      });

      // Every client fires 5 rapid blur events
      for (const client of clients) {
        for (let i = 0; i < 5; i++) {
          client.emit('contestant:incident', { incidentType: 'WINDOW_BLUR' });
        }
      }

      await sleep(350);

      // In a 1.5s window, exactly 1 incident per terminal should pass debounce (60 alerts)
      assert.equal(alertsReceived, 60, `Expected exactly 60 debounced alerts (1 per terminal), received ${alertsReceived}`);
    });
  });
});
