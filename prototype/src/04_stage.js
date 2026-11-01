/* =====================================================================
   4. Stage machinery: pieces that move, the route, the corridor that
      forms around the player, the scenery in the fog, the mist
   ===================================================================== */

/** A pose on stage: where a piece stands, which way it faces, and how far it leans and which way. */
function makePose({ p, yaw = 0, lean = 0, leanDir = 0, pitch = 0, roll = 0 }) {
  const pos = new THREE.Vector3(p[0], p[1] ?? 0, p[2]);
  const qYaw = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * D2R, yaw * D2R, roll * D2R, 'YXZ'));
  // lean: tip the piece's top towards the horizontal direction leanDir (degrees, three.js yaw convention: 0 = -z)
  const dx = -Math.sin(leanDir * D2R), dz = -Math.cos(leanDir * D2R);
  const qLean = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(dz, 0, -dx), lean * D2R);
  return { pos, quat: qLean.multiply(qYaw), yaw, lean, leanDir };
}
/** Yaw (degrees) that turns local +x along the horizontal direction (dx, dz). */
const yawAlong = (dx, dz) => Math.atan2(-dz, dx) / D2R;
/** Yaw (degrees) of the horizontal direction (dx, dz) in the leanDir convention (0 = -z). */
const dirYaw = (dx, dz) => Math.atan2(-dx, -dz) / D2R;

/** One piece of scenery. It walks towards its target pose, steering round other pieces and stopping short of the player. */
class Piece {
  constructor(id, kit, sizeIdx, { cat, group = '', floating = false, collide = true, speed = null, turn = 32 } = {}) {
    const def = KIT_DEF[kit];
    this.id = id; this.kit = kit; this.sizeIdx = sizeIdx; this.size = def.sizes[sizeIdx]; this.dims = def.dims(this.size);
    this.cat = cat || def.cat; this.group = group; this.floating = floating; this.collide = collide;
    this.mesh = new THREE.Mesh(KIT_GEO[kit], MAT[this.cat]);
    this.mesh.scale.set(...this.dims); this.mesh.castShadow = !LOW; this.mesh.receiveShadow = !LOW;
    this.mesh.userData = { piece: this };
    // footprint for steering and collision: a segment along local x with a radius (long pieces) or a disc
    const [dx, , dz] = this.dims;
    if (def.shape === 'long') { this.half = Math.max(0, dx / 2 - dz / 2); this.rad = dz / 2 + 0.05; }
    else if (def.shape === 'box') { this.half = 0; this.rad = Math.max(dx, dz) / 2 * 1.05; }
    else { this.half = 0; this.rad = def.r * Math.max(dx, dz); }
    this.speed = speed ?? clamp(3.3 - this.dims[1] * 0.07, 1.5, 3.2);
    this.turn = turn;                       // degrees per second
    this.pos = new THREE.Vector3(); this.quat = new THREE.Quaternion();
    this.tPos = new THREE.Vector3(); this.tQuat = new THREE.Quaternion();
    this.vel = new THREE.Vector3(); this.poses = {}; this.pose = null; this.drift = null;
    this.attachments = []; this.moving = false; this.override = false;
  }
  define(name, spec) { this.poses[name] = spec.pos ? spec : makePose(spec); return this; }
  go(name) { const p = this.poses[name] || this.poses.home; if (!p) return; this.pose = name; this.tPos.copy(p.pos); this.tQuat.copy(p.quat); }
  goTo(pose) { this.pose = null; this.tPos.copy(pose.pos); this.tQuat.copy(pose.quat); }
  snap(name) { this.go(name); this.pos.copy(this.tPos); this.quat.copy(this.tQuat); this.vel.set(0, 0, 0); this.apply(0); }
  /** World-space footprint segment (base), for steering and collision. */
  segment(out) {
    const yaw = new THREE.Euler().setFromQuaternion(this.quat, 'YXZ').y;
    const ax = Math.cos(yaw) * this.half, az = -Math.sin(yaw) * this.half;
    out.ax = this.pos.x - ax; out.az = this.pos.z - az; out.bx = this.pos.x + ax; out.bz = this.pos.z + az; out.r = this.rad;
    return out;
  }
  apply(time) {
    const m = this.mesh; m.position.copy(this.pos); m.quaternion.copy(this.quat);
    if (this.drift) {
      const d = this.drift;
      m.position.x += Math.sin(time * d.w + d.ph) * d.a; m.position.z += Math.cos(time * d.w * 0.8 + d.ph * 1.3) * d.a;
      m.rotateY(Math.sin(time * d.w * 0.6 + d.ph) * d.r);
    }
    for (const a of this.attachments) a.follow(this);
  }
}

