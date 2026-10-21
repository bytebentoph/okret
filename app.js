(() => {
  const garments = window.OKRET.garments;
  // Rail physics: neighbours slide aside in step with the hovered garment's turn (see frame) and swing
  // on their hooks when pushed.
  // pushed garments lean away and settle straight back: critically damped (c = 2*sqrt(k)), no rocking
  // Lean is driven by the hook's sideways VELOCITY (the garment trails behind while it is being moved),
  // not acceleration (which flips sign as the push slows and made it rock through centre). The layout
  // never moves backwards, so the lean only ever goes one way and settles critically damped.
  const SWING = { k: 200, c: 28.3, gain: 0.02, max: 2 }; // stiffness, damping (2*sqrt(k)), deg per px/s, clamp
  const OPEN_RATIO = 0.46;               // open slot width as a fraction of the rail height
  // hook geometry, as fractions of the art height (frames are 1024 tall; tools/build_assets.py pins
  // every frame's hook top at HOOK_Y = 2px). The placeholder SVG's hook top is y=0.3 of 356.
  const HOOK_TOP = 2 / 1024, PLACEHOLDER_HOOK_TOP = 0.3 / 356, WIRE = 3 / 1024;
  const LIFT = 1.5;  // px: every garment hangs this much higher, so the hook's curl clearly sits on top of the beam
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const $ = (id) => document.getElementById(id);
  // ?v= changes on every server start (tools/serve.py), so browsers never reuse stale frames
  const asset = (g, file) => `assets/garments/${g.id}/${file}${window.ASSET_V ? `?v=${window.ASSET_V}` : ""}`;
  const pad = (n) => String(n).padStart(3, "0");

  // ---------- placeholder art (used until a garment has generated frames) ----------
  const SHAPES = {
    tee: "M62 70 L90 60 Q100 74 110 60 L138 70 L166 102 L148 118 L136 108 L136 222 L64 222 L64 108 L52 118 L34 102 Z",
    longsleeve: "M64 70 L90 60 Q100 74 110 60 L136 70 L150 92 L162 210 L146 212 L136 116 L136 222 L64 222 L64 116 L54 212 L38 210 L50 92 Z",
    hoodie: "M62 72 L84 62 Q78 44 100 40 Q122 44 116 62 L138 72 L152 94 L164 212 L148 214 L138 118 L138 224 L62 224 L62 118 L52 214 L36 212 L48 94 Z",
  };
  function placeholderSVG(g, label = "") {
    return `<svg class="placeholder" viewBox="0 0 200 356" aria-hidden="true">
      <path class="hook" d="M100 34 V10 Q100 1.5 107 1.5 Q113 1.5 113 5"/><g transform="translate(0 -14)">
      <path class="bar" d="M58 66 Q100 30 142 66 L140 70 Q100 38 60 70 Z"/>
      <path class="body" fill="${g.swatch}" d="${SHAPES[g.shape] || SHAPES.tee}"/>
      ${label ? `<text class="badge" x="100" y="250">${label}</text>` : ""}
    </g></svg>`;
  }


  // lowest opaque row of an image, as a fraction of its height (the garment's hem)
  function hemOf(img) {
    const c = document.createElement("canvas");
    c.width = 90; c.height = 160;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const a = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let y = c.height - 1; y >= 0; y--)
      for (let x = 0; x < c.width; x++) if (a[(y * c.width + x) * 4 + 3] > 40) return (y + 1) / c.height;
    return 1;
  }
  const PLACEHOLDER_HEM = (224 - 14) / 356; // body bottom in the placeholder SVG

  // ---------- frame-sequence player (side -> front turn) ----------
  // True crossfade between two frames: (1 - f) * A + f * B. Drawing A fully and B on top at f left A's
  // extra silhouette fully visible until the frame index ticked over, then it vanished at once - a pop at
  // every whole frame, most visible where the turn slows down before settling. "lighter" adds the two
  // premultiplied layers, which is exactly the weighted mix.
  function blend(ctx, a, b, f, w, h) {
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = b ? 1 - f : 1;
    ctx.drawImage(a, 0, 0, w, h);
    if (b) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = f;
      ctx.drawImage(b, 0, 0, w, h);
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  // ---------- hook ----------
  // The photographed hooks are erased from every frame and a clean one is drawn instead: a 3D curve in
  // the hanger's plane (stem up from the wood, a curl wrapped round the beam, the tip coming down in
  // front), turned by the angle tools/hookstem.py measured in each frame (data.js: sin, axis). Vector
  // strokes, so it is sharp at any size, and the beam layering is exact: the tip half of the loop is
  // nearer the viewer and goes on the front canvas, over the beam; the stem and the far side of the
  // loop stay on the main canvas, behind the beam and behind the clothes.
  // The hook is a "?": the loop is centred right above the hanger, the stem rises from the wood into the
  // loop's bottom, goes up the far side, over the top, and the tip comes down the near side, in front
  // of the beam, ending just below the beam's middle.
  const TIP_END = 195; // degrees round the loop where the tip ends (90 = top, 180 = level with the centre)
  // behind = true draws the wire BEHIND whatever is already on the canvas (the garment and its hanger),
  // so the hook never paints over fabric or wood: "destination-over", with the passes in reverse order
  function strokeWire(ctx, pts, w, shadow, behind) {
    const trace = (dx, dy) => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0] + dx, pts[0][1] + dy);
      for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0] + dx, pts[k][1] + dy);
    };
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.globalCompositeOperation = behind ? "destination-over" : "source-over";
    const passes = [
      () => { ctx.strokeStyle = "#5c5c5c"; ctx.lineWidth = w; trace(0, 0); ctx.stroke(); },                     // the wire
      () => { ctx.strokeStyle = "#a8a8a8"; ctx.lineWidth = w * 0.6; trace(-w * 0.06, -w * 0.1); ctx.stroke(); },   // lit side
      () => { ctx.strokeStyle = "#f3f3f3"; ctx.lineWidth = w * 0.26; trace(-w * 0.15, -w * 0.24); ctx.stroke(); }, // highlight
    ];
    if (shadow) passes.unshift(   // a faint shadow onto the beam, so the tip sits on it instead of looking pasted over it
      () => { ctx.strokeStyle = "rgba(0, 0, 0, .10)"; ctx.lineWidth = w * 2.4; trace(w * 0.3, w * 0.9); ctx.stroke(); },
      () => { ctx.strokeStyle = "rgba(0, 0, 0, .14)"; ctx.lineWidth = w * 1.3; trace(w * 0.3, w * 0.8); ctx.stroke(); });
    (behind ? passes.reverse() : passes).forEach((p) => p());
    ctx.globalCompositeOperation = "source-over";
  }

  // ---------- frame download queue ----------
  // A few downloads at a time instead of all 443 handed to the browser at once: then the order can still
  // change, so the garment you hover can jump ahead of the rest.
  const queue = [], INFLIGHT = 6;
  let inflight = 0;
  function fetchFrame(img, url, first) {
    if (img.src) return;
    const at = queue.indexOf(img);
    if (at >= 0) { if (!first) return; queue.splice(at, 1); }
    img.url = url;
    first ? queue.unshift(img) : queue.push(img);
    pump();
  }
  function pump() {
    while (inflight < INFLIGHT && queue.length) {
      const img = queue.shift();
      if (img.src) continue;
      inflight++;
      const done = () => { img.removeEventListener("load", done); img.removeEventListener("error", done); inflight--; pump(); };
      img.addEventListener("load", done);
      img.addEventListener("error", done);
      img.src = img.url;
    }
  }

  class Turn {
    constructor(g, host, frontHost) {
      this.g = g;
      this.count = g.frames;
      this.pos = -1;
      this.band = null;      // beam's vertical extent within the art, as fractions [top, bottom]
      this.front = document.createElement("canvas");
      this.fctx = this.front.getContext("2d");
      frontHost.appendChild(this.front);
      this.bottom = 0;       // lowest point of the garment, as a fraction of the art height
      this.frames = [];
      this.canvas = document.createElement("canvas");
      this.ctx = this.canvas.getContext("2d");
      host.appendChild(this.canvas);
      for (let i = 0; i < this.count; i++) {
        const img = new Image();
        // draw as soon as the frame we need exists; decode() only warms up (browsers may reject it
        // under load, so it must never be the only trigger)
        img.onload = () => {
          if (i === 0 || this.waiting) this.redraw();
          if (i === 0 || i === this.count - 1) this.bottom = Math.max(this.bottom, hemOf(img));
          img.decode().catch(() => {});
        };
        // a host hiccup (a 503 right after a deploy) must not leave a hole in the turn: retry a few times
        let tries = 0;
        img.onerror = () => { if (++tries <= 3) setTimeout(() => { img.src = asset(g, `turn/${pad(i)}.webp`) + `${window.ASSET_V ? "&" : "?"}r=${tries}`; }, 800 * tries); };
        this.frames.push(img);
      }
      new ResizeObserver(() => this.redraw()).observe(host);
    }
    // queue frame i for download (order: see the load order below rail; hovering jumps the queue)
    load(i, first = false) { fetchFrame(this.frames[i], asset(this.g, `turn/${pad(i)}.webp`), first); }
    // the garment under the cursor: its missing frames go to the front of the queue, in turn order
    hurry() { for (let i = this.count - 1; i >= 0; i--) this.load(i, true); }
    redraw() {
      this.waiting = false;
      const r = this.canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = this.front.width = Math.round(r.width * dpr);
      this.canvas.height = this.front.height = Math.round(r.height * dpr);
      const p = Math.max(this.pos, 0); this.pos = -1; this.set(p);
    }
    // progress 0 (side) .. 1 (front); blends the two nearest frames so slow turns stay smooth
    set(progress) {
      const pos = progress * (this.count - 1);
      // redraw on every tiny step: skipping sub-0.02-frame steps made the slow settle update irregularly
      if (!this.waiting && Math.abs(pos - this.pos) < 0.001) return;
      this.pos = pos;
      // the nearest frames that have arrived on either side: while the in-betweens are still downloading
      // the turn blends across the gap (coarser, but it turns at once instead of freezing)
      const ok = (k) => this.frames[k]?.naturalWidth;
      let i = Math.floor(pos), j = Math.min(i + 1, this.count - 1);
      while (i > 0 && !ok(i)) i--;
      while (j < this.count - 1 && !ok(j)) j++;
      if (!ok(j)) j = i;
      let f = j > i ? clamp01((pos - i) / (j - i)) : 0;
      // ...but only across a small gap: blending two poses several frames apart shows both at once (a
      // ghosted double garment), so across a big gap it shows the nearer frame on its own
      if (j - i > 2) { if (f >= 0.5) i = j; else j = i; f = 0; }
      const a = this.frames[i], b = this.frames[j];
      const i0 = Math.floor(pos);
      this.waiting = !ok(i0) || (pos > i0 + 0.01 && !ok(Math.min(i0 + 1, this.count - 1)));   // redraw when they arrive
      if (!ok(i)) return;
      const { width: w, height: h } = this.canvas;
      this.ctx.clearRect(0, 0, w, h);
      blend(this.ctx, a, f > 0.01 && j !== i ? b : null, f, w, h);
      this.fctx.clearRect(0, 0, w, h);
      this.drawHook(i, j, f);
    }
    drawHook(i, j, f) {
      const hk = this.g.hook;
      if (!hk || !this.band) return;
      const { width: w, height: h } = this.canvas;
      const wire = Math.max(1.2, WIRE * h);
      const at = (arr) => arr[i] + (arr[j] - arr[i]) * f;
      const s = clamp01(at(hk.sin));                           // sin of the turn angle: 0 side-on, 1 facing you
      // where the photographed hook entered the hanger (hook.base, measured per frame from the frames
      // themselves), so the drawn stem meets the wood exactly where the original did
      const cx = at(hk.base || hk.axis) * w, woodY = hk.wood * h;
      const topY = HOOK_TOP * h + wire / 2;                    // wire centre line at the top of the hook
      const beamY = (this.band[0] + this.band[1]) / 2 * h;     // the curl is concentric with the beam
      const R = Math.max(beamY - topY, wire * 1.5);
      // the photographed hook: everything above the wood, near the axis
      this.ctx.clearRect(cx - 0.08 * w, 0, 0.16 * w, woodY - 0.5);
      // the loop in the hanger's plane: angle a round its centre (-90° bottom, 0° far side, 90° top,
      // 180° tip side), u = R cos a across; turned about the stem, x = cx - dir * u * sin. The tip half
      // (u on the tip's side) is nearer the viewer.
      const arc = (a) => [cx - hk.dir * R * Math.cos(a) * s, beamY - R * Math.sin(a)];
      const far = [[cx, woodY + 3 * wire]], near = [];
      const N = 12, D = Math.PI / 180;
      for (let k = 0; k <= 2 * N; k++) far.push(arc((-90 + 180 * k / (2 * N)) * D));              // bottom -> far side -> top
      for (let k = 0; k <= N; k++) near.push(arc((90 + (TIP_END - 90) * k / N) * D));           // top -> tip
      // stem + far side of the loop: behind the beam, and behind the clothes (the hanger and any fabric
      // near it stay in front of the wire); the tip half passes in front of the beam
      strokeWire(this.ctx, far, wire, false, true);
      strokeWire(this.fctx, near, wire, true, false);
    }
    setBand(band) { this.band = band; const p = Math.max(this.pos, 0); this.pos = -1; this.set(p); }
  }

  // ---------- rail ----------
  const list = $("hangers");
  const items = garments.map((g, i) => {
    const li = document.createElement("li");
    li.className = "hanger";
    li.tabIndex = 0;
    li.setAttribute("role", "button");
    li.setAttribute("aria-label", `${g.name}, ${g.type}, ${g.colour}`);
    const art = document.createElement("div");
    art.className = "hanger__art";
    li.appendChild(art);
    const fli = document.createElement("div");
    fli.className = "hanger-front";
    const fart = document.createElement("div");
    fart.className = "hanger__art";
    fli.appendChild(fart);
    $("hangersFront").appendChild(fli);
    const turn = g.frames > 1 ? new Turn(g, art, fart) : null;
    if (!turn) {
      art.innerHTML = placeholderSVG(g);
      // placeholder hook: like the real garments (which all turn left), the tip half is nearer the
      // viewer and passes in front of the beam; the stem goes behind
      fart.innerHTML = `<svg class="placeholder" viewBox="0 0 200 356"><path class="hook" d="M107 1.5 Q113 1.5 113 5"/></svg>`;
    }
    list.appendChild(li);

    li.addEventListener("mousedown", (e) => e.preventDefault()); // focus = keyboard only
    li.addEventListener("focus", () => setOpen(i));
    li.addEventListener("blur", () => setOpen(-1));
    li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(i); } });

    return {
      li, art, fli, fart, turn, flat: art.querySelector(".placeholder"), flatFront: fart.querySelector(".placeholder"),
      tp: 0, tv: 0, tFrom: 0, tTo: 0, tStart: 0, tDur: 0, tV0: 0,  // turn progress + speed: fixed-duration curve (see TURN_MS)
      x: null, vx: 0,         // centre position (px) + velocity, for the swing
      th: 0, thv: 0,          // swing angle (deg) + angular velocity
    };
  });

  // Load order over a slow connection (443 frames, ~9 MB): every garment's resting and front frame
  // first, then every 8th frame, every 4th, every 2nd, the rest - each garment can turn (coarsely, see
  // set) within seconds instead of waiting for all of it, and gets smoother as the rest arrives.
  const turns = items.map((it) => it.turn).filter(Boolean);
  turns.forEach((t) => { t.load(0); t.load(t.count - 1); });
  [8, 4, 2, 1].forEach((step) => turns.forEach((t) => { for (let i = 0; i < t.count; i += step) t.load(i); }));

  // ---------- one physics loop drives layout, turn and swing together ----------
  let active = -1;
  let slot = 0, open = 0, start = 0, raf = 0, last = 0;
  let zone = { left: 0, top: 0 };

  const wrap = list.parentElement;
  function measure() {
    slot = items[0].li.offsetWidth;
    open = items[0].art.offsetHeight * OPEN_RATIO;
    const full = slot * (items.length - 1) + open;
    // the beam is as long as the clothes need plus a margin each side, at any window size
    const stage = wrap.parentElement.clientWidth - 32;
    wrap.style.width = `${Math.min(stage, full + 2 * Math.max(70, open * 0.45))}px`;
    const room = wrap.clientWidth;
    const scrolls = full + 48 > room;          // phones: the rail scrolls sideways
    list.style.width = $("hangersFront").style.width = scrolls ? `${full + 48}px` : "";
    start = scrolls ? 24 : 0;
    // Hang every garment so its hook rests ON the beam: the hook's top sits one wire-thickness above
    // the beam's top. Beam measured from the DOM, hook top from the assets (pinned at HOOK_TOP).
    const bar = document.querySelector(".rail__bar").getBoundingClientRect();
    const listTop = list.getBoundingClientRect().top;
    const artH = items[0].art.offsetHeight;
    const wire = Math.max(1.5, artH * WIRE);
    items.forEach((it) => {
      const top = bar.top - wire - LIFT - (it.turn ? HOOK_TOP : PLACEHOLDER_HOOK_TOP) * artH - listTop;
      it.art.style.top = it.fart.style.top = `${top.toFixed(2)}px`;
      it.turn?.setBand([(bar.top - listTop - top) / artH, (bar.bottom - listTop - top) / artH]);
    });
    // hover-zone geometry, cached here so pointermove never has to force a layout
    const r = list.getBoundingClientRect();
    zone = { left: r.left + (start || (r.width - slot * items.length) / 2), top: r.top };
    items.forEach((it) => { it.artTop = it.art.offsetTop; it.artH = it.art.offsetHeight; });
    kick();
  }

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    let moving = false;
    // 1. the turns. A fixed-duration curve, not a spring: a critically damped spring never quite
    // arrives, and its long creeping tail showed the last frames slowly dissolving into each other right
    // before settling. The curve is a cubic Hermite from the current position AND speed to the target at
    // rest (see turnTo for the start speed): it lands exactly, and a turn reversed halfway carries its
    // speed into the reversal instead of snapping round.
    const snd = window.OKRET.sound;
    items.forEach((it, k) => {
      if (!it.tDur) return;
      const T = it.tDur, u = clamp01((now - it.tStart) / T), u2 = u * u, u3 = u2 * u;
      it.tp = (2 * u3 - 3 * u2 + 1) * it.tFrom + (u3 - 2 * u2 + u) * T * it.tV0 + (3 * u2 - 2 * u3) * it.tTo;
      it.tv = ((6 * u2 - 6 * u) * it.tFrom + (3 * u2 - 4 * u + 1) * T * it.tV0 + (6 * u - 6 * u2) * it.tTo) / T;
      if (u >= 1) { it.tDur = 0; it.tp = it.tTo; it.tv = 0; }
      else moving = true;
      // the rail's sound follows this speed (sound.js): turn speed in units where a full turn averages 1
      snd?.motion(k, it.tv * TURN_MS, panOf(k));
    });
    // 2. the layout follows the turns: each garment's slot widens exactly as it turns to face you (it IS
    // getting wider), so neighbours slide aside in step with it - same smooth start, exact landing and
    // smooth reversal. (A separate spring started from rest, peaked at ~2.4x its average speed and
    // crept in at the end, out of step with the turn.)
    const widths = items.map((it) => slot + clamp01(it.tp) * (open - slot));
    const total = widths.reduce((a, b) => a + b, 0);
    let x = start || (list.clientWidth - total) / 2;

    items.forEach((it, i) => {
      // position + pendulum swing driven by the hook's sideways velocity
      const cx = x + widths[i] / 2;
      x += widths[i];
      if (it.x === null) it.x = cx;
      const vx = (cx - it.x) / dt;
      it.x = cx; it.vx = vx;
      const lean = Math.max(-SWING.max, Math.min(SWING.max, -SWING.gain * vx));
      it.thv += (SWING.k * (lean - it.th) - SWING.c * it.thv) * dt;
      it.th += it.thv * dt;

      it.li.style.transform = `translate3d(${(cx - slot / 2).toFixed(2)}px,0,0)`;
      it.art.style.rotate = it.fart.style.rotate = `${it.th.toFixed(3)}deg`;
      it.fli.style.transform = it.li.style.transform;
      const p = it.tp;
      if (it.turn) it.turn.set(p);
      else if (it.flat) it.flat.style.transform = it.flatFront.style.transform = `scaleX(${(0.18 + 0.82 * p).toFixed(4)})`;

      if (Math.abs(it.th) > 0.01 || Math.abs(it.thv) > 0.01 || Math.abs(vx) > 0.5) moving = true;
    });
    raf = moving ? requestAnimationFrame(frame) : 0;
  }
  function kick() {
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }

  // full side->front turn time; turning back is a bit quicker (measured from the reference video)
  const TURN_MS = 460, TURN_BACK_MS = 320, START_SPEED = 1.5;
  function turnTo(it, to) {
    if (it.tTo === to && it.tDur) return;
    const now = performance.now();
    const v = it.tDur ? it.tv : 0;   // speed now, if it is mid-turn
    it.tFrom = it.tp; it.tTo = to; it.tStart = now;
    it.tDur = Math.max(200, (to ? TURN_MS : TURN_BACK_MS) * Math.max(Math.abs(to - it.tp), 0.35));
    // start speed, in multiples of the average: 0 eases in (felt laggy at this pace), 3 is exactly the old
    // ease-out cubic (leapt ~4 frames on the first refresh); 1.5 reacts at once without the leap. A turn
    // reversed mid-way keeps its current speed instead.
    it.tV0 = v || START_SPEED * (to - it.tp) / it.tDur;
  }
  // a garment's place on the rail as a stereo position, -1 (left) .. 1 (right), for sound.js
  const panOf = (k) => Math.max(-1, Math.min(1, ((zone.left + slot * (k + 0.5)) / innerWidth) * 2 - 1)) * 0.8;
  function setOpen(i) {
    if (i === active) return;
    if (i >= 0) items[i].turn?.hurry();
    if (active >= 0) turnTo(items[active], 0);
    if (i >= 0) turnTo(items[i], 1);
    active = i;
    setCaption(i >= 0 ? garments[i] : null);
    kick();
  }

  // Hover zones come from the *resting* layout (every garment side-on). Because the rail is centred,
  // an open garment stays centred on its own zone, so you leave a garment exactly where you entered it.
  function zoneAt(x, y) {
    const k = Math.floor((x - zone.left) / slot);
    if (k < 0 || k >= items.length) return -1;
    // ...and only down to that garment's hem (plus a little slack). Once one is open, down to the
    // LONGEST hem: moving at mid-height from a long garment onto a short one otherwise dropped to
    // nothing for a moment, so everything started closing and the next one re-opened - a jump.
    const hemOf = (it) => (it.turn ? it.turn.bottom || 1 : PLACEHOLDER_HEM) * it.artH + it.artTop;
    const hem = active >= 0 ? Math.max(...items.map(hemOf)) : hemOf(items[k]);
    return y <= zone.top + hem + 4 ? k : -1;
  }
  // touch: the garment whose current (live) slot contains the tap
  function itemAt(x) {
    const left = list.getBoundingClientRect().left;
    return items.findIndex((it) => Math.abs(left + it.x - x) <= (slot + clamp01(it.tp) * (open - slot)) / 2);
  }

  let hoverCol = -1;
  list.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" || start) return;
    const col = Math.floor((e.clientX - zone.left) / slot);   // the garment column under the cursor: load it first
    if (col !== hoverCol) { hoverCol = col; items[col]?.turn?.hurry(); }
    setOpen(zoneAt(e.clientX, e.clientY));
  });
  list.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") setOpen(-1); });
  list.addEventListener("click", (e) => {
    if (e.pointerType === "mouse" && !start) { if (active >= 0) openDetail(active); return; }
    const i = itemAt(e.clientX);
    if (i < 0) return;
    if (i !== active) setOpen(i);   // first tap turns it
    else openDetail(i);             // second tap opens it
  });

  new ResizeObserver(measure).observe(wrap.parentElement);
  measure();

  const HINT =matchMedia("(hover: none)").matches ? "Tap to turn. Tap again to explore." : "Hover to turn. Click to explore.";
  $("captionHint").textContent = HINT;
  function setCaption(g) {
    $("captionTitle").textContent = g ? g.name : "";
    $("captionHint").textContent = g ? `${g.type} · ${g.colour}` : HINT;
  }

  // ---------- detail view ----------
  let current = -1;
  let side = "front";
  const detail = $("detail");

  function renderDetail() {
    const g = garments[current];
    const fig = $("detailFigure");
    fig.style.animation = "none"; fig.offsetHeight; fig.style.animation = "";
    fig.innerHTML = (g.frames > 1
      ? `<img src="${asset(g, side + ".webp")}" alt="${g.name}, ${side}">`
      : placeholderSVG(g, side === "back" ? "BACK" : ""));
    $("detailCount").textContent = `${pad(current + 1).slice(1)} / ${pad(garments.length).slice(1)}`;
    $("detailName").textContent = g.name;
    $("detailMeta").textContent = `${g.type} · ${g.colour}`;
    detail.querySelectorAll(".toggle button").forEach((b) => b.setAttribute("aria-selected", b.dataset.side === side));
    window.OKRET.onDetail?.(g);   // store.js: price, sizes, add to cart
  }
  function openDetail(i) {
    current = i; side = "front";
    renderDetail();
    detail.hidden = false;
    document.body.classList.add("is-detail");
    $("detailClose").focus();
  }
  function closeDetail() {
    detail.hidden = true;
    document.body.classList.remove("is-detail");
    if (lastInputKeyboard) list.children[current]?.focus({ preventScroll: true });
  }
  let lastInputKeyboard = false;
  addEventListener("keydown", () => (lastInputKeyboard = true), true);
  addEventListener("pointerdown", () => (lastInputKeyboard = false), true);
  const shift = (d) => { current = (current + d + garments.length) % garments.length; side = "front"; renderDetail(); };

  $("detailClose").addEventListener("click", closeDetail);
  $("detailPrev").addEventListener("click", () => shift(-1));
  $("detailNext").addEventListener("click", () => shift(1));
  detail.querySelectorAll(".toggle button").forEach((b) =>
    b.addEventListener("click", () => { side = b.dataset.side; renderDetail(); }));
  // any click that is not on a control or on the garment itself closes the view; the photo's box is
  // much bigger than the garment (object-fit, transparent surroundings), so test the actual pixel
  const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  function onGarment(img, x, y) {
    const r = img.getBoundingClientRect();
    const s = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
    const u = (x - r.left - (r.width - img.naturalWidth * s) / 2) / s;
    const v = (y - r.top - (r.height - img.naturalHeight * s) / 2) / s;
    if (u < 0 || v < 0 || u >= img.naturalWidth || v >= img.naturalHeight) return false;
    probe.canvas.width = probe.canvas.height = 1;
    probe.clearRect(0, 0, 1, 1);
    probe.drawImage(img, u, v, 1, 1, 0, 0, 1, 1);
    return probe.getImageData(0, 0, 1, 1).data[3] > 40;
  }
  detail.addEventListener("click", (e) => {
    if (e.target.closest("button, a, .detail__info")) return;
    const img = e.target.closest(".detail__figure")?.querySelector("img");
    if (img && img.naturalWidth && onGarment(img, e.clientX, e.clientY)) return;
    closeDetail();
  });
  document.addEventListener("keydown", (e) => {
    if (detail.hidden || document.body.classList.contains("has-drawer")) return;   // a drawer on top handles its own keys
    if (e.key === "Escape") closeDetail();
    if (e.key === "ArrowLeft") shift(-1);
    if (e.key === "ArrowRight") shift(1);
  });

  // for store.js: the shop grid opens garments in this same view
  window.OKRET.openDetail = (id) => openDetail(Math.max(0, garments.findIndex((g) => g.id === id)));
  window.OKRET.closeDetail = () => { if (!detail.hidden) closeDetail(); };
})();
