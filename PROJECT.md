# Project: OLFU IT Olympics LAN Quiz Bee Management System

## Architecture
The system is an offline-first, local-area-network (LAN) tournament platform running autonomously on a single host machine (`192.168.1.100:3000` or local subnet) with zero internet/cloud dependencies.

### Architectural Subsystems & Data Flow
1. **Core Data & State Engine (`src/db.js`, `src/gameEngine.js`, `src/csvImporter.js`)**:
   - SQLite relational database (`quizbee.db`) configured with Write-Ahead Logging (`PRAGMA journal_mode = WAL;`) for high-concurrency read/write operations.
   - Authoritative 5-phase finite state machine (`LOBBY` -> `READING` -> `COUNTDOWN` -> `LOCKED` -> `REVIEW` -> `LEADERBOARD` -> `REVEAL`).
   - Server-authoritative epoch timing (`startedAt`, `expiresAt`) eliminating client-side clock skew.
2. **Real-Time Gateway & Telemetry (`src/socketHandler.js`, `src/server.js`)**:
   - Socket.io WebSocket server hosting local client libraries (`/socket.io/socket.io.js`) and partitioned into role rooms (`room:quizmaster`, `room:contestants`, `room:projector`, `room:judges`, `contestant:${pin}`).
   - NTP-lite LAN clock synchronization (±1ms precision).
   - Anti-cheat incident ingestion (`CHEAT_LOGS`), debouncing, and real-time telemetry alerting.
   - PIN-based session re-attachment with state rehydration and duplicate socket eviction.
3. **Four Synchronized Zero-CDN Client Interfaces (`public/`)**:
   - Zero-external-CDN static web views: Quizmaster Dashboard, Contestant Terminal, Projector Stage Display (1080p), and Judge/Tabulator Panel.
   - Native CSS variables, system font stacks, inline SVGs, and Web Audio API procedural sound synthesis (zero audio asset dependencies).
4. **Scoring, Evaluation & Tie-Breaking Engine**:
   - Tiered scoring: Easy (1 pt, 15s), Average (2 pts, 30s), Difficult (3 pts, 45s), Clincher (5 pts, 30s).
   - Multi-stage identification grader: canonical exact match -> semicolon-delimited synonym match -> whitespace/punctuation normalization -> fuzzy candidate / judge review queue.
   - Speed bonus evaluation strictly in finals/clincher using millisecond server timestamps (`server_time_ms`) to break score ties.
5. **Headless Programmatic Verification Suite (`tests/simulation.test.js`)**:
   - Automated simulation spawning 30+ concurrent headless socket contestant connections across all rounds with zero race conditions.
6. **ITPM 311 Documentation & Lab Runbook (`docs/`)**:
   - Comprehensive system architecture, SQLite DDL & data dictionary, WBS, risk matrix, and LAN setup runbook.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Autonomous Local Server | Host Express HTTP server on local port 3000 serving all assets offline without internet | M1 | R1, Survey §3.1 |
