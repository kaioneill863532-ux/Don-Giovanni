/* =====================================================================
   5. The player: walking and running, the masks, the hand that puts them on
   ===================================================================== */
class Player {
  constructor(camera, world) {
    this.camera = camera; this.world = world;
    this.pos = new THREE.Vector3(); this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.moveLock = false; this.lookLock = false; this.speedScale = 1; this.constraint = null; this.auto = null;
    this.floorY = 0; this.stepAcc = 0; this.extraY = 0; this.bob = 0; this.speedNow = 0;
    this.carry = new THREE.Vector3();   // displacement applied by moving floors (the turntable)
  }
  place(p, yawDeg = 0) { this.pos.set(p.x, 0, p.z); this.yaw = yawDeg * D2R; this.pitch = 0; this.floorY = this.world.floorAt(p.x, p.z); }
  forward(out = new THREE.Vector3()) { return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)); }
  update(dt, input) {
    if (!this.lookLock) {
      const m = input.takeMouse();
      this.yaw -= m.dx * PLAYER.mouse; this.pitch -= m.dy * PLAYER.mouse;
      const turn = (input.down('ArrowLeft') ? 1 : 0) - (input.down('ArrowRight') ? 1 : 0);
      const tilt = (input.down('ArrowUp') ? 1 : 0) - (input.down('ArrowDown') ? 1 : 0);
      this.yaw += turn * PLAYER.keyTurn * dt; this.pitch += tilt * PLAYER.keyTurn * 0.6 * dt;
      this.pitch = clamp(this.pitch, -1.35, 1.35);
    } else input.takeMouse();
    const running = input.down('ShiftLeft') || input.down('ShiftRight');
    let mx = 0, mz = 0; const speed = (running ? PLAYER.run : PLAYER.walk) * this.speedScale;
    if (this.auto) {
      const dx = this.auto.target.x - this.pos.x, dz = this.auto.target.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.05) { this.auto = null; }
      else { const st = Math.min(d, this.auto.speed * dt); mx = dx / d * st; mz = dz / d * st; }
    } else if (!this.moveLock) {
      const f = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
      const r = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
      const len = Math.hypot(f, r) || 1, sx = -Math.sin(this.yaw), sz = -Math.cos(this.yaw);
      mx = (sx * f + -sz * r) / len * speed * dt; mz = (sz * f + sx * r) / len * speed * dt;
    }
    mx += this.carry.x; mz += this.carry.z; this.carry.set(0, 0, 0);
    const before = this.pos.clone();
    if (mx || mz) this.#move(mx, mz, !!this.auto);
    this.speedNow = dist2(before, this.pos) / Math.max(dt, 1e-4);
    const targetFloor = this.world.floorAt(this.pos.x, this.pos.z);
    this.floorY += (targetFloor - this.floorY) * Math.min(1, dt * 10);
    this.bob += this.speedNow * dt * 1.9;
    const bobY = Math.sin(this.bob * 2) * Math.min(0.045, this.speedNow * 0.011);
    this.camera.position.set(this.pos.x, this.floorY + PLAYER.eye + this.extraY + bobY, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
  }
  #move(mx, mz, scripted) {
    const before = this.pos.clone(), B = this.world.boundary;
    const nx = this.pos.x + mx, nz = this.pos.z + mz;
    if (scripted || B.contains(nx, nz)) { this.pos.x = nx; this.pos.z = nz; }
    else if (B.contains(nx, this.pos.z)) this.pos.x = nx;
    else if (B.contains(this.pos.x, nz)) this.pos.z = nz;
    if (!scripted) {
      this.world.stage.resolvePlayer(this.pos, PLAYER.radius);
      if (!B.contains(this.pos.x, this.pos.z)) this.pos.copy(before);
    }
    if (this.constraint) {
      const c = this.constraint, dx = this.pos.x - c.x, dz = this.pos.z - c.z, d = Math.hypot(dx, dz);
      if (d > c.r) { this.pos.x = c.x + dx / d * c.r; this.pos.z = c.z + dz / d * c.r; }
    }
    this.stepAcc += dist2(before, this.pos);
    const stride = this.speedNow > 3.2 ? 1.05 : 0.78;
    if (this.stepAcc > stride) { this.stepAcc = 0; this.world.audio.step(this.world.surfaceAt(this.pos.x, this.pos.z)); }
  }
}