/** Do two pieces share any height (one standing on another doesn't count)? */
function shareHeight(ya, ha, yb, hb) { return ya < yb + hb - 0.05 && yb < ya + ha - 0.05; }

/** Point-to-segment distance in xz, and the closest point. */
function segPoint(s, px, pz) {
  const vx = s.bx - s.ax, vz = s.bz - s.az, l2 = vx * vx + vz * vz;
  const t = l2 > 1e-9 ? clamp(((px - s.ax) * vx + (pz - s.az) * vz) / l2, 0, 1) : 0;
  const cx = s.ax + vx * t, cz = s.az + vz * t;
  return { d: Math.hypot(px - cx, pz - cz), cx, cz };
}
/** Segment-to-segment distance in xz (sampled; good enough for steering). */
function segSeg(a, b) {
  let best = { d: Infinity };
  for (let i = 0; i <= 4; i++) {
    const t = i / 4, px = lerp(a.ax, a.bx, t), pz = lerp(a.az, a.bz, t), r = segPoint(b, px, pz);
    if (r.d < best.d) best = { d: r.d, px, pz, cx: r.cx, cz: r.cz };
  }
  for (let i = 0; i <= 4; i++) {
    const t = i / 4, px = lerp(b.ax, b.bx, t), pz = lerp(b.az, b.bz, t), r = segPoint(a, px, pz);
    if (r.d < best.d) best = { d: r.d, px: r.cx, pz: r.cz, cx: px, cz: pz };
  }
  return best;
}

