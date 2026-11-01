/* =====================================================================
   Reused from greybox v0.1: silhouettes, input, screen text, sound, masks, UE maths
   ===================================================================== */
const HALO_TEX = canvasTexture(256, 256, drawHalo);
const round = (x) => Math.round(x * 100) / 100, round6 = (x) => Math.round(x * 1e6) / 1e6;

/** A flat black silhouette. Pose textures can be swapped; opacity fades. */
class Figure {
  constructor(pose, size) {
    this.material = new THREE.MeshBasicMaterial({ map: poseTexture(pose), color: 0x000000, transparent: true, alphaTest: 0.04, side: THREE.DoubleSide, depthWrite: false, fog: true });
    this.mesh = new THREE.Mesh(KIT.Plane, this.material);
    this.mesh.scale.set(size, size, 1);
    this.mesh.renderOrder = 2;
    this.mesh.userData = { kit: 'Silhouette', pose, size: [size, size, 1], fadeMaterial: this.material };
    this.pose = pose;
  }
  setPose(pose) { if (pose === this.pose) return; this.pose = pose; this.material.map = poseTexture(pose); this.mesh.userData.pose = pose; }
}

function makeHalo(size, opacity = 0.85) {
  const m = new THREE.MeshBasicMaterial({ map: HALO_TEX, color: 0xffffff, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
  mesh.scale.set(size, size, 1);
  mesh.userData = { kit: 'Halo', size: [size, size, 1], fadeMaterial: m, baseOpacity: opacity };
  return mesh;
}

class Input {
  constructor(dom) {
    this.keys = new Set(); this.dx = 0; this.dy = 0; this.handlers = [];
    addEventListener('keydown', (e) => { if (e.code === 'Tab') e.preventDefault(); if (!e.repeat) this.handlers.forEach((h) => h('key', e)); this.keys.add(e.code); });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', (e) => { if (document.pointerLockElement === dom) { this.dx += e.movementX; this.dy += e.movementY; } });
    dom.addEventListener('mousedown', (e) => this.handlers.forEach((h) => h('mouse', e)));
    addEventListener('contextmenu', (e) => e.preventDefault());
  }
  on(fn) { this.handlers.push(fn); }
  down(code) { return this.keys.has(code); }
  takeMouse() { const m = { dx: this.dx, dy: this.dy }; this.dx = 0; this.dy = 0; return m; }
}

class ScreenUI {
  constructor(sched) {
    this.sched = sched;
    this.el = (id) => document.getElementById(id);
    this.sub = this.el('sub'); this.mono = this.el('mono'); this.titleEl = this.el('title'); this.promptEl = this.el('prompt');
    this.choicesEl = this.el('choices'); this.fadeEl = this.el('fade'); this.flashEl = this.el('flash');
    this.promptUntil = 0; this.promptText = '';
  }
  /** Waits `seconds`, or less if the player clicks (advance()). Returns true when cut short. */
  async #hold(seconds, cancelled = () => false) {
    const t0 = this.sched.time;
    await this.sched.until(() => this.skip || cancelled() || this.sched.time - t0 >= seconds);
    const skipped = this.skip; this.skip = false; return skipped;
  }
  /** Click, Space or Enter: show the next line now. */
  advance() { if (this.speaking || this.thinking) this.skip = true; }
  async say(who, text, { keep = false } = {}) {
    this.skip = false; this.speaking = true;
    this.sub.style.transition = 'none';   // a new line appears at once
    this.sub.querySelector('.who').textContent = who; this.sub.querySelector('.txt').textContent = text;
    this.sub.style.opacity = 1;
    const skipped = await this.#hold(readTime(text));
    if (keep && skipped) { this.speaking = false; return; }   // the next line replaces this one immediately
    this.sub.style.transition = ''; this.sub.style.opacity = 0;
    if (!skipped) await this.#hold(0.35 * FAST);
    this.speaking = false;
  }
  async lines(list, onLine) { for (let i = 0; i < list.length; i++) { onLine?.(list[i]); await this.say(list[i][0], list[i][1], { keep: i < list.length - 1 }); } }
  /** Inner monologue, one line at a time; stops early when cancelled() becomes true. */
  async monologue(lines, cancelled) {
    this.thinking = true;
    for (let i = 0; i < lines.length; i++) {
      if (cancelled()) break;
      this.mono.style.transition = 'none'; this.mono.textContent = lines[i]; this.mono.style.opacity = 1;
      const skipped = await this.#hold(readTime(lines[i]), cancelled);
      if (skipped && i < lines.length - 1) continue;   // straight to the next line
      this.mono.style.transition = ''; this.mono.style.opacity = 0;
      if (!skipped) await this.#hold(0.7 * FAST, cancelled);
    }
    this.mono.style.transition = ''; this.mono.style.opacity = 0;
    this.thinking = false;
  }
  clearMonologue() { this.mono.style.opacity = 0; }
  async title(text, hold = 4) {
    this.titleEl.textContent = text; this.titleEl.classList.add('on');
    await this.sched.wait(1.8 + hold * FAST);
    this.titleEl.classList.remove('on');
    await this.sched.wait(1.8);
  }
  prompt(text, seconds = 0) { this.promptText = text; this.promptEl.textContent = text; this.promptEl.style.opacity = text ? 1 : 0; this.promptUntil = seconds ? this.sched.time + seconds : 0; }
  update() { if (this.promptUntil && this.sched.time > this.promptUntil) this.prompt(''); }
  fade(to, seconds = 1.6) { this.fadeEl.style.transition = `opacity ${seconds}s ease`; this.fadeEl.style.opacity = to; return this.sched.wait(seconds); }
  /** A quick darkening as the mask closes over the eyes. */
  blink() { this.flashEl.style.background = '#0d0907'; this.flashEl.style.opacity = 0.92; setTimeout(() => { this.flashEl.style.opacity = 0; }, 140); }
  flash() { this.flashEl.style.opacity = 0.85; setTimeout(() => { this.flashEl.style.opacity = 0; }, 160); }
  vignette(mask) { document.querySelectorAll('#vig .v').forEach((v) => { v.style.opacity = v.dataset.mask === mask ? 1 : 0; }); }
  /** Show options; resolves with the index chosen, or -1 after `timeout` seconds. */
  choose(options, timeout) {
    return new Promise((resolve) => {
      this.choicesEl.innerHTML = ''; this.choicesEl.style.display = 'flex';
      let done = false;
      const finish = (i) => { if (done) return; done = true; this.choicesEl.style.display = 'none'; resolve(i); };
      options.forEach((o, i) => { const b = document.createElement('button'); b.textContent = o; b.onclick = () => finish(i); this.choicesEl.appendChild(b); });
      const keyHandler = (e) => { if (e.code === 'Enter' || e.code === 'KeyE') { removeEventListener('keydown', keyHandler); finish(0); } };
      addEventListener('keydown', keyHandler);
      this.sched.wait(timeout).then(() => { removeEventListener('keydown', keyHandler); finish(-1); });
    });
  }
}

class Sound {
  constructor() { this.ctx = null; this.master = null; this.musicTimer = null; }
  start() {
    if (this.ctx) return;
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    this.master = this.ctx.createGain(); this.master.gain.value = 0.6; this.master.connect(this.ctx.destination);
    const dl = this.ctx.createDelay(1.0); dl.delayTime.value = 0.32; const fb = this.ctx.createGain(); fb.gain.value = 0.35;
    dl.connect(fb); fb.connect(dl); dl.connect(this.master); this.echo = dl;
    this.noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  #noise(dur, { f = 1000, q = 1, type = 'bandpass', gain = 0.3, attack = 0.002, echo = false } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime, s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const flt = c.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(flt); flt.connect(g); g.connect(this.master); if (echo) g.connect(this.echo);
    s.start(t, Math.random() * 0.5, dur + 0.05);
  }
  #tone(freq, dur, { type = 'sine', gain = 0.12, when = 0 } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + when, o = c.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  step(surface) {
    if (surface === 'masks') { this.#noise(0.35, { f: 2600 + Math.random() * 1600, q: 8, gain: 0.25, echo: true }); this.#noise(0.18, { f: 900, q: 3, gain: 0.12, echo: true }); }
    else this.#noise(0.09, { f: 1800, q: 1.2, gain: 0.07 });
  }
  rumble(dur) { this.#noise(dur, { f: 90, q: 0.7, type: 'lowpass', gain: 0.35, attack: 0.4 }); }
  motif(mask) {
    const base = 293.66; // D
    const iv = { don: [0, 4, 7, 12], anna: [0, 3, 7, 3], servant: [0, 3, 6, 9] }[mask] || [0];
    iv.forEach((s, i) => this.#tone(base * Math.pow(2, s / 12), 0.9, { type: 'triangle', gain: 0.07, when: i * 0.16 }));
  }
  sting() { [0, 1, 6].forEach((s, i) => this.#tone(73.42 * Math.pow(2, s / 12), 4, { type: 'sawtooth', gain: 0.05, when: i * 0.05 })); }
  crack() { this.#noise(0.6, { f: 3500, q: 2, gain: 0.4 }); this.#noise(1.2, { f: 200, q: 0.8, gain: 0.3, type: 'lowpass' }); }
  fire(dur) { this.#noise(dur, { f: 400, q: 0.4, type: 'lowpass', gain: 0.5, attack: 2 }); }
  /** A simple 3/4 pulse in D minor for the stage (stand-in for the opera recording). */
  music(on) {
    if (!this.ctx) return;
    clearInterval(this.musicTimer); if (!on) return;
    const bass = [146.83, 146.83, 110, 130.81, 116.54, 110], chords = [[293.66, 349.23, 440], [277.18, 329.63, 440], [293.66, 349.23, 466.16]];
    let beat = 0;
    this.musicTimer = setInterval(() => {
      const bar = Math.floor(beat / 3) % bass.length;
      if (beat % 3 === 0) this.#tone(bass[bar], 0.9, { type: 'triangle', gain: 0.11 });
      else chords[bar % chords.length].forEach((f) => this.#tone(f, 0.25, { type: 'sine', gain: 0.035 }));
      if (this.onBeat) this.onBeat(beat);
      beat++;
    }, 460);
  }
}

/** Liquid wobble for the masks on the table (vertex displacement in view space, metres). */
function wobbleMaterial(src, _shared, time) {
  const mat = src.clone();
  const wob = { value: 0.006 };
  mat.userData.wobble = wob;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWobble = wob; shader.uniforms.uTime = time;
    shader.vertexShader = 'uniform float uWobble; uniform float uTime;\n' + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 wpW = modelMatrix * vec4(transformed, 1.0);
      vec3 nW = normalize(normalMatrix * objectNormal);
      mvPosition.xyz += nW * uWobble * (sin(wpW.x * 60.0 + uTime * 2.3) * sin(wpW.z * 55.0 + uTime * 1.7) + 0.6 * sin(wpW.y * 70.0 + uTime * 3.1));
      gl_Position = projectionMatrix * mvPosition;`);
  };
  return mat;
}

/** ~200-triangle mask shell for the thousands of masks on the floor of Act 3. */
function lowMaskGeometry() {
  const nu = 12, nv = 14, pos = [], idx = [], id = (i, j) => j * (nu + 1) + i, inside = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = (i / nu) * 2 - 1, v = (j / nv) * 2 - 1;
    pos.push(0.085 * u, 0.105 * v, 0.045 * (1 - u * u) * (1 - 0.35 * v * v));
    inside.push(u * u + v * v <= 1.02);
  }
  const eye = (u, v) => ((Math.abs(u) - 0.42) ** 2) / 0.05 + ((v - 0.22) ** 2) / 0.012 < 1;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = id(i, j), b = id(i + 1, j), c = id(i, j + 1), d = id(i + 1, j + 1);
    const u = ((i + 0.5) / nu) * 2 - 1, v = ((j + 0.5) / nv) * 2 - 1;
    if (![a, b, c, d].every((k) => inside[k]) || eye(u, v)) continue;
    idx.push(a, b, d, a, d, c);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function drawArms(c) {   // outstretched arms bound to a beam, seen from inside
  const g = c.getContext('2d'), W = c.width, H = c.height;
  g.fillStyle = '#0b0705';
  g.fillRect(0, H * 0.3, W * 0.2, H * 0.09); g.fillRect(W * 0.8, H * 0.3, W * 0.2, H * 0.09);
  g.beginPath(); g.moveTo(0, H * 0.4); g.quadraticCurveTo(W * 0.12, H * 0.38, W * 0.18, H * 0.44); g.lineTo(W * 0.16, H * 0.52); g.quadraticCurveTo(W * 0.08, H * 0.49, 0, H * 0.53); g.fill();
  g.beginPath(); g.moveTo(W, H * 0.4); g.quadraticCurveTo(W * 0.88, H * 0.38, W * 0.82, H * 0.44); g.lineTo(W * 0.84, H * 0.52); g.quadraticCurveTo(W * 0.92, H * 0.49, W, H * 0.53); g.fill();
  g.strokeStyle = '#2a1a12'; g.lineWidth = 7; for (const x of [W * 0.12, W * 0.88]) { g.beginPath(); g.moveTo(x - 30, H * 0.36); g.lineTo(x + 30, H * 0.5); g.stroke(); }
}

async function loadMasks() {
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const models = {};
  for (const id of MASK_IDS) {
    const url = window.DG_ASSETS?.['mask_' + id]; if (!url) continue;
    const buf = await (await fetch(url)).arrayBuffer();
    const gltf = await loader.parseAsync(buf, '');
    const root = gltf.scene; const box = new THREE.Box3().setFromObject(root), c = box.getCenter(new THREE.Vector3());
    const holder = new THREE.Group(); root.position.sub(c); holder.add(root);
    models[id] = holder;
  }
  return models;
}

/** three.js (metres, +y up, -z north) → UE (centimetres, Z up) assuming UE's glTF import maps (x, y, z) → (x, z, y). Verify with axis_marker.glb first (see docs/ue-handoff). */
function toUE(pos, quat, scale) {
  const q = { x: -quat.x, y: -quat.z, z: -quat.y, w: quat.w };
  return { location_cm: [pos.x * 100, pos.z * 100, pos.y * 100].map(round), quat_xyzw: [q.x, q.y, q.z, q.w].map(round6), rotator_pyr: quatToRotator(q).map(round), scale: [scale.x, scale.z, scale.y].map(round6) };
}

/** Same maths as UE's FQuat::Rotator(). Returns [Pitch, Yaw, Roll] in degrees. */
function quatToRotator(q) {
  const { x: X, y: Y, z: Z, w: W } = q, R2D = 180 / Math.PI;
  const sing = Z * X - W * Y, yawY = 2 * (W * Z + X * Y), yawX = 1 - 2 * (Y * Y + Z * Z);
  const yaw = Math.atan2(yawY, yawX) * R2D;
  if (sing < -0.4999995) return [-90, yaw, normAxis(-yaw - 2 * Math.atan2(X, W) * R2D)];
  if (sing > 0.4999995) return [90, yaw, normAxis(yaw - 2 * Math.atan2(X, W) * R2D)];
  return [Math.asin(2 * sing) * R2D, yaw, Math.atan2(-2 * (W * X + Y * Z), 1 - 2 * (X * X + Y * Y)) * R2D];
}

function normAxis(a) { a %= 360; if (a > 180) a -= 360; if (a < -180) a += 360; return a; }

function describe(obj, parentMatrix) {
  const m = new THREE.Matrix4().multiplyMatrices(parentMatrix, obj.matrix);
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); m.decompose(p, q, s);
  return { three: { pos: p.toArray().map(round6), quat_xyzw: q.toArray().map(round6), scale: s.toArray().map(round6) }, ue: toUE(p, q, s) };
}

