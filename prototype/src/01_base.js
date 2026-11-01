import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

/* =====================================================================
   0. Settings and text
   ===================================================================== */
const params = new URLSearchParams(location.search);
const FAST = params.has('fast') ? 0.2 : 1;          // text / pacing speed (testing)
const START_AT = params.get('at');                    // opening | act1 | shadow | act2 | act3 | ending
const AUTOSTART = params.has('autostart');
const DT_MAX = parseFloat(params.get('dtmax') || '0.05');      // testing on slow machines
const WALK_SCALE = parseFloat(params.get('speed') || '1');     // testing: walk faster

const LOW = params.has('low');                                  // testing: no shadows, less mist

const PLAYER = { eye: 1.65, radius: 0.35, walk: 2.4 * WALK_SCALE, run: 4.6 * WALK_SCALE, mouse: 0.0022, keyTurn: 1.7 };
const MASK_IDS = ['don', 'anna', 'servant'];
const MASK_LABEL = { don: 'DON GIOVANNI', anna: 'DONNA ANNA', servant: 'LEPORELLO' };
const MASK_KEY = { Digit1: 'don', Digit2: 'anna', Digit3: 'servant' };

// All in-game text. Lines marked DRAFT are placeholders for the writers.
const SCRIPT = {
  opening: [
    ['DON GIOVANNI', "You're finally awake. Don't look at me like that - this isn't the first time we've met. Don't you remember?"],
    ['DON GIOVANNI', 'They say I am guilty. That I should stay here forever. But they only remember what I did - never why I did it.'],
    ['DON GIOVANNI', "So I need someone without prejudice. Someone who doesn't remember the past, and doesn't know me."],
    ['DON GIOVANNI', 'These masks - put them on, and you will see what others saw. And what I saw.', 'masks'],
    ['DON GIOVANNI', 'Go and see those stories. Then come back and tell me: do I truly not deserve forgiveness?'],
  ],
  openingTitle: 'Change the mask. Does the truth change with it?',
  act1Intro: [
    ['COMMENDATORE', 'Stop! You shameless wretch - you wanted to violate my daughter, and you think you can simply leave?'],
    ['DON GIOVANNI', 'Out of my way, old man. Let me go.'],
    ['COMMENDATORE', 'Draw your sword! Come and fight me!'],
    ['DON GIOVANNI', 'You asked for this yourself!'],
  ],
  act1Mono: { // DRAFT
    don: ['He drew first. Steel against steel, man against man.', 'I gave him every chance to walk away. This was a duel - nothing more.'],
    anna: ['Father?', 'A moment ago this was our home. Now every wall is closing in,', 'and the only way out is the one he is standing in.'],
    servant: ['I could only watch through the cracks. The blade. His chest. The sound.', 'I did nothing. What could a servant do?'],
  },
  t1: [
    ['DON GIOVANNI', 'You saw it. I had no choice. He wanted to kill me - I could only defend myself.'],
    ['DON GIOVANNI', "Go on. I'll be watching you."],
  ],
  act2Intro: [ // DRAFT
    ['FIRST SHADOW', 'Mercy, sirs - I am not the man you want!'],
    ['SECOND SHADOW', 'Nor am I. Look closer - I am only the servant.'],
  ],
  act2Mono: { // DRAFT
    don: ['A cloak, a hat, a borrowed voice - and the whole town chases the wrong man.', 'Is it a crime to be clever?'],
    servant: ['His coat is heavy, and every lantern in the town is turned on me.', 'If they hang me, they will hang his name. No one will ask for mine.'],
    anna: ['There he is again, above us, laughing in another man\'s clothes.', 'We can shout as loud as we like. He never has to come down.'],
  },
  act2Pick: 'Which of them is Don Giovanni?',
  t2: [['DON GIOVANNI', "What of it? He got away in the end, didn't he? No one died... not this time."]],
  act3Question: [['THE SHADOW', 'You have seen everything. Now, tell me - should Don Giovanni be forgiven?']],
  act3Answer: 'I have no right to forgive him on behalf of those he hurt.',
  act3Reply: [['THE COMMENDATORE', 'So. Even you cannot absolve yourself.']],
  act3Cry: [
    ['DON GIOVANNI', 'No! No! I gave you my memories, my thoughts, my voice - you are part of me!'],
    ['DON GIOVANNI', "Why won't even you forgive me? You are me. You were my last chance. No-!"],
  ],
  endCard: 'No one can forgive on behalf of the wounded.',
  actTitles: { act1: 'ACT ONE  ·  THE COURTYARD', act2: 'ACT TWO  ·  THE STAGE', act3: 'ACT THREE  ·  THE JUDGEMENT' },
};