/** All pieces. Moves them like stage machinery: limited speed, eased, steering round each other, yielding to the player. */
class Stage {
  constructor(world) { this.w = world; this.pieces = []; this.byId = new Map(); this.activity = 0; this.tmpA = {}; this.tmpB = {}; }
  add(piece) {
    if (this.byId.has(piece.id)) throw new Error('duplicate piece id ' + piece.id);
    this.pieces.push(piece); this.byId.set(piece.id, piece); this.w.scene.add(piece.mesh); return piece;
  }
  get(id) { return this.byId.get(id); }
  update(dt, time) {   // big frames (slow machines) are split into small steps so pieces can't jump through each other
    const n = Math.ceil(dt / 0.05); for (let i = 0; i < n; i++) this.#step(dt / n, time);
  }
  #step(dt, time) {
    const pl = this.w.player.pos, live = [];
    for (const p of this.pieces) {
      if (p.override) { p.apply(time); continue; }
      const far = dist2(p.pos, pl) > 95;
      const away = p.pos.distanceToSquared(p.tPos) > 1e-4 || p.vel.lengthSq() > 1e-4 || p.quat.angleTo(p.tQuat) > 1e-3;
      p.moving = away;
      if (!away) { p.apply(time); continue; }
      if (far) { // out in the fog: no steering, just glide
        const d = p.tPos.clone().sub(p.pos), l = d.length(), step = Math.min(l, p.speed * 1.6 * dt);
        if (l > 1e-6) p.pos.addScaledVector(d, step / l);
        p.quat.rotateTowards(p.tQuat, p.turn * 1.6 * D2R * dt); p.vel.set(0, 0, 0); p.apply(time); continue;
      }
      live.push(p);
    }
    // steering for pieces near the player
    let moved = 0;
    for (const p of live) {
      const to = p.tPos.clone().sub(p.pos), dist = to.length();
      const want = dist > 1e-4 ? to.multiplyScalar(Math.min(p.speed, dist * 1.1) / dist) : new THREE.Vector3();
      if (!p.floating) {
        // look a little ahead: steer by where the piece will be in 0.45 s
        const A = p.segment(this.tmpA), lx = p.vel.x * 0.45, lz = p.vel.z * 0.45; A.ax += lx; A.bx += lx; A.az += lz; A.bz += lz;
        for (const q of this.pieces) {               // separation (xz) from every other floor piece nearby
          if (q === p || q.floating || !q.collide || q.override) continue;
          if (Math.abs(q.pos.x - p.pos.x) > 26 || Math.abs(q.pos.z - p.pos.z) > 26) continue;
          if (!shareHeight(p.pos.y, p.dims[1], q.pos.y, q.dims[1])) continue;   // a lifted piece passes over
          const B = q.segment(this.tmpB), r = segSeg(A, B), min = A.r + B.r + 0.7;
          if (r.d < min) {
            let nx = r.px - r.cx, nz = r.pz - r.cz; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
            const push = (min - r.d) * 5.0 + (q.moving ? 0 : 0.6);
            want.x += (nx - nz * 0.35) * push; want.z += (nz + nx * 0.35) * push;   // a slight sideways bias breaks head-on stalemates
          }
        }
        if (p.collide) {                              // never run into the player
          const r = segPoint(A, pl.x, pl.z), gap = r.d - A.r - PLAYER.radius;
          if (gap < 1.1) {
            let nx = pl.x - r.cx, nz = pl.z - r.cz; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
            const toward = want.x * nx + want.z * nz;
            if (toward > 0) { want.x -= nx * toward; want.z -= nz * toward; }
          }
        }
      }
      const k = 1 - Math.exp(-dt * 2.6);
      p.vel.lerp(want, k);
      if (p.vel.length() > p.speed * 1.4) p.vel.setLength(p.speed * 1.4);
      p.pos.addScaledVector(p.vel, dt);
      if (dist < 0.02 && p.vel.length() < 0.03) { p.pos.copy(p.tPos); p.vel.set(0, 0, 0); }
      p.quat.rotateTowards(p.tQuat, p.turn * D2R * dt);
      p.apply(time);
      moved += p.vel.length() * p.dims[1];
    }
    this.activity = moved;
  }
  /** Push the player out of every solid piece standing on the floor. */
  resolvePlayer(pos, radius) {
    for (const p of this.pieces) {
      if (!p.collide || p.floating || !p.mesh.visible) continue;
      if (p.pos.y > 1.3 || p.pos.y + p.dims[1] < 0.3) continue;
      if (Math.abs(p.pos.x - pos.x) > 30 || Math.abs(p.pos.z - pos.z) > 30) continue;
      const s = p.segment(this.tmpA), r = segPoint(s, pos.x, pos.z), min = s.r + radius;
      if (r.d < min) {
        let nx = pos.x - r.cx, nz = pos.z - r.cz; const l = Math.hypot(nx, nz);
        if (l < 1e-6) { nx = 1; nz = 0; } else { nx /= l; nz /= l; }
        pos.x = r.cx + nx * min; pos.z = r.cz + nz * min;
      }
    }
  }
}

/**
 * Settle a layout (piece -> pose): push apart any two footprints that overlap, and keep everything
 * outside an optional clear disc (the pocket round the player). Only positions change.
 */
function relaxLayout(map, { clear = null, iterations = 150, gap = 0.12, keep = null } = {}) {
  const items = [...map.entries()].map(([pc, pose]) => ({ pc, pose, x: pose.pos.x, z: pose.pos.z }));
  const yawOf = (q) => new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const A = items[i], B = items[j];
      if (A.pc.floating || B.pc.floating || !shareHeight(A.pose.pos.y, A.pc.dims[1], B.pose.pos.y, B.pc.dims[1])) continue;
      const sa = segAt(A.pc, A.x, A.z, yawOf(A.pose.quat)), sb = segAt(B.pc, B.x, B.z, yawOf(B.pose.quat));
      const r = segSeg(sa, sb), need = sa.r + sb.r + gap;
      if (r.d < need) {
        let nx = r.px - r.cx, nz = r.pz - r.cz; const l = Math.hypot(nx, nz); if (l < 1e-6) { nx = 1; nz = 0; } else { nx /= l; nz /= l; }
        const push = (need - r.d) / 2 + 0.01; A.x += nx * push; A.z += nz * push; B.x -= nx * push; B.z -= nz * push; moved = true;
      }
    }
    if (clear) for (const A of items) {
      if (A.pc.floating) continue;
      const sa = segAt(A.pc, A.x, A.z, yawOf(A.pose.quat)), r = segPoint(sa, clear.x, clear.z), need = clear.r + sa.r;
      if (r.d < need) { let nx = r.cx - clear.x, nz = r.cz - clear.z; const l = Math.hypot(nx, nz) || 1; A.x += nx / l * (need - r.d + 0.02); A.z += nz / l * (need - r.d + 0.02); moved = true; }
    }
    if (keep) for (const A of items) { const k = keep(A.pc, A.x, A.z); if (k) { A.x = k.x; A.z = k.z; } }
    if (!moved) break;
  }
  for (const A of items) { A.pose.pos.x = A.x; A.pose.pos.z = A.z; }
  return map;
}
function segAt(pc, x, z, yaw) { const ax = Math.cos(yaw) * pc.half, az = -Math.sin(yaw) * pc.half; return { ax: x - ax, az: z - az, bx: x + ax, bz: z + az, r: pc.rad }; }

