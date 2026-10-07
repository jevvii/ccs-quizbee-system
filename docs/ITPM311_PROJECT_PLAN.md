# OLFU IT Olympics: Digitalized Quiz Bee System
## ITPM 311 Comprehensive Project Charter, System Architecture & Operational Blueprint

This document contains the complete project specification, architecture design, database schema, ITPM 311 management artifacts (WBS, Gantt, Risk Management), and LAN deployment runbook for the Our Lady of Fatima University (OLFU) IT Olympics Quiz Bee system.

---

## 1. Project Charter & Executive Summary

### 1.1 Project Overview
* **Project Name**: Digitalized LAN Quiz Bee Management System (*"Fatima QuizBee Engine"*)
* **Course & Code**: ITPM 311 (IT Project Management)
* **Client / Host Institution**: College of Computer Studies, Our Lady of Fatima University (OLFU)
* **Venue**: University Computer Laboratory (Local LAN Environment)
* **Event**: Annual IT Olympics Quiz Bee Competition

### 1.2 Problem Statement
Traditional computer lab quiz bees rely on manual pen-and-paper, whiteboard scoreboards, or cloud-hosted quiz software (e.g., Kahoot, Quizizz, Google Forms). In a university computer lab setting, this presents severe bottlenecks:
1. **Network Fragility**: Cloud platforms fail when campus Wi-Fi or proxy firewalls throttle or disconnect under high concurrent traffic.
2. **Delayed Tabulation & Human Error**: Manual score tallying across Easy, Average, and Difficult rounds causes lengthy dead air and score disputes.
3. **Academic Dishonesty Risks**: Lab computers have web browsers with internet access and shortcut keys, making tab-switching and searching easy if not restricted.
4. **Poor Spectator & Stage Experience**: Audiences and judges lack synchronized real-time visualization of question timers and leaderboard shifts.

### 1.3 Solution & Scope
A self-hosted, offline-first Local Area Network (LAN) real-time web application built on **Node.js, Express, Socket.io, React/Tailwind, and SQLite**. The system is hosted directly on a quizmaster/server machine in the lab, serving up to 60+ individual contestant terminals, a dedicated projector display, and a judge validation panel with sub-second synchronization and zero reliance on external internet.

---

## 2. Competition Rules & Game Engine Logic

### 2.1 Round Structure & Point Weights
| Round | Number of Questions | Time Limit | Question Types | Points per Question | Scoring Mechanics |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Round 1: Easy** | 10 | 15s | Multiple Choice | **1 point** | Auto-graded immediately |
| **Round 2: Average** | 10 | 30s | Multiple Choice / Identification | **2 points** | Auto-graded / Judge queue |
| **Round 3: Difficult** | 10 | 45s | Identification / Code Syntax | **3 points** | Auto-graded / Judge queue |
| **Clincher / Tie-Breaker** | Sudden Death | 30s | Identification / Problem Solving | **5 points** | Earliest correct submission breaks tie |

### 2.2 Speed Bonus & Tie-Breaking Rule
* **Preliminary Rounds (Easy, Average, Difficult)**: All contestants who submit the correct answer within the allotted timer receive the full base points for that round. Response speed is recorded but does **not** grant bonus points, ensuring accuracy is paramount.
* **Finals & Tie-Breaking (Clincher)**: Speed bonuses and tie-breaking are applied **strictly in the finals and only when breaking score ties**. The contestant terminal with the lowest timestamp (server-received time in milliseconds) among correct submissions is awarded rank precedence or tie-break bonus.

### 2.3 The "Standard Stage Flow" State Machine
The competition follows a strict, orchestrated 5-stage lifecycle per question controlled by the Quizmaster:

```
[Quizmaster Selects Question]
           │
           ▼
[Stage 1: Reading Mode] (Projector displays question; Contestant terminals locked)
           │  (Quizmaster reads question twice)
           ▼
[Stage 2: Countdown Mode] (Authoritative timer starts; Contestant terminals unlock)
           │  (Contestants submit answers)
           ▼
[Stage 3: Submissions Locked] (Timer reaches 0s; All submissions frozen)
           │
           ▼
[Stage 4: Judge Review & Answer Reveal] (Disputed identification answers verified; Reveal answer on stage)
           │
           ▼
[Stage 5: Leaderboard Broadcast] (Scores tabulated; Animated leaderboard displayed on Projector)
```

---

## 3. System Architecture & Real-Time Protocol

### 3.1 Network Topology (Computer Lab LAN)
* **Local Subnet**: `192.168.1.0/24`
* **Host Machine (Server)**: `192.168.1.100:3000` (Node.js + Socket.io + SQLite)
* **Contestant Terminals**: `192.168.1.101` to `192.168.1.160` (Lab PCs)
* **Projector Screen**: `192.168.1.200`
* **Quizmaster Dashboard**: `192.168.1.201`
* **Judge Panel**: `192.168.1.202`