/* =====================================================================
   1. Small utilities
   ===================================================================== */
const D2R = Math.PI / 180;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const qDeg = (rx, ry, rz) => new THREE.Quaternion().setFromEuler(new THREE.Euler(rx * D2R, ry * D2R, rz * D2R, 'YXZ'));
const readTime = (text) => (1.7 + text.length * 0.052) * FAST;
function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Pause-aware game clock: wait(seconds) and until(predicate) resolve inside the frame loop. */
class Scheduler {
  constructor() { this.time = 0; this.waiters = []; }
  wait(seconds) { const at = this.time + seconds; return new Promise((res) => this.waiters.push({ at, res })); }
  until(pred) { return new Promise((res) => this.waiters.push({ pred, res })); }
  tick(dt) {
    this.time += dt;
    const keep = [];
    for (const w of this.waiters) {
      const done = w.pred ? w.pred() : this.time >= w.at;
      if (done) w.res(); else keep.push(w);
    }
    this.waiters = keep;
  }
}

/** Frame-driven tweens. run(duration, fn) calls fn(easedK) every frame and resolves at the end. */
class Tweens {
  constructor() { this.list = []; }
  run(duration, fn, easing = easeInOut) {
    return new Promise((res) => { const t = { k: 0, duration: Math.max(1e-3, duration), fn, easing, res }; this.list.push(t); fn(easing(0)); });
  }
  update(dt) {
    const keep = [];
    for (const t of this.list) {
      t.k = Math.min(1, t.k + dt / t.duration);
      t.fn(t.easing(t.k));
      if (t.k >= 1) t.res(); else keep.push(t);
    }
    this.list = keep;
  }
}

/* =====================================================================
   2. Procedural textures (marble, halo, cracks, silhouettes)
   ===================================================================== */
function canvasTexture(w, h, draw, { srgb = true, repeat = null } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.userData.canvas = c;
  return t;
}

function drawMarble(g, w, h, rnd) {
  g.fillStyle = '#121212'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * w, y = rnd() * h, r = 2 + rnd() * 20, c = 34 + rnd() * 34;
    g.fillStyle = `rgba(${c | 0},${c | 0},${(c + 3) | 0},${0.05 + rnd() * 0.08})`;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  g.lineCap = 'round';
  for (let v = 0; v < 30; v++) {
    let x = rnd() * w, y = rnd() * h, a = rnd() * Math.PI * 2;
    const len = 120 + rnd() * 520;
    g.strokeStyle = `rgba(236,236,232,${0.3 + rnd() * 0.55})`; g.lineWidth = 0.6 + rnd() * 2.6;
    g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < len; s += 6) { a += (rnd() - 0.5) * 0.7; x += Math.cos(a) * 6; y += Math.sin(a) * 6; g.lineTo(x, y); }
    g.stroke();
  }
  g.filter = 'blur(7px)';
  for (let i = 0; i < 16; i++) {
    g.fillStyle = `rgba(230,230,226,${0.06 + rnd() * 0.12})`;
    g.beginPath(); g.ellipse(rnd() * w, rnd() * h, 20 + rnd() * 70, 8 + rnd() * 30, rnd() * 3, 0, 7); g.fill();
  }
  g.filter = 'none';
}

function drawHalo(g, w, h) {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.75)');
  gr.addColorStop(0.7, 'rgba(255,255,255,.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
}

function drawCracks(g, w, h, rnd, { centres, color, count = 9, len = 0.45, width = 1 }) {
  g.strokeStyle = color; g.lineCap = 'round';
  const branch = (x, y, a, l, lineW, depth) => {
    lineW *= width;
    g.lineWidth = lineW; g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < l; s += 8) {
      a += (rnd() - 0.5) * 0.6; x += Math.cos(a) * 8; y += Math.sin(a) * 8; g.lineTo(x, y);
      if (depth < 2 && rnd() < 0.05) { g.stroke(); branch(x, y, a + (rnd() - 0.5) * 1.6, l * 0.4, lineW / width * 0.6, depth + 1); g.beginPath(); g.moveTo(x, y); g.lineWidth = lineW; }
    }
    g.stroke();
  };
  for (const [cx, cy] of centres) for (let i = 0; i < count; i++) branch(cx * w, cy * h, (i / count) * Math.PI * 2 + rnd() * 0.5, len * w * (0.5 + rnd() * 0.5), 2.5 + rnd() * 2, 0);
}