| 2 | SQLite Relational Schema | SQLite database schema with WAL mode: ROUNDS, QUESTIONS, CONTESTANTS, SUBMISSIONS, CHEAT_LOGS | M1 | R1, Survey §3.36 |
| 3 | CSV Question Bank Importer | Ingest 12-column CSV (`sample_questions.csv`) with robust quoting and error handling | M1 | R5, Survey §3.30 |
| 4 | Semicolon Synonym Normalizer | Parse semicolon-delimited synonyms into normalized lookup arrays | M1 | R5, Survey §3.31 |
| 5 | Seed Data Generator | CLI script to seed questions and 60 contestant PINs (1001–1060) | M1 | R1, Survey §4.2 |
| 6 | 5-Phase State Machine | Central engine coordinating LOBBY, READING, COUNTDOWN, LOCKED, REVIEW, LEADERBOARD | M1 | R1, Survey §3.2 |
| 7 | Server Authoritative Epoch Timer | Epoch-based timer (`expiresAt`) with pause, resume, and force-lock mechanics | M1 | R1, Survey §3.3 |
| 8 | Server Timestamping | Authoritative server receipt millisecond timestamp assigned to every submission | M1 | R1, Survey §3.4 |
| 9 | Socket.io Real-Time Gateway | WebSocket server with dedicated role rooms and event registry | M2 | R1, Survey §4.2 |
| 10 | NTP-Lite LAN Clock Sync | 3-way ping/pong protocol providing ±1ms clock offset calibration | M2 | R1, Survey §2.2 |
| 11 | PIN Session Re-attachment | Workstation crash/reload recovery restoring question, timer, and score | M2 | R4, Survey §3.12 |
| 12 | Duplicate Socket Eviction | Disconnects older socket when same PIN authenticates from another device | M2 | R4, Survey §2.5 |
| 13 | Anti-Cheat Telemetry Ingestion | Rate-limited logging of fullscreen exit, blur, and tab-switch into CHEAT_LOGS | M2 | R4, Survey §2.4 |
| 14 | Telemetry Alert Broadcast | Real-time emission of cheat incident badges to Quizmaster grid | M2 | R4, Survey §3.6 |
| 15 | Late Submission Guard | Strict rejection of submissions arriving after expiration + LAN grace window | M2 | R1, Survey §4.6 |
| 16 | Zero-CDN Asset Delivery | Local asset serving with system font stacks, inline SVGs, and local Socket.io client | M3 | R1, Survey §2.2 |
| 17 | Web Audio Procedural Sound Synthesizer | Offline sound synthesizer (ticks, chimes, buzzers, fanfare) via Web Audio API | M3 | R1, Survey §2.2 |
| 18 | Role Landing Hub | Clean entry page (`/`) linking to all four interface views | M3 | R2, Survey §4.2 |
| 19 | Quizmaster Dashboard | Tournament command center with question staging, timer triggers, overrides | M3 | R2, Survey §3.5 |
| 20 | Quizmaster Live Telemetry Grid | Responsive workstation matrix displaying connection status and cheat alerts | M3 | R2, Survey §3.6 |
| 21 | Quizmaster Question Admin UI | Admin interface to preview, add, edit questions and import CSVs | M3 | R5, Survey §3.32 |
| 22 | Contestant Terminal | PIN login, locked reading screen, MCQ buttons, Identification input field | M3 | R2, Survey §3.8-10 |
| 23 | Contestant Fullscreen Enforcement | Fullscreen request on login with modal warning if exited | M3 | R4, Survey §3.25-26 |
| 24 | Contestant Client Hardening | Intercept and block Ctrl+C/V/U, F12, context menu, text selection | M3 | R4, Survey §3.28 |
| 25 | Contestant Blur & Tab-Switch Hooks | Detect window blur and visibility change, emitting alerts to server | M3 | R4, Survey §3.27 |
| 26 | Projector 1080p Stage Screen | High-visibility spectator display with question text and animated timer | M3 | R2, Survey §3.13 |
| 27 | Syntax-Highlighted Code Block | Clean offline formatting of programming snippets in questions | M3 | R2, Survey §3.14 |
| 28 | Correct Answer Stage Reveal | Dramatic answer reveal card with class statistics | M3 | R2, Survey §3.15 |
| 29 | Animated Stage Leaderboard | Dynamic leaderboard podium and full ranked roster display | M3 | R2, Survey §3.16 |
| 30 | Judge / Tabulator Panel | Real-time queue for identification answers not matching exact strings | M3 | R2, Survey §3.17 |
| 31 | Judge 1-Click Ruling UI | 1-click Approve / Reject action buttons with synonym suggestions | M3 | R2, Survey §3.18 |
| 32 | Multi-Tier Base Scoring Rules | Easy (1 pt/15s), Average (2 pt/30s), Difficult (3 pt/45s), Clincher (5 pt/30s) | M4 | R3, Survey §3.19-22 |
| 33 | Multi-Stage Identification Evaluator | Exact match -> synonym match -> normalization -> judge review queue | M4 | R3, Survey §2.3 |
| 34 | Finals Speed Tie-Breaking Logic | Millisecond server timestamp ranking strictly in Clincher/finals for ties | M4 | R3, Survey §3.24 |
| 35 | Dynamic Score & Leaderboard Calculation | Transactional total score recomputation on grading or judge ruling | M4 | R3, Survey §2.3 |
| 36 | System Architecture Diagram & Spec | LAN topology, client roles, WebSocket event flows in Markdown/ASCII | M5 | R7, Survey §3.35 |
| 37 | SQLite Schema Specification | Complete DDL, data types, indexes, and entity relationship documentation | M5 | R7, Survey §3.36 |
| 38 | Work Breakdown Structure (WBS) | 5-phase project management breakdown (1.0 to 1.5) with deliverables | M5 | R7, Survey §3.37 |
| 39 | Risk Management & Contingency Matrix | Operational risks, probability, impact, and mitigation protocols | M5 | R7, Survey §3.38 |
| 40 | Computer Lab Network Setup Runbook | Static IP assignment, firewall rules, dry-run checklist, troubleshooting | M5 | R7, Survey §3.39 |
| 41 | Headless 30+ Socket Contestant Simulator | Automated simulation of 30+ concurrent sockets answering across rounds | M6 | R6, Survey §3.33 |
| 42 | Concurrency & Race-Condition Integrity | Concurrency verification under heavy simultaneous socket traffic, exiting code 0 | M6 | R6, Survey §3.34 |
| 43 | 100% E2E Test Suite Pass & Adversarial Hardening | Verification of all 5 tiers of E2E tests and white-box coverage hardening | M6 | R6, Project Pattern |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Core Engine & Data Foundation | SQLite schema, WAL mode, CSV importer, seed generator, 5-phase state machine, authoritative epoch timer | none | DONE |
| M2 | Real-Time Gateway & Anti-Cheat Telemetry | Socket.io server, role rooms, NTP-lite clock sync, PIN session re-attachment, anti-cheat incident ingestion & alerting | M1 | BLOCKED: Iteration 1 Gate Failure (auditor INTEGRITY VIOLATION) |
| M3 | Synchronized Multi-Screen User Interfaces | 4 responsive zero-CDN web views (QM, Contestant, Projector, Judge), procedural Web Audio, fullscreen/anti-cheat client hooks | M2 | PLANNED |
| M4 | Scoring Engine, Tie-Breaking & Review Logic | Tiered round points, multi-stage identification grader, judge queue actions, finals millisecond speed tie-breaking, leaderboard aggregation | M1, M2 | PLANNED |
| M5 | ITPM 311 Project Documentation & LAN Runbook | Architecture diagram, SQLite schema documentation, WBS, Risk Management Matrix, Computer Lab Network Setup Runbook | none | PLANNED |
| M6 | Final Milestone: 100% E2E Test Pass & Adversarial Hardening | Execute 30+ headless socket simulation suite across all tiers (Tiers 1-4 100% pass, Tier 5 adversarial hardening) | M1, M2, M3, M4, M5, TEST_READY.md | PLANNED |

