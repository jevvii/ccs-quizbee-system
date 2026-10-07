/**
 * public/js/audio.js
 * OLFU IT Olympics LAN Quiz Bee System (ITPM 311)
 * Web Audio API Procedural Sound Synthesizer (Zero Audio Asset Dependencies)
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.QuizAudio = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  class QuizAudioSynthesizer {
    constructor() {
      this.ctx = null;
      this.masterGain = null;
      this.isMuted = false;
      this.volume = 0.8;
      this.isInitialized = false;
      this._lastTickTime = 0;

      // Auto-unlock Web Audio on first user interaction in browser
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        const unlock = () => {
          this.init();
          this.resume();
          window.removeEventListener('pointerdown', unlock, true);
          window.removeEventListener('keydown', unlock, true);
        };
        window.addEventListener('pointerdown', unlock, { capture: true, once: true });
        window.addEventListener('keydown', unlock, { capture: true, once: true });
      }
    }

    /**
     * Lazily initialize AudioContext and Master Gain node
     */
    init() {
      if (this.ctx || typeof window === 'undefined') return;

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;

      try {
        this.ctx = new AudioContextClass();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);
        this.isInitialized = true;
      } catch (err) {
        // Fallback silently if audio hardware cannot be initialized
      }
    }

    /**
     * Resume AudioContext if suspended by browser autoplay policy
     */
    resume() {
      if (!this.ctx) this.init();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    }

    /**
     * Set master volume (0.0 to 1.0)
     */
    setVolume(val) {
      this.volume = Math.max(0, Math.min(1, Number(val) || 0));
      if (this.ctx && this.masterGain && !this.isMuted) {
        this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
      }
    }

    /**
     * Toggle mute state
     * @returns {boolean} current mute state
     */
    toggleMute() {
      return this.setMuted(!this.isMuted);
    }

    /**
     * Set explicit mute state
     */
    setMuted(muted) {
      this.isMuted = Boolean(muted);
      if (this.ctx && this.masterGain) {
        const target = this.isMuted ? 0 : this.volume;
        this.masterGain.gain.setValueAtTime(target, this.ctx.currentTime);
      }
      return this.isMuted;
    }

    // =========================================================================
    // Procedural Sound Effects (Zero External Files)
    // =========================================================================

    /**
     * 1. Countdown Tick (Normal)
     * Short percussive 800Hz sine wave pulse (50ms)
     */
    playTick() {
      if (this.isMuted) return;
      this.resume();
      if (!this.ctx || !this.masterGain) return;

      const now = this.ctx.currentTime;
      // Prevent harsh overlap if ticks fire faster than 300ms
      if (now - this._lastTickTime < 0.3) return;
      this._lastTickTime = now;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(400, now + 0.04);

      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now);
      osc.stop(now + 0.05);
    }

    /**
     * 2. Urgent Warning Tick (<= 5 seconds)
     * Higher-pitch 1320Hz triangle pulse with sharp attack (70ms)
     */
    playWarningTick() {
      if (this.isMuted) return;
      this.resume();
      if (!this.ctx || !this.masterGain) return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1320, now);
      osc.frequency.exponentialRampToValueAtTime(990, now + 0.07);

      gain.gain.setValueAtTime(0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now);
      osc.stop(now + 0.08);
    }

    /**
     * 3. Question Lock / Timeout Buzzer
     * Low-frequency 160Hz sawtooth wave filtered through lowpass (450ms)
     */
    playLock() {
      if (this.isMuted) return;
      this.resume();
      if (!this.ctx || !this.masterGain) return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.linearRampToValueAtTime(110, now + 0.4);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(600, now);

      gain.gain.setValueAtTime(0.6, now);
      gain.gain.setValueAtTime(0.6, now + 0.2);
      gain.gain.linearRampToValueAtTime(0.001, now + 0.45);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now);
      osc.stop(now + 0.46);
    }

    /**
     * 4. Phase Transition Chime
     * Ascending two-tone chime: E5 (659Hz) -> G#5 (831Hz) (350ms)
     */
    playPhaseChime() {
      if (this.isMuted) return;
      this.resume();
      if (!this.ctx || !this.masterGain) return;

      const now = this.ctx.currentTime;
      const notes = [
        { freq: 659.25, start: 0, dur: 0.16 },
        { freq: 830.61, start: 0.14, dur: 0.22 }
      ];

      notes.forEach((n) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(n.freq, now + n.start);

        gain.gain.setValueAtTime(0.35, now + n.start);
        gain.gain.exponentialRampToValueAtTime(0.001, now + n.start + n.dur);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(now + n.start);
        osc.stop(now + n.start + n.dur + 0.02);
      });
    }

    /**
     * 5. Correct Answer Reveal Chime
     * Bright major arpeggio: C5 -> E5 -> G5 -> C6 (650ms)
     */
    playCorrect() {
      if (this.isMuted) return;
      this.resume();
      if (!this.ctx || !this.masterGain) return;

      const now = this.ctx.currentTime;
      const arpeggio = [
        { freq: 523.25, start: 0.00, dur: 0.2 },
        { freq: 659.25, start: 0.10, dur: 0.2 },
        { freq: 783.99, start: 0.20, dur: 0.25 },
        { freq: 1046.5, start: 0.32, dur: 0.35 }
      ];

      arpeggio.forEach((n) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(n.freq, now + n.start);

        gain.gain.setValueAtTime(0.4, now + n.start);
        gain.gain.exponentialRampToValueAtTime(0.001, now + n.start + n.dur);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(now + n.start);
        osc.stop(now + n.start + n.dur + 0.02);
      });
    }

    /**
     * 6. Incorrect Answer Buzzer
     * Dissonant descending dual sawtooth buzzer (220Hz / 140Hz)
     */
    playIncorrect() {
      if (this.isMuted) return;
      this.resume();
      if (!this.ctx || !this.masterGain) return;

      const now = this.ctx.currentTime;
      const freqs = [220, 226];

      freqs.forEach((f) => {
        const osc = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(f, now);
        osc.frequency.linearRampToValueAtTime(f * 0.65, now + 0.35);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(800, now);

        gain.gain.setValueAtTime(0.4, now);
        gain.gain.linearRampToValueAtTime(0.001, now + 0.4);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        osc.start(now);
        osc.stop(now + 0.42);
      });
    }

    /**
     * 7. Leaderboard Reveal Victory Fanfare
     * Triumphant brass-style arpeggio sequence (G4 -> C5 -> E5 -> G5) (1.8s)
     */
    playFanfare() {
      if (this.isMuted) return;
      this.resume();
      if (!this.ctx || !this.masterGain) return;

      const now = this.ctx.currentTime;
      const sequence = [
        { freq: 392.00, start: 0.00, dur: 0.18 }, // G4
        { freq: 523.25, start: 0.18, dur: 0.18 }, // C5
        { freq: 659.25, start: 0.36, dur: 0.22 }, // E5
        { freq: 783.99, start: 0.56, dur: 1.10 }  // G5 sustained
      ];

      sequence.forEach((n) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(n.freq, now + n.start);

        gain.gain.setValueAtTime(0.5, now + n.start);
        gain.gain.exponentialRampToValueAtTime(0.001, now + n.start + n.dur);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(now + n.start);
        osc.stop(now + n.start + n.dur + 0.05);
      });
    }

    /**
     * 8. Telemetry Alert Chirp
     * Distinct 2000Hz double-pip warning chirp (100ms) for cheat alerts
     */
    playAlert() {
      if (this.isMuted) return;
      this.resume();
      if (!this.ctx || !this.masterGain) return;

      const now = this.ctx.currentTime;
      const pips = [
        { start: 0.00, dur: 0.04 },
        { start: 0.06, dur: 0.04 }
      ];

      pips.forEach((p) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(2000, now + p.start);

        gain.gain.setValueAtTime(0.4, now + p.start);
        gain.gain.exponentialRampToValueAtTime(0.001, now + p.start + p.dur);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(now + p.start);
        osc.stop(now + p.start + p.dur + 0.01);
      });
    }
  }

  return new QuizAudioSynthesizer();
});