/* Silhouette poses, drawn white-on-transparent in a unit square (y down, feet at y≈0.98, facing +x). */
const POSE_SPECS = {
  stand: { head: [0.5, 0.15], torso: [[0.44, 0.22], [0.56, 0.22], [0.55, 0.52], [0.45, 0.52]], legs: [[[0.47, 0.52], [0.46, 0.75], [0.45, 0.97]], [[0.53, 0.52], [0.54, 0.75], [0.55, 0.97]]], arms: [[[0.45, 0.24], [0.43, 0.38], [0.44, 0.5]], [[0.55, 0.24], [0.57, 0.38], [0.56, 0.5]]], hat: 'tricorne' },
  cloak: { head: [0.5, 0.15], torso: [[0.44, 0.22], [0.56, 0.22], [0.55, 0.52], [0.45, 0.52]], cloak: [[0.42, 0.21], [0.58, 0.21], [0.65, 0.8], [0.35, 0.8]], legs: [[[0.47, 0.6], [0.46, 0.78], [0.45, 0.97]], [[0.53, 0.6], [0.54, 0.78], [0.55, 0.97]]], arms: [], hat: 'tricorne' },
  dandy: { head: [0.5, 0.15], torso: [[0.44, 0.22], [0.56, 0.22], [0.55, 0.52], [0.45, 0.52]], cloak: [[0.43, 0.21], [0.57, 0.21], [0.61, 0.72], [0.4, 0.74]], legs: [[[0.47, 0.6], [0.46, 0.78], [0.45, 0.97]], [[0.53, 0.6], [0.54, 0.78], [0.55, 0.97]]], arms: [[[0.56, 0.25], [0.63, 0.36], [0.66, 0.46]]], hat: 'feather' },
  servant: { head: [0.5, 0.17], torso: [[0.45, 0.24], [0.55, 0.24], [0.56, 0.54], [0.44, 0.54]], legs: [[[0.47, 0.54], [0.45, 0.76], [0.44, 0.97]], [[0.53, 0.54], [0.55, 0.76], [0.57, 0.97]]], arms: [[[0.45, 0.26], [0.41, 0.4], [0.43, 0.5]], [[0.55, 0.26], [0.6, 0.38], [0.58, 0.48]]], hat: 'cap', stoop: true },
  guard: { head: [0.5, 0.15], torso: [[0.44, 0.22], [0.56, 0.22], [0.55, 0.52], [0.45, 0.52]], legs: [[[0.5, 0.52], [0.58, 0.72], [0.63, 0.97]], [[0.5, 0.52], [0.42, 0.74], [0.36, 0.97]]], arms: [[[0.54, 0.24], [0.63, 0.31], [0.71, 0.29]], [[0.46, 0.24], [0.38, 0.2], [0.35, 0.12]]], sword: [[0.71, 0.29], [0.97, 0.24]], hat: 'tricorne' },
  lunge: { head: [0.54, 0.19], torso: [[0.46, 0.25], [0.57, 0.24], [0.53, 0.54], [0.44, 0.54]], legs: [[[0.48, 0.54], [0.63, 0.7], [0.71, 0.97]], [[0.48, 0.54], [0.34, 0.76], [0.22, 0.97]]], arms: [[[0.56, 0.27], [0.69, 0.29], [0.8, 0.29]], [[0.46, 0.26], [0.36, 0.24], [0.3, 0.17]]], sword: [[0.8, 0.29], [0.995, 0.28]], hat: 'tricorne' },
  fall: { head: [0.41, 0.23], torso: [[0.39, 0.29], [0.49, 0.27], [0.53, 0.56], [0.45, 0.57]], legs: [[[0.49, 0.56], [0.55, 0.76], [0.52, 0.97]], [[0.49, 0.56], [0.44, 0.77], [0.4, 0.97]]], arms: [[[0.42, 0.31], [0.32, 0.26], [0.27, 0.16]], [[0.48, 0.3], [0.56, 0.21], [0.6, 0.13]]], hat: 'tricorne' },
  lying: { head: [0.12, 0.5], torso: [[0.17, 0.44], [0.47, 0.43], [0.47, 0.57], [0.17, 0.56]], cloak: [[0.16, 0.4], [0.5, 0.38], [0.55, 0.64], [0.15, 0.62]], legs: [[[0.47, 0.47], [0.7, 0.45], [0.92, 0.47]], [[0.47, 0.53], [0.7, 0.56], [0.9, 0.6]]], arms: [[[0.2, 0.44], [0.3, 0.32], [0.38, 0.28]], [[0.2, 0.56], [0.32, 0.66], [0.4, 0.7]]], sword: [[0.45, 0.25], [0.82, 0.17]] },
  seated: { head: [0.5, 0.3], headR: 0.05, torso: [[0.39, 0.38], [0.61, 0.38], [0.58, 0.64], [0.42, 0.64]], arms: [[[0.4, 0.4], [0.35, 0.53], [0.41, 0.63]], [[0.6, 0.4], [0.65, 0.53], [0.59, 0.63]]], legs: [], hat: 'tricorne-front' },
  kneel: { head: [0.52, 0.44], torso: [[0.46, 0.5], [0.57, 0.5], [0.57, 0.73], [0.47, 0.73]], legs: [[[0.52, 0.73], [0.62, 0.86], [0.5, 0.97]], [[0.5, 0.73], [0.42, 0.97], [0.3, 0.97]]], arms: [[[0.47, 0.52], [0.53, 0.62], [0.6, 0.57]], [[0.56, 0.52], [0.62, 0.62], [0.64, 0.55]]], hat: 'cap' },
  lookup: { head: [0.52, 0.15], torso: [[0.45, 0.22], [0.56, 0.22], [0.55, 0.52], [0.45, 0.52]], skirt: [[0.44, 0.46], [0.56, 0.46], [0.68, 0.97], [0.32, 0.97]], legs: [], arms: [[[0.55, 0.24], [0.62, 0.14], [0.66, 0.04]], [[0.46, 0.24], [0.43, 0.38], [0.45, 0.48]]], hair: true },
  lookupMan: { head: [0.52, 0.15], torso: [[0.45, 0.22], [0.56, 0.22], [0.55, 0.52], [0.45, 0.52]], legs: [[[0.47, 0.52], [0.46, 0.75], [0.45, 0.97]], [[0.53, 0.52], [0.54, 0.75], [0.55, 0.97]]], arms: [[[0.55, 0.24], [0.63, 0.15], [0.68, 0.06]], [[0.46, 0.24], [0.43, 0.38], [0.45, 0.48]]], hat: 'cap' },
  dancer: { head: [0.5, 0.14], torso: [[0.45, 0.21], [0.55, 0.21], [0.54, 0.47], [0.46, 0.47]], skirt: [[0.45, 0.44], [0.55, 0.44], [0.72, 0.9], [0.28, 0.9]], legs: [[[0.47, 0.88], [0.46, 0.97]], [[0.53, 0.88], [0.56, 0.97]]], arms: [[[0.45, 0.23], [0.36, 0.14], [0.33, 0.05]], [[0.55, 0.23], [0.64, 0.14], [0.67, 0.05]]], hair: true },
  anna: { head: [0.5, 0.15], torso: [[0.45, 0.22], [0.55, 0.22], [0.54, 0.47], [0.46, 0.47]], skirt: [[0.45, 0.44], [0.55, 0.44], [0.69, 0.97], [0.31, 0.97]], legs: [], arms: [[[0.45, 0.24], [0.43, 0.36], [0.47, 0.44]], [[0.55, 0.24], [0.57, 0.36], [0.53, 0.44]]], hair: true },
};