---

## Interface Contracts

### `src/db.js` (Database API)
- `initDb(dbPath)`: Initializes SQLite database in WAL mode and creates tables `ROUNDS`, `QUESTIONS`, `CONTESTANTS`, `SUBMISSIONS`, `CHEAT_LOGS`.
- `getQuestion(id)`: Returns question record with parsed options and synonyms JSON.
- `getAllQuestions(roundId?)`: Returns question list.
- `saveSubmission(contestantId, questionId, answer, serverTimeMs, isCorrect, judgeStatus, points)`: Persists submission atomically.
- `updateSubmissionRuling(submissionId, judgeStatus, awardedPoints)`: Updates judge ruling and recalculates contestant total score.
- `logIncident(contestantId, incidentType, details)`: Logs anti-cheat incident to `CHEAT_LOGS`.
- `getContestantByPin(pin)`: Returns contestant row or null.
- `getLeaderboard(roundId?)`: Returns sorted list of `{ rank, pin, fullName, terminalNumber, score, lastSubmitTimeMs }`.

### `src/gameEngine.js` (State Machine API)
- `getState()`: Returns `{ phase, currentQuestion, timer: { startedAt, expiresAt, durationMs, remainingMs, isPaused }, roundId }`.
- `stageQuestion(questionId)`: Transitions to `READING`. Returns updated state.
- `startCountdown(durationSeconds?)`: Transitions to `COUNTDOWN`, sets `startedAt` and `expiresAt`.
- `pauseCountdown()`: Transitions to `PAUSED`, freezes remaining milliseconds.
- `resumeCountdown()`: Transitions to `COUNTDOWN`, recalculates `expiresAt`.
- `lockQuestion()`: Transitions to `LOCKED`, freezes input.
- `revealAnswer()`: Transitions to `REVEAL`.
- `showLeaderboard()`: Transitions to `LEADERBOARD`.
- `resetRound()`: Transitions to `LOBBY`.