/* ---------- A dark first-person hand that brings a mask up and presses it onto the face ---------- */
function buildHand() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x231d1a, roughness: 0.75 });
  const g = new THREE.Group();
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.092, 0.026), mat); g.add(palm);
  [[-0.028, 0.95], [-0.009, 1.05], [0.01, 1.0], [0.028, 0.85]].forEach(([x, len]) => {
    const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.0085, 0.05 * len, 4, 8), mat);
    f.position.set(x, 0.046 + 0.03 * len, -0.006); f.rotation.x = -0.35; g.add(f);
  });
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.0095, 0.04, 4, 8), mat);
  thumb.position.set(-0.046, 0.012, -0.012); thumb.rotation.z = 0.9; thumb.rotation.x = -0.4; g.add(thumb);
  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.12, 12), mat); wrist.position.y = -0.1; g.add(wrist);
  return g;
}

class HandRig {
  constructor(world) {
    this.w = world; this.root = new THREE.Group(); world.camera.add(this.root);
    this.hand = buildHand(); this.root.add(this.hand); this.root.visible = false;
    this.masks = {}; this.busy = false;
  }
  attach(models) {
    for (const id of MASK_IDS) {
      if (!models[id]) continue;
      const holder = new THREE.Group(), m = models[id].clone(true);
      m.rotation.y = Math.PI;                 // we look at the inside of the mask
      holder.add(m); holder.visible = false; this.root.add(holder); this.masks[id] = holder;
      holder.traverse((o) => { if (o.isMesh) { o.renderOrder = 20; o.material = o.material.clone(); o.material.depthTest = true; } });
    }
  }
  #pose(handPos, maskOffset, rot, maskId, maskVisible, turn = 1) {
    this.hand.position.copy(handPos); this.hand.rotation.set(rot.x, rot.y, rot.z);
    const m = this.masks[maskId];
    if (m) { m.visible = maskVisible; m.position.copy(handPos).add(maskOffset); m.rotation.set(rot.x * 0.6, Math.PI * (1 - turn), rot.z * 0.6); }   // turn 0 = face towards us, 1 = inside towards us
  }
  /** Bring the mask up and press it on (about 0.95 s). Calls onFace when it touches the face. */
  async put(id, onFace) {
    this.root.visible = true; this.hand.visible = true;
    const A = v3(0.22, -0.44, -0.42), B = v3(0.025, -0.13, -0.33), C = v3(0, -0.1, -0.085), D = v3(0.2, -0.55, -0.3);
    const off = v3(0, 0.115, -0.012);
    await this.w.tweens.run(0.5, (k) => this.#pose(new THREE.Vector3().lerpVectors(A, B, k), off, v3(lerp(-0.7, 0, k), 0, lerp(0.35, 0, k)), id, true, clamp01((k - 0.35) / 0.65)));
    await this.w.tweens.run(0.3, (k) => this.#pose(new THREE.Vector3().lerpVectors(B, C, k), off, v3(0, 0, 0), id, true), (t) => t * t);
    onFace?.();
    if (this.masks[id]) this.masks[id].visible = false;
    await this.w.tweens.run(0.35, (k) => this.#pose(new THREE.Vector3().lerpVectors(C, D, k), off, v3(0.5 * k, 0, -0.3 * k), id, false));
    this.root.visible = false;
  }
  /** Take the mask off (about 0.75 s). Calls onOff as it leaves the face. */
  async take(id, onOff) {
    this.root.visible = true;
    const D = v3(0.2, -0.55, -0.3), C = v3(0, -0.1, -0.085), E = v3(0.26, -0.5, -0.45), off = v3(0, 0.115, -0.012);
    await this.w.tweens.run(0.28, (k) => this.#pose(new THREE.Vector3().lerpVectors(D, C, k), off, v3(0.5 * (1 - k), 0, -0.3 * (1 - k)), id, false));
    onOff?.();
    await this.w.tweens.run(0.45, (k) => this.#pose(new THREE.Vector3().lerpVectors(C, E, k), off, v3(-0.6 * k, 0, 0.3 * k), id, true));
    if (this.masks[id]) this.masks[id].visible = false;
    this.root.visible = false;
  }
}

/** The three masks in the tray, and the rules for wearing them (design doc §3). */
class MaskSystem {
  constructor(world) {
    this.w = world; this.owned = false; this.current = null; this.memory = null; this.busyUntil = 0; this.picking = false; this.signature = '';
    this.tray = document.getElementById('tray'); this.slots = {}; this.hand = new HandRig(world);
    MASK_IDS.forEach((id, i) => {
      const s = document.createElement('div'); s.className = 'slot'; s.dataset.mask = id;
      s.innerHTML = `<span class="key">${i + 1}</span><img src="${window.DG_ASSETS?.['icon_' + id] || ''}"><span class="tick">✓</span><span class="name">${MASK_LABEL[id]}</span>`;
      s.addEventListener('mousedown', (e) => { e.stopPropagation(); if (e.button === 0) { this.wear(id); this.setPicking(false); } });
      this.tray.appendChild(s); this.slots[id] = s;
    });
    document.querySelectorAll('#vig .v').forEach((v) => { v.style.backgroundImage = `url(${window.DG_ASSETS?.['vignette_' + v.dataset.mask] || ''})`; });
  }
  setMemory(mem) { this.memory = mem; this.refresh(true); }
  reveal(seconds) { this.revealUntil = this.w.sched.time + seconds; }
  inMemory() { const m = this.memory; return !!(m && m.enabled && !m.complete && m.inPocket(this.w.player.pos)); }
  wear(id) {
    if (!this.owned || !id) return;
    if (!this.inMemory()) { this.w.ui.prompt(this.memory?.enabled && !this.memory.complete ? 'Go closer to them.' : 'There is nothing to remember here.', 2.5); return; }
    if (this.current === id || this.w.sched.time < this.busyUntil) return;
    const prev = this.current; this.busyUntil = this.w.sched.time + 1.15; this.current = id;
    const m = this.memory;
    this.w.player.constraint = { x: m.pocket.x, z: m.pocket.z, r: m.pocketRadius - PLAYER.radius };
    this.w.audio.motif(id);
    const swap = async () => {
      if (prev) { this.w.ui.vignette(null); await this.hand.take(prev); }
      setTimeout(() => m.wear(id), 420);                     // the scene starts to move while the hand is still rising
      await this.hand.put(id, () => { this.w.ui.blink(); this.w.ui.vignette(id); });
    };
    swap();
    this.refresh(true);
  }
  remove() {
    if (!this.current || this.w.sched.time < this.busyUntil) return;
    const id = this.current; this.current = null; this.busyUntil = this.w.sched.time + 0.8;
    this.hand.take(id, () => this.w.ui.vignette(null));
    this.w.player.constraint = null;
    this.memory?.remove();
    this.refresh(true);
  }
  setPicking(on) {
    this.picking = on && this.owned;
    this.tray.classList.toggle('picking', this.picking);
    if (this.picking) { document.exitPointerLock?.(); if (!this.inMemory()) this.wear('__probe__'); }
    else this.w.lockPointer();
  }
  refresh(force = false) {
    const show = this.owned && (this.picking || !!this.memory?.enabled || this.w.sched.time < (this.revealUntil || 0));
    const sig = [show, this.picking, this.current, this.inMemory(), [...(this.memory?.seen || [])].join(), this.memory?.complete].join('|');
    if (!force && sig === this.signature) return;
    this.signature = sig;
    this.tray.classList.toggle('show', show);
    for (const id of MASK_IDS) {
      const s = this.slots[id], seen = !!this.memory?.seen.has(id);
      s.classList.toggle('disabled', !this.inMemory() && this.current !== id);
      s.classList.toggle('worn', this.current === id);
      s.classList.toggle('seen', !!this.memory?.enabled && seen);
      s.classList.toggle('unseen', !!this.memory?.enabled && !seen && !this.memory?.complete);
    }
  }
  dropAll() {   // Act 3: the masks fall out of the tray
    if (this.current) { this.w.ui.vignette(null); this.current = null; }
    this.owned = false; this.w.player.constraint = null;
    Object.values(this.slots).forEach((s, i) => { s.style.setProperty('--rot', `${(i - 1) * 40 + 15}deg`); setTimeout(() => s.classList.add('falling'), i * 260); });
    setTimeout(() => this.tray.classList.remove('show'), 2400);
  }
}

/** A continuous low grind whose loudness follows how much scenery is moving near the player. */
class MachineryHum {
  constructor(audio) { this.a = audio; this.gain = null; }
  start() {
    const c = this.a.ctx; if (!c || this.gain) return;
    const src = c.createBufferSource(); src.buffer = this.a.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 110; f.Q.value = 0.9;
    const f2 = c.createBiquadFilter(); f2.type = 'peaking'; f2.frequency.value = 340; f2.gain.value = 6; f2.Q.value = 3;
    this.gain = c.createGain(); this.gain.gain.value = 0;
    src.connect(f); f.connect(f2); f2.connect(this.gain); this.gain.connect(this.a.master); src.start();
  }
  set(level) { if (this.gain) this.gain.gain.setTargetAtTime(clamp(level, 0, 1) * 0.55, this.a.ctx.currentTime, 0.25); }
}
