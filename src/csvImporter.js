/**
 * src/csvImporter.js - Question Bank CSV Importer
 * OLFU IT Olympics LAN Quiz Bee System (ITPM 311)
 *
 * Ingests 12-column CSV files into SQLite database:
 * round, type, question, code_snippet, option_a..d, correct_answer, synonyms, points, timer_seconds.
 */

const fs = require('fs');

/**
 * Normalizes synonym string (semicolon-delimited) into trimmed lowercase array
 * @param {string} rawSynonyms
 * @returns {string[]}
 */
function parseSynonyms(rawSynonyms) {
  if (!rawSynonyms || typeof rawSynonyms !== 'string') return [];
  return rawSynonyms
    .split(';')
    .map(s => s.trim().toLowerCase())
    .filter(s => s.length > 0);
}

/**
 * Extracts and combines synonyms with canonical answer for IDENTIFICATION
 * @param {string} rawSynonyms
 * @param {string} canonicalAnswer
 * @param {string} questionType
 * @returns {string[]}
 */
function extractSynonyms(rawSynonyms, canonicalAnswer, questionType) {
  if (questionType === 'MCQ') return [];

  const set = new Set();
  const parsed = parseSynonyms(rawSynonyms);
  parsed.forEach(s => set.add(s));

  if (canonicalAnswer && typeof canonicalAnswer === 'string') {
    const canon = canonicalAnswer.trim().toLowerCase();
    if (canon) set.add(canon);
  }

  return Array.from(set);
}

/**
 * Fallback RFC-4180 CSV parser if csv-parse is unavailable
 * @param {string} text
 * @returns {Array<Array<string>>}
 */
function parseCsvBuffer(text) {
  const rows = [];
  let row = [];
  let curr = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        curr += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(curr);
      curr = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      row.push(curr);
      if (row.some(c => c.trim().length > 0)) rows.push(row);
      row = [];
      curr = '';
    } else {
      curr += char;
    }
  }

  if (curr.length > 0 || row.length > 0) {
    row.push(curr);
    if (row.some(c => c.trim().length > 0)) rows.push(row);
  }

  return rows;
}

/**
 * Parses raw CSV string into array of object records
 * @param {string} content
 * @returns {Array<Object>}
 */
function parseCsvContent(content) {
  try {
    const { parse } = require('csv-parse/sync');
    return parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
  } catch (_) {
    const rows = parseCsvBuffer(content);
    if (rows.length === 0) return [];
    const headers = rows[0].map(h => h.trim());
    return rows.slice(1).map(r => {
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = r[idx] !== undefined ? r[idx].trim() : '';
      });
      return obj;
    });
  }
}

/**
 * Import questions from raw CSV text content into SQLite database
 * @param {string} content - Raw CSV string
 * @param {Database} dbInstance - better-sqlite3 or node:sqlite database instance
 * @param {Object} [options={}] - { mode: 'replace' | 'append', replace: boolean }
 * @returns {{ success: boolean, importedCount: number, errors: string[] }}
 */
