# Test Infrastructure & Specification: OLFU IT Olympics LAN Quiz Bee System

## 1. Test Philosophy: Opaque-Box, Requirement-Driven Testing

The testing architecture for the OLFU IT Olympics LAN Quiz Bee System adheres to a strict **opaque-box, requirement-driven philosophy**:

1. **Zero Coupling to Internal Implementation Details**: Tests evaluate only externally observable interfaces and behavior:
   - HTTP route responses, status codes, and zero-CDN headers.
   - Real-time WebSocket event frames (payload schemas, emission order, room partitioning).
   - Relational database state persistence in SQLite (WAL mode, transactional consistency, constraints).
   - Authoritative epoch timing and state machine lifecycle transitions.
   - Standard output and terminal exit codes.
2. **Authoritative Output Derivation**: Every test case's expected output is strictly derived from the requirements in `ORIGINAL_REQUEST.md`, `PROJECT.md`, `docs/ITPM311_PROJECT_PLAN.md`, and the ground-truth data in `sample_questions.csv`.
3. **Progressive Testability & Isolation**: Tests are self-contained, independent, idempotent, and clean up temporary state (in-memory or test-scoped databases) after execution. Tests are structured to progressively verify features as milestones are completed, with clear reporting of readiness across all tiers.
4. **Adversarial & Concurrency Resilience**: The test suite actively challenges the system with malformed CSVs, raw HTML injection in options, rapid duplicate submissions, tab-switch flooding, network disconnects mid-countdown, and high-concurrency 30+ socket load bursts.

---

## 2. Test Tier Architecture

The test suite is organized into five complementary tiers:

```
tests/
├── e2e/
│   ├── tier1_features.test.js      # Feature Coverage across R1–R5 (>=5 tests per feature area)
│   ├── tier2_boundaries.test.js    # Boundary & Edge Cases (0s locks, XSS, trim, duplicates, late)
│   ├── tier3_interactions.test.js  # Pairwise Integration & Multi-Screen State Combinations
│   └── tier4_realworld.test.js     # Full Multi-Round Tournament Scenarios (>=5 scenarios)
├── simulation.test.js              # 30+ Headless Socket Contestant Concurrency Simulation
└── runAllTests.js                  # Unified Test Runner & Reporting Engine
```

---

## 3. Feature Inventory & Tier Mapping (R1–R7)

The table below maps all primary system requirements (R1–R7) and their architectural features into Tiers 1 through 3:

| Req | Feature Name | Description | Test Tier | Primary Test Target |
| :--- | :--- | :--- | :--- | :--- |
| **R1** | 5-Phase State Machine | Central engine coordinating LOBBY, READING, COUNTDOWN, LOCKED, REVIEW, LEADERBOARD, REVEAL | Tier 1 | `tests/e2e/tier1_features.test.js` |
| **R1** | Authoritative Epoch Timer | Epoch timestamping (`startedAt`, `expiresAt`), zero clock drift | Tier 1, Tier 2 | `tests/e2e/tier1_features.test.js`, `tier2_boundaries.test.js` |
| **R1** | 0s Timer Lock & Grace Window | Instant lock when countdown expires; rejection of post-grace submissions | Tier 2 | `tests/e2e/tier2_boundaries.test.js` |
| **R1** | Pause / Resume / Force Lock | Quizmaster emergency controls during active countdown | Tier 3 | `tests/e2e/tier3_interactions.test.js` |
| **R2** | Four Synchronized Views | Responsive offline views: QM Dashboard, Contestant, Projector, Judge | Tier 1 | `tests/e2e/tier1_features.test.js` |
| **R2** | Zero-CDN Local Delivery | Local asset serving with system font stacks, inline SVGs, local Socket.io | Tier 1 | `tests/e2e/tier1_features.test.js` |
| **R2** | Live Telemetry Grid | Matrix display of contestant workstation status and incident badges | Tier 1, Tier 3 | `tests/e2e/tier1_features.test.js`, `tier3_interactions.test.js` |
| **R2** | Judge Review Queue | Real-time queue for identification answers needing manual evaluation | Tier 1, Tier 3 | `tests/e2e/tier1_features.test.js`, `tier3_interactions.test.js` |
| **R2** | 1-Click Judge Ruling | 1-click Approve / Reject action buttons updating scores dynamically | Tier 1, Tier 3 | `tests/e2e/tier1_features.test.js`, `tier3_interactions.test.js` |
| **R3** | Multi-Tier Base Scoring | Easy (1 pt/15s), Average (2 pt/30s), Difficult (3 pt/45s), Clincher (5 pt/30s) | Tier 1 | `tests/e2e/tier1_features.test.js` |
| **R3** | Preliminary Speed Equality | No speed bonuses in regular rounds; all correct submissions receive base points | Tier 1 | `tests/e2e/tier1_features.test.js` |
| **R3** | Finals Speed Tie-Breaking | Earliest server millisecond timestamp breaks ties strictly in Clincher/finals | Tier 1, Tier 3 | `tests/e2e/tier1_features.test.js`, `tier3_interactions.test.js` |
| **R4** | Assigned Seat PIN Authentication | PINs 1001–1060 mapped 1-to-1 to physical lab workstations 1–60 | Tier 1 | `tests/e2e/tier1_features.test.js` |
| **R4** | Fullscreen Exit Detection | DOM fullscreen change hook emits `contestant:incident` (`FULLSCREEN_EXIT`) | Tier 1, Tier 3 | `tests/e2e/tier1_features.test.js`, `tier3_interactions.test.js` |
| **R4** | Window Blur & Tab-Switch Alert | Blur and `visibilitychange` listeners emit `contestant:incident` (`BLUR`) | Tier 1, Tier 3 | `tests/e2e/tier1_features.test.js`, `tier3_interactions.test.js` |
| **R4** | Telemetry Incident Debouncing | Client debouncing and server rate-limiting prevent `CHEAT_LOGS` spam | Tier 2, Tier 3 | `tests/e2e/tier2_boundaries.test.js`, `tier3_interactions.test.js` |
| **R4** | PIN Session Re-attachment | Workstation browser reload / crash recovery restoring question & timer | Tier 3 | `tests/e2e/tier3_interactions.test.js` |
| **R4** | Duplicate Socket Eviction | Re-login from same PIN evicts previous socket connection safely | Tier 3 | `tests/e2e/tier3_interactions.test.js` |
| **R5** | 12-Column CSV Importer | Ingestion of `sample_questions.csv` with robust quote handling | Tier 1 | `tests/e2e/tier1_features.test.js` |
| **R5** | Semicolon Synonym Normalizer | Parses semicolon-separated synonyms into normalized arrays | Tier 1, Tier 2 | `tests/e2e/tier1_features.test.js`, `tier2_boundaries.test.js` |
| **R5** | HTML Tag Sanitization | Safe handling of `<script>`, `<style>` in question options without XSS | Tier 2 | `tests/e2e/tier2_boundaries.test.js` |
| **R6** | 30+ Headless Socket Simulation | 30+ virtual contestant clients answering concurrently across rounds | Simulation | `tests/simulation.test.js` |
| **R6** | Concurrency & Race Condition Guard | SQLite WAL mode verifies zero database locks under burst submissions | Simulation | `tests/simulation.test.js` |
| **R7** | Project Documentation & Runbook | Validates presence, formatting, and completeness of ITPM 311 artifacts | Tier 1 | `tests/e2e/tier1_features.test.js` |