function drawPose(g, S, spec) {
  g.fillStyle = g.strokeStyle = '#fff'; g.lineCap = g.lineJoin = 'round';
  const P = ([x, y]) => [x * S, y * S];
  const poly = (pts) => { g.beginPath(); pts.forEach((p, i) => { const [X, Y] = P(p); if (i) g.lineTo(X, Y); else g.moveTo(X, Y); }); g.closePath(); g.fill(); };
  const line = (pts, w) => { g.lineWidth = w * S; g.beginPath(); pts.forEach((p, i) => { const [X, Y] = P(p); if (i) g.lineTo(X, Y); else g.moveTo(X, Y); }); g.stroke(); };
  const W = spec.limbW || 0.045;
  if (spec.cloak) poly(spec.cloak);
  if (spec.skirt) poly(spec.skirt);
  poly(spec.torso);
  for (const l of spec.legs || []) line(l, W * 1.1);
  for (const a of spec.arms || []) line(a, W * 0.85);
  if (spec.sword) line(spec.sword, 0.012);
  const [hx, hy] = P(spec.head); const r = (spec.headR || 0.047) * S;
  g.beginPath(); g.arc(hx, hy, r, 0, 7); g.fill();
  // neck
  g.fillRect(hx - r * 0.45, hy, r * 0.9, r * 1.6);
  if (spec.hair) { g.beginPath(); g.arc(hx - r * 0.7, hy - r * 0.5, r * 0.7, 0, 7); g.fill(); }
  if (spec.hat === 'tricorne' || spec.hat === 'feather') {
    g.beginPath(); g.ellipse(hx, hy - r * 0.75, r * 2.0, r * 0.42, 0, 0, 7); g.fill();
    g.beginPath(); g.moveTo(hx - r * 1.1, hy - r * 0.8); g.lineTo(hx, hy - r * 2.1); g.lineTo(hx + r * 1.1, hy - r * 0.8); g.fill();
    if (spec.hat === 'feather') { g.lineWidth = r * 0.35; g.beginPath(); g.moveTo(hx - r * 0.6, hy - r * 1.5); g.quadraticCurveTo(hx - r * 2.6, hy - r * 3.4, hx - r * 3.2, hy - r * 1.6); g.stroke(); }
  } else if (spec.hat === 'tricorne-front') {
    g.beginPath(); g.ellipse(hx, hy - r * 0.8, r * 2.3, r * 0.5, 0, 0, 7); g.fill();
    g.beginPath(); g.moveTo(hx - r * 1.2, hy - r * 0.8); g.lineTo(hx, hy - r * 1.9); g.lineTo(hx + r * 1.2, hy - r * 0.8); g.fill();
  } else if (spec.hat === 'cap') {
    g.beginPath(); g.ellipse(hx + r * 0.1, hy - r * 0.55, r * 1.25, r * 0.7, 0, Math.PI, 0); g.fill();
  }
  if (spec.stoop) { g.beginPath(); g.arc(hx - r * 0.2, hy + r * 1.9, r * 0.9, 0, 7); g.fill(); }
}