/* ---------- The route: a clockwise spiral round the giant at the centre ---------- */
// Stations: phi = degrees clockwise from south (0 = +z), r = distance from the centre, w = half-width of the free path.
const ROUTE_STATIONS = [
  { phi: -5, r: 64, w: 3.2 }, { phi: 4, r: 64, w: 3.2 },            // the table
  { phi: 22, r: 62.5, w: 4.6 }, { phi: 40, r: 60.5, w: 4.2 },       // overture walk
  { phi: 48, r: 59.5, w: 2.4 },                                       // squeeze before the courtyard
  { phi: 55, r: 59, w: 3.4 }, { phi: 66, r: 58.5, w: 3.4 }, { phi: 80, r: 57.5, w: 3.4 },   // act 1 (arena)
  { phi: 88, r: 56, w: 3.0 }, { phi: 98, r: 54, w: 2.2 },             // to the balcony
  { phi: 110, r: 52, w: 3.2 }, { phi: 140, r: 50, w: 5.0 }, { phi: 175, r: 47, w: 4.4 },   // walk with the giant
  { phi: 190, r: 45.5, w: 2.6 },                                      // squeeze before the stage
  { phi: 198, r: 44.5, w: 3.4 }, { phi: 210, r: 43.5, w: 3.4 }, { phi: 222, r: 42.5, w: 3.4 },   // act 2 (turntable)
  { phi: 240, r: 40, w: 3.6 }, { phi: 262, r: 36.5, w: 3.2 },         // after the stage
  { phi: 290, r: 32, w: 2.8 }, { phi: 325, r: 26, w: 2.0 }, { phi: 360, r: 20.5, w: 1.45 },   // act 3: the spiral tightens
  { phi: 392, r: 16.6, w: 1.0 }, { phi: 404, r: 15.3, w: 0.8 }, { phi: 409, r: 14.5, w: 0.7 }, { phi: 410.5, r: 13.6, w: 0.68 },
];

