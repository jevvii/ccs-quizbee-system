/**
 * scripts/seed.js - Automated Database Initialization & Seeding CLI
 * OLFU IT Olympics Quiz Bee System (ITPM 311)
 *
 * Bootstraps ROUNDS, imports sample_questions.csv, and generates 60 contestant terminals (PIN 1001-1060).
 */

const path = require('path');
const db = require('../src/db');
const { importQuestionsFromCsv } = require('../src/csvImporter');

function runSeed(customDbPath = null) {
  console.log('====================================================');
  console.log('  OLFU IT Olympics Quiz Bee Engine — Seeding CLI    ');
  console.log('====================================================');

  const dbPath = customDbPath || path.resolve(__dirname, '../quizbee.db');
  const csvPath = path.resolve(__dirname, '../sample_questions.csv');

  console.log(`[1/4] Initializing SQLite database (WAL mode) at: ${dbPath}`);
  const dbInstance = db.initDb(dbPath);

  // Reset tournament tables for clean bootstrap
  console.log('[2/4] Resetting tournament tables...');
  dbInstance.exec(`
    DELETE FROM CHEAT_LOGS;
    DELETE FROM SUBMISSIONS;
    DELETE FROM QUESTIONS;
    DELETE FROM CONTESTANTS;
    DELETE FROM ROUNDS;
  `);

  // 1. Seed 4 Standard Competition Rounds
  console.log('[3/4] Seeding 4 standard competition rounds...');
  const insertRound = dbInstance.prepare(`
    INSERT INTO ROUNDS (id, name, weight_points, default_timer_sec, sequence_order)
    VALUES (?, ?, ?, ?, ?)
  `);

  const rounds = [
    { id: 1, name: 'Easy', weight: 1, timer: 15, seq: 1 },
    { id: 2, name: 'Average', weight: 2, timer: 30, seq: 2 },
    { id: 3, name: 'Difficult', weight: 3, timer: 45, seq: 3 },
    { id: 4, name: 'Clincher', weight: 5, timer: 30, seq: 4 }
  ];

  rounds.forEach(r => insertRound.run(r.id, r.name, r.weight, r.timer, r.seq));
  console.log(`      ✓ Seeded ${rounds.length} rounds.`);

  // 2. Ingest Questions from sample_questions.csv
  console.log(`[4/4] Importing question bank from: ${csvPath}`);
  const result = importQuestionsFromCsv(csvPath, dbInstance);
  console.log(`      ✓ Imported ${result.importedCount} questions.`);
  if (result.errors.length > 0) {
    console.warn('      ⚠ Import warnings/errors:', result.errors);
  }

  // 3. Seed 60 Contestant PINs (1001 - 1060)
  console.log('[5/4] Seeding 60 contestant terminals (PIN 1001 to 1060)...');
  const insertContestant = dbInstance.prepare(`
    INSERT INTO CONTESTANTS (pin, terminal_number, student_id, full_name, department_or_section, total_score)
    VALUES (?, ?, ?, ?, ?, 0)
  `);

  const seedContestantsTx = dbInstance.transaction(() => {
    for (let i = 1; i <= 60; i++) {
      const terminalNumber = i;
      const pin = String(1000 + i); // 1001 to 1060
      const studentId = `2024-OLFU-${String(i).padStart(4, '0')}`;
      const fullName = `Contestant ${String(i).padStart(2, '0')}`;
      const dept = 'BSIT - CCS';
      insertContestant.run(pin, terminalNumber, studentId, fullName, dept);
    }
  });

  seedContestantsTx();
  console.log('      ✓ Successfully generated 60 contestants.');

  // Verification Audit Summary
  const countRounds = dbInstance.prepare('SELECT COUNT(*) AS c FROM ROUNDS').get().c;
  const countQuestions = dbInstance.prepare('SELECT COUNT(*) AS c FROM QUESTIONS').get().c;
  const countContestants = dbInstance.prepare('SELECT COUNT(*) AS c FROM CONTESTANTS').get().c;

  console.log('----------------------------------------------------');
  console.log('  Bootstrap Summary:');
  console.log(`    - Rounds in Database:      ${countRounds}`);
  console.log(`    - Questions Loaded:        ${countQuestions}`);
  console.log(`    - Contestants Registered:  ${countContestants} (PIN 1001–1060)`);
  console.log('  Status: Database is tournament-ready!');
  console.log('====================================================');

  return {
    rounds: countRounds,
    questions: countQuestions,
    contestants: countContestants
  };
}

if (require.main === module) {
  runSeed();
  db.closeDb();
}

module.exports = { runSeed };
