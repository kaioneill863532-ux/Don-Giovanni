/* =====================================================================
   6. The giant: the Commendatore's shadow, built from the same kit
   ---------------------------------------------------------------------
   Before the balcony: its pieces hang scattered in the fog round an
   empty plinth. From one viewpoint (the balcony) they line up into the
   figure. Once seen, they fly together into the statue, which then turns
   its head to follow the player round the spiral. In act 3 it leans down
   over the edge of its plinth to meet the player at the glass.
   ===================================================================== */
// Statue in its own frame: origin = centre of the plinth on the floor, front = +z.
const GIANT_PARTS = [
  // id, kit, size, cat, stand pose (p = base pivot), group
  ['G_plinth0', 'Cube', 4, 'marble', { p: [-3, 0, -3] }, 'plinth'],
  ['G_plinth1', 'Cube', 4, 'marble', { p: [3, 0, -3] }, 'plinth'],
  ['G_plinth2', 'Cube', 4, 'marble', { p: [-3, 0, 3] }, 'plinth'],
  ['G_plinth3', 'Cube', 4, 'marble', { p: [3, 0, 3] }, 'plinth'],
  ['G_robeF', 'Sail', 1, 'plum', { p: [0, 6, 5.6], yaw: 0, lean: 40, leanDir: 0 }, 'body'],
  ['G_robeB', 'Sail', 1, 'plum', { p: [0, 6, -5.6], yaw: 0, lean: 40, leanDir: 180 }, 'body'],
  ['G_robeL', 'Sail', 1, 'plum', { p: [-5.6, 6, 0], yaw: 90, lean: 40, leanDir: -90 }, 'body'],
  ['G_robeR', 'Sail', 1, 'plum', { p: [5.6, 6, 0], yaw: 90, lean: 40, leanDir: 90 }, 'body'],
  ['G_shoulders', 'Pillar', 2, 'plum', { p: [-6.6, 14.3, 0], roll: -90 }, 'body'],
  ['G_armL', 'Pillar', 1, 'plum', { p: [-6.4, 4.4, 0.4], yaw: 0, lean: 6, leanDir: 90 }, 'body'],
  ['G_armR', 'Pillar', 1, 'plum', { p: [6.4, 5.2, 1.4], yaw: 0, lean: 22, leanDir: 180 }, 'body'],
  ['G_sword', 'Spike', 1, 'plum', { p: [7.2, 10.6, 3.6], pitch: 180 }, 'body'],
  ['G_neck', 'Cube', 1, 'plum', { p: [0, 15.2, 0] }, 'head'],
  ['G_head', 'Orb', 3, 'orb', { p: [0, 16.5, 0] }, 'head'],
  ['G_eyeL', 'Orb', 0, 'eye', { p: [-0.78, 18.25, 1.82] }, 'head'],
  ['G_eyeR', 'Orb', 0, 'eye', { p: [0.78, 18.25, 1.82] }, 'head'],
  ['G_brim', 'Pillar', 0, 'plum', { p: [-3.6, 20.55, 0.25], roll: -90 }, 'head'],
  ['G_crown', 'Sail', 0, 'plum', { p: [0, 20.6, 0], yaw: 0 }, 'head'],
];
// Leaning over the front edge of the plinth towards the glass (act 3). Same frame; front = towards the glass.
const GIANT_CROUCH = {
  G_shoulders: { p: [-6.6, 8.2, 6.6], roll: -90, pitch: 14 },
  G_armL: { p: [-3.0, 0, 9.4], yaw: 0, lean: 3, leanDir: 0 },
  G_armR: { p: [3.0, 0, 9.4], yaw: 0, lean: 3, leanDir: 0 },
  G_sword: { p: [9.2, 0.1, 3.0], yaw: 30, lean: 86, leanDir: 60 },
  G_neck: { p: [0, 6.6, 7.6] },
  G_head: { p: [0, 2.2, 8.7] },
  G_eyeL: { p: [-0.8, 3.95, 10.55] }, G_eyeR: { p: [0.8, 3.95, 10.55] },
  G_brim: { p: [-3.6, 6.15, 8.9], roll: -90, pitch: -18 },
  G_crown: { p: [0, 6.3, 8.6], yaw: 0, pitch: -22 },
  G_robeF: { p: [0, 6, 5.6], yaw: 0, lean: 58, leanDir: 0 },
};
// How far along its own sight line from the balcony each piece hangs before the figure assembles (1 = in place).
const GIANT_DEPTH = { G_robeF: 0.78, G_robeB: 1.26, G_robeL: 0.9, G_robeR: 1.14, G_shoulders: 1.18, G_armL: 0.72, G_armR: 1.3, G_sword: 0.8, G_neck: 0.86, G_head: 0.86, G_eyeL: 0.86, G_eyeR: 0.86, G_brim: 0.86, G_crown: 0.86 };

