// 音のしくみ。ほかのファイルは sound.play('flick', { x }) のように呼ぶだけ。高さ・長さ・大きさは soundConfig.js。
//
// iPhone に合わせた決まり:
// - AudioContext は、音がオンの人が画面に触れたときに作る(オフのままなら一度も作らない)
// - navigator.audioSession があれば 'ambient' にする(マナーモードに従い、ほかのアプリの音楽を止めない。'playback' にはしない)。
//   このファイルを読み込んだ時点(どの音よりも前)に指定し、AudioContext を作る前・resume の前・画面に戻ったときにも指定し直す
// - 最初に触れるまで音は鳴らないので、触れるたびに resume する(鳴り始めたら聴くのをやめ、止まったらまた聴く)。
//   <audio> 要素や、無音を鳴らしてロックを外す処理は使わない(音の扱いが playback に変わるおそれがあるため)
// - 画面が見えない間は suspend する
//
// つながり:各音 → 効果音 / 環境音のまとめ → 全体の音量(上限)→ コンプレッサー → 出力
import { AMBIENT, DEFAULTS, MASTER, NOISE_SECONDS, SCRUB, SOUNDS } from './soundConfig.js';
import { makeRng } from '../util/random.js';

const clamp01 = (v, fallback) => {
  const n = typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
};

// 保存されている設定を読む。無い・壊れた値は初期値(音なし)
export function normalizeSound(raw) {
  return {
    on: raw?.on === true,
    ambient: clamp01(raw?.ambient, DEFAULTS.ambient),
    effects: clamp01(raw?.effects, DEFAULTS.effects),
  };
}

// 個体の seed から、鳴き声の高さの倍率を決める(同じ子はいつも同じ高さ。±spread 半音)
export function chirpPitch(seed, spread = SOUNDS.chirp.spread) {
  const r = makeRng((Number(seed) ^ 0x51c3) >>> 0)();
  return 2 ** (((r * 2 - 1) * spread) / 12);
}

// 同時に鳴る数の上限と、同じ音の間隔(minGap)を見る。時刻は秒
export class VoiceLimiter {
  constructor(max = MASTER.MAX_VOICES, gaps = {}) {
    this.max = max;
    this.gaps = gaps;
    this.active = 0;
    this.last = new Map();
  }

  // 鳴らしてよければ数に入れて true
  tryStart(kind, now) {
    if (this.active >= this.max) return false;
    const last = this.last.get(kind);
    if (last != null && now - last < (this.gaps[kind] ?? 0)) return false;
    this.last.set(kind, now);
    this.active++;
    return true;
  }

  end() {
    this.active = Math.max(0, this.active - 1);
  }
}

const range = ([a, b], r = Math.random()) => a + (b - a) * r;
const capFreq = (f) => Math.min(MASTER.FREQ_MAX, f);
const volume = (v) => v ** MASTER.CURVE;
const GESTURES = ['touchend', 'pointerup', 'click', 'keydown'];

// 音の扱いを 'ambient' にする(マナーモードに従い、ほかのアプリの音と一緒に鳴る)。
// iPhone が既定(auto)に戻すことがあるので、何度でも呼ぶ。指定できたら true
export function useAmbientSession() {
  const session = globalThis.navigator?.audioSession;
  if (!session) return false;
  try {
    if (session.type !== 'ambient') session.type = 'ambient';
    return session.type === 'ambient';
  } catch {
    return false;
  }
}

// 読み込んだ時点で、先に決めておく(どの音の処理よりも前)
useAmbientSession();

class Sound {
  constructor() {
    this.settings = normalizeSound(null);
    this.ctx = null;
    this.paused = false;
    this.armed = false;
    this.limiter = new VoiceLimiter(
      MASTER.MAX_VOICES,
      Object.fromEntries(Object.entries(SOUNDS).map(([k, s]) => [k, s.minGap ?? 0])),
    );
    this.bubbleTimer = null;
    this.suspendTimer = null;
    this.onGesture = () => this.gesture();
  }

  // ---- 設定 ----

