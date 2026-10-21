// Clothes on a rail, as sound. Real cloth recordings (assets/sound/, CC0, built by tools/build_sounds.py),
// played the way games do cloth foley: one voice per moving garment - a single rustle gesture from its start -
// whose volume and brightness follow the garment's actual turning speed every frame (app.js reports it).
// Cloth only makes sound while it moves, loudest where it moves fastest - so the rustle swells and dies
// exactly with the motion instead of being a clip pasted on top (research notes: research_notes/Natural
// interaction sound design/). Kept quiet, close to the edge of hearing; silent on touch screens, with
// reduced motion, and in hidden tabs. Audio needs a click/tap/key first (browser rule); the speaker
// button in the header turns it on/off (remembered).
(() => {
  const AC = window.AudioContext || window.webkitAudioContext;
  const btn = document.getElementById("soundToggle");
  if (!AC || !btn) return;
  const touch = matchMedia("(hover: none)").matches;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const store = {
    get() { try { return localStorage.getItem("okret.sound"); } catch { return null; } },
    set(v) { try { localStorage.setItem("okret.sound", v); } catch {} },
  };
  const v = window.ASSET_V ? `?v=${window.ASSET_V}` : "";
  let on = store.get() !== "off";
  let ctx = null, master = null, verb = null, meter = null;
  const rnd = (a, b) => a + Math.random() * (b - a);

  const PEAK = 0.55;          // a voice at full speed (master + limiter on top)
  const MAX_VOICES = 2;
  // A fast drag across the rail is NOT one rustle per garment: physically it is one continuous friction
  // texture whose loudness/brightness follow hand speed, and garments crossed at 20+ per second fuse into
  // a texture for the ear anyway; ten stacked copies of one rustle comb-filter into a hollow pile-up
  // (research: reports/Sound of a cloth rail sweep.md). So when garments start turning in quick succession
  // a BED of short real-cloth grains fades in, with only a few soft accents on top.
  const SWEEP_WINDOW = 0.4, SWEEP_HITS = 3;   // 3 garments entered within 0.4 s = a sweep
  const ACCENT_GAP = 0.25;                     // accents inside a sweep: at most one per 250 ms
  const entries = [];
  let lastAccent = -1;
  const CUT_SLOW = 900, CUT_FAST = 5500;   // the texture brightens with speed (log scale)

  const raw = fetch(`assets/sound/sounds.json${v}`).then((r) => r.json()).then((m) =>
    Promise.all((m.rustle || []).map((f) => fetch(`assets/sound/${f}${v}`).then((r) => r.arrayBuffer())))).catch(() => []);
  let loops = [];

  function init() {
    if (ctx) return;
    ctx = new AC({ latencyHint: "interactive" });
    // master -> gentle limiter (no sudden loud stacks when several garments move at once)
    master = ctx.createGain(); master.gain.value = 0.25;   // quiet: hovers peak around -17 dB
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -18; lim.knee.value = 6; lim.ratio.value = 12; lim.attack.value = 0.003; lim.release.value = 0.15;
    master.connect(lim).connect(ctx.destination);
    meter = ctx.createAnalyser(); meter.fftSize = 2048; lim.connect(meter);
    // just a hint of room: short, pre-delayed, darkened - too much reverb on close-miked cloth sounds like two spaces
    verb = ctx.createConvolver();
    const len = Math.round(ctx.sampleRate * 0.25), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    const pre = Math.round(ctx.sampleRate * 0.012);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = pre; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - (i - pre) / (len - pre), 4) * 0.35;
    }
    verb.buffer = ir;
    const wetLp = ctx.createBiquadFilter(); wetLp.type = "lowpass"; wetLp.frequency.value = 4000;
    const wet = ctx.createGain(); wet.gain.value = 0.07;
    verb.connect(wetLp).connect(wet).connect(master);
    raw.then((bufs) => Promise.all(bufs.map((b) => ctx.decodeAudioData(b.slice(0))))).then((decoded) => {
      loops = decoded;   // played from the start: the take is one rustle gesture (a random slice could land in its quiet tail)
    });
  }

  // ---------- voices: one looping texture per moving garment ----------
  const voices = new Map();     // garment index -> voice
  let lastTake = -1;
  // ---------- the sweep bed: 30-50 ms Hann grains, random positions/timing, ~5x overlap, +-5% rate ----------
  const HANN = (() => { const n = 64, c = new Float32Array(n); for (let i = 0; i < n; i++) c[i] = Math.sin(Math.PI * i / (n - 1)) ** 2; return c; })();
  let bed = null, bedLevel = 0, bedTimer = 0, nextGrain = 0;
  function bedNodes() {
    if (bed) return bed;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 180;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1500; lp.Q.value = 0.4;
    const g = ctx.createGain(); g.gain.value = 0;
    hp.connect(lp).connect(g); g.connect(master); g.connect(verb);
    return (bed = { hp, lp, g });
  }
  function grain(t) {
    const buf = loops[0], len = rnd(0.03, 0.05);
    const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rnd(0.95, 1.05);
    const g = ctx.createGain(); g.gain.value = 0;
    const amp = rnd(0.55, 1);
    g.gain.setValueCurveAtTime(HANN.map((x) => x * amp), t, len);
    src.connect(g).connect(bed.hp);
    src.start(t, rnd(0, Math.max(0, buf.duration - len * 1.2)), len * 1.1);
  }
  function bedTick() {
    const t = ctx.currentTime;
    bedLevel *= Math.exp(-0.025 / 0.22);                     // falls ~220 ms after the hand stops crossing garments
    bed.g.gain.setTargetAtTime(PEAK * 0.5 * Math.min(1, bedLevel), t, 0.03);
    bed.lp.frequency.setTargetAtTime(1500 * Math.pow(5200 / 1500, Math.min(1, bedLevel)), t, 0.05);  // faster = brighter
    if (nextGrain < t) nextGrain = t;
    while (nextGrain < t + 0.06) { grain(nextGrain); nextGrain += rnd(0.03, 0.05) / 5 * rnd(0.5, 1.5); }
    if (bedLevel < 0.01) { clearInterval(bedTimer); bedTimer = 0; bed.g.gain.setTargetAtTime(0, t, 0.06); }
  }
  // a garment starts turning in: is the hand sweeping? (returns true when the bed takes over)
  function sweeping() {
    const t = ctx.currentTime;
    entries.push(t);
    while (entries.length && t - entries[0] > SWEEP_WINDOW) entries.shift();
    if (entries.length < SWEEP_HITS || !loops.length) return false;
    bedNodes();
    const rate = entries.length / SWEEP_WINDOW;              // garments per second
    bedLevel = Math.min(1.2, Math.max(bedLevel, rate / 14) + 0.12);   // each contact lifts it a little
    if (!bedTimer) bedTimer = setInterval(bedTick, 25);
    return true;
  }

  function voice(k, pan, trimScale = 1) {
    let vc = voices.get(k);
    if (vc) return vc;
    if (!loops.length) return null;
    if (voices.size >= MAX_VOICES) {                         // steal the quietest
      let q = null;
      voices.forEach((x, key) => { if (!q || x.level < q.level) q = { level: x.level, key }; });
      stop(q.key, 0.03);
    }
    let take = Math.floor(Math.random() * loops.length);
    if (loops.length > 1 && take === lastTake) take = (take + 1) % loops.length;
    lastTake = take;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = loops[take];
    src.playbackRate.value = rnd(0.96, 1.04);                 // +-4%: repeats are never identical
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 140;   // no close-mic boom
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = CUT_SLOW; lp.Q.value = 0.4;
    const g = ctx.createGain(); g.gain.value = 0;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (p.pan) p.pan.value = pan * 0.6;
    src.connect(hp).connect(lp).connect(g).connect(p);
    p.connect(master); p.connect(verb);
    src.start(t);                                              // the gesture from its start, every time
    vc = { src, g, lp, level: 0, quiet: 0, trim: rnd(0.85, 1.05) * trimScale };
    voices.set(k, vc);
    return vc;
  }
  function stop(k, fade = 0.08) {
    const vc = voices.get(k);
    if (!vc) return;
    const t = ctx.currentTime;
    vc.g.gain.cancelScheduledValues(t); vc.g.gain.setTargetAtTime(0, t, fade / 3);
    vc.src.stop(t + fade + 0.05);
    voices.delete(k);
  }

  const ready = () => on && !touch && !reduced && ctx && ctx.state === "running" && !document.hidden;
  const api = {
    // called by app.js every animation frame for a turning garment: v = turn speed (1.5 = the fastest a
    // turn starts; negative = turning back), pan = its place on the rail (-1..1)
    motion(k, v, pan) {
      if (!ready()) { if (ctx && voices.has(k)) stop(k); return; }
      const speed = Math.min(1, Math.abs(v) / 1.5) * (v < 0 ? 0.55 : 1);   // turning back is gentler
      let vc = voices.get(k);
      if (!vc && speed < 0.04) return;
      if (!vc && v > 0 && sweeping()) {
        // mid-sweep: the bed carries it; only an occasional soft accent for a single garment
        const t0 = ctx.currentTime;
        if (t0 - lastAccent < ACCENT_GAP) return;
        lastAccent = t0;
        vc = voice(k, pan, 0.45);
      }
      vc = vc || voice(k, pan);
      if (!vc) return;
      const t = ctx.currentTime;
      const target = PEAK * vc.trim * Math.pow(speed, 1.5);
      // rise fast (~20 ms), fall a little slower (~50 ms): no zipper noise, no lag behind the picture
      vc.g.gain.setTargetAtTime(target, t, target > vc.level ? 0.02 : 0.05);
      vc.lp.frequency.setTargetAtTime(CUT_SLOW * Math.pow(CUT_FAST / CUT_SLOW, speed), t, 0.03);
      vc.level = target;
      vc.quiet = speed < 0.02 ? vc.quiet + 1 : 0;
      if (vc.quiet > 20) stop(k);                            // settled: let the voice go
    },
    level() {
      if (!meter) return 0;
      const d = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(d);
      return d.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    },
    state: () => (ctx ? ctx.state : "not started"),
    loaded: () => ({ loops: loops.length }),
    sweep: () => ({ bed: +bedLevel.toFixed(2), voices: voices.size }),
  };
  window.OKRET = window.OKRET || {};
  window.OKRET.sound = api;

  // ---------- on/off + unlocking ----------
  function render() {
    btn.setAttribute("aria-pressed", String(on));
    btn.setAttribute("aria-label", on ? "Sound on" : "Sound off");
    btn.querySelector("use").setAttribute("href", on ? "#i-sound" : "#i-mute");
  }
  if (touch) btn.hidden = true;                              // no hover on touch screens: no rail sound
  function unlock() {
    if (!on || touch) return;
    init();
    if (ctx.state !== "running") ctx.resume();
  }
  ["pointerdown", "keydown"].forEach((e) => addEventListener(e, unlock, { capture: true, passive: true }));
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.hidden) { voices.forEach((_, k) => stop(k, 0.02)); ctx.suspend(); }
    else if (on) ctx.resume();
  });
  btn.addEventListener("click", () => {
    on = !on; store.set(on ? "on" : "off"); render();
    if (on) unlock();
    else if (ctx) { voices.forEach((_, k) => stop(k, 0.05)); ctx.suspend(); }
  });
  render();
})();