class Route {
  constructor(stations) {
    this.pts = [];
    // Catmull-Rom through (phi, r, w), sampled every 0.2 degrees
    const S = stations, cr = (a, b, c, d, t) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
    for (let i = 0; i < S.length - 1; i++) {
      const a = S[Math.max(0, i - 1)], b = S[i], c = S[i + 1], d = S[Math.min(S.length - 1, i + 2)];
      const n = Math.max(2, Math.round((c.phi - b.phi) / 0.2));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        this.pts.push({ phi: cr(a.phi, b.phi, c.phi, d.phi, t), r: cr(a.r, b.r, c.r, d.r, t), w: lerp(b.w, c.w, easeInOut(t)) });
      }
    }
    const last = S[S.length - 1]; this.pts.push({ phi: last.phi, r: last.r, w: last.w });
    let s = 0;
    this.pts.forEach((p, i) => {
      p.x = -p.r * Math.sin(p.phi * D2R); p.z = p.r * Math.cos(p.phi * D2R);
      if (i) s += Math.hypot(p.x - this.pts[i - 1].x, p.z - this.pts[i - 1].z);
      p.s = s;
    });
    this.length = s;
  }
  /** Position, unit tangent, unit left normal (away from the centre) and half-width at arc length s. */
  at(s) {
    const P = this.pts; s = clamp(s, 0, this.length);
    let lo = 0, hi = P.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].s <= s) lo = m; else hi = m; }
    const a = P[lo], b = P[hi], t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
    const x = lerp(a.x, b.x, t), z = lerp(a.z, b.z, t), w = lerp(a.w, b.w, t), phi = lerp(a.phi, b.phi, t), r = lerp(a.r, b.r, t);
    let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    return { x, z, tx, tz, nx: tz, nz: -tx, w, phi, r, s };   // left of a clockwise walk = away from the centre
  }
  /** Arc length of the route point nearest (x, z), searched in [s0 - back, s0 + fwd]. */
  project(x, z, s0 = 0, back = 12, fwd = 30) {
    let best = s0, bd = Infinity;
    for (let s = Math.max(0, s0 - back); s <= Math.min(this.length, s0 + fwd); s += 0.5) {
      const p = this.at(s), d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    for (let s = best - 0.5; s <= best + 0.5; s += 0.05) { const p = this.at(s), d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = s; } }
    const p = this.at(best);
    return { s: best, lateral: (x - p.x) * p.nx + (z - p.z) * p.nz, dist: Math.sqrt(bd) };
  }
  /** Distance from (x, z) to the nearest point of the whole route, and the half-width there. */
  distTo(x, z) {
    let bd = Infinity, bw = 0;
    for (let i = 0; i < this.pts.length; i += 2) { const p = this.pts[i], d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; bw = p.w; } }
    return { dist: Math.sqrt(bd), w: bw };
  }
  /** Arc length at a given phi (first crossing). */
  sAtPhi(phi) { const p = this.pts.find((q) => q.phi >= phi) || this.pts[this.pts.length - 1]; return p.s; }
}

/* ---------- The corridor: walls that assemble round the player and close behind ---------- */
const CORRIDOR_STYLES = {
  // kits per side: [kit, sizeIdx, weight]; lean = degrees towards the path; gap = metres between pieces
  overture: { outer: [['Prism', 2, 3], ['Sail', 1, 2], ['Pillar', 2, 2], ['Blade', 2, 2], ['Spike', 2, 2], ['Prism', 3, 1]], inner: [['Spike', 1, 3], ['Cube', 2, 1], ['Cone', 1, 1], ['Pillar', 1, 2], ['Orb', 2, 1], ['Notch', 1, 2]], gap: [0.6, 2.0], lean: [0, 10], gateShare: 0.3, back: [0.6, 0.35] },
  tense:    { outer: [['Pillar', 3, 3], ['Blade', 3, 2], ['Prism', 3, 2], ['Spike', 3, 2]], inner: [['Pillar', 2, 2], ['Spike', 2, 2], ['Notch', 2, 1], ['Blade', 2, 1]], gap: [0.35, 1.1], lean: [6, 15], gateShare: 0.45, back: [0.7, 0.5] },
  vista:    { outer: [['Prism', 2, 3], ['Sail', 2, 2], ['Pillar', 2, 2], ['Spike', 3, 2], ['Prism', 3, 1]], inner: [['Cube', 2, 2], ['Cone', 1, 2], ['Orb', 1, 2], ['Spike', 0, 2], ['Notch', 0, 1], ['Cube', 1, 1]], gap: [1.0, 3.0], lean: [0, 8], gateShare: 0.2, back: [0.65, 0] },
  finale:   { outer: [['Pillar', 3, 3], ['Prism', 3, 2], ['Spike', 3, 2], ['Blade', 3, 2]], inner: [['Pillar', 3, 3], ['Prism', 3, 2], ['Spike', 3, 2], ['Blade', 3, 2]], gap: [0.2, 0.6], lean: [8, 22], gateShare: 0.5, back: [0.8, 0.8] },
};

/**
 * Builds the corridor pieces along [s0, s1] of the route. Each piece knows three poses:
 *   ahead  - before the player gets near: waiting out in the fog, or standing across the path
 *   open   - the wall of the path while the player passes
 *   behind - after the player has gone by: closing the way back, or falling away into the fog
 * and two distances that decide when it switches (ahead -> open at A metres, open -> behind at B metres).
 */
