/**
 * public/js/projector.js
 * OLFU IT Olympics LAN Quiz Bee System (ITPM 311)
 * 1080p Stage Spectator Display & Leaderboard Podium Controller (Zero-CDN)
 */

(function () {
  'use strict';

  let socket = null;
  let currentQuestion = null;

  // DOM Elements - Stage Sections
  const stageLobby = document.getElementById('stage-lobby');
  const stageQuestionCard = document.getElementById('stage-question-card');
  const stageLeaderboard = document.getElementById('stage-leaderboard');

  // Stage Header
  const elRoundName = document.getElementById('stage-round-name');
  const elPhasePill = document.getElementById('stage-phase-pill');
  const elStageItemBadge = document.getElementById('stage-item-badge');
  const elStageTimer = document.getElementById('stage-timer');

  // Question & Code Block
  const elQuestionText = document.getElementById('stage-question-text');
  const elCodeSnippet = document.getElementById('stage-code-snippet');
  const elCodeBlock = elCodeSnippet ? elCodeSnippet.querySelector('code') : null;
  const elStageCountdownNotice = document.getElementById('stage-countdown-notice');
  const elOptionsGrid = document.getElementById('stage-options-grid');

  // Reveal Card
  const elRevealCard = document.getElementById('reveal-card');
  const elCorrectAnswer = document.getElementById('correct-answer-text');
  const elAnswerExplanation = document.getElementById('answer-explanation');

  // Leaderboard Podium & Roster
  const elPodiumName1 = document.getElementById('podium-name-1');
  const elPodiumScore1 = document.getElementById('podium-score-1');
  const elPodiumName2 = document.getElementById('podium-name-2');
  const elPodiumScore2 = document.getElementById('podium-score-2');
  const elPodiumName3 = document.getElementById('podium-name-3');
  const elPodiumScore3 = document.getElementById('podium-score-3');
  const elRosterTbody = document.getElementById('stage-roster-tbody');

  // Audio Widget & Banner
  const bannerAudioUnlock = document.getElementById('audio-unlock-banner');
  const btnAudioMute = document.getElementById('btn-audio-mute');
  const sliderAudioVolume = document.getElementById('audio-volume-slider');

  function init() {
    setupAudioUnlock();
    initSocketConnection();
  }

  function setupAudioUnlock() {
    if (bannerAudioUnlock) {
      bannerAudioUnlock.addEventListener('click', () => {
        if (window.QuizAudio) {
          window.QuizAudio.init();
          window.QuizAudio.resume();
        }
        bannerAudioUnlock.style.display = 'none';
      });
    }

    if (btnAudioMute && window.QuizAudio) {
      btnAudioMute.addEventListener('click', () => {
        const isMuted = window.QuizAudio.toggleMute();
        btnAudioMute.style.opacity = isMuted ? '0.4' : '1';
      });
    }

    if (sliderAudioVolume && window.QuizAudio) {
      sliderAudioVolume.addEventListener('input', (e) => {
        window.QuizAudio.setVolume(parseFloat(e.target.value));
      });
    }
  }

  function initSocketConnection() {
    if (typeof io === 'undefined') return;

    socket = io();

    socket.on('connect', () => {
      socket.emit('projector:join');
    });

    socket.on('projector:init', (data) => {
      if (!data || !data.success) return;
      if (data.gameState) {
        applyGameState(data.gameState);
      }
    });

    socket.on('game:phase:change', (data) => {
      const phase = data.newPhase || data.phase;
      if (data.state) {
        applyGameState(data.state);
      } else {
        setPhase(phase);
      }

      if (window.QuizAudio) {
        if (phase === 'READING') window.QuizAudio.playPhaseChime();
        else if (phase === 'LOCKED') window.QuizAudio.playLock();
        else if (phase === 'REVEAL') window.QuizAudio.playCorrect();
        else if (phase === 'LEADERBOARD') window.QuizAudio.playFanfare();
      }
    });

    socket.on('game:tick', (data) => {
      const sec = data.remainingSeconds !== undefined ? data.remainingSeconds : Math.ceil(data.remainingMs / 1000);
      updateTimerDisplay(sec);

      if (window.QuizAudio) {
        if (sec <= 5 && sec > 0) window.QuizAudio.playWarningTick();
        else if (sec > 5) window.QuizAudio.playTick();
      }
    });

    socket.on('game:question:lock', () => {
      updateTimerDisplay(0);
      if (elPhasePill) elPhasePill.textContent = 'SUBMISSIONS CLOSED';
      if (window.QuizAudio) window.QuizAudio.playLock();
    });

    socket.on('game:answer:reveal', (data) => {
      showAnswerReveal(data);
      if (window.QuizAudio) window.QuizAudio.playCorrect();
    });

    socket.on('game:leaderboard', (data) => {
      renderLeaderboard(data.leaderboard || []);
      if (window.QuizAudio) window.QuizAudio.playFanfare();
    });

    socket.on('leaderboard:update', (data) => {
      renderLeaderboard(data.leaderboard || []);
    });
  }

  function applyGameState(state) {
    if (!state) return;
    setPhase(state.phase);

    if (state.currentQuestion) {
      currentQuestion = state.currentQuestion;
      renderQuestion(state.currentQuestion);
    }
  }

  function setPhase(phase) {
    switch (phase) {
      case 'LOBBY':
        stageLobby.classList.remove('hidden');
        stageQuestionCard.classList.add('hidden');
        stageLeaderboard.classList.add('hidden');
        if (elStageCountdownNotice) elStageCountdownNotice.classList.add('hidden');
        if (elPhasePill) elPhasePill.textContent = 'STANDBY';
        break;

      case 'READING':
        stageLobby.classList.add('hidden');
        stageQuestionCard.classList.remove('hidden');
        stageLeaderboard.classList.add('hidden');
        elRevealCard.classList.add('hidden');
        if (elStageCountdownNotice) elStageCountdownNotice.classList.add('hidden');

        // Flashed to stage projector
        if (elQuestionText) {
          elQuestionText.classList.remove('hidden');
          elQuestionText.classList.remove('staged-flash');
          void elQuestionText.offsetWidth; // trigger reflow for flash animation
          elQuestionText.classList.add('staged-flash');
        }
        if (currentQuestion && currentQuestion.code_snippet && elCodeSnippet) {
          elCodeSnippet.classList.remove('hidden');
        }
        if (currentQuestion && (currentQuestion.type === 'MCQ' || currentQuestion.question_type === 'MCQ') && elOptionsGrid) {
          elOptionsGrid.classList.remove('hidden');
        }

        if (elPhasePill) {
          elPhasePill.className = 'badge badge-info';
          elPhasePill.textContent = 'READING PHASE';
        }
        resetOptionCards();
        break;

      case 'COUNTDOWN':
        stageLobby.classList.add('hidden');
        stageQuestionCard.classList.remove('hidden');
        stageLeaderboard.classList.add('hidden');
        elRevealCard.classList.add('hidden');

        // Question prompt disappears after timer starts
        if (elQuestionText) elQuestionText.classList.add('hidden');
        if (elCodeSnippet) elCodeSnippet.classList.add('hidden');
        if (elOptionsGrid) elOptionsGrid.classList.add('hidden');
        if (elStageCountdownNotice) elStageCountdownNotice.classList.remove('hidden');

        if (elPhasePill) {
          elPhasePill.className = 'badge badge-gold';
          elPhasePill.textContent = 'COUNTDOWN ACTIVE';
        }
        break;

      case 'PAUSED':
        if (elPhasePill) {
          elPhasePill.className = 'badge badge-slate';
          elPhasePill.textContent = 'TIMER PAUSED';
        }
        break;

      case 'LOCKED':
        if (elPhasePill) {
          elPhasePill.className = 'badge badge-danger';
          elPhasePill.textContent = 'SUBMISSIONS CLOSED';
        }
        if (elStageCountdownNotice) elStageCountdownNotice.classList.add('hidden');
        if (elQuestionText) elQuestionText.classList.remove('hidden');
        if (currentQuestion && currentQuestion.code_snippet && elCodeSnippet) {
          elCodeSnippet.classList.remove('hidden');
        }
        if (currentQuestion && (currentQuestion.type === 'MCQ' || currentQuestion.question_type === 'MCQ') && elOptionsGrid) {
          elOptionsGrid.classList.remove('hidden');
        }
        updateTimerDisplay(0);
        break;

      case 'REVIEW':
        if (elPhasePill) {
          elPhasePill.className = 'badge badge-purple';
          elPhasePill.textContent = 'JUDGE EVALUATION';
        }
        if (elStageCountdownNotice) elStageCountdownNotice.classList.add('hidden');
        if (elQuestionText) elQuestionText.classList.remove('hidden');
        break;

      case 'REVEAL':
        stageLobby.classList.add('hidden');
        stageQuestionCard.classList.remove('hidden');
        stageLeaderboard.classList.add('hidden');
        if (elStageCountdownNotice) elStageCountdownNotice.classList.add('hidden');
        if (elQuestionText) elQuestionText.classList.remove('hidden');
        if (currentQuestion && currentQuestion.code_snippet && elCodeSnippet) {
          elCodeSnippet.classList.remove('hidden');
        }
        if (currentQuestion && (currentQuestion.type === 'MCQ' || currentQuestion.question_type === 'MCQ') && elOptionsGrid) {
          elOptionsGrid.classList.remove('hidden');
        }
        if (elPhasePill) {
          elPhasePill.className = 'badge badge-emerald';
          elPhasePill.textContent = 'ANSWER REVEALED';
        }
        break;

      case 'LEADERBOARD':
        stageLobby.classList.add('hidden');
        stageQuestionCard.classList.add('hidden');
        stageLeaderboard.classList.remove('hidden');
        if (elStageCountdownNotice) elStageCountdownNotice.classList.add('hidden');
        break;
    }
  }

  function renderQuestion(q) {
    if (!q) return;

    if (elStageItemBadge) {
      if (q.item_number) {
        elStageItemBadge.textContent = `ITEM ${q.item_number}${q.total_items ? ' OF ' + q.total_items : ''}`;
        elStageItemBadge.classList.remove('hidden');
      } else {
        elStageItemBadge.classList.add('hidden');
      }
    }

    if (elRoundName) {
      const itemStr = q.item_number ? ` • ITEM ${q.item_number}${q.total_items ? ' OF ' + q.total_items : ''}` : '';
      elRoundName.textContent = `${(q.round || 'ROUND 1').toUpperCase()}${itemStr} • ${q.points || 1} POINT${(q.points || 1) > 1 ? 'S' : ''}`;
    }

    if (elQuestionText) {
      elQuestionText.textContent = q.question || q.question_text || '';
      elQuestionText.classList.remove('hidden');
      elQuestionText.classList.remove('staged-flash');
      void elQuestionText.offsetWidth; // trigger reflow for animation
      elQuestionText.classList.add('staged-flash');
    }

    if (elStageCountdownNotice) {
      elStageCountdownNotice.classList.add('hidden');
    }

    if (q.code_snippet) {
      elCodeSnippet.classList.remove('hidden');
      if (elCodeBlock) elCodeBlock.textContent = q.code_snippet;
    } else {
      elCodeSnippet.classList.add('hidden');
    }

    const isMcq = q.type === 'MCQ' || q.question_type === 'MCQ';
    if (isMcq && q.options) {
      elOptionsGrid.classList.remove('hidden');
      const opts = typeof q.options === 'string' ? JSON.parse(q.options) : q.options;
      ['A', 'B', 'C', 'D'].forEach((letter) => {
        const textEl = document.getElementById(`stage-text-${letter.toLowerCase()}`);
        if (textEl) textEl.textContent = opts[letter] || `Option ${letter}`;
      });
    } else {
      elOptionsGrid.classList.add('hidden');
    }
  }

  function resetOptionCards() {
    ['a', 'b', 'c', 'd'].forEach((letter) => {
      const card = document.getElementById(`stage-opt-${letter}`);
      if (card) {
        card.classList.remove('correct');
        card.classList.remove('dimmed');
      }
    });
  }

  function updateTimerDisplay(remainingSeconds) {
    if (!elStageTimer) return;
    const sec = Math.max(0, remainingSeconds);
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    elStageTimer.textContent = `${m}:${s}`;

    if (sec <= 5 && sec > 0) {
      elStageTimer.className = 'stage-timer-digits danger';
    } else if (sec <= 10 && sec > 5) {
      elStageTimer.className = 'stage-timer-digits warning';
    } else {
      elStageTimer.className = 'stage-timer-digits';
    }
  }

  function showAnswerReveal(data) {
    if (!data) return;
    const correct = data.correctAnswer || (currentQuestion ? currentQuestion.correct_answer : '');
    const explanation = data.explanation || '';

    if (elStageCountdownNotice) elStageCountdownNotice.classList.add('hidden');
    if (elQuestionText) elQuestionText.classList.remove('hidden');
    if (currentQuestion && currentQuestion.code_snippet && elCodeSnippet) {
      elCodeSnippet.classList.remove('hidden');
    }
    const isMcq = currentQuestion && (currentQuestion.type === 'MCQ' || currentQuestion.question_type === 'MCQ');
    if (isMcq && elOptionsGrid) {
      elOptionsGrid.classList.remove('hidden');
    }

    elRevealCard.classList.remove('hidden');
    if (elCorrectAnswer) elCorrectAnswer.textContent = correct;
    if (elAnswerExplanation) elAnswerExplanation.textContent = explanation;

    // Highlight correct option if MCQ
    if (isMcq) {
      const correctLetter = String(correct).toLowerCase().trim();
      ['a', 'b', 'c', 'd'].forEach((letter) => {
        const card = document.getElementById(`stage-opt-${letter}`);
        if (card) {
          if (letter === correctLetter) {
            card.classList.add('correct');
          } else {
            card.classList.add('dimmed');
          }
        }
      });
    }
  }

  function renderLeaderboard(leaderboard) {
    if (!Array.isArray(leaderboard)) return;

    // Top 3 Podium
    const p1 = leaderboard[0];
    const p2 = leaderboard[1];
    const p3 = leaderboard[2];

    if (elPodiumName1) elPodiumName1.textContent = p1 ? (p1.fullName || `T${p1.terminalNumber}`) : '—';
    if (elPodiumScore1) elPodiumScore1.textContent = p1 ? `${p1.totalScore} PTS` : '0 PTS';

    if (elPodiumName2) elPodiumName2.textContent = p2 ? (p2.fullName || `T${p2.terminalNumber}`) : '—';
    if (elPodiumScore2) elPodiumScore2.textContent = p2 ? `${p2.totalScore} PTS` : '0 PTS';

    if (elPodiumName3) elPodiumName3.textContent = p3 ? (p3.fullName || `T${p3.terminalNumber}`) : '—';
    if (elPodiumScore3) elPodiumScore3.textContent = p3 ? `${p3.totalScore} PTS` : '0 PTS';

    // Roster for Ranks 4+
    if (!elRosterTbody) return;
    elRosterTbody.innerHTML = '';

    const remaining = leaderboard.slice(3, 15); // Show next top ranks
    remaining.forEach((item, index) => {
      const tr = document.createElement('tr');
      const padNum = String(item.terminalNumber).padStart(2, '0');
      tr.innerHTML = `
        <td style="font-weight: 800; font-family: var(--font-mono); color: var(--text-muted);">${index + 4}</td>
        <td style="font-weight: 600;">${item.fullName || `Contestant ${item.terminalNumber}`}</td>
        <td style="font-family: var(--font-mono); color: var(--color-primary-light);">T${padNum}</td>
        <td style="color: var(--text-secondary);">${item.department || 'Computer Studies'}</td>
        <td style="text-align: right; font-weight: 800; font-family: var(--font-mono); color: var(--color-accent);">${item.totalScore} PTS</td>
      `;
      elRosterTbody.appendChild(tr);
    });
  }

  // Auto-run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