function importQuestionsFromContent(content, dbInstance, options = {}) {
  if (typeof content !== 'string' || !content.trim()) {
    return {
      success: false,
      importedCount: 0,
      errors: ['CSV content is empty.']
    };
  }

  // If replace mode is requested, atomically wipe prior questions and submissions
  if (options.mode === 'replace' || options.replace) {
    dbInstance.transaction(() => {
      dbInstance.exec('DELETE FROM SUBMISSIONS;');
      dbInstance.exec('DELETE FROM CHEAT_LOGS;');
      dbInstance.exec('DELETE FROM QUESTIONS;');
    })();
  }

  const rows = parseCsvContent(content);
  const errors = [];
  let importedCount = 0;

  // Prepared statements for round lookup and question insertion
  const getRoundStmt = dbInstance.prepare('SELECT id FROM ROUNDS WHERE UPPER(name) = UPPER(?)');
  const insertRoundStmt = dbInstance.prepare(`
    INSERT INTO ROUNDS (name, weight_points, default_timer_sec, sequence_order)
    VALUES (?, ?, ?, ?)
  `);
  const insertQuestionStmt = dbInstance.prepare(`
    INSERT INTO QUESTIONS (
      round_id, question_text, code_snippet, question_type, 
      options_json, correct_answer, acceptable_synonyms_json, points, timer_seconds
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const roundDefaults = {
    TRIAL: { points: 0, timer: 15, seq: 0 },
    WARMUP: { points: 0, timer: 15, seq: 0 },
    PRACTICE: { points: 0, timer: 15, seq: 0 },
    EASY: { points: 1, timer: 15, seq: 1 },
    AVERAGE: { points: 2, timer: 30, seq: 2 },
    DIFFICULT: { points: 3, timer: 45, seq: 3 },
    CLINCHER: { points: 5, timer: 30, seq: 4 }
  };

  const importTx = dbInstance.transaction(() => {
    rows.forEach((row, index) => {
      const rowNum = index + 2; // Accounting for 1-based index and header
      try {
        const roundName = (row.round || 'Easy').trim();
        const upperRound = roundName.toUpperCase();
        let roundRecord = getRoundStmt.get(roundName);

        if (!roundRecord) {
          const defaults = roundDefaults[upperRound] || { points: 1, timer: 15, seq: 99 };
          const parsedPts = parseInt(row.points, 10);
          const roundPoints = (!isNaN(parsedPts) && parsedPts >= 0) ? parsedPts : defaults.points;
          const timer = parseInt(row.timer_seconds, 10) || defaults.timer;

          let targetSeq = defaults.seq;
          const existingWithSeq = dbInstance.prepare('SELECT id FROM ROUNDS WHERE sequence_order = ?').get(targetSeq);
          if (existingWithSeq) {
            const maxSeqRow = dbInstance.prepare('SELECT MAX(sequence_order) as m FROM ROUNDS').get();
            targetSeq = (maxSeqRow && maxSeqRow.m !== null) ? maxSeqRow.m + 1 : 99;
          }

          const info = insertRoundStmt.run(roundName, roundPoints, timer, targetSeq);
          roundRecord = { id: info.lastInsertRowid };
        }

        const questionType = (row.type || 'MCQ').trim().toUpperCase();
        if (!['MCQ', 'IDENTIFICATION'].includes(questionType)) {
          throw new Error(`Invalid question type "${questionType}". Must be MCQ or IDENTIFICATION.`);
        }

        const questionText = (row.question || '').trim();
        if (!questionText) {
          throw new Error('Question text is empty.');
        }

        const codeSnippet = (row.code_snippet || '').trim();
        const correctAnswer = (row.correct_answer || '').trim();
        if (!correctAnswer) {
          throw new Error('Correct answer is empty.');
        }

        const points = parseInt(row.points, 10);
        const isTrialRound = ['TRIAL', 'WARMUP', 'PRACTICE'].includes(upperRound);
        if (isNaN(points) || (isTrialRound ? points < 0 : points <= 0)) {
          throw new Error(`Points must be a positive integer, got "${row.points}".`);
        }

        const timerSeconds = parseInt(row.timer_seconds, 10);
        if (isNaN(timerSeconds) || timerSeconds <= 0) {
          throw new Error(`Timer seconds must be a positive integer, got "${row.timer_seconds}".`);
        }

        // Build options JSON
        let optionsJson = '[]';
        if (questionType === 'MCQ') {
          optionsJson = JSON.stringify({
            A: (row.option_a || '').trim(),
            B: (row.option_b || '').trim(),
            C: (row.option_c || '').trim(),
            D: (row.option_d || '').trim()
          });
        }

        // Build synonyms JSON
        const synonymsList = extractSynonyms(row.synonyms, correctAnswer, questionType);
        const acceptableSynonymsJson = JSON.stringify(synonymsList);

        insertQuestionStmt.run(
          roundRecord.id,
          questionText,
          codeSnippet,
          questionType,
          optionsJson,
          correctAnswer,
          acceptableSynonymsJson,
          points,
          timerSeconds
        );

        importedCount++;
      } catch (err) {
        errors.push(`Row ${rowNum}: ${err.message}`);
      }
    });
  });

  importTx();

  return {
    success: errors.length === 0,
    importedCount,
    errors
  };
}

/**
 * Import questions from a CSV file into SQLite database
 * @param {string} filePath - Absolute or relative path to CSV file
 * @param {Database} dbInstance - better-sqlite3 database instance
 * @param {Object} [options={}] - { mode: 'replace' | 'append', replace: boolean }
 * @returns {{ success: boolean, importedCount: number, errors: string[] }}
 */
function importQuestionsFromCsv(filePath, dbInstance, options = {}) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`CSV file not found at: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  return importQuestionsFromContent(content, dbInstance, options);
}

module.exports = {
  importQuestionsFromCsv,
  importQuestionsFromContent,
  parseSynonyms,
  extractSynonyms,
  parseCsvContent,
  parseCsvBuffer
};