function buildCorridor(stage, route, sections, exclude, rnd) {
  const out = [];
  const pick = (table) => { const total = table.reduce((a, t) => a + t[2], 0); let r = rnd() * total; for (const t of table) { r -= t[2]; if (r <= 0) return t; } return table[0]; };
  const excluded = (s) => exclude.some(([a, b]) => s >= a && s <= b);
  let n = 0;
  const make = (kit, sz, s, side, layer, st, sec) => {
    const def = KIT_DEF[kit], dims = def.dims(def.sizes[sz]);
    const across = def.shape === 'long' ? dims[2] / 2 : Math.max(dims[0], dims[2]) / 2 * (def.shape === 'box' ? 1.05 : 1.1);
    const P = route.at(s), routeYaw = yawAlong(P.tx, P.tz);
    const towardPath = dirYaw(-P.nx * side, -P.nz * side);
    // lean towards the path, but never so far that the top crosses the middle of the path
    const maxLean = Math.asin(clamp((layer ? 1.4 : P.w * 0.8) / dims[1], 0, 1)) / D2R;   // the back row may only lean a little, so its top stays behind the front row
    const lean = Math.min(lerp(st.lean[0], st.lean[1], rnd()) * (sec.leanScale ?? 1), maxLean);
    const wOff = P.w + across + (layer ? 4.4 + rnd() * 3 : rnd() * 0.4);
    const piece = new Piece(`C${String(n++).padStart(3, '0')}`, kit, sz, { group: 'corridor' });
    const wall = { p: [P.x + P.nx * side * wOff, 0, P.z + P.nz * side * wOff], yaw: def.shape === 'long' ? routeYaw + (rnd() - 0.5) * 8 : rnd() * 360, lean, leanDir: towardPath };
    piece.define('open', wall);
    const isGate = !layer && def.shape === 'long' && rnd() < st.gateShare && s - (sec.lastGate ?? -99) > 4;
    if (isGate) {
      sec.lastGate = s;
      piece.define('ahead', { p: [P.x + P.nx * (rnd() - 0.5) * 1.2, 0, P.z + P.nz * (rnd() - 0.5) * 1.2], yaw: routeYaw + 90 + (rnd() - 0.5) * 20, lean: rnd() * 5, leanDir: rnd() * 360 });
    } else {
      const out2 = wOff + 7 + rnd() * 8, Q = route.at(s + 2 + rnd() * 6);
      piece.define('ahead', { p: [Q.x + Q.nx * side * out2, 0, Q.z + Q.nz * side * out2], yaw: wall.yaw + (rnd() - 0.5) * 70, lean: 6 + rnd() * 18, leanDir: rnd() * 360 });
    }
    if (!layer && rnd() < 0.55) {
      const k = 0.15 + rnd() * 0.35;
      piece.define('behind', { p: [P.x + P.nx * side * (P.w * k + across), 0, P.z + P.nz * side * (P.w * k + across)], yaw: wall.yaw + side * (20 + rnd() * 30), lean: lean * 0.5, leanDir: towardPath });
    } else {
      const out3 = wOff + 7 + rnd() * 8;
      piece.define('behind', { p: [P.x + P.nx * side * out3, 0, P.z + P.nz * side * out3], yaw: wall.yaw + (rnd() - 0.5) * 40, lean: 10 + rnd() * 18, leanDir: dirYaw(P.nx * side, P.nz * side) });
    }
    piece.slot = { s, side, layer, A: 17 + rnd() * 10 + layer * 4, B: 5 + rnd() * 5 + layer * 3, gate: isGate };
    stage.add(piece); piece.snap('ahead'); out.push(piece);
    return { along: def.shape === 'long' ? dims[0] / 2 : across, wOff };
  };
  for (const sec of sections) {
    const st = CORRIDOR_STYLES[sec.style];
    for (const side of [1, -1]) {      // +1 = outer (left), -1 = inner (right, towards the giant)
      for (const layer of [0, 1]) {
        const share = layer ? (side > 0 ? st.back[0] : st.back[1]) : 1;
        if (!share) continue;
        let s = sec.s0 + rnd() * 2 + layer * 1.5;
        while (s < sec.s1) {
          const [kit, sz] = pick(layer ? st.outer : (side > 0 ? st.outer : st.inner));
          const def = KIT_DEF[kit], dims = def.dims(def.sizes[sz]);
          const along = def.shape === 'long' ? dims[0] / 2 : Math.max(dims[0], dims[2]) / 2 * 1.1;
          const P0 = route.at(s), wall = P0.w + (layer ? 5 : 1);
          const curve = P0.r / Math.max(4, P0.r + side * wall);   // inner walls lie on a smaller circle: space them further along the route
          s += along * curve;
          if (s > sec.s1) break;
          if (excluded(s) || (layer && rnd() > share)) { s += (along + 1.5) * curve; continue; }
          make(kit, sz, s, side, layer, st, sec);
          s += (along + lerp(st.gap[0], st.gap[1], rnd()) + layer * 2.5) * curve;
        }
      }
    }
  }
  return out;
}

