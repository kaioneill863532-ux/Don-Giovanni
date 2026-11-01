/* =====================================================================
   3. The kit: the pieces of Derek Jarman's stage model
   ---------------------------------------------------------------------
   Every piece of scenery in the game is one of these ten shapes, at one
   of a few fixed sizes. Proportions are read off the model photograph.
   Unit meshes have their pivot at the centre of the base; a piece's
   scale is dims(size). Pieces never change size in play: new scenes come
   only from moving, turning and tilting them, plus stage lifts.
   ===================================================================== */
const KIT_DEF = {
  // green equilateral triangular prism, side s, height 3s
  Prism:  { dims: (s) => [s, 3 * s, s], sizes: [2.4, 3.2, 4.2, 5.2], cat: 'green', shape: 'round', r: 0.55 },
  // plum square pyramid, height 5 x base (often stands on a marble cube)
  Spike:  { dims: (s) => [s, 5 * s, s], sizes: [1.2, 1.8, 2.6, 3.4], cat: 'plum', shape: 'round', r: 0.62 },
  // plum isosceles triangle, thin; height 0.85 x base
  Sail:   { dims: (s) => [s, 0.85 * s, 0.035 * s], sizes: [7, 11, 16, 20], cat: 'plum', shape: 'long' },
  // plum right triangle, vertical edge on +x; height = base
  Blade:  { dims: (s) => [s, s, 0.04 * s], sizes: [5, 8, 12, 15], cat: 'plum', shape: 'long' },
  // plum tall rectangular block, 1 : 6 : 0.6
  Pillar: { dims: (s) => [s, 6 * s, 0.6 * s], sizes: [1.2, 1.6, 2.2, 2.8], cat: 'plum', shape: 'long' },
  // plum slab whose top is cut on a slope (left edge 1.7 x base, right edge 1.05 x base)
  Notch:  { dims: (s) => [s, 1.7 * s, 0.14 * s], sizes: [3, 4.5, 6], cat: 'plum', shape: 'long' },
  // marble cube: plinths, steps, lifts
  Cube:   { dims: (s) => [s, s, s], sizes: [0.55, 1.5, 2.5, 4, 6], cat: 'marble', shape: 'box' },
  // black sphere (a white one appears once in the model)
  Orb:    { dims: (s) => [s, s, s], sizes: [0.6, 1.4, 2.6, 4.2], cat: 'orb', shape: 'round', r: 0.5 },
  // white cylinder, usually lying on its side
  Drum:   { dims: (s) => [s, 0.9 * s, s], sizes: [1.6, 2.4], cat: 'white', shape: 'round', r: 0.5 },
  // green cone, height 1.7 x base
  Cone:   { dims: (s) => [s, 1.7 * s, s], sizes: [1.4, 2.2, 3.2], cat: 'green', shape: 'round', r: 0.5 },
};

/** Unit meshes, pivot at the centre of the base, x = width, y = height, z = depth. */
const KIT_GEO = (() => {
  const flat = (g) => { const n = g.index ? g.toNonIndexed() : g; n.computeVertexNormals(); return n; };
  const extrude = (pts) => { const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))), { depth: 1, bevelEnabled: false }); g.translate(0, 0, -0.5); return flat(g); };
  const prism = new THREE.CylinderGeometry(1 / Math.sqrt(3), 1 / Math.sqrt(3), 1, 3, 1); prism.translate(0, 0.5, 0);
  const spike = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1); spike.rotateY(Math.PI / 4); spike.translate(0, 0.5, 0);
  const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
  const orb = new THREE.SphereGeometry(0.5, 28, 18); orb.translate(0, 0.5, 0);
  const drum = new THREE.CylinderGeometry(0.5, 0.5, 1, 36); drum.translate(0, 0.5, 0);
  const cone = new THREE.ConeGeometry(0.5, 1, 36); cone.translate(0, 0.5, 0);
  return {
    Prism: flat(prism), Spike: flat(spike),
    Sail: extrude([[-0.5, 0], [0.5, 0], [0, 1]]),
    Blade: extrude([[-0.5, 0], [0.5, 0], [0.5, 1]]),
    Pillar: box.clone(), Notch: extrude([[-0.5, 0], [0.5, 0], [0.5, 1.05 / 1.7], [-0.5, 1]]),
    Cube: box, Orb: orb, Drum: drum, Cone: cone,
  };
})();

// a 1 x 1 plane with its pivot at the bottom edge, for silhouettes (not scenery)
const KIT = { Plane: new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0) };

const marbleTex = canvasTexture(1024, 1024, (g, w, h) => drawMarble(g, w, h, seeded(7)));
marbleTex.wrapS = marbleTex.wrapT = THREE.RepeatWrapping;
const floorTex = marbleTex.clone(); floorTex.repeat.set(460 / 9, 460 / 9); floorTex.needsUpdate = true;   // one marble tile every 9 m on the 460 m floor