---

## 4. Real-World Application Scenarios (Tier 4)

Tier 4 exercises full end-to-end tournament simulations representing actual competition flows in the computer laboratory:

### Scenario 1: Standard Tournament Lifecycle (Happy Path)
- **Context**: 10 contestants (PINs 1001–1010) compete through Easy, Average, and Difficult rounds.
- **Flow**:
  1. Quizmaster stages Easy MCQ question; all terminals enter reading mode (inputs disabled).
  2. QM starts 15s countdown; all 10 contestants receive tick heartbeats and submit options.
  3. Timer expires; server transitions to `LOCKED`; submissions frozen.
  4. Server auto-grades MCQ answers against `correct_answer`; QM triggers stage reveal.
  5. QM triggers leaderboard display; standings reflect 1 point per correct contestant.
  6. Flow advances sequentially through Average (2 pts) and Difficult (3 pts) rounds.
- **Verification**: Zero dropped events, 100% accurate score tallies, valid phase progression.

### Scenario 2: High-Dispute Identification Tournament with Judge Interventions
- **Context**: Average and Difficult rounds featuring open-ended identification questions (`DROP TABLE`, `lambda`, `O(log n)`).
- **Flow**:
  1. QM stages Difficult question (`What SQL command is used to remove a table...`).
  2. Contestants submit varied answers:
     - Exact match: `"DROP TABLE"` (auto-approved, 2 pts).
     - Synonym match: `"DROPTABLE"` (auto-approved, 2 pts).
     - Case/whitespace variation: `"  drop table  "` (normalized and auto-approved, 2 pts).
     - Disputed variation: `"DROP"` (routed to Judge Queue as `PENDING`).
     - Erroneous answer: `"DELETE TABLE"` (routed to Judge Queue as `PENDING`).
  3. Judge Panel displays queue of 2 pending answers.
  4. Judge clicks **Approve** for `"DROP"`, awarding 2 points.
  5. Judge clicks **Reject** for `"DELETE TABLE"`, awarding 0 points.
  6. Leaderboard updates dynamically to reflect judge rulings before round close.
- **Verification**: Queue population, atomic ruling updates, total score recalculation.

### Scenario 3: Computer Lab Power Glitch / Browser Crash & Recovery
- **Context**: During a live 30s countdown, 3 contestant workstation browsers crash or refresh.
- **Flow**:
  1. Average round countdown active with 18 seconds remaining.
  2. Contestants 1003, 1007, and 1012 experience sudden socket disconnect.
  3. Contestants reopen browser and re-enter assigned PINs.
  4. Server authenticates PINs, matches existing sessions, and restores:
     - Active question ID and prompt text.
     - Synchronized remaining countdown time (e.g., 14 seconds remaining).
     - Current cumulative score.
  5. Recovered contestants submit answers before timer reaches 0s.
  6. All submissions successfully recorded with authoritative server timestamps.
