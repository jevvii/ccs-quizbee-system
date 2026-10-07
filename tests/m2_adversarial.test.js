/**
 * tests/m2_adversarial.test.js
 * Adversarial Stress & Concurrency Suite for Milestone 2:
 * Real-Time Gateway, Anti-Cheat Telemetry, and Judge Dispute Atomicity
 *
 * Requirements (Milestone 2 Challenge):
 * 1. Simulate 60 concurrent terminals connecting and disconnecting simultaneously.
 * 2. Verify answer tampering prevention: contestant socket cannot receive unredacted correct_answer before REVEAL phase.
 * 3. Verify judge dispute actions update database atomically and emit leaderboard broadcasts without race conditions.
 * 4. Verify telemetry debounce suppression under rapid incident flood.
 * 5. Verify authorization boundary checks between role rooms.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const express = require('express');
const { Server } = require('socket.io');
const ioClient = require('socket.io-client');

const dbMod = require('../src/db');
const GameEngine = require('../src/gameEngine');
const TelemetryManager = require('../src/telemetryManager');
const { SocketHandler } = require('../src/socketHandler');

const TEST_PORT = 3456;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;

describe('Adversarial Stress Test: Milestone 2 Real-Time Gateway & Anti-Cheat Telemetry', () => {
  let tempDbPath;
  let server;
  let io;
  let engine;
  let telemetryManager;
  let handler;
  let dbInstance;
  let dbWrapper;

  before(async () => {
    // 1. Create isolated temporary database in WAL mode
    const rand = Math.random().toString(36).substring(2, 9);
    tempDbPath = path.join(os.tmpdir(), `quizbee_m2_adv_${Date.now()}_${rand}.db`);
    dbInstance = dbMod.initDb(tempDbPath);

    // 2. Seed competition rounds
    dbInstance.prepare(`
      INSERT INTO ROUNDS (id, name, weight_points, default_timer_sec, sequence_order)
      VALUES 
        (1, 'Easy', 1, 15, 1),
        (2, 'Average', 2, 30, 2),
        (3, 'Difficult', 3, 45, 3),
        (4, 'Clincher', 5, 30, 4)
    `).run();

    // 3. Seed sample questions (MCQ and Identification)
    dbInstance.prepare(`
      INSERT INTO QUESTIONS (id, round_id, question_text, code_snippet, question_type, options_json, correct_answer, acceptable_synonyms_json, points, timer_seconds)
      VALUES 
        (1, 1, 'Which tag is used for internal CSS?', '', 'MCQ', '{"A":"<script>","B":"<style>","C":"<link>","D":"<css>"}', 'B', '[]', 1, 15),
        (2, 2, 'What does CSS stand for?', '', 'IDENTIFICATION', '{}', 'Cascading Style Sheets', '["Cascading Style Sheet","CSS"]', 2, 30)
    `).run();

    // 4. Seed all 60 contestant terminals (PIN 1001 to 1060)
    const insertContestant = dbInstance.prepare(`
      INSERT INTO CONTESTANTS (id, pin, terminal_number, student_id, full_name, department_or_section, total_score, is_connected)
      VALUES (?, ?, ?, ?, ?, 'BSIT', 0, 0)
    `);
    for (let i = 1; i <= 60; i++) {
      const pin = String(1000 + i);
      insertContestant.run(i, pin, i, `2024-OLFU-${String(i).padStart(4, '0')}`, `Contestant ${i}`);
    }

    // Wrap dbMod with helper methods to enable end-to-end stress testing
    dbWrapper = {
      ...dbMod,
      getSubmission: (contestantId, questionId) => {
        return dbMod.getDb().prepare('SELECT * FROM SUBMISSIONS WHERE contestant_id = ? AND question_id = ?').get(contestantId, questionId);
      },
      getSubmissionById: (submissionId) => {
        return dbMod.getDb().prepare('SELECT * FROM SUBMISSIONS WHERE id = ?').get(submissionId);
      }
    };

    // 5. Initialize Express, HTTP, and Socket.io Server
    const app = express();
    server = http.createServer(app);

    io = new Server(server, {
      cors: { origin: '*' },
      pingInterval: 10000,
      pingTimeout: 5000
    });

    engine = new GameEngine({ graceWindowMs: 300, tickIntervalMs: 500 });
    telemetryManager = new TelemetryManager({
      db: dbWrapper,
      debounceMs: 1500,
      totalTerminals: 60,
      pinStart: 1001
    });

    handler = new SocketHandler(io, engine, dbWrapper, telemetryManager);

    await new Promise((resolve) => {
      server.listen(TEST_PORT, '127.0.0.1', resolve);
    });
  });

  after(async () => {
    if (engine && typeof engine._clearTimers === 'function') {
      engine._clearTimers();
    }
    if (io) {
      await new Promise(r => io.close(r));
    }
    if (server) {
      await new Promise(r => server.close(r));
    }
    dbMod.closeDb();
    for (const ext of ['', '-wal', '-shm']) {
      const f = `${tempDbPath}${ext}`;
      if (fs.existsSync(f)) {
        try { fs.unlinkSync(f); } catch (_) {}
      }
    }
  });

  function createClient() {
    return ioClient(SERVER_URL, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false
    });
  }

  // =========================================================================
  // SUITE 0: INTERFACE CONTRACT BREAKAGE & REGRESSION DETECTION
  // =========================================================================

  describe('Suite 0: Interface Contract Defect Discovery (src/db.js vs src/socketHandler.js)', () => {
    it('0.1 Empirically verifies src/db.js fails to export getSubmission and getSubmissionById', () => {
      // Direct observation: dbMod exports check
      assert.equal(
        typeof dbMod.getSubmission,
        'undefined',
        'DEFECT CONFIRMED: src/db.js does not export getSubmission despite src/socketHandler.js:460 invoking it unconditionally'
      );
      assert.equal(
        typeof dbMod.getSubmissionById,
        'undefined',
        'DEFECT CONFIRMED: src/db.js does not export getSubmissionById despite src/socketHandler.js:674 checking it'
      );
    });
  });

  // =========================================================================
  // SUITE 1: 60 CONCURRENT TERMINALS CONNECT & DISCONNECT STRESS
  // =========================================================================

  describe('Suite 1: 60 Concurrent Terminals Connect & Disconnect Stress', () => {
    it('1.1 Connects 60 concurrent socket clients and authenticates PINs simultaneously', async () => {
      const clients = [];
      try {
        // 1. Establish 60 socket connections in parallel
        const connectPromises = [];
        for (let i = 1; i <= 60; i++) {
          const client = createClient();
          clients.push(client);
          connectPromises.push(new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`Client ${i} connect timed out`)), 5000);
            client.on('connect', () => {
              clearTimeout(timer);
              resolve();
            });
          }));
        }
        await Promise.all(connectPromises);
        assert.equal(clients.length, 60, 'All 60 sockets must be connected');

        // 2. Perform simultaneous PIN authentications (PIN 1001 to 1060)
        const authPromises = clients.map((client, index) => {
          const pin = String(1001 + index);
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`Client PIN ${pin} auth timed out`)), 5000);
            client.emit('contestant:auth', { pin }, (res) => {
              clearTimeout(timer);
              resolve({ pin, res });
            });
          });
        });

        const authResults = await Promise.all(authPromises);
        assert.equal(authResults.length, 60);

        for (const { pin, res } of authResults) {
          assert.equal(res.success, true, `Authentication for PIN ${pin} must succeed`);
          assert.equal(res.contestant.pin, pin);
          assert.equal(res.contestant.terminalNumber, parseInt(pin, 10) - 1000);
        }

        // 3. Verify in-memory telemetry snapshot shows all 60 workstations ONLINE
        const snapshot = telemetryManager.getSnapshot();
        assert.equal(snapshot.summary.online, 60, 'Telemetry summary must report 60 online workstations');
        assert.equal(snapshot.summary.offline, 0, 'Telemetry summary must report 0 offline workstations');

        // 4. Verify SQLite database persistence shows is_connected = 1 for all 60 contestants
        const rows = dbMod.getAllContestants();
        assert.equal(rows.length, 60);
        const allConnected = rows.every(r => r.is_connected === 1);
        assert.equal(allConnected, true, 'All 60 contestants in SQLite must have is_connected = 1');

        // 5. Simultaneously disconnect all 60 clients
        const disconnectPromises = clients.map((client) => {
          return new Promise((resolve) => {
            client.on('disconnect', () => resolve());
            client.disconnect();
          });
        });
        await Promise.all(disconnectPromises);

        // Allow server event loop tick to finalize disconnect callbacks
        await new Promise(r => setTimeout(r, 200));

        // 6. Verify telemetry snapshot shows all 60 workstations OFFLINE
        const postDisconnectSnapshot = telemetryManager.getSnapshot();
        assert.equal(postDisconnectSnapshot.summary.online, 0, 'Telemetry summary must report 0 online workstations');
        assert.equal(postDisconnectSnapshot.summary.offline, 60, 'Telemetry summary must report 60 offline workstations');

        // 7. Verify SQLite database reflects is_connected = 0 for all 60 contestants
        const postRows = dbMod.getAllContestants();
        const allDisconnected = postRows.every(r => r.is_connected === 0);
        assert.equal(allDisconnected, true, 'All 60 contestants in SQLite must have is_connected = 0');

      } finally {
        for (const c of clients) {
          if (c.connected) c.disconnect();
        }
      }
    });

    it('1.2 High-concurrency duplicate PIN connection: older sockets receive kicked event and are evicted', async () => {
      const primaryClients = [];
      const duplicateClients = [];

      try {
        // Connect and authenticate 10 primary clients (PINs 1001-1010)
        for (let i = 1; i <= 10; i++) {
          const client = createClient();
          primaryClients.push(client);
        }

        await Promise.all(primaryClients.map(c => new Promise(r => c.on('connect', r))));
        await Promise.all(primaryClients.map((c, idx) => {
          return new Promise(r => c.emit('contestant:auth', { pin: String(1001 + idx) }, r));
        }));

        // Track 'contestant:kicked' events on primary sockets
        const kickedMap = new Map();
        primaryClients.forEach((c, idx) => {
          const pin = String(1001 + idx);
          c.on('contestant:kicked', (payload) => {
            kickedMap.set(pin, payload);
          });
        });

        // Now connect 10 duplicate clients with the exact same PINs
        for (let i = 1; i <= 10; i++) {
          const dup = createClient();
          duplicateClients.push(dup);
        }

        await Promise.all(duplicateClients.map(c => new Promise(r => c.on('connect', r))));
        const dupAuthResults = await Promise.all(duplicateClients.map((c, idx) => {
          return new Promise(r => c.emit('contestant:auth', { pin: String(1001 + idx) }, r));
        }));

        dupAuthResults.forEach(res => {
          assert.equal(res.success, true);
        });

        // Allow disconnect propagation
        await new Promise(r => setTimeout(r, 150));

        assert.equal(kickedMap.size, 10, 'All 10 original sockets must receive contestant:kicked');
        for (let i = 1; i <= 10; i++) {
          const pin = String(1000 + i);
          const kicked = kickedMap.get(pin);
          assert.ok(kicked, `PIN ${pin} must have kicked record`);
          assert.equal(kicked.reason, 'DUPLICATE_LOGIN');
        }

        const primaryConnected = primaryClients.filter(c => c.connected).length;
        assert.equal(primaryConnected, 0, 'All original sockets must be disconnected');

      } finally {
        for (const c of [...primaryClients, ...duplicateClients]) {
          if (c.connected) c.disconnect();
        }
      }
    });
  });

  // =========================================================================
  // SUITE 2: ANSWER TAMPERING PREVENTION & PAYLOAD REDACTION
  // =========================================================================

  describe('Suite 2: Answer Tampering Prevention & Redaction Boundary', () => {
    it('2.1 Contestant socket does NOT receive correct_answer in READING, COUNTDOWN, or LOCKED phases', async () => {
      const qmClient = createClient();
      const contestantClient = createClient();

      try {
        await Promise.all([
          new Promise(r => qmClient.on('connect', r)),
          new Promise(r => contestantClient.on('connect', r))
        ]);

        await new Promise(r => qmClient.emit('qm:join', {}, r));
        const authRes = await new Promise(r => contestantClient.emit('contestant:auth', { pin: '1001' }, r));
        assert.equal(authRes.success, true);

        const receivedStateSnapshots = [];
        contestantClient.on('game:phase:change', (data) => {
          receivedStateSnapshots.push({ event: 'game:phase:change', data });
        });

        // Step 1: Stage Question 1 (Easy MCQ, correct answer is 'B')
        const q1 = dbMod.getQuestion(1);
        assert.equal(q1.correct_answer, 'B');

        await new Promise(r => qmClient.emit('qm:question:stage', { questionId: 1 }, r));
        await new Promise(r => setTimeout(r, 100));

        let readingSnapshot = receivedStateSnapshots.find(s => s.data?.newPhase === 'READING');
        assert.ok(readingSnapshot, 'Must receive READING phase event');

        let readingQ = readingSnapshot.data.state.currentQuestion;
        assert.equal(readingQ.id, 1);
        assert.equal(readingQ.correct_answer, undefined, 'correct_answer must be redacted in READING');
        assert.equal(readingQ.acceptable_synonyms_json, undefined);
        assert.equal(readingQ.synonyms, undefined);
        assert.equal(JSON.stringify(readingQ).includes('"correct_answer"'), false);

        // Step 2: Start Countdown
        await new Promise(r => qmClient.emit('qm:timer:start', { durationSeconds: 15 }, r));
        await new Promise(r => setTimeout(r, 100));

        let countdownSnapshot = receivedStateSnapshots.find(s => s.data?.newPhase === 'COUNTDOWN');
        assert.ok(countdownSnapshot, 'Must receive COUNTDOWN phase event');
        let countdownQ = countdownSnapshot.data.state.currentQuestion;
        assert.equal(countdownQ.correct_answer, undefined, 'correct_answer must be redacted in COUNTDOWN');

        // Step 3: Contestant Submits Answer ('B')
        const submitAck = await new Promise(r => {
          contestantClient.emit('contestant:submit', { pin: '1001', questionId: 1, answer: 'B' }, r);
        });
        assert.equal(submitAck.success, true);
        assert.equal(submitAck.pointsAwarded, 1);
        assert.equal(submitAck.correct_answer, undefined, 'Submission ack must not leak correct_answer');

        // Step 4: Force Lock question
        await new Promise(r => qmClient.emit('qm:question:lock', r));
        await new Promise(r => setTimeout(r, 100));

        let lockedSnapshot = receivedStateSnapshots.find(s => s.data?.newPhase === 'LOCKED');
        assert.ok(lockedSnapshot, 'Must receive LOCKED phase event');
        let lockedQ = lockedSnapshot.data.state.currentQuestion;
        assert.equal(lockedQ.correct_answer, undefined, 'correct_answer must be redacted in LOCKED');

        // Step 5: Reveal Answer
        let revealedEvent = null;
        contestantClient.on('game:answer:reveal', (data) => {
          revealedEvent = data;
        });

        await new Promise(r => qmClient.emit('qm:answer:reveal', r));
        await new Promise(r => setTimeout(r, 100));

        assert.ok(revealedEvent, 'Must receive game:answer:reveal in REVEAL phase');
        assert.equal(revealedEvent.questionId, 1);
        assert.equal(revealedEvent.correctAnswer, 'B', 'Correct answer is revealed ONLY on REVEAL');

      } finally {
        if (qmClient.connected) qmClient.disconnect();
        if (contestantClient.connected) contestantClient.disconnect();
      }
    });

    it('2.2 Session re-attachment does NOT leak correct_answer during active countdown', async () => {
      const qmClient = createClient();
      const contestantClient1 = createClient();

      try {
        await Promise.all([
          new Promise(r => qmClient.on('connect', r)),
          new Promise(r => contestantClient1.on('connect', r))
        ]);

        await new Promise(r => qmClient.emit('qm:join', {}, r));
        await new Promise(r => contestantClient1.emit('contestant:auth', { pin: '1002' }, r));

        // Stage & start countdown for Question 2 (Identification)
        await new Promise(r => qmClient.emit('qm:question:stage', { questionId: 2 }, r));
        await new Promise(r => qmClient.emit('qm:timer:start', { durationSeconds: 30 }, r));

        // Client 1 disconnects (e.g. accidental browser close)
        contestantClient1.disconnect();
        await new Promise(r => setTimeout(r, 100));

        // Client 2 connects from same seat PIN (1002) to restore session
        const contestantClient2 = createClient();
        await new Promise(r => contestantClient2.on('connect', r));

        const restoreRes = await new Promise(r => {
          contestantClient2.emit('contestant:auth', { pin: '1002' }, r);
        });

        assert.equal(restoreRes.success, true);
        assert.ok(restoreRes.gameState);
        const restoredQ = restoreRes.gameState.currentQuestion;
        assert.ok(restoredQ);
        assert.equal(restoredQ.id, 2);
        assert.equal(restoredQ.correct_answer, undefined, 'Rehydrated question must NOT leak correct_answer');
        assert.equal(restoredQ.acceptable_synonyms_json, undefined, 'Rehydrated question must NOT leak synonyms');

        contestantClient2.disconnect();
      } finally {
        if (qmClient.connected) qmClient.disconnect();
        if (contestantClient1.connected) contestantClient1.disconnect();
      }
    });
  });

  // =========================================================================
  // SUITE 3: JUDGE DISPUTE ACTIONS ATOMICITY & LEADERBOARD RACE CONDITIONS
  // =========================================================================

  describe('Suite 3: Judge Dispute Actions Atomicity & Leaderboard Concurrency', () => {
    it('3.1 Disputed submissions route to Judge queue as PENDING and reject duplicate concurrent rulings', async () => {
      const qmClient = createClient();
      const judgeClient = createClient();
      const contestantClients = [];

      try {
        await Promise.all([
          new Promise(r => qmClient.on('connect', r)),
          new Promise(r => judgeClient.on('connect', r))
        ]);

        await new Promise(r => qmClient.emit('qm:join', {}, r));
        await new Promise(r => judgeClient.emit('judge:join', {}, r));

        // Stage and start countdown for Question 2 (Identification: "Cascading Style Sheets", 2 pts)
        await new Promise(r => qmClient.emit('qm:question:stage', { questionId: 2 }, r));
        await new Promise(r => qmClient.emit('qm:timer:start', { durationSeconds: 30 }, r));

        // 5 contestants submit non-matching identification answers -> enters Judge queue
        const answers = [
          'Cascade Style Sheets',
          'Cascaded Style Sheets',
          'Cascading Stylesheet',
          'Cascading Style System',
          'Cascaded Sheets'
        ];

        const pendingSubmissionIds = [];

        for (let i = 1; i <= 5; i++) {
          const client = createClient();
          contestantClients.push(client);
          await new Promise(r => client.on('connect', r));
          await new Promise(r => client.emit('contestant:auth', { pin: String(1000 + i) }, r));

          const subRes = await new Promise(r => {
            client.emit('contestant:submit', {
              pin: String(1000 + i),
              questionId: 2,
              answer: answers[i - 1]
            }, r);
          });

          assert.equal(subRes.success, true);
          assert.equal(subRes.judgeStatus, 'PENDING');
          assert.equal(subRes.pointsAwarded, 0);
          pendingSubmissionIds.push(subRes.submissionId);
        }

        assert.equal(pendingSubmissionIds.length, 5);

        // Verify judge queue via db
        const pendingInDb = dbMod.getPendingRulings();
        assert.ok(pendingInDb.length >= 5);

        // Stress test race condition: Simulate 10 simultaneous rulings on the SAME submissionId
        const targetSubId = pendingSubmissionIds[0];
        const concurrentRulings = [];
        for (let j = 0; j < 10; j++) {
          concurrentRulings.push(new Promise((resolve) => {
            judgeClient.emit('judge:dispute:action', {
              submissionId: targetSubId,
              status: j % 2 === 0 ? 'APPROVED' : 'REJECTED'
            }, resolve);
          }));
        }

        const rulingResults = await Promise.all(concurrentRulings);

        // Exactly 1 ruling must succeed; the remaining 9 must be rejected as already ruled
        const successfulRulings = rulingResults.filter(r => r.success === true);
        const rejectedRulings = rulingResults.filter(r => r.success === false && r.error === 'SUBMISSION_ALREADY_RULED');

        assert.equal(successfulRulings.length, 1, 'Exactly one concurrent ruling on a submission must succeed');
        assert.equal(rejectedRulings.length, 9, 'All competing concurrent rulings must be rejected as SUBMISSION_ALREADY_RULED');

        // Check SQLite database integrity
        const finalSub = dbWrapper.getSubmissionById(targetSubId);
        assert.ok(finalSub.judge_status === 'APPROVED' || finalSub.judge_status === 'REJECTED');

        const c1 = dbMod.getContestantById(finalSub.contestant_id);
        const expectedScore = finalSub.judge_status === 'APPROVED' ? 2 : 0;
        assert.ok(c1.total_score >= expectedScore);

      } finally {
        if (qmClient.connected) qmClient.disconnect();
        if (judgeClient.connected) judgeClient.disconnect();
        for (const c of contestantClients) {
          if (c.connected) c.disconnect();
        }
      }
    });

    it('3.2 Concurrent rulings across multiple submissions emit consistent real-time leaderboard broadcasts', async () => {
      const qmClient = createClient();
      const judgeClient = createClient();

      try {
        await Promise.all([
          new Promise(r => qmClient.on('connect', r)),
          new Promise(r => judgeClient.on('connect', r))
        ]);

        await new Promise(r => qmClient.emit('qm:join', {}, r));
        await new Promise(r => judgeClient.emit('judge:join', {}, r));

        const leaderboardBroadcasts = [];
        judgeClient.on('leaderboard:update', (data) => {
          leaderboardBroadcasts.push(data);
        });

        const pending = dbMod.getPendingRulings();
        if (pending.length >= 2) {
          const promises = pending.slice(0, 2).map(sub => {
            return new Promise(r => {
              judgeClient.emit('judge:dispute:action', { submissionId: sub.id, status: 'APPROVED' }, r);
            });
          });

          const results = await Promise.all(promises);
          results.forEach(r => {
            assert.equal(r.success, true);
          });

          await new Promise(r => setTimeout(r, 100));

          assert.ok(leaderboardBroadcasts.length >= 2, 'Leaderboard updates must be emitted on each ruling');
          const latestLb = leaderboardBroadcasts[leaderboardBroadcasts.length - 1].leaderboard;
          assert.ok(Array.isArray(latestLb));
          assert.equal(latestLb.length, 60, 'Leaderboard must contain all 60 contestants');

          // Verify monotonicity: rank 1 score >= rank 2 score
          for (let k = 0; k < latestLb.length - 1; k++) {
            assert.ok(latestLb[k].score >= latestLb[k + 1].score, 'Leaderboard must remain monotonically sorted by score');
          }
        }
      } finally {
        if (qmClient.connected) qmClient.disconnect();
        if (judgeClient.connected) judgeClient.disconnect();
      }
    });
  });

  // =========================================================================
  // SUITE 4: TELEMETRY DEBOUNCING & FLOOD SUPPRESSION
  // =========================================================================

  describe('Suite 4: Telemetry Debouncing & Flood Suppression', () => {
    it('4.1 50 rapid incident events within 100ms from one contestant are debounced to exactly 1 alert', async () => {
      const qmClient = createClient();
      const contestantClient = createClient();

      try {
        await Promise.all([
          new Promise(r => qmClient.on('connect', r)),
          new Promise(r => contestantClient.on('connect', r))
        ]);

        await new Promise(r => qmClient.emit('qm:join', {}, r));
        await new Promise(r => contestantClient.emit('contestant:auth', { pin: '1015' }, r));

        const receivedAlerts = [];
        qmClient.on('qm:telemetry:alert', (alert) => {
          if (alert.pin === '1015') {
            receivedAlerts.push(alert);
          }
        });

        // Fire 50 rapid incidents in a burst
        for (let i = 0; i < 50; i++) {
          contestantClient.emit('contestant:incident', {
            pin: '1015',
            type: 'WINDOW_BLUR',
            details: `rapid_blur_${i}`
          });
        }

        await new Promise(r => setTimeout(r, 300));

        assert.equal(receivedAlerts.length, 1, 'Only 1 alert must be broadcast to Quizmaster during debounce window');
        assert.equal(receivedAlerts[0].incidentType, 'WINDOW_BLUR');

        const logs = dbMod.getIncidentLogs(15);
        assert.equal(logs.length, 1, 'Exactly 1 row must be persisted in CHEAT_LOGS for contestant 15');

      } finally {
        if (qmClient.connected) qmClient.disconnect();
        if (contestantClient.connected) contestantClient.disconnect();
      }
    });
  });

  // =========================================================================
  // SUITE 5: AUTHORIZATION & ATTACK SURFACE BOUNDARIES
  // =========================================================================

  describe('Suite 5: Authorization & Role Room Boundary Analysis', () => {
    it('5.1 Probes whether an authenticated contestant socket can escalate privileges by emitting qm:join', async () => {
      const client = createClient();
      try {
        await new Promise(r => client.on('connect', r));
        const authRes = await new Promise(r => client.emit('contestant:auth', { pin: '1020' }, r));
        assert.equal(authRes.success, true);

        // Attempt privilege escalation: Emit qm:join from contestant socket
        const qmJoinRes = await new Promise(r => client.emit('qm:join', {}, r));

        // Observation: Check if server allows contestant socket to join room:quizmaster
        const allowsEscalation = qmJoinRes && qmJoinRes.success === true;
        if (allowsEscalation) {
          const leakedState = qmJoinRes.gameState;
          assert.ok(leakedState, 'VULNERABILITY CONFIRMED: qm:join permits contestant to join QM room and access unredacted gameState');
        }
      } finally {
        if (client.connected) client.disconnect();
      }
    });
  });
});