class Giant {
  constructor(world, centre, frontDir) {
    this.w = world; this.centre = centre.clone();
    this.baseYaw = dirYaw(-frontDir.x, -frontDir.z);   // statue front (+z local) faces frontDir
    this.pieces = {}; this.headYaw = 0; this.tracking = false; this.eyesOn = 0;
    for (const [id, kit, sz, cat, pose, group] of GIANT_PARTS) {
      const pc = new Piece(id, kit, sz, { cat, group: 'giant', floating: group !== 'plinth', collide: group === 'plinth', turn: 26 });
      pc.part = group; pc.define('stand', this.#world(pose, this.baseYaw)); world.stage.add(pc); pc.snap('stand');
      this.pieces[id] = pc;
    }
    this.glow = makeGlow(70, 0xfff2e2, 0.0); world.scene.add(this.glow);
  }
  /** Statue-frame pose -> world pose, with the statue turned to `yaw` degrees. */
  #world(pose, yaw) {
    const c = Math.cos(yaw * D2R), s = Math.sin(yaw * D2R), [x, y, z] = pose.p;
    return makePose({ ...pose, p: [this.centre.x + x * c + z * s, y, this.centre.z - x * s + z * c], yaw: (pose.yaw ?? 0) + yaw, leanDir: (pose.leanDir ?? 0) + yaw });
  }
  /** Scatter along the sight lines from eye position E: each piece slides along its own line, so from E nothing changes shape. */
  defineCloud(E) {
    for (const pc of Object.values(this.pieces)) {
      const k = GIANT_DEPTH[pc.id]; if (!k) { pc.define('cloud', pc.poses.stand); continue; }
      const st = pc.poses.stand, centroid = new THREE.Vector3(0, 0.5, 0).multiply(new THREE.Vector3(...pc.dims)).applyQuaternion(st.quat).add(st.pos);
      const moved = E.clone().add(centroid.clone().sub(E).multiplyScalar(k));
      const pos = moved.sub(new THREE.Vector3(0, 0.5, 0).multiply(new THREE.Vector3(...pc.dims)).applyQuaternion(st.quat));
      pc.define('cloud', { pos, quat: st.quat.clone() });
    }
    this.eye = E.clone();
  }
  defineCrouch(towardDir) {
    const yaw = dirYaw(-towardDir.x, -towardDir.z); this.crouchYaw = yaw;
    for (const pc of Object.values(this.pieces)) {
      const spec = GIANT_CROUCH[pc.id];
      pc.define('crouch', spec ? this.#world(spec, yaw) : pc.poses.stand);
    }
  }
  pose(name, speedScale = 1, stagger = 0) {
    Object.values(this.pieces).forEach((pc, i) => {
      if (pc.part === 'plinth') return;
      const go = () => { pc.speed = Math.max(1.2, pc.pos.distanceTo(pc.poses[name].pos) / (7 * speedScale)); pc.turn = 30; pc.go(name); };
      if (stagger) setTimeout(go, (i % 7) * stagger * 1000); else go();
    });
    this.state = name;
  }
  snap(name) { Object.values(this.pieces).forEach((pc) => pc.snap(name)); this.state = name; }
  lightEyes(on) { this.eyesOnTarget = on ? 1 : 0; }
  /** Head group turns (slowly) to face the player; done by hand so it can pivot round the head. */
  update(dt, time) {
    this.eyesOn += ((this.eyesOnTarget ?? 0) - this.eyesOn) * Math.min(1, dt * 1.5);
    MAT.eye.emissiveIntensity = this.eyesOn * (2.2 + 0.3 * Math.sin(time * 1.7));
    const pl = this.w.player.pos;
    // glow behind the giant from wherever the player stands, so it always reads as a dark shape
    const away = new THREE.Vector3(this.centre.x - pl.x, 0, this.centre.z - pl.z), d = away.length(); away.normalize();
    this.glow.position.set(this.centre.x + away.x * 16, 15, this.centre.z + away.z * 16);
    this.glow.material.opacity = (this.glowOn ?? 0) * clamp(1.2 - d / 120, 0.15, 0.85);
    if (!this.tracking) { this.#releaseHead(); return; }
    const head = this.pieces.G_head, hc = head.poses[this.state].pos.clone().add(new THREE.Vector3(0, head.dims[1] / 2, 0));
    const want = dirYaw(pl.x - hc.x, pl.z - hc.z) - this.facingYaw(this.state) - 180;
    let delta = ((want - this.headYaw + 540) % 360) - 180;
    const maxTurn = 14 * dt; this.headYaw += clamp(delta, -maxTurn, maxTurn); this.headYaw = clamp(this.headYaw, -80, 80);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.headYaw * D2R);
    for (const pc of Object.values(this.pieces)) {
      if (pc.part !== 'head' || pc.id === 'G_neck') continue;
      const base = pc.poses[this.state];
      if (pc.pos.distanceTo(base.pos) > 0.6 && !pc.override) continue;   // still flying in: leave it to the stage
      pc.override = true;
      pc.pos.copy(base.pos).sub(hc).applyQuaternion(q).add(hc); pc.quat.copy(q).multiply(base.quat);
    }
  }
  #releaseHead() { for (const pc of Object.values(this.pieces)) if (pc.override && pc.part === 'head') { pc.override = false; } }
  facingYaw(state) { return state === 'crouch' ? this.crouchYaw ?? this.baseYaw : this.baseYaw; }
}