  setSettings(raw) {
    const s = normalizeSound(raw);
    this.settings = s;
    if (s.on) {
      clearTimeout(this.suspendTimer);
      if (this.ctx) {
        this.applyLevels();
        if (!this.paused) this.wake();
      }
      if (!this.running) this.arm();
      this.scheduleBubbles();
    } else {
      this.disarm();
      this.stopBubbles();
      if (this.ctx) {
        this.applyLevels();
        this.scrubEnd();
        // 絞りきってから止める(ぷつっと切れないように)
        clearTimeout(this.suspendTimer);
        this.suspendTimer = setTimeout(() => {
          if (!this.settings.on) this.ctx?.suspend().catch(() => {});
        }, (MASTER.FADE + 0.1) * 1000);
      }
    }
  }

  get running() {
    return this.ctx?.state === 'running';
  }

  // 全体・環境音・効果音の音量を、なめらかに今の設定へ
  applyLevels() {
    const { ctx, settings: s } = this;
    if (!ctx) return;
    const t = ctx.currentTime;
    const k = MASTER.FADE / 3;
    this.master.gain.setTargetAtTime(s.on ? MASTER.GAIN : 0, t, k);
    this.ambientBus.gain.setTargetAtTime(volume(s.ambient), t, k);
    this.effectsBus.gain.setTargetAtTime(volume(s.effects), t, k);
  }

  // ---- 最初のタップ(iPhone では、触れるまで音が鳴らない) ----

  arm() {
    if (this.armed || typeof document === 'undefined') return;
    this.armed = true;
    for (const type of GESTURES) document.addEventListener(type, this.onGesture, true);
  }

  disarm() {
    if (!this.armed) return;
    this.armed = false;
    for (const type of GESTURES) document.removeEventListener(type, this.onGesture, true);
  }

  // 画面に触れたとき(音のボタンを押したときも呼ぶ)
  gesture() {
    if (!this.settings.on || this.paused) return;
    if (!this.ctx && !this.create()) return;
    this.wake();
    if (this.running) this.disarm();
  }

  // 触れた中で resume するだけ(無音を鳴らしてロックを外す処理は、音の扱いが変わるおそれがあるので使わない)
  wake() {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
    useAmbientSession();
    ctx.resume().then(
      () => {
        if (this.running) this.disarm();
      },
      () => {},
    );
  }

  create() {
    const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AC) return false;
    useAmbientSession(); // AudioContext を作る前に
    let ctx;
    try {
      ctx = new AC();
    } catch {
      return false;
    }
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    for (const [k, v] of Object.entries(MASTER.COMPRESSOR)) comp[k].value = v;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(comp);

    this.ambientBus = ctx.createGain();
    this.ambientBus.connect(this.master);
    const tame = ctx.createBiquadFilter();
    tame.type = 'lowpass';
    tame.frequency.value = MASTER.LOWPASS;
    tame.connect(this.master);
    this.effectsBus = ctx.createGain();
    this.effectsBus.connect(tame);
    this.ambientBus.gain.value = 0;
    this.effectsBus.gain.value = 0;

    this.noise = makeNoise(ctx);
    this.startWater();
    this.applyLevels();

