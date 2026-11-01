/* =====================================================================
   7. The acts
   ===================================================================== */

/** A local frame on the route: f = metres forward along the route, r = metres to the right (towards the giant). */
class Frame {
  constructor(route, s) {
    const P = route.at(s); this.s = s; this.ox = P.x; this.oz = P.z; this.tx = P.tx; this.tz = P.tz; this.rx = -P.nx; this.rz = -P.nz;
  }
  pt(f, r) { return { x: this.ox + f * this.tx + r * this.rx, z: this.oz + f * this.tz + r * this.rz }; }
  vec(df, dr) { return { x: df * this.tx + dr * this.rx, z: df * this.tz + dr * this.rz }; }
  v3(f, r, y = 0) { const p = this.pt(f, r); return new THREE.Vector3(p.x, y, p.z); }
  /** Pose in local terms. along: [df, dr] for a long piece's length; face: [f, r] the flat side looks at; leanTo: [f, r] the top tips towards. */
  pose({ f, r, y = 0, along = null, face = null, yaw = null, lean = 0, leanTo = null, leanAway = null, pitch = 0, roll = 0 }) {
    const p = this.pt(f, r);
    let yw = yaw ?? 0;
    if (along) { const d = this.vec(along[0], along[1]); yw = yawAlong(d.x, d.z); }
    if (face) { const q = this.pt(face[0], face[1]); yw = Math.atan2(q.x - p.x, q.z - p.z) / D2R; }
    let ld = 0;
    if (leanTo) { const q = this.pt(leanTo[0], leanTo[1]); ld = dirYaw(q.x - p.x, q.z - p.z); }
    if (leanAway) { const q = this.pt(leanAway[0], leanAway[1]); ld = dirYaw(p.x - q.x, p.z - q.z); }
    return makePose({ p: [p.x, y, p.z], yaw: yw, lean, leanDir: ld, pitch, roll });
  }
}

const isLong = (pc) => KIT_DEF[pc.kit].shape === 'long';
const radialHalf = (pc) => (isLong(pc) ? pc.dims[2] / 2 : pc.rad);
const tangentWidth = (pc) => (isLong(pc) ? pc.dims[0] : pc.rad * 2);

/**
 * Stand pieces round a centre, leaving a gap. Each piece sits as close as `radius` allows while
 * keeping `clear` metres of open floor round the centre; when one ring is full the rest form a ring behind it.
 */
function ringLayout(F, pieces, { cf = 0, cr = 0, radius, clear = 4.8, gapAt = 0, gapHalf = 20, outerGapHalf = null, arcs = null, lean = 0, outerLean = null, spacing = 0.6, step = 4.6, jitter = 0 }, rnd = Math.random) {
  const poses = new Map(); let R = radius, ring = 0;
  const arcsFor = (rg) => arcs || [[gapAt + (rg && outerGapHalf != null ? outerGapHalf : gapHalf), gapAt + 360 - (rg && outerGapHalf != null ? outerGapHalf : gapHalf)]];
  let list = arcsFor(0), ai = 0, a = list[0][0];
  for (const pc of pieces) {
    const tw = tangentWidth(pc) + spacing;
    let rad = Math.max(R, clear + radialHalf(pc)), da = (tw / rad) / D2R;
    while (a + da > list[ai][1]) {
      ai++;
      if (ai >= list.length) { ring++; R += step; list = arcsFor(ring); ai = 0; }
      a = list[ai][0]; rad = Math.max(R, clear + radialHalf(pc)); da = (tw / rad) / D2R;
    }
    const ang = (a + da / 2) * D2R; a += da;
    const f = cf + rad * Math.cos(ang), r = cr + rad * Math.sin(ang), tan = [-Math.sin(ang), Math.cos(ang)];
    const L = ring > 0 && outerLean != null ? outerLean : lean;
    poses.set(pc, F.pose({ f: f + (rnd() - 0.5) * jitter, r: r + (rnd() - 0.5) * jitter, along: isLong(pc) ? tan : null, yaw: isLong(pc) ? null : rnd() * 360, lean: L, leanTo: [cf, cr] }));
  }
  return poses;
}
/** Stand pieces in a straight row from f0 towards f1 at lateral offset r (long pieces along the row). */
function rowLayout(F, pieces, { f0, f1, r, spacing = 0.8, lean = 0, leanTo = null }) {
  const poses = new Map(); let f = f0; const dir = Math.sign(f1 - f0) || 1;
  for (const pc of pieces) {
    const half = (isLong(pc) ? pc.dims[0] : pc.rad * 2) / 2;
    f += dir * half;
    poses.set(pc, F.pose({ f, r: r + Math.sign(r) * radialHalf(pc), along: isLong(pc) ? [1, 0] : null, yaw: 0, lean, leanTo: leanTo ?? [f, 0] }));
    f += dir * (half + spacing);
  }
  return poses;
}

/** A thing that rides on a piece (a painted silhouette on a slab, say). Offset is in the piece's own unscaled frame. */
class Attachment {
  constructor(obj, offset, { quat = null } = {}) { this.obj = obj; this.offset = offset; this.quat = quat; this.tmp = new THREE.Vector3(); }
  follow(pc) {
    this.tmp.copy(this.offset).applyQuaternion(pc.mesh.quaternion).add(pc.mesh.position);
    this.obj.position.copy(this.tmp); this.obj.quaternion.copy(pc.mesh.quaternion); if (this.quat) this.obj.quaternion.multiply(this.quat);
  }
}
/** Fade a silhouette's opacity over time. */
function fadeFigure(w, fig, to, seconds = 1.2) { const from = fig.material.opacity; fig.mesh.visible = true; return w.tweens.run(seconds, (k) => { fig.material.opacity = lerp(from, to, k); if (k >= 1 && to <= 0.001) fig.mesh.visible = false; }); }

/**
 * A memory scene (Act 1, Act 2): the masks work only in its pocket, the open floor its pieces leave round the
 * player. Wearing a mask sends every piece to that mask's pose; taking it off sends them back.
 */
class Memory {
  constructor(world, { pocket, pocketRadius, pieces, palettes, monologues, onWear, onRemove }) {
    Object.assign(this, { w: world, pocket, pocketRadius, pieces, palettes, monologues, onWear, onRemove });
    this.enabled = false; this.complete = false; this.seen = new Set(); this.token = 0; this.current = null;
  }
  inPocket(p) { return Math.hypot(p.x - this.pocket.x, p.z - this.pocket.z) <= this.pocketRadius; }
  async wear(mask) {
    const tok = ++this.token; this.current = mask;
    for (const pc of this.pieces) { pc.speedSave ??= pc.speed; pc.speed = pc.speedSave * 2.1; pc.go(pc.poses[mask] ? mask : 'neutral'); }   // fast: the scene re-forms while the mask goes on
    this.w.atmo.to(this.palettes[mask], 1.6);
    this.onWear?.(mask);
    await this.w.sched.wait(2.4);
    if (tok !== this.token) return;
    await this.w.ui.monologue(this.monologues[mask], () => tok !== this.token);
    if (tok !== this.token) return;
    this.seen.add(mask); this.w.masks.refresh(true);
  }
  remove() {
    ++this.token; this.current = null;
    this.w.ui.clearMonologue();
    for (const pc of this.pieces) { pc.speed = (pc.speedSave ?? pc.speed) * 1.7; pc.go('neutral'); }
    this.w.atmo.to(this.palettes.neutral, 1.6);
    this.onRemove?.();
    if (this.seen.size === MASK_IDS.length && !this.complete) { this.complete = true; }
  }
  hint() {
    if (!this.enabled || this.complete) return '';
    const masks = this.w.masks;
    if (!this.inPocket(this.w.player.pos)) return '';
    if (!masks.current) return this.seen.size === 0 ? 'Press Tab to choose a mask  (or 1 / 2 / 3)' : (this.seen.size < 3 ? 'Choose another mask  (Tab)' : '');
    if (this.seen.size === 3) return 'Right-click to take off the mask.';
    return '';
  }
}