### 3.2 Real-Time WebSocket Events (Socket.io)
| Event Name | Direction | Payload | Description |
| :--- | :--- | :--- | :--- |
| `qm:question:stage` | QM -> Server | `{ questionId, roundId }` | Sets active question in Reading mode. |
| `qm:timer:start` | QM -> Server | `{ durationSeconds, questionId }` | Server starts tick countdown, unlocks contestant screens. |
| `game:tick` | Server -> All | `{ remainingSeconds, serverTime }` | Synchronized 1-second interval heartbeat. |
| `contestant:submit` | Contestant -> Server | `{ terminalPin, questionId, answer, clientTimestamp }` | Recorded with authoritative `serverTimestamp`. |
| `game:question:lock` | Server -> All | `{ questionId }` | Locks all contestant terminals immediately. |
| `judge:dispute:action`| Judge -> Server | `{ submissionId, status: 'APPROVED'\|'REJECTED' }` | Updates pending identification answer score. |
| `qm:reveal:answer` | QM -> Server | `{ questionId }` | Triggers correct answer reveal on spectator screen. |
| `game:leaderboard` | Server -> All | `[ { rank, contestantName, terminalNumber, score } ]` | Broadcasts recalculated standings. |
| `contestant:alert` | Contestant -> Server | `{ terminalPin, alertType: 'BLUR'\|'FULLSCREEN_EXIT' }` | Flags anti-cheating incident to Quizmaster dashboard. |

---

## 4. Database Schema (SQLite)

* `ROUNDS` (`id`, `name`, `weight_points`, `default_timer_sec`, `sequence_order`)
* `QUESTIONS` (`id`, `round_id`, `question_text`, `code_snippet`, `question_type`, `options_json`, `correct_answer`, `acceptable_synonyms_json`, `points`, `timer_seconds`)
* `CONTESTANTS` (`id`, `pin`, `terminal_number`, `student_id`, `full_name`, `department_or_section`, `total_score`, `is_connected`, `last_socket_id`)
* `SUBMISSIONS` (`id`, `contestant_id`, `question_id`, `submitted_answer`, `server_time_ms`, `is_correct`, `judge_status`, `awarded_points`)
* `CHEAT_LOGS` (`id`, `contestant_id`, `incident_type`, `timestamp`, `details`)

---

## 5. User Interfaces & Role Specifications

1. **Quizmaster / Admin Dashboard**: Question selection, reading phase toggle, countdown trigger, force lock, emergency override, and live terminal connection matrix.
2. **Contestant View**: Terminal authentication via PIN, reading lock screen, dynamic response form (MCQ buttons or identification field), instant lock on timeout, and anti-tamper safeguards.
3. **Projector / Spectator Screen**: High-visibility stage display with large animated countdown timer, syntax-highlighted code blocks, answer reveal graphics, and animated leaderboard.
4. **Tabulator / Judge Panel**: Queue for open-ended/identification submissions that did not match exact string patterns; 1-click approval or rejection.

---

## 6. Anti-Cheating & Integrity Safeguards

1. **Fullscreen Enforcement**: Browser automatically enters fullscreen upon test start; warns and logs server alerts if exited.
2. **Tab-Switch & Blur Detection**: `visibilitychange` and `window.blur` listeners notify the server if contestants switch windows or open developer tools.
3. **Pre-assigned Seat PINs**: Unique 4-digit PINs tied strictly to designated physical PC workstation numbers.
4. **Shortcut & Right-Click Disabling**: Suppresses context menus, `Ctrl+C`, `Ctrl+V`, `Ctrl+U`, and `F12`.
5. **State Reconnect & Resume**: Contestant sessions survive browser reloads or crashes; entering their PIN restores their current question state and remaining timer.

---

## 7. ITPM 311 Project Artifacts

### 7.1 Work Breakdown Structure (WBS)
```
1.0 OLFU Quiz Bee Management System
├── 1.1 Project Initiation & Requirements (Week 1)
├── 1.2 System Architecture & Design (Week 1 - 2)
├── 1.3 Core Engineering & Implementation (Week 2 - 3)
├── 1.4 Verification & Lab Simulation (Week 3 - 4)
└── 1.5 Live Deployment & Post-Event (Week 4)
```

### 7.2 Risk Management & Contingency Plan
* **Network drop / Switch power surge**: Host machine runs on UPS; game pause preserves state in SQLite.
* **Lab PC Crash**: Reassign contestant to spare PC; entering assigned PIN immediately restores score and state.
* **Spelling dispute**: Judge panel provides real-time review queue with 1-click overrides before round finalization.
* **Host PC Port Block**: Windows Firewall rule pre-configured via script before event day.

---

## 8. LAN Deployment Runbook

1. **Server Host Machine**: Connect via Ethernet to the main lab switch. Assign static IP: `192.168.1.100`.
2. **Inbound Firewall Rule**: Allow TCP port 3000.
3. **Run Application**: Execute `npm run start`.
4. **Lab PC Terminals**: Open Chrome or Edge and point to `http://192.168.1.100:3000/contestant`.
5. **Stage Projector**: Point browser to `http://192.168.1.100:3000/projector`.