/** Decides each corridor piece's pose from the player's progress along the route. */
class Corridor {
  constructor(world, pieces) { this.w = world; this.pieces = pieces; this.enabled = false; }
  update() {
    if (!this.enabled) return;
    const sp = this.w.progress.s;
    for (const p of this.pieces) {
      const { s, A, B } = p.slot;
      const want = s > sp + A ? 'ahead' : (s < sp - B ? 'behind' : 'open');
      if (p.pose !== want) p.go(want);
    }
  }
}

/** Scattered pieces out in the fog: tilted, fallen, leaning on each other, drifting very slowly. */
function buildDressing(stage, route, rnd, avoid = []) {
  const kits = [['Prism', 3], ['Prism', 2], ['Spike', 3], ['Spike', 2], ['Sail', 2], ['Sail', 3], ['Blade', 3], ['Pillar', 3], ['Pillar', 2], ['Notch', 2], ['Cube', 4], ['Cube', 3], ['Orb', 3], ['Cone', 2], ['Drum', 1]];
  const placed = [];
  const clearOfRoute = (x, z, margin) => { const d = route.distTo(x, z); return d.dist > d.w + margin; };
  const tryPlace = (x, z, minGap) => placed.every(([px, pz]) => Math.hypot(px - x, pz - z) > minGap);
  let n = 0;
  const bands = [
    { r0: 80, r1: 150, count: 120, phi: [0, 360], margin: 22 },
    { r0: 14, r1: 30, count: 26, phi: [122, 250], margin: 9 },     // round the giant's feet, clear of the balcony view and act 3
    { r0: 30, r1: 50, count: 24, phi: [-20, 60], margin: 9 },      // between the first lap and the last
  ];
  for (const b of bands) {
    let tries = 0, made = 0;
    while (made < b.count && tries++ < b.count * 40) {
      const phi = lerp(b.phi[0], b.phi[1], rnd()), r = lerp(b.r0, b.r1, Math.sqrt(rnd()));
      const x = -r * Math.sin(phi * D2R), z = r * Math.cos(phi * D2R);
      if (!clearOfRoute(x, z, b.margin) || !tryPlace(x, z, 7) || avoid.some((a) => Math.hypot(x - a.x, z - a.z) < a.r)) continue;
      const [kit, sz] = kits[Math.floor(rnd() * kits.length)];
      const pc = new Piece(`D${String(n++).padStart(3, '0')}`, kit, sz, { group: 'dressing' });   // solid: moving walls steer round them
      const roll = rnd(); let pose;
      if (roll < 0.28 && kit !== 'Orb' && kit !== 'Cube') {           // fallen on its side
        const lieDir = rnd() * 360, thick = KIT_DEF[kit].shape === 'long' ? pc.dims[2] : Math.max(pc.dims[0], pc.dims[2]);
        pose = { p: [x, thick / 2 * 0.9, z], yaw: lieDir + 90, lean: 86, leanDir: lieDir };
      } else if (roll < 0.7) pose = { p: [x, 0, z], yaw: rnd() * 360, lean: 8 + rnd() * 26, leanDir: rnd() * 360 };   // tilted
      else pose = { p: [x, 0, z], yaw: rnd() * 360, lean: rnd() * 4, leanDir: rnd() * 360 };
      pc.define('home', pose); stage.add(pc); pc.snap('home');
      pc.drift = { a: 0.15 + rnd() * 0.5, r: (0.5 + rnd() * 2) * D2R, w: 2 * Math.PI / (22 + rnd() * 30), ph: rnd() * 6.28 };
      placed.push([x, z]); made++;
    }
  }
}