const MAT = {
  plum: new THREE.MeshStandardMaterial({ color: 0x2c1f30, roughness: 0.82, metalness: 0.04, flatShading: true }),
  green: new THREE.MeshStandardMaterial({ color: 0x5a8c3c, roughness: 0.78, flatShading: true }),
  marble: new THREE.MeshStandardMaterial({ color: 0x8a8a8a, map: marbleTex, roughness: 0.45 }),
  orb: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.22, metalness: 0.15 }),
  white: new THREE.MeshStandardMaterial({ color: 0xd8d3c8, roughness: 0.55 }),
  floor: new THREE.MeshStandardMaterial({ color: 0xffffff, map: floorTex, roughness: 0.34 }),
  iron: new THREE.MeshStandardMaterial({ color: 0x8a837a, roughness: 0.38, metalness: 0.62 }),
  eye: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe8f0ff, emissiveIntensity: 0, roughness: 0.3 }),
  table: new THREE.MeshStandardMaterial({ color: 0x24191f, roughness: 0.7, flatShading: true }),
};

/* Palettes. Rule (design §1.2): wearing Don Giovanni's mask changes space only, never colour,
   so 'neutral' is also his. Every palette keeps enough ambient light to read the scene. */
const PALETTE = {
  void:      { bg: 0x1d1b21, fog: 0.04, sky: 0x76727f, ground: 0x111014, hemi: 1.25, key: 0xd8dcff, keyI: 0.45, plum: 0x3a2c3e, green: 0x4f7542, marble: 0x707072, orb: 0x1c1c1c, white: 0xc4bfb6, floor: 0x9a9a9a },
  neutral:   { bg: 0x8b8781, fog: 0.0155, sky: 0xdedad2, ground: 0x3a3433, hemi: 1.15, key: 0xfff4e4, keyI: 1.5, plum: 0x2c1f30, green: 0x5a8c3c, marble: 0x8a8a8a, orb: 0x141414, white: 0xd8d3c8, floor: 0xffffff },
  anna:      { bg: 0x46525f, fog: 0.024, sky: 0xb4c6da, ground: 0x1a2028, hemi: 1.35, key: 0xc8d9ee, keyI: 0.9, plum: 0x363d4c, green: 0x5f7788, marble: 0x7b8592, orb: 0x1a1e24, white: 0xaab5c2, floor: 0xa8b8cc },
  servant:   { bg: 0x481813, fog: 0.026, sky: 0xd86a52, ground: 0x260a08, hemi: 1.35, key: 0xff7a5c, keyI: 0.85, plum: 0x45201f, green: 0x6e3222, marble: 0x8e5048, orb: 0x1c0807, white: 0xa65e50, floor: 0xc48478 },
  judgement: { bg: 0xa7a39b, fog: 0.04, sky: 0xeae6de, ground: 0x2c2828, hemi: 1.1, key: 0xffffff, keyI: 1.0, plum: 0x221a25, green: 0x3e5a34, marble: 0x7a7a7a, orb: 0x121212, white: 0xd0ccc4, floor: 0xd8d8d8 },
  inferno:   { bg: 0x3a0c03, fog: 0.05, sky: 0xff7030, ground: 0x260400, hemi: 1.1, key: 0xff7a2a, keyI: 1.4, plum: 0x2a0c08, green: 0x3a1408, marble: 0x5a2410, orb: 0x150303, white: 0x7a3a22, floor: 0xa04a2a },
};
const COLOR_KEYS = ['bg', 'sky', 'ground', 'key', 'plum', 'green', 'marble', 'orb', 'white', 'floor'];
const NUM_KEYS = ['fog', 'hemi', 'keyI'];

