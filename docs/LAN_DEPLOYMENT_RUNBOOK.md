# OLFU IT Olympics Quiz Bee — LAN Deployment Runbook
## Computer Laboratory Network Configuration & Execution Protocol (ITPM 311)

---

## 1. Network Topology & Lab Architecture

```
                          ┌────────────────────────┐
                          │    Gigabit Ethernet    │
                          │   Lab Switch / Router  │
                          │     192.168.1.1/24     │
                          └───────────┬────────────┘
                                      │
       ┌──────────────────────────────┼─────────────────────────────┐
       │                              │                             │
┌──────▼─────────────────┐   ┌────────▼──────────────┐   ┌──────────▼──────────────┐
│ Host Server Machine    │   │ Stage Projector PC    │   │ Judge / Tabulator PC    │
│ 192.168.1.100:3000     │   │ 192.168.1.200         │   │ 192.168.1.202           │
│ Node.js + SQLite (WAL) │   │ Fullscreen 1080p View │   │ Real-time Ruling Queue  │
└────────────────────────┘   └───────────────────────┘   └─────────────────────────┘
                                      │
            ┌─────────────────────────┴─────────────────────────┐
            │                                                   │
┌───────────▼────────────┐                             ┌────────▼──────────────┐
│ Contestant Station 01  │         . . . . . .         │ Contestant Station 60 │
│ 192.168.1.101 (PIN 1001)                             │ 192.168.1.160 (PIN 1060)
└────────────────────────┘                             └───────────────────────┘
```

---

## 2. Server Host Machine Setup (Pre-Event)

### 2.1 Hardware Requirements
* **Operating System**: Windows 10/11, Ubuntu 22.04 LTS, or macOS.
* **Processor**: Intel Core i5 / AMD Ryzen 5 or better.
* **Memory**: 8 GB RAM minimum (16 GB recommended).
* **Network Interface**: Gigabit Ethernet (Wired connection directly to main lab switch recommended).

### 2.2 Network & IP Assignment
Assign a static IP to the host machine to ensure all lab terminals connect reliably to `192.168.1.100`.

#### Windows (PowerShell as Administrator)
```powershell
New-NetIPAddress -InterfaceAlias "Ethernet" -IPAddress "192.168.1.100" -PrefixLength 24 -DefaultGateway "192.168.1.1"
```

#### Linux (bash)
```bash
sudo ip addr add 192.168.1.100/24 dev eth0
sudo ip route add default via 192.168.1.1
```

### 2.3 Firewall Rule Configuration
Open TCP port 3000 for local intranet access:

#### Windows (Command Prompt as Administrator)
```cmd
netsh advfirewall firewall add rule name="OLFU QuizBee Server" dir=in action=allow protocol=TCP localport=3000
```

#### Linux (ufw)
```bash
sudo ufw allow 3000/tcp
```

---

## 3. Starting the Quiz Bee Server

### 3.1 Install Dependencies & Seed Database
```bash
cd /home/javvii/YearIII/ITPM311/quizbee
npm install
npm run seed
```

### 3.2 Start the Server
```bash
npm start
```
Upon startup, the console displays the server banner:
```
========================================================================
   OLFU IT OLYMPICS LAN QUIZ BEE MANAGEMENT SYSTEM (ITPM 311)          
   "Fatima QuizBee Engine" — Authoritative Offline LAN Gateway          
========================================================================
 LAN Host IP:        192.168.1.100
 Binding Address:    0.0.0.0:3000
 Database:           quizbee.db (SQLite WAL Mode)
 Workstation Range:  Terminals 1–60 (PIN 1001–1060)
------------------------------------------------------------------------
 Role Interface URLs:
   • Landing Hub:        http://192.168.1.100:3000/
   • Quizmaster:         http://192.168.1.100:3000/quizmaster
   • Contestant PCs:     http://192.168.1.100:3000/contestant
   • Stage Projector:    http://192.168.1.100:3000/projector
   • Judge Panel:        http://192.168.1.100:3000/judge
========================================================================
```

---

## 4. Workstation Deployment & Terminal Distribution

### 4.1 Contestant Terminals (60 Stations)
1. Launch Google Chrome or Microsoft Edge on each computer lab workstation.
2. Navigate to: `http://192.168.1.100:3000/contestant`
3. Optional: Create a desktop shortcut pointing to the contestant URL.
4. Distribute physical PIN slips corresponding to designated desks:
   * Desk 1: PIN `1001`
   * Desk 2: PIN `1002`
   * ...
   * Desk 60: PIN `1060`

### 4.2 Stage Projector (Audience View)
1. Connect the stage PC to the overhead auditorium/lab projector.
2. Open Chrome/Edge and browse to: `http://192.168.1.100:3000/projector`
3. Press `F11` to enter native 1080p borderless fullscreen.

### 4.3 Judge / Tabulator Panel
1. The judge PC connects via: `http://192.168.1.100:3000/judge`
2. Panel auto-streams disputed or open-ended answers needing review.

### 4.4 Quizmaster Dashboard
1. The Quizmaster operates from: `http://192.168.1.100:3000/quizmaster`
2. Provides phase progression (`Stage Question` $\rightarrow$ `Start Timer` $\rightarrow$ `Lock` $\rightarrow$ `Reveal` $\rightarrow$ `Leaderboard`).

---

## 5. Event-Day Execution Timeline (T-Minus Protocol)

| Timing | Activity | Owner | Checklist |
| :--- | :--- | :--- | :--- |
| **T - 120 min** | Power on lab switch, verify DHCP/static IP routing. | Network Proctor | [ ] Ping `192.168.1.100` from test PC |
| **T - 90 min** | Start Quiz Bee Server; verify `/api/health` returns `healthy`. | Server Admin | [ ] SQLite WAL mode active |
| **T - 60 min** | Import faculty question bank via `sample_questions.csv`. | Quiz Coordinator | [ ] Questions verified in QM dashboard |
| **T - 45 min** | Boot 60 lab PCs, open `/contestant`, verify status dot is green. | Lab Assistants | [ ] All 60 stations connected |
| **T - 30 min** | Contestants enter lab, seat at assigned terminals, enter PINs. | Proctors | [ ] QM telemetry grid shows 60 online tiles |
| **T - 15 min** | Run 1 sample practice question to test timer & audio chime. | Quizmaster | [ ] Projector reveals answer; audio verified |
| **T - 0 min** | Official Tournament Commences: Round 1 (Easy). | Quizmaster | [ ] Stage flow initialized |

---

## 6. Contingency Procedures

* **Workstation Freeze / Accidental Browser Close**: Contestant restarts browser and re-enters their PIN. Server rehydrates current question, timer, and cumulative score with zero data loss.
* **Network Cable Disconnect**: Reconnect cable. Socket auto-reconnects and re-authenticates via stored session token.
* **Faculty Disputed Spelling**: Judge panel permits 1-click `[Approve]` with custom point assignment prior to answer reveal.