- **Verification**: Seamless re-attachment, zero score loss, no duplicate submission errors.

### Scenario 4: Anti-Cheating Ingestion & Telemetry Incident Escalation
- **Context**: Several contestants attempt to switch windows, exit fullscreen, and use shortcut keys.
- **Flow**:
  1. Active tournament in progress.
  2. Contestant 1005 presses `Escape` to exit fullscreen; client emits `FULLSCREEN_EXIT`.
  3. Contestant 1008 switches tabs (`Alt+Tab`); client emits `BLUR`.
  4. Contestant 1008 rapidly repeats tab switches 10 times in 2 seconds.
  5. Server rate-limits incident logging to `CHEAT_LOGS` (debouncing flood attacks).
  6. Quizmaster Live Telemetry Grid immediately renders visual warning badges on Stations 5 and 8.
  7. Tournament execution continues uninterrupted without server latency spikes.
- **Verification**: Event propagation to QM room, SQLite `CHEAT_LOGS` records, rate-limiting stability.

### Scenario 5: Finals Clincher Sudden-Death with Millisecond Tie-Breaking
- **Context**: Contestants 1001 and 1002 are tied for 1st place with identical cumulative scores after Round 3.
- **Flow**:
  1. Quizmaster initiates Clincher / Sudden Death round (5 points, 30s timer).
  2. Clincher question staged: *"In computer networking, which protocol provides connectionless, unreliable datagram service...?"*.
  3. Countdown begins; both contestants submit correct answer (`"UDP"`).
  4. Contestant 1001 submits at server timestamp `T + 1245ms`.
  5. Contestant 1002 submits at server timestamp `T + 1890ms`.
  6. Server evaluates tie-break: both receive 5 base points, but Contestant 1001 is awarded Rank 1 based on earliest `server_time_ms`.
  7. Stage Projector displays final podium with Contestant 1001 in Gold position.
- **Verification**: Microsecond/millisecond precision ordering, tie-breaker activation strictly in Clincher.

---

## 5. Headless 30+ Socket Contestant Simulation (`tests/simulation.test.js`)

To guarantee LAN lab readiness under authentic hardware and network loads:
- **Client Fleet**: Spawns 35 simulated headless socket clients (PINs `1001` through `1035`).
- **Concurrent Handshakes**: Executes parallel PIN authentication against the server.
- **Multi-Round Execution**:
  - Round 1 (Easy MCQ): 35 concurrent answer emissions within countdown.
  - Round 2 (Average Identification): 35 concurrent text submissions with mixed synonyms.
  - Round 3 (Clincher): 35 concurrent burst submissions at tick 0.
- **Concurrency & WAL Mode Verification**: Verifies zero SQLite database lock errors (`SQLITE_BUSY`), zero dropped packets, and 100% deterministic leaderboard tally.

---

## 6. Coverage Thresholds & Quality Gates

| Tier | Test Suite | Minimum Test Cases / Coverage Target | Success Criteria |
| :--- | :--- | :--- | :--- |
| **Tier 1** | `tests/e2e/tier1_features.test.js` | **>= 5 test cases per feature area** (State Machine, Views, Scoring, Anti-Cheat, CSV Import, Docs) | 100% Pass |
| **Tier 2** | `tests/e2e/tier2_boundaries.test.js` | **>= 5 test cases per boundary area** (0s Locks, HTML Sanitize, Whitespace/Case, Synonyms, Empty Inputs, Duplicates, Late Submissions) | 100% Pass |
| **Tier 3** | `tests/e2e/tier3_interactions.test.js` | **Pairwise state combinations** (Reconnect mid-timer, Pause/Resume/Lock, ID + Judge + Score, Cheat alert escalation, Socket eviction) | 100% Pass |
| **Tier 4** | `tests/e2e/tier4_realworld.test.js` | **>= 5 full multi-round tournament scenarios** (Happy path, Judge dispute, Crash recovery, Anti-cheat alert, Finals tie-break) | 100% Pass |
| **Simulation** | `tests/simulation.test.js` | **30+ concurrent socket connections** across rounds, stress testing SQLite WAL mode | Exits code 0 |

---

## 7. Execution Commands

The test runner is executable via Node's native test runner without third-party test runners:

```bash
# Run complete test suite (Tiers 1-4 + Simulation)
node tests/runAllTests.js

# Or via Node native test runner directly:
node --test tests/runAllTests.js

# Run individual tiers:
node --test tests/e2e/tier1_features.test.js
node --test tests/e2e/tier2_boundaries.test.js
node --test tests/e2e/tier3_interactions.test.js
node --test tests/e2e/tier4_realworld.test.js
node --test tests/simulation.test.js
```