### `src/socketHandler.js` (Socket Event Contracts)
- Roles and rooms: `room:quizmaster`, `room:contestants`, `room:projector`, `room:judges`, `contestant:${pin}`.
- Telemetry events: `contestant:incident` `{ pin, type, details }` -> `qm:telemetry:alert` `{ pin, terminalNumber, incidentType, timestamp }`.
- Session restore: `contestant:auth` `{ pin }` -> `contestant:session:restore` `{ success, contestant, gameState }`.
- Dispute action: `judge:dispute:action` `{ submissionId, status: 'APPROVED' | 'REJECTED' }` -> dynamic score broadcast.

### `src/csvImporter.js` (CSV Parser API)
- `importQuestionsFromCsv(filePath, db)`: Parses 12-column CSV, sanitizes HTML options, normalizes synonyms, inserts into `QUESTIONS` table. Returns `{ importedCount, errors: [] }`.

---

## Code Layout
```
quizbee/
├── .agents/                      # Coordination metadata (read-only for application)
├── docs/                         # ITPM 311 documentation artifacts
│   ├── ITPM311_PROJECT_PLAN.md   # Reference project plan
│   ├── SYSTEM_ARCHITECTURE.md    # System architecture diagram and network topology
│   ├── DATABASE_SCHEMA.md        # SQLite schema DDL and data dictionary
│   ├── WORK_BREAKDOWN_STRUCTURE.md # WBS (1.0 to 1.5)
│   ├── RISK_MANAGEMENT_MATRIX.md # Risk and contingency matrix
│   └── LAB_SETUP_RUNBOOK.md      # Computer lab network runbook & checklist
├── sample_questions.csv          # Authoritative sample questions
├── public/                       # Zero-CDN static frontend assets
│   ├── css/
│   │   ├── shared.css            # Common tokens, responsive layout, dark theme
│   │   ├── quizmaster.css        # QM dashboard and telemetry matrix styles
│   │   ├── contestant.css        # PIN pad, focus mode, MCQ/ID input styles
│   │   ├── projector.css         # 1080p display, large timer, podium animations
│   │   └── judge.css             # Dispute queue cards and review styles
│   ├── js/
│   │   ├── audio.js              # Web Audio API procedural sound synthesizer
│   │   ├── quizmaster.js         # QM client controller
│   │   ├── contestant.js         # Contestant controller and anti-cheat hooks
│   │   ├── projector.js          # Projector display controller
│   │   └── judge.js              # Judge review controller
│   ├── index.html                # Navigation landing page
│   ├── quizmaster.html           # Quizmaster Dashboard view
│   ├── contestant.html           # Contestant Terminal view
│   ├── projector.html            # Stage Projector view
│   └── judge.html                # Judge / Tabulator Panel view
├── src/                          # Server-side modules
│   ├── config.js                 # Network IP auto-detection, ports, constants
│   ├── db.js                     # SQLite initialization and query helpers
│   ├── gameEngine.js             # 5-phase authoritative state machine
│   ├── scoringEngine.js          # Tiered scoring, synonym matcher, tie-breaker
│   ├── socketHandler.js          # Socket.io event registry, rooms, telemetry
│   ├── csvImporter.js            # CSV parser for question bank
│   └── server.js                 # Express bootstrap and static asset hosting
├── scripts/
│   └── seed.js                   # Populates DB with sample questions and PINs (1001-1060)
├── tests/                        # Programmatic verification and E2E suites
│   ├── e2e/                      # Opaque-box E2E test suites (Tiers 1-4)
│   │   ├── tier1_features.test.js
│   │   ├── tier2_boundaries.test.js
│   │   ├── tier3_interactions.test.js
│   │   └── tier4_realworld.test.js
│   ├── simulation.test.js        # 30+ headless socket contestant simulation
│   └── runAllTests.js            # Full test runner script
├── package.json                  # Scripts and dependencies
└── README.md                     # Overview and quick-start guide
```