/* ---------- Mist: low layers that follow the player and soft banks drifting at mid distance ---------- */
const MIST_TEX = canvasTexture(256, 256, (g, w, h) => {
  const rnd = seeded(77);
  for (let i = 0; i < 70; i++) {
    const x = rnd() * w, y = rnd() * h, r = 20 + rnd() * 70, gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(255,255,255,${0.12 + rnd() * 0.14})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    // wrap so the texture tiles
    for (const [ox, oy] of [[w, 0], [-w, 0], [0, h], [0, -h]]) { g.save(); g.translate(ox, oy); g.fillStyle = gr; g.fillRect(-ox, -oy, w, h); g.restore(); }
  }
});
MIST_TEX.wrapS = MIST_TEX.wrapT = THREE.RepeatWrapping;
/** The same mist, faded to nothing towards the edges, for the drifting banks (no visible square edges). */
const BANK_TEX = canvasTexture(256, 256, (g, w, h) => {
  g.drawImage(MIST_TEX.userData.canvas, 0, 0);
  g.globalCompositeOperation = 'destination-in';
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.55, 'rgba(0,0,0,.75)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});

class Mist {
  constructor(scene) {
    this.layers = [];
    const n = LOW ? 1 : 3;
    for (let i = 0; i < n; i++) {
      const tex = MIST_TEX.clone(); tex.needsUpdate = true; tex.repeat.set(6, 6);
      const m = new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff, transparent: true, opacity: 0.32 - i * 0.07, depthWrite: false, fog: true });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), m); mesh.rotation.x = -Math.PI / 2; mesh.position.y = 0.25 + i * 0.7; mesh.renderOrder = 1;
      scene.add(mesh); this.layers.push({ mesh, tex, speed: [0.004 + i * 0.002, 0.003 - i * 0.001] });
    }
    this.banks = [];
    const rnd = seeded(91), count = LOW ? 0 : 26;
    for (let i = 0; i < count; i++) {
      const m = new THREE.SpriteMaterial({ map: BANK_TEX, color: 0xffffff, transparent: true, opacity: 0.0, depthWrite: false, fog: true });
      const s = new THREE.Sprite(m); const size = 14 + rnd() * 18; s.scale.set(size * 1.8, size, 1); scene.add(s);
      this.banks.push({ s, m, ang: rnd() * Math.PI * 2, dist: 16 + rnd() * 46, h: 1.5 + rnd() * 5, drift: (rnd() - 0.5) * 0.02, base: 0.18 + rnd() * 0.18 });
    }
    this.tint = new THREE.Color();
  }
  update(dt, player, fogColor) {
    this.tint.copy(fogColor).lerp(new THREE.Color(0xffffff), 0.25);
    for (const l of this.layers) {   // the plane follows the player but its pattern stays put in the world, drifting slowly
      l.scroll = (l.scroll || [0, 0]); l.scroll[0] += l.speed[0] * dt; l.scroll[1] += l.speed[1] * dt;
      l.mesh.position.x = player.x; l.mesh.position.z = player.z;
      l.tex.offset.set(player.x * 6 / 220 + l.scroll[0], -player.z * 6 / 220 + l.scroll[1]);
      l.mesh.material.color.copy(this.tint);
    }
    for (const b of this.banks) {
      b.ang += b.drift * dt;
      b.s.position.set(player.x + Math.cos(b.ang) * b.dist, b.h, player.z + Math.sin(b.ang) * b.dist);
      b.m.color.copy(this.tint); b.m.opacity = b.base;
    }
  }
}

/** Where the player may walk: the corridor (as far as it has opened) plus any open zones (arenas, the balcony). */
class Boundary {
  constructor(world) { this.w = world; this.zones = new Map(); }
  zone(id, z) { this.zones.set(id, z); }
  remove(id) { this.zones.delete(id); }
  contains(x, z, m = 0.3) {
    for (const zn of this.zones.values()) {
      if (zn.kind === 'disk' && Math.hypot(x - zn.x, z - zn.z) <= zn.r - m) return true;
      if (zn.kind === 'fn' && zn.test(x, z, m)) return true;
    }
    const R = this.w.route, pr = R.project(x, z, this.w.progress.s, 16, 26), P = R.at(pr.s);
    const lo = this.w.progress.s - 13, hi = Math.min(this.w.progress.cap + 1.5, R.length - 0.15);
    return pr.s >= lo && pr.s <= hi && Math.abs(pr.lateral) <= P.w + 0.85 - m;
  }
}