function drawBust(g, S) {   // the giant shadow: head and shoulders, hat, front view
  g.fillStyle = '#fff';
  g.beginPath(); g.ellipse(0.5 * S, 0.38 * S, 0.105 * S, 0.13 * S, 0, 0, 7); g.fill();
  g.beginPath(); g.ellipse(0.5 * S, 0.27 * S, 0.24 * S, 0.045 * S, 0, 0, 7); g.fill();
  g.beginPath(); g.moveTo(0.36 * S, 0.27 * S); g.lineTo(0.5 * S, 0.13 * S); g.lineTo(0.64 * S, 0.27 * S); g.fill();
  g.beginPath(); g.moveTo(0.44 * S, 0.47 * S); g.quadraticCurveTo(0.2 * S, 0.53 * S, 0.1 * S, 0.66 * S); g.lineTo(0.03 * S, 1.0 * S); g.lineTo(0.97 * S, 1.0 * S); g.lineTo(0.9 * S, 0.66 * S); g.quadraticCurveTo(0.8 * S, 0.53 * S, 0.56 * S, 0.47 * S); g.closePath(); g.fill();
}
const BUST_EYES = [[0.455, 0.385], [0.545, 0.385]];

function drawHand(g, S, rnd = seeded(3)) {   // open hand, fingers up
  g.fillStyle = g.strokeStyle = '#fff'; g.lineCap = 'round';
  g.beginPath(); g.ellipse(0.5 * S, 0.62 * S, 0.17 * S, 0.2 * S, 0, 0, 7); g.fill();
  g.fillRect(0.4 * S, 0.7 * S, 0.2 * S, 0.3 * S);
  const fingers = [[0.36, 0.5, 0.3, 0.2], [0.44, 0.45, 0.43, 0.08], [0.52, 0.44, 0.54, 0.05], [0.6, 0.46, 0.65, 0.1], [0.64, 0.62, 0.84, 0.48]];
  g.lineWidth = 0.075 * S;
  for (const [x0, y0, x1, y1] of fingers) { g.beginPath(); g.moveTo(x0 * S, y0 * S); g.quadraticCurveTo(((x0 + x1) / 2 + (rnd() - 0.5) * 0.03) * S, ((y0 + y1) / 2) * S, x1 * S, y1 * S); g.stroke(); }
}

const POSE_CACHE = new Map();
function poseTexture(name) {
  if (POSE_CACHE.has(name)) return POSE_CACHE.get(name);
  const tex = canvasTexture(512, 512, (g, w) => {
    if (name === 'bust') drawBust(g, w);
    else if (name === 'hand') drawHand(g, w);
    else drawPose(g, w, POSE_SPECS[name]);
  });
  POSE_CACHE.set(name, tex);
  return tex;
}