/* ---------------------------------------------------------------- Opening: the table in the dark */
class Opening {
  constructor(w) {
    this.w = w; const F = this.F = new Frame(w.route, 0.5);
    this.pieces = [];
    const add = (id, kit, sz, cat, poses, opts = {}) => { const pc = new Piece(id, kit, sz, { cat, group: 'opening', ...opts }); for (const [k, v] of Object.entries(poses)) pc.define(k, v.pos ? v : F.pose(v)); w.stage.add(pc); pc.snap(Object.keys(poses)[0]); this.pieces.push(pc); return pc; };
    // the table: a pillar laid on two marble cubes; Don Giovanni sits on a third cube at the far end
    this.top = add('O_table', 'Pillar', 0, 'marble', { home: { f: 1.6, r: 0, y: 0.91, along: null, yaw: 0, pitch: 90 }, away: { f: 30, r: 3, y: 0.91, pitch: 90 } }, { speed: 4 });
    // pitch 90 lays the pillar's length along local +z; turn it to run along the route
    const yawF = Math.atan2(F.tx, F.tz) / D2R;
    this.top.define('home', makePose({ p: [F.pt(1.6, 0).x, 0.91, F.pt(1.6, 0).z], yaw: yawF, pitch: 90 }));
    this.top.define('away', makePose({ p: [F.pt(1.6, 0).x, -1.2, F.pt(1.6, 0).z], yaw: yawF, pitch: 90 }));
    this.top.snap('home');
    this.legA = add('O_legA', 'Cube', 0, 'marble', { home: { f: 2.6, r: 0 }, away: { f: 2.6, r: 0, y: -1.9 } });
    this.legB = add('O_legB', 'Cube', 0, 'marble', { home: { f: 7.8, r: 0 }, away: { f: 7.8, r: 0, y: -1.9 } });
    this.seat = add('O_seat', 'Cube', 0, 'marble', { home: { f: 10.1, r: 0 }, away: { f: 10.1, r: 0, y: -1.9 } });
    for (const pc of [this.top, this.legA, this.legB, this.seat]) { pc.speed = 0.55; pc.collide = false; }
    // wreckage leaning over the table in the dark; after the dialogue it becomes the first walls of the path
    add('O_w1', 'Sail', 2, 'plum', { wreck: { f: 4.5, r: 7.2, along: [1, 0], lean: 22, leanTo: [4.5, 0] }, clear: { f: 5, r: 9.5, along: [1, 0.1], lean: 6, leanTo: [5, 0] } });
    add('O_w2', 'Prism', 3, 'green', { wreck: { f: -3, r: -7, yaw: 20, lean: 16, leanTo: [1, 0] }, clear: { f: -4, r: -8.5, yaw: 5, lean: 4, leanTo: [0, 0] } });
    add('O_w3', 'Spike', 3, 'plum', { wreck: { f: 12, r: -6.5, yaw: 0, lean: 24, leanTo: [8, 0] }, clear: { f: 13, r: -8, yaw: 0, lean: 7, leanTo: [13, 0] } });
    add('O_w4', 'Pillar', 3, 'plum', { wreck: { f: 13.5, r: 2.5, y: 0.84, along: [0.3, 1], lean: 88, leanTo: [13.5, 12] }, clear: { f: 16, r: 7.5, y: 0.84, along: [1, 0], lean: 88, leanTo: [16, 14] } });
    add('O_w5', 'Blade', 2, 'plum', { wreck: { f: -5.5, r: 4.5, along: [1, -0.3], lean: 10, leanTo: [0, 0] }, clear: { f: -6, r: 6.5, along: [1, 0], lean: 4, leanTo: [-6, 0] } });
    add('O_w6', 'Prism', 2, 'green', { wreck: { f: 8, r: 8.5, yaw: 40, lean: 14, leanTo: [6, 0] }, clear: { f: 10, r: 10, yaw: 10, lean: 3, leanTo: [10, 0] } });
    add('O_w7', 'Orb', 3, 'orb', { wreck: { f: -1.5, r: -9.5 }, clear: { f: -2, r: -11 } });
    add('O_w8', 'Notch', 2, 'plum', { wreck: { f: 13, r: -1.4, along: [0, 1], lean: 6, leanTo: [6, 0] }, clear: { f: 19, r: -7.2, along: [1, 0], lean: 5, leanTo: [19, 0] } });
    add('O_w9', 'Cube', 3, 'marble', { wreck: { f: 3, r: -6, yaw: 25 }, clear: { f: 2.5, r: -7.5, yaw: 10 } });
    for (const st of ['wreck', 'clear']) {
      const map = new Map(this.pieces.filter((pc) => pc.poses[st]).map((pc) => [pc, pc.poses[st]]));
      relaxLayout(map, { clear: { ...F.pt(4, 0), r: 2.6 } });
    }
    for (const pc of this.pieces) if (pc.poses.wreck) pc.snap('wreck');
    this.don = new Figure('seated', 2.0); w.scene.add(this.don.mesh);
    const dp = F.pt(10.25, 0); this.don.mesh.position.set(dp.x, 0.55, dp.z); this.don.mesh.rotation.y = Math.atan2(-F.tx, -F.tz);
    this.donHalo = makeHalo(3.2, 0.3); { const hp = F.pt(10.9, 0); this.donHalo.position.set(hp.x, 1.5, hp.z); this.donHalo.rotation.y = Math.atan2(-F.tx, -F.tz); } w.scene.add(this.donHalo);
    this.masks = [];
  }
  attachMasks(models) {
    const offs = { don: -0.4, anna: 0, servant: 0.4 }, F = this.F;
    for (const id of MASK_IDS) {
      if (!models[id]) continue;
      const m = models[id].clone(true);
      m.traverse((o) => { if (o.isMesh) o.material = wobbleMaterial(o.material, null, this.time ??= { value: 0 }); });
      const p = F.pt(2.1 + Math.abs(offs[id]) * 0.4, offs[id]);
      m.rotation.set(-Math.PI / 2, 0, Math.atan2(F.tx, F.tz)); m.position.set(p.x, 1.31, p.z);
      m.userData.maskId = id; this.w.scene.add(m); this.masks.push(m);
    }
  }
  placePlayer() { const F = this.F; this.w.player.place(F.pt(-0.6, 0), dirYaw(F.tx, F.tz)); }
  async run() {
    const { w } = this; const { ui, sched, player, atmo } = w;
    atmo.set('void'); this.placePlayer(); player.pitch = -0.2; player.moveLock = true;
    for (const pc of this.pieces) if (pc.poses.wreck) pc.snap('wreck');
    const tableSpot = w.lights.get('table'), donSpot = w.lights.get('donRim');
    await sched.wait(0.8 * FAST);
    ui.fade(0, 3.0);
    tableSpot.set({ from: this.F.v3(2.6, 0.4, 8), to: this.F.v3(2.4, 0, 1.25), color: 0xffe6c8, intensity: 16, angle: 0.24, beam: 0.08 }, 3);
    donSpot.set({ from: this.F.v3(14, 0.5, 6), to: this.F.v3(10.3, 0, 1.4), color: 0x9fb4ff, intensity: 5, angle: 0.18, beam: 0.05 }, 3);
    await sched.wait(3.2 * FAST);
    await ui.lines(SCRIPT.opening, (line) => { if (line[2] === 'masks') this.#clarifyMasks(); });
    await this.#dissolve();
    w.masks.owned = true; w.masks.reveal(3);
    player.moveLock = false;
    ui.title(SCRIPT.openingTitle, 4);
    ui.prompt('W A S D to walk  ·  hold Shift to run  ·  mouse to look', 8);
    atmo.to('neutral', 7);
    this.pieces.filter((pc) => pc.poses.clear).forEach((pc, i) => setTimeout(() => pc.go('clear'), (i % 5) * 700));   // the wreckage gets up one piece at a time
    w.corridor.enabled = true;
    w.progress.cap = w.acts.act1.sMark;
    w.lights.release('table', 4); w.lights.release('donRim', 2);
    await sched.until(() => w.progress.s > w.acts.act1.sMark - 13);
  }
  async #clarifyMasks() { for (const m of this.masks) { m.userData.clear = 1; await this.w.sched.wait(0.6); m.userData.clear = 0; } }
  async #dissolve() {
    const { w } = this;
    w.audio.rumble(3);
    w.tweens.run(2, (k) => { this.donHalo.material.opacity = 0.3 * (1 - k); });
    await fadeFigure(w, this.don, 0, 2.0);
    for (const pc of [this.top, this.legA, this.legB, this.seat]) pc.go('away');
    const start = this.masks.map((m) => m.position.clone());
    await w.tweens.run(2.2, (k) => {
      const cam = w.camera.position;
      this.masks.forEach((m, i) => {
        const tgt = v3(cam.x, cam.y - 0.35, cam.z).add(w.player.forward().multiplyScalar(0.5)); tgt.y -= 0.05; tgt.x += (i - 1) * 0.15;
        m.position.lerpVectors(start[i], tgt, k); const s = lerp(1, 0.45, k); m.scale.set(s, s, s);
      });
    });
    this.masks.forEach((m) => { m.visible = false; });
  }
  skip() {
    for (const pc of this.pieces) pc.snap(pc.poses.clear ? 'clear' : 'away');
    this.don.mesh.visible = false; this.donHalo.visible = false; this.masks.forEach((m) => { m.visible = false; });
    this.w.masks.owned = true; this.w.corridor.enabled = true; this.w.progress.cap = Math.max(this.w.progress.cap, this.w.acts.act1.sMark);
  }
  update(dt, time) {
    if (this.time) this.time.value = time;
    for (const m of this.masks) { const want = m.userData.clear ? 0 : 1; m.userData.wob = lerp(m.userData.wob ?? 1, want, Math.min(1, dt * 4)); m.traverse((o) => { if (o.isMesh && o.material.userData.wobble) o.material.userData.wobble.value = 0.006 * m.userData.wob; }); }
  }
}

/* ---------------------------------------------------------------- Act 1: the courtyard */
class Act1 {
  constructor(w) {
    this.w = w; this.sMark = w.route.sAtPhi(64); const F = this.F = new Frame(w.route, this.sMark);
    this.range = [this.sMark - 15, this.sMark + 23];
    this.pocket = F.v3(0, 0); this.centre = F.v3(3, 0);
    const rnd = seeded(101); this.pieces = [];
    const add = (id, kit, sz, opts = {}) => { const pc = new Piece(id, kit, sz, { group: 'act1', ...opts }); w.stage.add(pc); this.pieces.push(pc); return pc; };
    this.slabL = add('A1_slabL', 'Sail', 1); this.slabR = add('A1_slabR', 'Sail', 1);
    this.lift = [add('A1_liftL', 'Cube', 4, { collide: false }), add('A1_liftR', 'Cube', 4, { collide: false })];
    const ringKits = [['Blade', 0], ['Spike', 1], ['Notch', 0], ['Prism', 1], ['Pillar', 2], ['Spike', 1], ['Blade', 0], ['Prism', 1], ['Orb', 2], ['Notch', 0], ['Spike', 1], ['Prism', 1], ['Pillar', 2], ['Cone', 1], ['Prism', 1], ['Spike', 2], ['Drum', 0], ['Prism', 2]];
    this.ring = ringKits.map(([k, sz], i) => add(`A1_${String(i).padStart(2, '0')}`, k, sz));
    // --- approach: an open courtyard, pieces standing loosely round its edge, the duel at the far end
    const approach = ringLayout(F, this.ring, { cf: 3, cr: 0, radius: 13.2, clear: 11, arcs: [[52, 146], [214, 308]], lean: 0, spacing: 1.4, step: 4.4, jitter: 1.2 }, rnd);
    // --- gather / neutral: they close in round the mark, open only towards the duel
    const aroundCourt = (pose) => { const l = this.#local(pose.pos); return (Math.atan2(l.r, l.f - 3) / D2R + 360) % 360; };
    const approachOrder = [...this.ring].sort((a, b) => ((aroundCourt(approach.get(a)) - 40 + 360) % 360) - ((aroundCourt(approach.get(b)) - 40 + 360) % 360));
    const gather = ringLayout(F, approachOrder, { radius: 8.4, clear: 5.0, gapAt: 0, gapHalf: 46, outerGapHalf: 64, lean: 4, outerLean: 7, spacing: 0.6, step: 4.6 }, rnd);
    // --- Don Giovanni: an orderly lane, two straight rows to the duel
    const sideOf = (pc) => this.#local(gather.get(pc).pos).r, byF = (a, b) => this.#local(gather.get(a).pos).f - this.#local(gather.get(b).pos).f;
    let left = this.ring.filter((pc) => sideOf(pc) < 0).sort(byF), right = this.ring.filter((pc) => sideOf(pc) >= 0).sort(byF);
    while (left.length > right.length + 1) right.unshift(left.shift()); while (right.length > left.length + 1) left.unshift(right.shift());
    const rowsL = rowLayout(F, left.slice(0, 6), { f0: -6, f1: 15, r: -5.4 }), rowsR = rowLayout(F, right.slice(0, 6), { f0: -6, f1: 15, r: 5.4 });
    const rowsL2 = rowLayout(F, left.slice(6), { f0: -4, f1: 15, r: -10 }), rowsR2 = rowLayout(F, right.slice(6), { f0: -4, f1: 15, r: 10 });
    const don = new Map([...rowsL, ...rowsR, ...rowsL2, ...rowsR2]);
    // every later layout keeps the gathered ring's order round the mark, so no two pieces cross on the way
    const angleOf = (pose) => { const l = this.#local(pose.pos); return (Math.atan2(l.r, l.f) / D2R + 360) % 360; };
    const ordered = [...this.ring].sort((a, b) => ((angleOf(gather.get(a)) - 36 + 360) % 360) - ((angleOf(gather.get(b)) - 36 + 360) % 360));
    // --- Anna: a cage leaning in, one gap towards the duel where Don Giovanni stands
    const anna = ringLayout(F, ordered, { radius: 7.0, clear: 5.0, gapAt: 0, gapHalf: 17, outerGapHalf: 34, lean: 7, outerLean: 11, spacing: 0.35, step: 4.6 }, rnd);
    // --- Leporello: a pit with slits; the duel goes up on two lifts
    const servant = ringLayout(F, ordered, { radius: 6.3, clear: 4.95, gapAt: 0, gapHalf: 7, outerGapHalf: 48, lean: 6, outerLean: 10, spacing: 0.25, step: 4.6 }, rnd);
    // --- exit: everything in front of the mark steps aside
    const exit = new Map();
    for (const pc of this.ring) {
      const g = gather.get(pc), p = g.pos, loc = this.#local(p), ang = Math.atan2(loc.r, loc.f) / D2R;
      if (Math.abs(ang) < 70) { const side = Math.sign(loc.r) || 1; exit.set(pc, F.pose({ f: loc.f + 2, r: side * (9.5 + Math.abs(loc.r) * 0.6), along: isLong(pc) ? [1, 0] : null, yaw: rnd() * 360, lean: 5, leanTo: [loc.f, 0] })); }
      else exit.set(pc, g);
    }
    // settle every layout: nothing overlaps, nothing in the pocket round the mark
    const pocketClear = { x: this.pocket.x, z: this.pocket.z, r: 4.2 + 0.3 };
    const slabsFor = (st) => new Map([[this.slabL, this.#slabPose(-1, st)], [this.slabR, this.#slabPose(1, st)], [this.lift[0], this.#liftPose(-1, st)], [this.lift[1], this.#liftPose(1, st)]]);
    for (const [st, map] of [['approach', approach], ['gather', gather], ['don', don], ['anna', anna], ['servant', servant], ['exit', exit]]) {
      const all = new Map([...map, ...slabsFor(st)]);
      const fixed = new Set([this.slabL, this.slabR, ...this.lift]);
      relaxLayout(all, { clear: st === 'approach' || st === 'exit' ? null : pocketClear, keep: (pc, x, z) => (fixed.has(pc) ? { x: all.get(pc).pos.x, z: all.get(pc).pos.z } : null) });
    }
    for (const pc of this.ring) {
      pc.define('approach', approach.get(pc)); pc.define('gather', gather.get(pc)); pc.define('neutral', gather.get(pc));
      pc.define('don', don.get(pc)); pc.define('anna', anna.get(pc)); pc.define('servant', servant.get(pc)); pc.define('exit', exit.get(pc));
      pc.snap('approach'); pc.drift = null;
    }
    // the duel boards, and the two lifts that raise them for Leporello's view
    for (const [pc, sgn] of [[this.slabL, -1], [this.slabR, 1]]) {
      for (const st of ['approach', 'gather', 'neutral', 'don', 'anna', 'servant', 'exit']) pc.define(st, this.#slabPose(sgn, st));
      pc.snap('approach');
    }
    this.lift.forEach((pc, i) => { for (const st of ['approach', 'gather', 'neutral', 'don', 'anna', 'servant', 'exit']) pc.define(st, this.#liftPose(i ? 1 : -1, st)); pc.snap('approach'); pc.speed = 1.6; });
    // silhouettes: the duel painted on the boards; Don Giovanni in the doorway and the body on the floor for Anna
    this.figL = new Figure('guard', 4.0); this.figR = new Figure('guard', 4.0);
    this.slabL.attachments.push(new Attachment(this.figL.mesh, v3(0, 1.0, 0.25))); this.slabR.attachments.push(new Attachment(this.figR.mesh, v3(0, 1.0, 0.25), { quat: new THREE.Quaternion().setFromAxisAngle(v3(0, 1, 0), Math.PI) }));
    this.figR.mesh.scale.x = 4.0;
    [this.figL, this.figR].forEach((f) => w.scene.add(f.mesh));
    this.door = new Figure('cloak', 2.5); this.door.material.opacity = 0; this.door.mesh.visible = false;
    const dp = F.pt(13.2, 0); this.door.mesh.position.set(dp.x, 0, dp.z); this.door.mesh.rotation.y = Math.atan2(-F.tx, -F.tz) + Math.PI; w.scene.add(this.door.mesh);
    this.body = new Figure('lying', 2.6); this.body.mesh.geometry = new THREE.PlaneGeometry(1, 1); this.body.material.opacity = 0; this.body.mesh.visible = false; this.body.mesh.renderOrder = 4;
    const bp = F.pt(5.8, 0); this.body.mesh.position.set(bp.x, 0.05, bp.z); this.body.mesh.rotation.set(-Math.PI / 2, 0, Math.atan2(F.tz, F.tx)); w.scene.add(this.body.mesh);
    const crackTex = canvasTexture(1024, 1024, (g, W, H) => drawCracks(g, W, H, seeded(5), { centres: [[0.5, 0.5]], color: 'rgba(175,205,235,.9)', count: 11, len: 0.48 }));
    this.crack = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial({ map: crackTex, transparent: true, opacity: 0, depthWrite: false }));
    this.crack.rotation.x = -Math.PI / 2; this.crack.position.set(bp.x, 0.03, bp.z); this.crack.renderOrder = 3; w.scene.add(this.crack);
    this.memory = new Memory(w, {
      pocket: this.pocket, pocketRadius: 4.2, pieces: [...this.ring, this.slabL, this.slabR, ...this.lift],
      palettes: { neutral: 'neutral', don: 'neutral', anna: 'anna', servant: 'servant' }, monologues: SCRIPT.act1Mono,
      onWear: (m) => this.#stateLook(m), onRemove: () => this.#stateLook('neutral'),
    });
    this.duelT = 0; this.stabT = -1; this.state = 'approach';
  }
  #slabPose(sgn, st) {
    const F = this.F;
    if (st === 'don') return F.pose({ f: 19.5, r: sgn * 5.9, face: [-60, sgn * 1.2] });          // side by side: one wide backdrop at the end of the lane
    if (st === 'anna') return F.pose({ f: 13.6, r: sgn * 6.05, face: [-60, 0] });                 // a narrow V-shaped slot between them: the only way out
    if (st === 'servant') return F.pose({ f: sgn < 0 ? 11.5 : 13.9, r: sgn * 2.6, y: 3.5, face: [0, sgn * 0.4] });   // staggered on the raised platform
    if (st === 'exit') return F.pose({ f: 16, r: sgn * 14.5, face: [0, sgn * 5] });
    return F.pose({ f: 12.5, r: sgn * 5.9, face: [0, sgn * 1.5] });
  }
  #liftPose(sgn, st) { return this.F.pose({ f: 12.7, r: sgn * 3.3, y: st === 'servant' ? -2.5 : -6.4 }); }
  #local(p) { const dx = p.x - this.F.ox, dz = p.z - this.F.oz; return { f: dx * this.F.tx + dz * this.F.tz, r: dx * this.F.rx + dz * this.F.rz }; }
  #spot(name, opts, s = 1.4) { this.w.lights.get(name).set(opts, s); }
  /** Lights and silhouettes for each state. Followspots always pick out the people in the scene. */
  #stateLook(state) {
    const F = this.F, w = this.w; this.state = state;
    const duel = (f, rL, rR, y) => { this.#spot('a1a', { from: F.v3(f - 7, rL - 1, y + 13), to: F.v3(f, rL, y + 2.6), color: 0xfff1dc, intensity: 9, angle: 0.2 }); this.#spot('a1b', { from: F.v3(f - 7, rR + 1, y + 13), to: F.v3(f, rR, y + 2.6), color: 0xfff1dc, intensity: 9, angle: 0.2 }); };
    w.lights.release('a1c', 1);
    if (state === 'neutral' || state === 'gather') { duel(12.5, -5.8, 5.8, 0); this.figL.setPose('guard'); this.figR.setPose('guard'); fadeFigure(w, this.figL, 1); fadeFigure(w, this.figR, 1); fadeFigure(w, this.door, 0); fadeFigure(w, this.body, 0); this.#crack(0); this.stabT = -1; }
    if (state === 'don') { this.#spot('a1a', { from: F.v3(10, 0, 15), to: F.v3(19.2, 0, 2.6), color: 0xfff4e2, intensity: 11, angle: 0.24 }); w.lights.release('a1b', 1); this.figL.setPose('guard'); this.figR.setPose('guard'); }
    if (state === 'anna') {
      this.#spot('a1a', { from: F.v3(5.8, 0, 14), to: F.v3(5.8, 0, 0), color: 0xa8c4ff, intensity: 7, angle: 0.17 });
      this.#spot('a1b', { from: F.v3(22, 0, 6), to: F.v3(13.2, 0, 1.2), color: 0xbcd4ff, intensity: 10, angle: 0.16, beam: 0.03 });
      fadeFigure(w, this.figL, 0, 1); fadeFigure(w, this.figR, 0, 1); fadeFigure(w, this.door, 1, 1.6); fadeFigure(w, this.body, 1, 1.6); this.#crack(1);
    }
    if (state === 'servant') { this.#spot('a1a', { from: F.v3(12.7, 0, 20), to: F.v3(12.7, 0, 3.5), color: 0xffd2c4, intensity: 12, angle: 0.24 }); w.lights.release('a1b', 1); this.figL.setPose('guard'); this.figR.setPose('guard'); this.stabT = 0; }
    if (state !== 'anna') { fadeFigure(w, this.door, 0, 0.8); fadeFigure(w, this.body, 0, 0.8); this.#crack(0); if (state !== 'neutral' && state !== 'gather') { fadeFigure(w, this.figL, 1); fadeFigure(w, this.figR, 1); } }
  }
  /** Debug: snap the whole courtyard into a state and light it. */
  showState(state) { for (const pc of this.memory.pieces) pc.snap(pc.poses[state] ? state : 'neutral'); this.#stateLook(state); this.w.atmo.set({ don: 'neutral', anna: 'anna', servant: 'servant' }[state] || 'neutral'); }
  #crack(to) { const from = this.crack.material.opacity; this.w.tweens.run(1.4, (k) => { this.crack.material.opacity = lerp(from, to, k); }); }
  placePlayer() { const F = this.F; this.w.player.place(F.pt(-17, 0), dirYaw(F.tx, F.tz)); }
  async run() {
    const { w } = this, F = this.F;
    await w.sched.until(() => w.progress.s > this.sMark - 12);
    // the courtyard closes behind the player and starts to gather round the mark
    w.boundary.zone('act1', { kind: 'disk', x: this.centre.x, z: this.centre.z, r: 15.5 });
    w.ui.title(SCRIPT.actTitles.act1, 2.5);
    this.#stateLook('gather');
    for (const pc of this.ring) { pc.speedSave = pc.speed; pc.speed = 1.35; pc.go('gather'); }
    this.gatherT = 0; this.gathering = true;
    this.#spot('a1c', { from: F.v3(-3, 0, 14), to: F.v3(0, 0, 0), color: 0xfff0d8, intensity: 5, angle: 0.16, beam: 0.06 }, 3);
    w.masks.setMemory(this.memory);
    const talk = w.ui.lines(SCRIPT.act1Intro);
    await talk;
    await w.sched.until(() => this.memory.inPocket(w.player.pos) || this.gatherT > 30);
    if (!this.memory.inPocket(w.player.pos)) { w.ui.prompt('Step into the light.', 0); await w.sched.until(() => this.memory.inPocket(w.player.pos)); w.ui.prompt(''); }
    this.gathering = false; w.lights.release('a1c', 1.5);
    w.boundary.zone('act1', { kind: 'disk', x: this.pocket.x, z: this.pocket.z, r: 5.2 });
    for (const pc of this.ring) pc.speed = pc.speedSave;
    this.memory.enabled = true; w.masks.refresh(true);
    await w.sched.until(() => this.memory.complete);
    w.ui.prompt(''); w.masks.setMemory(null);
    await w.sched.wait(1.2);
    this.#exit();
    await w.sched.until(() => w.progress.s > this.range[1] - 2);
    w.boundary.remove('act1');
  }
  #exit() {
    const { w } = this;
    for (const pc of [...this.ring, this.slabL, this.slabR]) { pc.speed = (pc.speedSave ?? pc.speed); pc.go('exit'); }
    w.audio.rumble(3.5);
    fadeFigure(w, this.figL, 0, 2); fadeFigure(w, this.figR, 0, 2);
    w.lights.release('a1a', 2); w.lights.release('a1b', 2);
    w.boundary.zone('act1', { kind: 'disk', x: this.pocket.x, z: this.pocket.z, r: 6 });
    w.progress.cap = w.acts.balcony.sNook + 0.6;
    w.crows?.burst(this.F.v3(14, 0, 6));
  }
  skip() { for (const pc of [...this.ring, this.slabL, this.slabR, ...this.lift]) pc.snap(pc.poses.exit ? 'exit' : 'neutral'); this.memory.complete = true; this.memory.seen = new Set(MASK_IDS); this.figL.mesh.visible = this.figR.mesh.visible = false; this.w.progress.cap = this.w.acts.balcony.sNook + 0.6; }
  update(dt) {
    if (this.gathering) {   // the courtyard shrinks round the player, never under their feet
      this.gatherT += dt;
      const shrink = lerp(15.5, 5.2, clamp01(this.gatherT / 18)), pd = Math.hypot(this.w.player.pos.x - this.pocket.x, this.w.player.pos.z - this.pocket.z);
      const z = this.w.boundary.zones.get('act1');
      if (z) { const want = Math.max(shrink, pd + 0.6); z.x = this.pocket.x; z.z = this.pocket.z; z.r = Math.min(z.r === 15.5 && z.x !== this.pocket.x ? 99 : z.r, want); }
    }
    // the duel goes on in the unmasked memory; a single thrust seen from the pit
    if ((this.state === 'gather' || this.state === 'neutral') && !this.memory.complete) {
      this.duelT += dt; const ph = Math.floor(this.duelT / 1.25) % 2;
      this.figL.setPose(ph ? 'lunge' : 'guard'); this.figR.setPose(ph ? 'guard' : 'lunge');
    }
    if (this.state === 'servant' && this.stabT >= 0) {
      this.stabT += dt;
      if (this.stabT > 2.6) this.figL.setPose('lunge');
      if (this.stabT > 3.0) this.figR.setPose('fall');
      if (this.stabT > 4.2) this.figR.material.opacity = Math.max(0, 1 - (this.stabT - 4.2) / 1.5);
    }
  }
}

/* ---------------------------------------------------------------- The balcony: where the shadow lines up */
class Balcony {
  constructor(w) {
    this.w = w; this.sNook = w.route.sAtPhi(98); const F = this.F = new Frame(w.route, this.sNook);
    this.range = [this.sNook - 3, this.sNook + 3];
    const P = w.route.at(this.sNook);
    // the spur runs from the route towards the centre; V1 at its end
    const inward = new THREE.Vector3(-P.x, 0, -P.z).normalize();
    this.entry = new THREE.Vector3(P.x, 0, P.z); this.V1 = this.entry.clone().addScaledVector(inward, 4.4);
    this.eye = this.V1.clone().setY(PLAYER.eye);
    const add = (id, kit, sz, pose, opts = {}) => { const pc = new Piece(id, kit, sz, { group: 'balcony', ...opts }); pc.define('home', pose); w.stage.add(pc); pc.snap('home'); return pc; };
    const side = new THREE.Vector3(-inward.z, 0, inward.x);
    const at = (a, b) => [this.V1.x + inward.x * a + side.x * b, 0, this.V1.z + inward.z * a + side.z * b];
    // two sails leaning together make a triangular window facing the centre
    const faceIn = Math.atan2(inward.x, inward.z) / D2R;
    // two sails side by side with a narrow gap: their sloping edges open into a V that frames the centre
    add('B_frameL', 'Sail', 1, makePose({ p: at(2.2, -6.15), yaw: faceIn, lean: 0 }));
    add('B_frameR', 'Sail', 1, makePose({ p: at(2.2, 6.15), yaw: faceIn, lean: 0 }));
    add('B_sideL', 'Pillar', 2, makePose({ p: at(-1.6, -2.4), yaw: yawAlong(inward.x, inward.z), lean: 5, leanDir: dirYaw(side.x, side.z) }));
    add('B_sideR', 'Pillar', 2, makePose({ p: at(-1.6, 2.4), yaw: yawAlong(inward.x, inward.z), lean: 5, leanDir: dirYaw(-side.x, -side.z) }));
    add('B_back', 'Prism', 3, makePose({ p: [P.x - inward.x * 6.5, 0, P.z - inward.z * 6.5], yaw: 15, lean: 5, leanDir: faceIn }));
    w.boundary.zone('spur', { kind: 'fn', test: (x, z, m) => {
      if (w.progress.s < this.sNook - 4) return false;
      const ax = this.entry.x, az = this.entry.z, bx = this.V1.x, bz = this.V1.z;
      const r = segPoint({ ax, az, bx, bz }, x, z); return r.d <= 1.45 - m * 0.5;
    } });
    this.done = false;
  }
  aligned() {
    const p = this.w.player; if (dist2(p.pos, this.V1) > 1.4) return false;
    const g = this.w.giant, target = new THREE.Vector3(g.centre.x, 13, g.centre.z).sub(this.eye).normalize();
    return p.forward().angleTo(target) < 12 * D2R;
  }
  async run() {
    const { w } = this; const t0 = w.sched.time;
    await w.sched.until(() => w.progress.s > this.sNook - 2);
    let hinted = false;
    await w.sched.until(() => {
      if (!hinted && w.sched.time - t0 > 45) { hinted = true; w.ui.prompt('Look through the window, towards the centre.', 6); }
      return this.aligned() || w.sched.time - t0 > 110;
    });
    this.done = true;
    w.giant.lightEyes(true); w.audio.sting();
    await w.ui.lines(SCRIPT.t1);
    w.giant.pose('stand', 1, 0.35); w.giant.glowOn = 1; w.audio.rumble(6);
    setTimeout(() => { w.giant.tracking = true; }, 9000);
    w.progress.cap = w.acts.act2.sCentre - 9;
    await w.sched.until(() => w.progress.s > this.sNook + 6);
    w.boundary.remove('spur');
  }
  skip() { this.done = true; this.w.giant.snap('stand'); this.w.giant.lightEyes(true); this.w.giant.glowOn = 1; this.w.giant.tracking = true; this.w.progress.cap = this.w.acts.act2.sCentre - 9; this.w.boundary.remove('spur'); }
  placePlayer() { const F = new Frame(this.w.route, this.sNook - 10); this.w.player.place(F.pt(0, 0), dirYaw(F.tx, F.tz)); }
  update() {}
}

/* ---------------------------------------------------------------- Act 2: the turntable */
class Act2 {
  constructor(w) {
    this.w = w; this.sCentre = w.route.sAtPhi(210); const F = this.F = new Frame(w.route, this.sCentre);
    this.range = [this.sCentre - 13, this.sCentre + 14];
    this.C = F.v3(0, 0); this.R = 11;
    // the revolving stage: part of the floor, raised 35 cm, turns on its own
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(this.R, this.R, 0.35, 96), MAT.floor); disc.position.set(this.C.x, 0.175, this.C.z); disc.receiveShadow = !LOW; w.scene.add(disc);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(this.R, 0.06, 6, 128), new THREE.MeshStandardMaterial({ color: 0xb4532a, roughness: 0.5 })); rim.rotation.x = Math.PI / 2; rim.position.set(this.C.x, 0.35, this.C.z); w.scene.add(rim);
    this.disc = disc;
    const rnd = seeded(202); this.pieces = [];
    const add = (id, kit, sz, opts = {}) => { const pc = new Piece(id, kit, sz, { group: 'act2', ...opts }); w.stage.add(pc); this.pieces.push(pc); return pc; };
    // eight green prisms; each carries three painted faces
    const facePoses = ['dancer', 'stand', 'anna', 'dandy', 'servant', 'dancer', 'cloak', 'lookupMan'];
    this.prisms = [];
    for (let i = 0; i < 8; i++) {
      const pc = add(`A2_P${i}`, 'Prism', 1);
      const ang = i * 45, ringPos = this.#polar(8.2, ang), wait = this.#polar(19 + rnd() * 5, ang + 8 + rnd() * 10);
      pc.define('approach', { p: [wait.x, 0, wait.z], yaw: rnd() * 360, lean: 10 + rnd() * 14, leanDir: rnd() * 360 });
      pc.define('neutral', { p: [ringPos.x, 0.35, ringPos.z], yaw: this.#faceYaw(ringPos), lean: 0 });
      const road = F.v3(i % 2 ? 3.6 : -3.6, -(13 + Math.floor(i / 2) * 7.5));   // Don Giovanni: a road away from the giant
      pc.define('don', { p: [road.x, 0, road.z], yaw: this.#faceYaw({ x: road.x, z: road.z }) + 90, lean: 0 });
      const sv = this.#polar(6.0, 90 + 42 + i * (276 / 7));                       // Leporello: a tight ring, gap towards the pedestals
      pc.define('servant', { p: [sv.x, 0.35, sv.z], yaw: this.#faceYaw(sv), lean: 8, leanDir: dirYaw(this.C.x - sv.x, this.C.z - sv.z) });
      const an = this.#polar(10.0, i * 45 + 22.5);                                  // Anna: pushed back to the edge of the stage
      pc.define('anna', { p: [an.x, 0.35, an.z], yaw: this.#faceYaw(an), lean: 0 });
      pc.define('exit', pc.poses.neutral);
      pc.snap('approach'); this.prisms.push(pc);
      pc.faces = [];
      const rin = pc.dims[0] / (2 * Math.sqrt(3));
      for (let k = 0; k < 3; k++) {
        const fig = new Figure(facePoses[(i + k * 3) % 8], 3.4); fig.material.color.set(0x070707); w.scene.add(fig.mesh);
        const fa = (180 + k * 120) * D2R;
        pc.attachments.push(new Attachment(fig.mesh, v3(Math.sin(fa) * (rin + 0.03), 1.6, Math.cos(fa) * (rin + 0.03)), { quat: new THREE.Quaternion().setFromAxisAngle(v3(0, 1, 0), fa) }));
        pc.faces.push(fig);
      }
    }
    // pedestals, and the lifts that raise them for Anna's tribunal
    this.peds = []; this.lifts = []; this.shades = [];
    [-1, 1].forEach((sgn, i) => {
      const ped = add(`A2_ped${i}`, 'Cube', 1), lift = add(`A2_lift${i}`, 'Pillar', 1, { collide: false });
      const at = F.v3(sgn * 2.4, 5.7), atS = F.v3(sgn * 1.5, 4.95), wait = F.v3(sgn * 5, 16);
      ped.define('approach', { p: [wait.x, 0, wait.z], yaw: 20 * sgn });
      ped.define('neutral', { p: [at.x, 0.35, at.z], yaw: this.#faceYaw(at) });
      ped.define('servant', { p: [atS.x, 0.35, atS.z], yaw: this.#faceYaw(atS) });
      ped.define('anna', { p: [at.x, 8.0, at.z], yaw: this.#faceYaw(at) });
      ped.define('don', ped.poses.neutral); ped.define('exit', ped.poses.neutral);
      ped.snap('approach'); ped.speed = 2.2;
      const low = { p: [at.x, -9.7, at.z], yaw: this.#faceYaw(at) };
      lift.define('approach', low); lift.define('neutral', low); lift.define('don', low); lift.define('servant', { p: [atS.x, -9.7, atS.z], yaw: 0 }); lift.define('exit', low);
      lift.define('anna', { p: [at.x, -1.6, at.z], yaw: this.#faceYaw(at) }); lift.snap('approach'); lift.speed = 2.0;
      this.peds.push(ped); this.lifts.push(lift);
      const sh = new Figure('cloak', 2.5); sh.material.opacity = 0; sh.mesh.visible = false; w.scene.add(sh.mesh);
      ped.attachments.push(new Attachment(sh.mesh, v3(0, 1.0 / 1.0, 0), { quat: new THREE.Quaternion().setFromAxisAngle(v3(0, 1, 0), Math.PI) }));
      this.shades.push(sh);
    });
    // tall walls that slide in from the fog to make Anna's tribunal
    this.tribunal = [];
    [['Pillar', 3, -4.6, 14.4], ['Pillar', 3, -1.55, 14.4], ['Pillar', 3, 1.55, 14.4], ['Pillar', 3, 4.6, 14.4], ['Sail', 2, -14.5, 10.5], ['Sail', 2, 14.5, 10.5]].forEach(([k, sz, f, r], i) => {
      const pc = add(`A2_T${i}`, k, sz);
      const wait = F.v3(f * 1.7 + (i - 2.5) * 3, 31 + (i % 3) * 5), wall = F.v3(f, r);
      pc.define('approach', { p: [wait.x, 0, wait.z], yaw: rnd() * 360, lean: 14, leanDir: rnd() * 360 });
      for (const st of ['neutral', 'don', 'servant', 'exit']) pc.define(st, pc.poses.approach);
      // a colonnade behind the raised judges, two great sails as its wings
      const yawWall = k === 'Sail' ? Math.atan2(this.C.x - wall.x, this.C.z - wall.z) / D2R : yawAlong(F.tx, F.tz);
      pc.define('anna', { p: [wall.x, 0, wall.z], yaw: yawWall, lean: 3, leanDir: dirYaw(this.C.x - wall.x, this.C.z - wall.z) });
      pc.snap('approach'); this.tribunal.push(pc);
    });
    this.prisms[0].define('exit', { p: [F.v3(3.4, 8.6).x, 0.35, F.v3(3.4, 8.6).z], yaw: 0 });
    // the route leaves the stage forward: two prisms on that side step aside
    const out = F.v3(9.5, 0);
    for (const pc of this.prisms) { const d = Math.hypot(pc.poses.neutral.pos.x - out.x, pc.poses.neutral.pos.z - out.z); if (d < 7) { const away = pc.poses.neutral.pos.clone().sub(this.C).setY(0).normalize().multiplyScalar(15).add(this.C); pc.define('exit', { p: [away.x, 0, away.z], yaw: 30, lean: 6, leanDir: 0 }); } }
    // silhouettes: victims under the tribunal, hands over the pit
    this.victims = [['lookup', -3.3, -1.0], ['lookupMan', 3.4, -0.4], ['lookup', -2.0, 3.2]].map(([pose, f, r]) => {
      const fig = new Figure(pose, 2.2); const p = F.pt(f, r); fig.mesh.position.set(p.x, 0.35, p.z); fig.material.opacity = 0; fig.mesh.visible = false; w.scene.add(fig.mesh); fig.at = p; return fig;
    });
    this.hands = Array.from({ length: 6 }, (_, i) => { const fig = new Figure('hand', 6); fig.material.opacity = 0; fig.mesh.visible = false; w.scene.add(fig.mesh); fig.ang = 90 + 30 + i * 52; return fig; });
    this.floorShadows = [new Figure('stand', 2.2), new Figure('stand', 2.2)];
    this.floorShadows.forEach((f) => { f.mesh.rotation.x = -Math.PI / 2; f.mesh.visible = false; w.scene.add(f.mesh); });
    // settle every state of the stage
    const act2 = [...this.prisms, ...this.peds, ...this.lifts, ...this.tribunal];
    for (const st of ['approach', 'neutral', 'don', 'anna', 'servant', 'exit']) {
      const map = new Map(act2.map((pc) => [pc, pc.poses[st] || pc.poses.neutral]));
      const locked = new Set([...this.peds, ...this.lifts]);
      relaxLayout(map, { clear: ['neutral', 'don', 'anna', 'servant'].includes(st) ? { x: this.C.x, z: this.C.z, r: 3.8 } : null, keep: (pc) => (locked.has(pc) ? { x: map.get(pc).pos.x, z: map.get(pc).pos.z } : null) });
    }
    this.prisms.forEach((pc) => pc.snap('approach')); this.tribunal.forEach((pc) => pc.snap('approach'));
    this.memory = new Memory(w, {
      pocket: this.C, pocketRadius: 3.5, pieces: [...this.prisms, ...this.peds, ...this.lifts, ...this.tribunal],
      palettes: { neutral: 'neutral', don: 'neutral', anna: 'anna', servant: 'servant' }, monologues: SCRIPT.act2Mono,
      onWear: (m) => this.#stateLook(m), onRemove: () => this.#stateLook('neutral'),
    });
    this.donSide = rnd() < 0.5 ? 0 : 1; this.state = 'approach'; this.spin = 0;
  }
  #polar(R, angDeg) { const a = angDeg * D2R; return this.F.pt(R * Math.cos(a), R * Math.sin(a)); }   // 0 = forward, 90 = towards the giant
  #faceYaw(p) { return Math.atan2(this.C.x - p.x, this.C.z - p.z) / D2R; }
  #spot(name, opts, s = 1.4) { this.w.lights.get(name).set(opts, s); }
  #stateLook(state) {
    const w = this.w, F = this.F; this.state = state;
    const real = this.shades[this.donSide], other = this.shades[1 - this.donSide];
    if (state === 'neutral') { this.#spot('a2a', { from: F.v3(-6, 3, 15), to: F.v3(0, 5.6, 1.5), color: 0xfff1de, intensity: 8, angle: 0.24 }); w.lights.release('a2b', 1); fadeFigure(w, real, 1); fadeFigure(w, other, 1); }
    if (state === 'don') { this.#spot('a2a', { from: F.v3(0, -6, 14), to: F.v3(0, -20, 0), color: 0xfff4e2, intensity: 7, angle: 0.3 }); this.realWalk = 0; }
    if (state === 'servant') { this.#spot('a2a', { from: F.v3(0, 0, 13), to: F.v3(0, 4.9, 1.5), color: 0xff6e58, intensity: 11, angle: 0.22 }); this.#spot('a2b', { from: F.v3(0, -3, 12), to: F.v3(0, 0, 0), color: 0xff8a70, intensity: 4, angle: 0.3 }); }
    if (state === 'anna') { this.#spot('a2a', { from: F.v3(0, 0, 16), to: F.v3(0, 5.7, 9.5), color: 0xbcd2ff, intensity: 9, angle: 0.22 }); this.#spot('a2b', { from: F.v3(0, -5, 12), to: F.v3(0, 0, 0), color: 0x9fb8e8, intensity: 4, angle: 0.35 }); }
    for (const v of this.victims) fadeFigure(w, v, state === 'anna' ? 1 : 0, 1.4);
    for (const h of this.hands) fadeFigure(w, h, state === 'servant' ? 1 : 0, 1.8);
    if (state !== 'don') { this.realWalk = -1; fadeFigure(w, real, 1, 1); }
    this.handsT = 0;
  }
  /** Debug: snap the stage into a state and light it. */
  showState(state) { for (const pc of this.pieces) pc.snap(pc.poses[state] ? state : 'neutral'); this.#stateLook(state); this.w.atmo.set({ don: 'neutral', anna: 'anna', servant: 'servant' }[state] || 'neutral'); }
  placePlayer() { const F = new Frame(this.w.route, this.sCentre - 18); this.w.player.place(F.pt(0, 0), dirYaw(F.tx, F.tz)); }
  async run() {
    const { w } = this; const F = this.F;
    await w.sched.until(() => dist2(w.player.pos, this.C) < this.R + 0.3);
    w.boundary.zone('act2', { kind: 'disk', x: this.C.x, z: this.C.z, r: this.R - 0.4 });
    w.ui.title(SCRIPT.actTitles.act2, 2.5);
    w.player.moveLock = true; w.audio.music(true);
    // the floor turns and carries the player in; the prisms slide in from the fog and close the ring
    this.turning = { t: 0, dur: 9, angle: 110 };
    for (const pc of this.prisms) { pc.speed = 2.6; pc.go('neutral'); }
    await w.sched.wait(9.2);
    this.turning = null;
    w.player.auto = { target: this.C.clone(), speed: 1.6 };
    await w.sched.until(() => !w.player.auto);
    this.#spot('a2a', { from: F.v3(-2, 0, 16), to: F.v3(0, 0, 0), color: 0xfff4e6, intensity: 9, angle: 0.13 }, 1.5);
    // carousel: one orbit, three turns of each prism; the player's shadow turns and splits in two
    this.spin = 0; this.spinning = true; this.floorShadows.forEach((f) => { f.mesh.visible = true; f.material.opacity = 1; });
    for (const pc of this.prisms) pc.override = true;
    await w.sched.wait(12.8);
    this.spinning = false; for (const pc of this.prisms) { pc.override = false; pc.snap('neutral'); }
    this.floorShadows.forEach((f) => { f.mesh.visible = false; });
    // the clothes swap, painted on the two prisms either side of the pedestals
    const pA = this.prisms[1].faces[0], pB = this.prisms[3].faces[0];
    pA.setPose('dandy'); pB.setPose('servant'); await w.sched.wait(2 * FAST);
    await Promise.all([fadeFigure(w, pA, 0, 1.4), fadeFigure(w, pB, 0, 1.4)]);
    pA.setPose('servant'); pB.setPose('dandy');
    await Promise.all([fadeFigure(w, pA, 1, 1.4), fadeFigure(w, pB, 1, 1.4)]);
    for (const pc of this.peds) pc.go('neutral');
    await w.sched.wait(3.5);
    this.#stateLook('neutral');
    await w.sched.wait(1.6);
    await w.ui.lines(SCRIPT.act2Intro);
    w.audio.music(false); w.player.moveLock = false;
    w.masks.setMemory(this.memory); this.memory.enabled = true; w.masks.refresh(true);
    await w.sched.until(() => this.memory.complete);
    w.masks.setMemory(null);
    await this.#pick();
    for (const pc of this.prisms) pc.go('exit');
    w.audio.rumble(3);
    w.lights.release('a2a', 2); w.lights.release('a2b', 2);
    w.boundary.zone('act2', { kind: 'disk', x: this.C.x, z: this.C.z, r: this.R - 0.4 });
    w.progress.cap = w.route.length;
    await w.sched.until(() => w.progress.s > this.sCentre + 18);
    await w.ui.lines(SCRIPT.t2);
    w.boundary.remove('act2');
  }
  async #pick() {
    const { w } = this;
    w.ui.prompt(SCRIPT.act2Pick);
    let choice = null;
    const near = () => { for (let i = 0; i < 2; i++) if (dist2(w.player.pos, this.peds[i].pos) < 2.8) return i; return -1; };
    w.interact = () => { const i = near(); if (i >= 0) choice = i; };
    await w.sched.until(() => { const want = near() >= 0 ? 'Press E to accuse' : SCRIPT.act2Pick; if (w.ui.promptText !== want) w.ui.prompt(want); return choice !== null; });
    w.interact = null; w.ui.prompt('');
    const real = this.shades[this.donSide], other = this.shades[1 - this.donSide];
    if (choice === this.donSide) { w.ui.say('DON GIOVANNI', '(laughs)'); await fadeFigure(w, real, 0, 3); other.setPose('kneel'); }
    else {
      for (const h of this.hands) fadeFigure(w, h, 1, 1.2);
      this.handsT = 0; this.grab = other;
      await w.sched.wait(2.2); w.ui.say('DON GIOVANNI', '(laughs, somewhere in the dark)');
      await w.sched.wait(2.6); this.grab = null; for (const h of this.hands) fadeFigure(w, h, 0, 1.5); fadeFigure(w, other, 0, 1);
    }
    await w.sched.wait(2.2);
  }
  skip() { for (const pc of this.pieces) pc.snap(pc.poses.exit ? 'exit' : 'neutral'); this.memory.complete = true; this.w.progress.cap = this.w.route.length; }
  update(dt, time) {
    const w = this.w;
    if (this.turning) {    // the turntable carries whoever stands on it
      const t = this.turning; const step = (t.angle / t.dur) * D2R * dt * Math.sin(Math.PI * clamp01(t.t / t.dur)) * 1.57; t.t += dt;
      this.disc.rotation.y += step;
      const p = w.player.pos, dx = p.x - this.C.x, dz = p.z - this.C.z, c = Math.cos(step), s = Math.sin(step);
      w.player.carry.set(this.C.x + dx * c + dz * s - p.x, 0, this.C.z - dx * s + dz * c - p.z); w.player.yaw += step;
    }
    if (this.spinning) {
      this.spin += dt; const k = easeInOut(clamp01(this.spin / 12.5));
      this.prisms.forEach((pc, i) => {
        const a = i * 45 + k * 360, pos = this.#polar(8.2, a);
        pc.pos.set(pos.x, 0.35, pos.z); pc.quat.setFromEuler(new THREE.Euler(0, (this.#faceYaw(pos) + k * 1080) * D2R, 0)); pc.apply(time);
      });
      const [a, b] = this.floorShadows, t = this.spin, fwd = clamp01((t - 3) / 5) * 3, split = clamp01((t - 6) / 3) * 1.4;
      const F = this.F, pa = F.pt(-split, -fwd), pb = F.pt(split, -fwd);   // the shadow walks towards the pedestals' side
      a.mesh.position.set(pa.x, 0.37, pa.z); b.mesh.position.set(pb.x, 0.37, pb.z); a.mesh.rotation.z = b.mesh.rotation.z = t * 1.2;
      const fade = 1 - clamp01((t - 10) / 2.5); a.material.opacity = b.material.opacity = fade;
    }
    // Leporello trembles: barely without a mask, clearly through his own
    const servant = this.shades[1 - this.donSide], amp = this.memory.current === 'servant' ? 0.035 : 0.004;
    servant.mesh.position.x += Math.sin(time * 37) * amp; servant.mesh.rotation.z = Math.sin(time * 29) * amp * 0.8;
    // Don Giovanni's shadow walks off down the escape road
    if (this.realWalk >= 0 && this.state === 'don') {
      this.realWalk += dt; const real = this.shades[this.donSide], k = clamp01((this.realWalk - 2) / 8);
      const from = this.peds[this.donSide].pos, to = this.F.v3(0, -32);
      real.mesh.position.set(lerp(from.x, to.x, k), 1.85 * (1 - k) + 0.35, lerp(from.z, to.z, k)); real.material.opacity = 1 - k * 0.7;
    }
    // giant hands press down over the pit
    this.handsT = (this.handsT || 0) + dt;
    this.hands.forEach((h, i) => {
      if (!h.mesh.visible) return;
      const p = this.#polar(6.6, h.ang), y = lerp(15, 7.5, clamp01(this.handsT / 6));
      h.mesh.position.set(p.x, y, p.z); h.mesh.rotation.set(0, Math.atan2(this.C.x - p.x, this.C.z - p.z), Math.PI);
    });
    if (this.grab) this.grab.mesh.position.y += dt * 3;
    for (const v of this.victims) if (v.mesh.visible) v.mesh.lookAt(w.camera.position.x, v.mesh.position.y, w.camera.position.z);
  }
}

/* ---------------------------------------------------------------- Act 3: the judgement, and the ending */
class Act3 {
  constructor(w) {
    this.w = w; this.s0 = w.route.sAtPhi(262); this.sEnd = w.route.length;
    const endP = w.route.at(this.sEnd), G = w.giant.centre;
    // the glass stands between the end of the path and the giant, square to the line between them
    const toGiant = new THREE.Vector3(G.x - endP.x, 0, G.z - endP.z).normalize();
    const end = { x: endP.x, z: endP.z, tx: toGiant.x, tz: toGiant.z, nx: toGiant.z, nz: -toGiant.x };
    this.glassPos = new THREE.Vector3(G.x, 0, G.z).addScaledVector(toGiant, -11.2);
    w.giant.defineCrouch(toGiant.clone().negate());
    const gy = Math.atan2(-end.tx, -end.tz);
    this.glass = new THREE.Mesh(new THREE.PlaneGeometry(6, 11), new THREE.MeshStandardMaterial({ color: 0xdedcd8, transparent: true, opacity: 0.3, roughness: 1, depthWrite: false }));
    this.glass.position.set(this.glassPos.x, 5.5, this.glassPos.z); this.glass.rotation.y = gy; w.scene.add(this.glass);
    const crackTex = canvasTexture(1024, 2048, (g, W, H) => drawCracks(g, W, H, seeded(9), { centres: [[0.36, 0.84], [0.64, 0.84]], color: 'rgba(255,255,255,.85)', count: 8, len: 0.3, width: 0.45 }));
    this.cracks = new THREE.Mesh(new THREE.PlaneGeometry(6, 11), new THREE.MeshBasicMaterial({ map: crackTex, transparent: true, opacity: 0, depthWrite: false }));
    this.cracks.position.copy(this.glass.position).add(new THREE.Vector3(-end.tx * 0.02, 0, -end.tz * 0.02)); this.cracks.rotation.y = gy; this.cracks.renderOrder = 6; w.scene.add(this.cracks);
    this.mist = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshBasicMaterial({ color: 0xcfcbc4, transparent: true, opacity: 0.8, depthWrite: false }));
    this.mist.position.set(this.glassPos.x + end.tx * 1.0, 6, this.glassPos.z + end.tz * 1.0); this.mist.rotation.y = gy; w.scene.add(this.mist);
    this.handsGlass = [-1, 1].map((sgn) => { const h = new Figure('hand', 1.6); h.mesh.position.set(this.glassPos.x + end.tx * 0.07 + end.nx * sgn * 0.95, 1.1, this.glassPos.z + end.tz * 0.07 + end.nz * sgn * 0.95); h.mesh.rotation.y = gy; if (sgn > 0) h.mesh.scale.x *= -1; h.mesh.renderOrder = 7; w.scene.add(h.mesh); return h; });
    this.#masksOnFloor();
    this.ended = false; this.crouched = false;
  }
  /** Masks piled several deep, densest where the path is narrowest, banked up against the walls. */
  #masksOnFloor() {
    const R = this.w.route, rnd = seeded(51), geo = lowMaskGeometry(), list = [];
    for (let s = this.s0 - 2; s < this.sEnd + 2.5; s += 0.05) {
      const t = clamp01((s - this.s0) / (this.sEnd - this.s0)), P = R.at(Math.min(s, this.sEnd)), n = Math.round(lerp(5, 15, t) * (0.6 + rnd() * 0.8));
      for (let i = 0; i < n; i++) {
        const lat = (rnd() * 2 - 1) * (P.w + 1.4), edge = clamp01((Math.abs(lat) - P.w * 0.6) / 1.6);
        const y = this.pileHeight(t, edge) * Math.pow(rnd(), 0.7) + 0.02;
        const ext = s > this.sEnd ? (s - this.sEnd) : 0;
        list.push([P.x + P.nx * lat + P.tx * ext, y, P.z + P.nz * lat + P.tz * ext, rnd()]);
      }
    }
    const inst = new THREE.InstancedMesh(geo, MAT.iron, list.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    list.forEach(([x, y, z, r], i) => {
      p.set(x, y, z); e.set(-Math.PI / 2 + (r - 0.5) * 0.9, r * 37, (r * 13 % 1 - 0.5) * 0.9); q.setFromEuler(e);
      const s = 0.9 + (r * 7 % 1) * 0.5; sc.set(s, s, s); m4.compose(p, q, sc); inst.setMatrixAt(i, m4);
    });
    inst.receiveShadow = !LOW; this.w.scene.add(inst); this.floorMasks = inst; this.maskCount = list.length;
  }
  pileHeight(t, edge) { return lerp(0.16, 0.5, t) + edge * lerp(0.4, 1.3, t); }
  floorAt(x, z) {
    const R = this.w.route; if (this.w.progress.s < this.s0 - 3) return 0;
    const pr = R.project(x, z, this.w.progress.s, 6, 8); if (pr.s < this.s0 - 1) return 0;
    const t = clamp01((pr.s - this.s0) / (this.sEnd - this.s0)), P = R.at(pr.s), edge = clamp01((Math.abs(pr.lateral) - P.w * 0.6) / 1.6);
    return this.pileHeight(t, edge) * 0.55;
  }
  surfaceAt(x, z) { return this.w.progress.s > this.s0 - 1 ? 'masks' : 'marble'; }
  placePlayer() { const F = new Frame(this.w.route, this.s0 - 6); this.w.player.place(F.pt(0, 0), dirYaw(F.tx, F.tz)); }
  async run({ jumpToEnd = false } = {}) {
    const { w } = this;
    if (!jumpToEnd) {
      await w.sched.until(() => w.progress.s > this.s0);
      w.ui.title(SCRIPT.actTitles.act3, 2.5);
      this.dropMasks();
      await w.sched.until(() => w.progress.s > this.sEnd - 32);
      if (!this.crouched) { this.crouched = true; w.giant.pose('crouch', 0.8, 0.25); w.audio.rumble(6); }
      await w.sched.until(() => w.progress.s >= this.sEnd - 1.2);
    }
    await this.#ending();
  }
  dropMasks() {
    const { w } = this; w.masks.dropAll();
    const models = w.maskModels; if (!models) return;
    MASK_IDS.forEach((id, i) => {
      if (!models[id]) return;
      const m = models[id].clone(true); w.scene.add(m);
      const p = w.camera.position.clone().add(w.player.forward().multiplyScalar(0.7)); p.x += (i - 1) * 0.25; p.y -= 0.2;
      m.position.copy(p); const vy = { v: 0.4 }, spin = v3(Math.random() * 4, Math.random() * 4, Math.random() * 4), floor = this.floorAt(p.x, p.z) + 0.08;
      w.onFrame.push((dt) => { if (m.position.y > floor) { vy.v -= 9.8 * dt; m.position.y = Math.max(floor, m.position.y + vy.v * dt); m.rotation.x += spin.x * dt; m.rotation.y += spin.y * dt; } else m.rotation.x += (-Math.PI / 2 - m.rotation.x) * Math.min(1, dt * 6); });
      setTimeout(() => w.audio.step('masks'), 600 + i * 120);
    });
  }
  update(dt) {
    const p = this.w.player;
    if (this.w.progress.s > this.s0 - 2 && !this.ended) {
      const t = clamp01((this.w.progress.s - this.s0) / (this.sEnd - this.s0));
      this.w.atmo.mix('neutral', 'judgement', t * 1.15);
      const d = this.sEnd - this.w.progress.s; p.speedScale = d < 12 ? lerp(0.42, 1, clamp01((d - 1) / 11)) : 1;
    }
  }
  async #ending() {
    const { w } = this; const { player, ui, sched, tweens, audio } = w;
    this.ended = true; player.moveLock = true; player.speedScale = 1;
    if (!this.crouched) { this.crouched = true; w.giant.snap('crouch'); }
    w.lights.get('glass').set({ from: this.glassPos.clone().add(new THREE.Vector3(0, 14, 0)).addScaledVector(new THREE.Vector3(w.giant.centre.x - this.glassPos.x, 0, w.giant.centre.z - this.glassPos.z).normalize(), 5), to: this.glassPos.clone().setY(1.5), color: 0xf6f2ea, intensity: 6, angle: 0.4, beam: 0.05 }, 3);
    await sched.wait(1.0);
    await ui.lines(SCRIPT.act3Question);
    document.exitPointerLock?.();
    const pick = await ui.choose([SCRIPT.act3Answer], 15);
    if (pick === 0) await ui.say('', SCRIPT.act3Answer);
    await sched.wait(pick === 0 ? 1 : 3);
    player.lookLock = true; const p0 = player.pitch, y0 = player.yaw;
    const toGlass = new THREE.Vector3(this.glassPos.x - player.pos.x, 0, this.glassPos.z - player.pos.z);
    const wantYaw = Math.atan2(-toGlass.x, -toGlass.z);
    await tweens.run(3.5, (k) => { this.mist.material.opacity = lerp(0.8, 0.08, k); player.pitch = lerp(p0, 0.36, k); player.yaw = lerp(y0, wantYaw, k); });
    await ui.lines(SCRIPT.act3Reply);
    audio.crack();
    await tweens.run(2.5, (k) => { this.cracks.material.opacity = k; });
    audio.rumble(5); w.atmo.to('inferno', 6);
    // the walls fall in
    const walls = w.stage.pieces.filter((pc) => pc.group === 'corridor' && pc.slot && pc.slot.s > this.s0 && pc.pos.distanceTo(player.pos) < 45);
    walls.forEach((pc, i) => { const out = new THREE.Vector3(pc.pos.x - player.pos.x, 0, pc.pos.z - player.pos.z).normalize(); const fall = makePose({ p: [pc.pos.x + out.x * 1.5, -0.5 - (i % 4) * 0.4, pc.pos.z + out.z * 1.5], yaw: new THREE.Euler().setFromQuaternion(pc.quat, 'YXZ').y / D2R, lean: 55 + (i % 5) * 7, leanDir: dirYaw(out.x, out.z) }); pc.speed = 3; pc.turn = 26; pc.goTo(fall); });
    tweens.run(5, (k) => { player.roll = Math.sin(k * 6) * 0.08 * (1 - k); this.glass.position.y = 5.5 - k * 2; this.cracks.position.y = 5.5 - k * 2; });
    await sched.wait(3);
    player.pitch = 0; this.#crossArms(true);
    await ui.lines(SCRIPT.act3Cry);
    document.getElementById('fire').classList.add('on'); audio.fire(8);
    await tweens.run(6, (k) => { player.extraY = -k * 2.2; });
    await ui.fade(1, 2.5);
    document.getElementById('fire').classList.remove('on'); this.#crossArms(false);
    await sched.wait(1.5);
    await ui.title(SCRIPT.endCard, 6);
  }
  /** First-person arms stretched out along a beam: the cross. */
  #crossArms(on) {
    if (!this.arms) {
      const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: 0x231d1a, roughness: 0.75 }), wood = new THREE.MeshStandardMaterial({ color: 0x2a1c14, roughness: 0.85 });
      const beam = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.07, 0.07), wood); beam.position.set(0, 0.07, 0.06); g.add(beam);
      for (const sgn of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.6, 12), mat); arm.rotation.z = Math.PI / 2 - sgn * 0.12; arm.position.set(sgn * 0.42, 0.0, 0.04); g.add(arm);
        const hand = buildHand(); hand.scale.setScalar(1.1); hand.rotation.set(0, 0, -sgn * Math.PI / 2); hand.position.set(sgn * 0.78, 0.04, 0.04); g.add(hand);
        const rope = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.011, 6, 16), wood); rope.rotation.y = Math.PI / 2; rope.position.set(sgn * 0.6, 0.02, 0.04); g.add(rope);
      }
      g.position.set(0, -0.12, -0.42); g.visible = false; this.w.camera.add(g); this.arms = g;
    }
    this.arms.visible = on;
  }
  skipToEnd() { this.dropMasks(); this.crouched = true; this.w.giant.snap('crouch'); this.w.progress.s = this.sEnd - 0.2; this.w.progress.cap = this.w.route.length; const F = new Frame(this.w.route, this.sEnd - 0.3); this.w.player.place(F.pt(0, 0), dirYaw(F.tx, F.tz)); this.w.atmo.set('judgement'); }
}

/** A burst of crows from behind the courtyard as it opens (silhouettes; the UE version uses the bird pack). */
class Crows {
  constructor(scene) {
    const tex = canvasTexture(64, 32, (g) => { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(2, 18); g.quadraticCurveTo(18, 4, 32, 16); g.quadraticCurveTo(46, 4, 62, 18); g.quadraticCurveTo(46, 12, 32, 22); g.quadraticCurveTo(18, 12, 2, 18); g.fill(); });
    this.mat = new THREE.SpriteMaterial({ map: tex, color: 0x0a0a0a, transparent: true, depthWrite: false });
    this.birds = Array.from({ length: 26 }, () => { const s = new THREE.Sprite(this.mat); s.visible = false; s.scale.set(0.9, 0.45, 1); scene.add(s); return s; });
  }
  burst(at) { const rnd = seeded(5); this.birds.forEach((b, i) => { b.visible = true; b.position.set(at.x + (rnd() - 0.5) * 6, 1 + rnd() * 4, at.z + (rnd() - 0.5) * 6); b.userData = { v: v3((rnd() - 0.5) * 6, 3 + rnd() * 4, (rnd() - 0.5) * 6), t: 0 }; }); this.active = true; }
  update(dt, time) {
    if (!this.active) return;
    let alive = 0;
    for (const b of this.birds) { if (!b.visible) continue; const u = b.userData; u.t += dt; b.position.addScaledVector(u.v, dt); u.v.y += dt * 0.6; b.scale.y = 0.45 * (0.6 + 0.4 * Math.sin(time * 18 + b.id)); if (u.t > 9) b.visible = false; else alive++; }
    if (!alive) this.active = false;
  }
}
