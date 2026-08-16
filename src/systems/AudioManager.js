// AudioManager.js — procedural sci-fi audio synthesis via Web Audio API.
// Mirrors scripts/systems/AudioManager.gd. Singleton instance exported.

class AudioManagerClass {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.enabled = true;
    this._lastPlay = new Map();   // event -> timestamp
    this.THROTTLE = 0.03;         // min seconds between same-event plays
    this.volumeVal = 0.8;         // master volume (0 to 1)
    this.muted = false;
  }

  // Must be called after a user gesture (browser autoplay policy).
  resume() {
    if (!this.ctx) {
      try { 
        this.ctx = new (window.AudioContext || window.webkitAudioContext)(); 
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(this.muted ? 0 : this.volumeVal, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);
      }
      catch (e) { this.enabled = false; return; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(val) {
    this.volumeVal = Math.max(0, Math.min(1, val));
    if (this.ctx && this.masterGain) {
      const t = this.ctx.currentTime;
      this.masterGain.gain.setValueAtTime(this.muted ? 0 : this.volumeVal, t);
    }
  }

  setMute(bool) {
    this.muted = !!bool;
    if (this.ctx && this.masterGain) {
      const t = this.ctx.currentTime;
      this.masterGain.gain.setValueAtTime(this.muted ? 0 : this.volumeVal, t);
    }
  }

  _route(sourceNode, gainNode, t, pan = 0) {
    if (!this.masterGain) return;
    if (pan !== 0 && this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.setValueAtTime(pan, t);
      sourceNode.connect(gainNode).connect(panner).connect(this.masterGain);
    } else {
      sourceNode.connect(gainNode).connect(this.masterGain);
    }
  }

  _tone(freq, dur, vol, type, pan = 0) {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    this._route(osc, gain, t, pan);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  _sweep(startFreq, endFreq, dur, vol, type = 'sine', pan = 0) {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t + dur);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    this._route(osc, gain, t, pan);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  _noise(dur, vol, lowpassFreq = 800, pan = 0) {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    try {
      const bufferSize = this.ctx.sampleRate * dur;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const noiseNode = this.ctx.createBufferSource();
      noiseNode.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(lowpassFreq, this.ctx.currentTime);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(vol, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);

      noiseNode.connect(filter);
      
      const t = this.ctx.currentTime;
      if (pan !== 0 && this.ctx.createStereoPanner) {
        const panner = this.ctx.createStereoPanner();
        panner.pan.setValueAtTime(pan, t);
        filter.connect(gain).connect(panner).connect(this.masterGain);
      } else {
        filter.connect(gain).connect(this.masterGain);
      }
      noiseNode.start();
    } catch (e) {
      console.warn("Audio noise synthesis failed:", e);
    }
  }

  _arpeggio(freqs, noteDur, vol, type = 'sine', pan = 0) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    freqs.forEach((f, idx) => {
      const startTime = t + idx * noteDur;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f, startTime);
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(vol, startTime + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + noteDur * 1.5);
      this._route(osc, gain, startTime, pan);
      osc.start(startTime);
      osc.stop(startTime + noteDur * 2.0);
    });
  }

  play(event, x = undefined) {
    if (!this.enabled || !this.ctx) return;
    const now = performance.now() / 1000;
    const last = this._lastPlay.get(event) || 0;
    const throttleVal = event === 'hover_tick' ? 0.015 : this.THROTTLE;
    if (now - last < throttleVal) return;
    this._lastPlay.set(event, now);
    
    let pan = 0;
    if (typeof x === 'number') {
      pan = Math.max(-1.0, Math.min(1.0, x / 10.0));
    }
    
    switch (event) {
      case 'hover_tick':
        this._tone(1200, 0.015, 0.025, 'sine', pan);
        break;
      case 'button_click':
        this._tone(600, 0.05, 0.15, 'sine', pan);
        break;
      case 'rule_add':
        this._arpeggio([523.25, 659.25], 0.06, 0.18, 'sine', pan);
        break;
      case 'battle_start':
        this._sweep(150, 400, 0.4, 0.25, 'sawtooth', pan);
        break;
      case 'basic_attack':
        this._sweep(700, 180, 0.08, 0.12, 'triangle', pan);
        break;
      case 'shield_on':
        this._sweep(250, 600, 0.25, 0.2, 'sine', pan);
        break;
      case 'dash':
        this._sweep(350, 1100, 0.1, 0.15, 'sawtooth', pan);
        break;
      case 'interrupt_success':
        this._arpeggio([880, 1320, 1760], 0.05, 0.25, 'sine', pan);
        break;
      case 'enemy_death':
        this._sweep(180, 60, 0.15, 0.15, 'sawtooth', pan);
        this._noise(0.15, 0.12, 400, pan);
        break;
      case 'boss_phase':
        this._sweep(220, 55, 0.6, 0.35, 'sawtooth', pan);
        this._noise(0.5, 0.25, 200, pan);
        break;
      case 'boss_laser':
        // Distinct high-energy telegraph/fire cue; keep it separate from the
        // phase transition so players can learn the interrupt timing.
        this._sweep(180, 1800, 0.45, 0.28, 'sawtooth', pan);
        this._tone(90, 0.32, 0.2, 'square', pan);
        break;
      case 'defeat':
        this._arpeggio([220, 207.65, 164.81], 0.15, 0.25, 'sawtooth', pan);
        break;
      case 'victory':
        this._arpeggio([523.25, 659.25, 783.99, 1046.50], 0.1, 0.2, 'sine', pan);
        break;
      case 'mine_explosion':
        this._sweep(120, 40, 0.3, 0.3, 'sawtooth', pan);
        this._noise(0.3, 0.25, 300, pan);
        break;
      case 'emp_burst':
        // Low freq thump + electric crackle
        this._sweep(80, 25, 0.35, 0.4, 'sawtooth', pan);
        this._noise(0.25, 0.2, 200, pan);
        this._tone(440, 0.08, 0.15, 'square', pan);
        break;
      case 'energy_transfer':
        // Flowing energy whoosh rising pitch
        this._sweep(220, 880, 0.2, 0.2, 'sine', pan);
        this._sweep(150, 600, 0.15, 0.12, 'triangle', pan);
        break;
      case 'dash_through':
        // Aggressive fast sweep with impact
        this._sweep(400, 1600, 0.09, 0.2, 'sawtooth', pan);
        this._noise(0.06, 0.12, 1200, pan);
        this._tone(200, 0.05, 0.1, 'square', pan);
        break;
      default: 
        break;
    }
  }
}

export const AudioManager = new AudioManagerClass();

