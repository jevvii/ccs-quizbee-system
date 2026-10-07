/**
 * tests/adversarial_worker.js
 * Dedicated Worker Thread for Adversarial Concurrency Testing against src/db.js
 */

const { workerData, parentPort } = require('node:worker_threads');
const dbMod = require('../src/db');

const { dbPath, contestantId, questionId, answer, serverTimeMs, isCorrect, judgeStatus, points, sharedBarrier, iterations } = workerData;

try {
  // Initialize DB instance in this worker thread
  dbMod.initDb(dbPath);

  // Synchronize start using Atomics barrier if provided
  if (sharedBarrier) {
    const int32Array = new Int32Array(sharedBarrier);
    // Notify parent worker is ready
    parentPort.postMessage({ status: 'READY', workerId: contestantId });
    // Wait until parent signals (value changes from 0 to 1)
    Atomics.wait(int32Array, 0, 0);
  }

  const results = [];
  const loopCount = iterations || 1;

  for (let i = 0; i < loopCount; i++) {
    const qId = loopCount > 1 ? (i + 1) : questionId;
    try {
      const sub = dbMod.saveSubmission(
        contestantId,
        qId,
        answer || 'A',
        serverTimeMs || Date.now(),
        isCorrect !== undefined ? isCorrect : 1,
        judgeStatus || 'AUTO',
        points !== undefined ? points : 1
      );
      results.push({ success: true, submissionId: sub.id, qId });
    } catch (err) {
      results.push({
        success: false,
        error: err.message,
        code: err.code,
        isBusy: err.code === 'SQLITE_BUSY' || /busy/i.test(err.message),
        isUnique: err.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE/i.test(err.message),
        qId
      });
    }
  }

  dbMod.closeDb();
  parentPort.postMessage({ status: 'DONE', workerId: contestantId, results });
} catch (fatalErr) {
  parentPort.postMessage({
    status: 'FATAL',
    workerId: contestantId,
    error: fatalErr.message,
    code: fatalErr.code,
    isBusy: fatalErr.code === 'SQLITE_BUSY' || /busy/i.test(fatalErr.message)
  });
}