    // 電話などで止められたら、次に触れたときにまた始める
    ctx.onstatechange = () => {
      if (!this.running && this.settings.on && !this.paused) this.arm();
    };
    return true;
  }

  // ---- 画面が見えない間は止める ----

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.stopBubbles();
    this.scrubEnd();
    this.ctx?.suspend().catch(() => {});
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    useAmbientSession(); // 画面に戻ったときも指定し直す
    if (!this.settings.on) return;
    this.scheduleBubbles();
    if (this.ctx) this.ctx.resume().catch(() => {});
    // 戻っただけでは始まらないこともあるので、次に触れたときにも始める
    this.arm();
  }

  // 今、鳴らしてよいか
  get audible() {
    return this.settings.on && !this.paused && this.running;
  }

  // 確かめるための様子(?sound=check のときに設定画面へ出す)
  status() {
    const session = globalThis.navigator?.audioSession;
    return {
      audioSession: !!session,
      type: session?.type ?? null,
      sessionState: session?.state ?? null,
      context: this.ctx?.state ?? 'まだ作っていない',
      standalone: !!globalThis.navigator?.standalone || !!globalThis.matchMedia?.('(display-mode: standalone)').matches,
    };
  }

  // ---- 環境音 ----

  // こもった水の音。ずっとループさせて、全体の音量で出し入れする
  startWater() {
    const { ctx } = this;
    const w = AMBIENT.WATER;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = w.lowpass;
    lp.Q.value = w.q;
    const g = ctx.createGain();
    g.gain.value = w.gain;
    // ゆっくりした揺れ(こもり具合と大きさ)
    const lfo = ctx.createOscillator();
    lfo.frequency.value = w.lfoRate;
    const lfoF = ctx.createGain();
    lfoF.gain.value = w.lfoFreq;
    const lfoG = ctx.createGain();
    lfoG.gain.value = w.lfoGain;
    lfo.connect(lfoF).connect(lp.frequency);
    lfo.connect(lfoG).connect(g.gain);
    src.connect(lp).connect(g).connect(this.ambientBus);
    src.start();
    lfo.start();
  }

  scheduleBubbles() {
    if (this.bubbleTimer || !this.settings.on || this.paused) return;
    this.bubbleTimer = setTimeout(() => {
      this.bubbleTimer = null;
      this.bubbles();
      this.scheduleBubbles();
    }, range(AMBIENT.BUBBLES.every) * 1000);
  }

  stopBubbles() {
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = null;
  }

  // ぷくぷく(いくつかの粒)
  bubbles() {
    if (!this.audible) return;
    const b = AMBIENT.BUBBLES;
    const n = Math.round(range(b.count));
    let at = this.ctx.currentTime + 0.02;
    const pan = Math.random() * 2 - 1;
    for (let i = 0; i < n; i++) {
      const f = range(b.freq);
      this.tone({ wave: 'sine', freq: f, to: f * b.rise, attack: b.attack, length: b.length, gain: b.gain, lowpass: b.lowpass }, at, pan, this.ambientBus);
      at += range(b.gap);
    }
  }

  // ---- 効果音 ----

  // kind: SOUNDS の名前。x: 水槽の左右の位置(0〜1)、pitch: 高さの倍率、delay: 遅らせる(秒)
  play(kind, { x = 0.5, pitch = 1, delay = 0 } = {}) {
    const s = SOUNDS[kind];
    if (!s || !(s.gain > 0) || !this.audible) return;
    const now = this.ctx.currentTime;
    if (!this.limiter.tryStart(kind, now + delay)) return;
    const at = now + delay + 0.005;
    const pan = (Math.min(1, Math.max(0, x)) - 0.5) * 2;
    let end;
    if (s.type === 'noise') end = this.noiseHit(s, at, pan);
    else if (s.type === 'notes') {
      for (const [i, semi] of s.notes.entries()) end = this.tone({ ...s, freq: s.freq * pitch * 2 ** (semi / 12), to: null }, at + i * s.step, pan);
    } else end = this.tone({ ...s, freq: s.freq * pitch, peak: s.peak && s.peak * pitch, to: s.to && s.to * pitch }, at, pan);
    end.onended = () => this.limiter.end();
  }

  // 音量のなめらかな山(立ち上がり → 指数的に消える)
  envelope(gain, peak, at, attack, length) {
    const a = Math.max(MASTER.MIN_ATTACK, attack);
    gain.setValueAtTime(0.0001, at);
    gain.linearRampToValueAtTime(peak, at + a);
    gain.exponentialRampToValueAtTime(0.0001, at + Math.max(a + 0.02, length));
  }

  // 左右に少しだけ振って、bus へ
  out(node, pan, bus = this.effectsBus) {
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan * MASTER.PAN;
      node.connect(p).connect(bus);
    } else {
      node.connect(bus);
    }
  }

  tone(s, at, pan, bus) {
    const { ctx } = this;
    const osc = ctx.createOscillator();
    osc.type = s.wave ?? 'sine';
    osc.frequency.setValueAtTime(capFreq(s.freq), at);
    if (s.peak) osc.frequency.linearRampToValueAtTime(capFreq(s.peak), at + s.length * 0.4);
    if (s.to) osc.frequency.exponentialRampToValueAtTime(capFreq(s.to), at + s.length);
    const g = ctx.createGain();
    this.envelope(g.gain, s.gain, at, s.attack, s.length);
    let node = osc.connect(g);
    if (s.lowpass) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = s.lowpass;
      node = node.connect(lp);
    }
    this.out(node, pan, bus);
    osc.start(at);
    osc.stop(at + s.length + 0.05);
    return osc;
  }

  noiseHit(s, at, pan) {
    const { ctx } = this;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = s.filter;
    f.Q.value = s.q;
    f.frequency.setValueAtTime(capFreq(s.freq), at);
    if (s.to) f.frequency.exponentialRampToValueAtTime(capFreq(s.to), at + s.length);
    const g = ctx.createGain();
    this.envelope(g.gain, s.gain, at, s.attack, s.length);
    this.out(src.connect(f).connect(g), pan);
    // ノイズのどこから使うかを変えて、毎回少し違う音に
    src.start(at, Math.random() * (NOISE_SECONDS - s.length - 0.1));
    src.stop(at + s.length + 0.05);
    return src;
  }

  // ---- 掃除:擦っている間だけ ----

  // 指が dist(px)動いた。x: 画面の左右の位置(0〜1)
  scrubbing(dist, x = 0.5) {
    if (!this.audible) return;
    const g = this.scrubGain ?? this.makeScrub();
    const t = this.ctx.currentTime;
    const level = SCRUB.gain * Math.min(1, Math.max(0.3, dist / SCRUB.fullMove));
    this.scrubPan?.pan.setTargetAtTime((Math.min(1, Math.max(0, x)) - 0.5) * 2 * MASTER.PAN, t, 0.05);
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.setTargetAtTime(level, t, SCRUB.rise);
    g.gain.setTargetAtTime(0, t + SCRUB.hold, SCRUB.fade);
  }

  scrubEnd() {
    const g = this.scrubGain;
    if (!g) return;
    const t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.setTargetAtTime(0, t, SCRUB.fade);
  }

  // しゃりしゃりのもと(ずっと流して、大きさだけ変える)
  makeScrub() {
    const { ctx } = this;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = SCRUB.filter;
    f.Q.value = SCRUB.q;
    // 細かい粒の感じ(大きさを速く揺らす)
    const grain = ctx.createGain();
    grain.gain.value = 1 - SCRUB.grainDepth;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = SCRUB.grainRate;
    const depth = ctx.createGain();
    depth.gain.value = SCRUB.grainDepth;
    lfo.connect(depth).connect(grain.gain);
    const g = ctx.createGain();
    g.gain.value = 0;
    const chain = src.connect(f).connect(grain).connect(g);
    if (ctx.createStereoPanner) {
      this.scrubPan = ctx.createStereoPanner();
      chain.connect(this.scrubPan).connect(this.effectsBus);
    } else {
      chain.connect(this.effectsBus);
    }
    src.start();
    lfo.start();
    this.scrubGain = g;
    return g;
  }
}

// やわらかいノイズ(少しだけ低い側に寄せた、ピンクに近いもの)
function makeNoise(ctx) {
  const n = Math.floor(ctx.sampleRate * NOISE_SECONDS);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    last = last * 0.7 + (Math.random() * 2 - 1) * 0.3;
    d[i] = last * 1.8;
  }
  // つなぎ目でぷつっといわないように、端をなめらかに
  const edge = Math.floor(ctx.sampleRate * 0.02);
  for (let i = 0; i < edge; i++) {
    const k = i / edge;
    d[n - 1 - i] = d[n - 1 - i] * k + d[i] * (1 - k);
  }
  return buf;
}

export const sound = new Sound();