/** Owns background, exponential fog, the two global lights and the tint of every shared material. */
class Atmosphere {
  constructor(scene, hemi, key) {
    this.scene = scene; this.hemi = hemi; this.key = key;
    this.cur = this.#copy(PALETTE.neutral); this.from = null; this.target = null; this.k = 1; this.duration = 1;
  }
  #copy(p) { const o = {}; for (const k of COLOR_KEYS) o[k] = new THREE.Color(p[k]); for (const k of NUM_KEYS) o[k] = p[k]; return o; }
  #mixInto(out, a, b, t) { for (const k of COLOR_KEYS) out[k].copy(a[k]).lerp(b[k], t); for (const k of NUM_KEYS) out[k] = lerp(a[k], b[k], t); }
  #asObj(c) { const o = {}; for (const k of COLOR_KEYS) o[k] = c[k].getHex(); for (const k of NUM_KEYS) o[k] = c[k]; return o; }
  set(name) { this.cur = this.#copy(PALETTE[name]); this.target = null; this.apply(); }
  to(name, duration = 2) { this.from = this.#copy(this.#asObj(this.cur)); this.target = this.#copy(PALETTE[name]); this.k = 0; this.duration = duration; }
  mix(a, b, t) { this.target = null; this.#mixInto(this.cur, this.#copy(PALETTE[a]), this.#copy(PALETTE[b]), clamp01(t)); this.apply(); }
  update(dt) {
    if (!this.target) return;
    this.k = Math.min(1, this.k + dt / this.duration);
    this.#mixInto(this.cur, this.from, this.target, easeInOut(this.k));
    if (this.k >= 1) this.target = null;
    this.apply();
  }
  apply() {
    const c = this.cur;
    this.scene.background.copy(c.bg); this.scene.fog.color.copy(c.bg); this.scene.fog.density = c.fog;
    this.hemi.color.copy(c.sky); this.hemi.groundColor.copy(c.ground); this.hemi.intensity = c.hemi;
    this.key.color.copy(c.key); this.key.intensity = c.keyI;
    for (const k of ['plum', 'green', 'marble', 'orb', 'white', 'floor']) MAT[k].color.copy(c[k]);
    MAT.table.color.copy(c.plum).multiplyScalar(0.85);
  }
}

/* ---------- Stage lights: a fixed pool of followspots with visible beams ---------- */
const BEAM_TEX = canvasTexture(16, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.12, 'rgba(255,255,255,.9)');
  gr.addColorStop(0.7, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});

/** One followspot: a SpotLight plus a soft additive cone so the beam reads in the haze. */
class Followspot {
  constructor(scene) {
    this.light = new THREE.SpotLight(0xffffff, 0, 0, 0.3, 0.55, 0);
    this.light.position.set(0, 30, 0); scene.add(this.light, this.light.target);
    const geo = new THREE.CylinderGeometry(0.15, 1, 1, 32, 1, true); geo.translate(0, -0.5, 0); geo.rotateX(-Math.PI / 2);   // apex at origin, opens along -z... then +z
    this.beamMat = new THREE.MeshBasicMaterial({ map: BEAM_TEX, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.beam = new THREE.Mesh(geo, this.beamMat); this.beam.renderOrder = 5; scene.add(this.beam);
    this.from = new THREE.Vector3(0, 30, 0); this.to = new THREE.Vector3(); this.intensity = 0; this.beamStrength = 0.11;
    this.goal = null;
  }
  /** Aim from `from` at `to`; fades to the new intensity / colour over `seconds`. */
  set({ from, to, color = 0xffffff, intensity = 6, angle = 0.22, beam = 0.11 }, seconds = 1.2) {
    this.goal = { from: from.clone(), to: to.clone(), color: new THREE.Color(color), intensity, angle, beam, t: 0, seconds: Math.max(0.01, seconds),
      from0: this.from.clone(), to0: this.to.clone(), color0: this.light.color.clone(), intensity0: this.intensity, angle0: this.light.angle, beam0: this.beamStrength };
  }
  off(seconds = 1) { if (this.goal || this.intensity > 0) this.set({ from: this.from, to: this.to, color: this.light.color, intensity: 0, angle: this.light.angle, beam: this.beamStrength }, seconds); }
  update(dt) {
    const g = this.goal;
    if (g) {
      g.t = Math.min(1, g.t + dt / g.seconds); const k = easeInOut(g.t);
      this.from.lerpVectors(g.from0, g.from, k); this.to.lerpVectors(g.to0, g.to, k);
      this.light.color.lerpColors(g.color0, g.color, k); this.intensity = lerp(g.intensity0, g.intensity, k);
      this.light.angle = lerp(g.angle0, g.angle, k); this.beamStrength = lerp(g.beam0, g.beam, k);
      if (g.t >= 1) this.goal = null;
    }
    this.light.position.copy(this.from); this.light.target.position.copy(this.to); this.light.intensity = this.intensity;
    const len = this.from.distanceTo(this.to) * 1.05, rad = Math.tan(this.light.angle) * len;
    this.beam.position.copy(this.from); this.beam.lookAt(this.to); this.beam.scale.set(rad, rad, len);
    this.beamMat.color.copy(this.light.color); this.beamMat.opacity = this.beamStrength * Math.min(1, this.intensity / 6);
    this.beam.visible = this.beamMat.opacity > 0.002;
  }
}

/** A fixed pool of followspots (a fixed light count avoids shader recompiles). Acts borrow them by name. */
class LightRig {
  constructor(scene, count = 6) { this.spots = Array.from({ length: count }, () => new Followspot(scene)); this.byName = new Map(); }
  get(name) {
    if (this.byName.has(name)) return this.byName.get(name);
    const free = this.spots.find((s) => ![...this.byName.values()].includes(s)) || this.spots[0];
    this.byName.set(name, free); return free;
  }
  release(name, seconds = 1) { const s = this.byName.get(name); if (s) { s.off(seconds); this.byName.delete(name); } }
  releaseAll(seconds = 1) { for (const n of [...this.byName.keys()]) this.release(n, seconds); }
  update(dt) { this.spots.forEach((s) => s.update(dt)); }
}

/** A large soft glow in the fog (e.g. behind the giant so it reads as a silhouette). */
function makeGlow(size, color = 0xffffff, opacity = 0.5) {
  const m = new THREE.SpriteMaterial({ map: HALO_TEX, color, transparent: true, opacity, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
  const s = new THREE.Sprite(m); s.scale.set(size, size, 1); return s;
}
