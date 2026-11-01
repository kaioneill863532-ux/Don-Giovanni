/* =====================================================================
   8. World, director, checks, export, boot
   ===================================================================== */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = !LOW; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('app').appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(); scene.fog = new THREE.FogExp2(0x000000, 0.02);
const camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.01, 900); scene.add(camera);
const hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 1); scene.add(hemi);
const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
keyLight.castShadow = !LOW; keyLight.shadow.mapSize.set(2048, 2048);
Object.assign(keyLight.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 260 });
keyLight.shadow.bias = -0.0005; keyLight.shadow.normalBias = 0.05;
scene.add(keyLight, keyLight.target);
// a weak fill from the other side so dark pieces stay separate from dark backgrounds
const fillLight = new THREE.DirectionalLight(0xbfc8d8, 0.35); fillLight.position.set(40, 30, -30); scene.add(fillLight);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
// one flat marble floor for the whole world
const floorMesh = new THREE.Mesh(new THREE.CircleGeometry(230, 120), MAT.floor); floorMesh.rotation.x = -Math.PI / 2; floorMesh.receiveShadow = !LOW; scene.add(floorMesh);

const sched = new Scheduler();
const world = {
  scene, camera, renderer, sched, tweens: new Tweens(), atmo: new Atmosphere(scene, hemi, keyLight), audio: new Sound(),
  onFrame: [], interact: null, progress: { s: 0, cap: 0.5 },
  lockPointer: () => { try { renderer.domElement.requestPointerLock?.()?.catch?.(() => {}); } catch { /* headless */ } },
};
world.route = new Route(ROUTE_STATIONS);
world.stage = new Stage(world);
world.boundary = new Boundary(world);
world.lights = new LightRig(scene, 6);
world.ui = new ScreenUI(sched);
world.player = new Player(camera, world);
world.masks = new MaskSystem(world);
world.mist = new Mist(scene);
world.hum = new MachineryHum(world.audio);
world.crows = new Crows(scene);
{   // the giant faces the balcony
  const P = world.route.at(world.route.sAtPhi(98)), inward = new THREE.Vector3(-P.x, 0, -P.z).normalize();
  world.giant = new Giant(world, new THREE.Vector3(0, 0, 0), inward.clone().negate());
}
world.acts = { opening: new Opening(world), act1: new Act1(world), balcony: new Balcony(world), act2: new Act2(world) };
world.acts.act3 = new Act3(world);
world.giant.defineCloud(world.acts.balcony.eye); world.giant.snap('cloud');
{   // the corridor everywhere outside the scenes
  const R = world.route, s = (phi) => R.sAtPhi(phi), A = world.acts;
  const sections = [
    { s0: 8.5, s1: s(46), style: 'overture' }, { s0: s(46), s1: s(54), style: 'tense' },
    { s0: s(78), s1: s(100), style: 'tense' }, { s0: s(100), s1: s(186), style: 'vista' }, { s0: s(186), s1: s(200), style: 'tense' },
    { s0: s(220), s1: s(262), style: 'overture' }, { s0: s(262), s1: R.length - 3.5, style: 'finale' },
  ];
  const pieces = buildCorridor(world.stage, R, sections, [A.act1.range, A.balcony.range, A.act2.range], seeded(303));
  const A1 = world.acts.act1, A2 = world.acts.act2, B = world.acts.balcony;
  buildDressing(world.stage, R, seeded(404), [{ x: A1.centre.x, z: A1.centre.z, r: 26 }, { x: A2.C.x, z: A2.C.z, r: 30 }, { x: B.V1.x, z: B.V1.z, r: 14 }, { x: 0, z: 0, r: 14 }, { ...world.acts.opening.F.pt(4, 0), r: 20 }]);
  const dressing = world.stage.pieces.filter((pc) => pc.group === 'dressing'), others = world.stage.pieces.filter((pc) => !['corridor', 'dressing', 'giant'].includes(pc.group));
  const settle = (pose, keepSide) => {
    const map = new Map(pieces.map((pc) => [pc, pc.poses[pose]]));
    for (const pc of dressing) map.set(pc, pc.poses.home);
    const fixed = new Set(dressing);
    relaxLayout(map, { keep: (pc, x, z) => {
      if (fixed.has(pc)) return { x: pc.poses.home.pos.x, z: pc.poses.home.pos.z };
      if (!keepSide) return null;
      const P = R.at(pc.slot.s), lat = (x - P.x) * P.nx + (z - P.z) * P.nz, min = P.w + pc.rad * 0.9;
      if (Math.abs(lat) < min || Math.sign(lat) !== pc.slot.side) { const l = pc.slot.side * min; return { x: x + (l - lat) * P.nx, z: z + (l - lat) * P.nz }; }
      return null;
    } });
  };
  settle('open', true); settle('ahead', false); settle('behind', false);
  for (const pc of pieces) pc.snap('ahead');
  world.corridor = new Corridor(world, pieces);
}
world.floorAt = (x, z) => {
  const a2 = world.acts.act2; if (Math.hypot(x - a2.C.x, z - a2.C.z) <= a2.R) return 0.35;
  return world.acts.act3.floorAt(x, z);
};
world.surfaceAt = (x, z) => world.acts.act3.surfaceAt(x, z);
world.atmo.set('void');
drawArms(document.querySelector('#arms canvas'));

/* ---------- checks: no two pieces in the same place, and the pocket always clear ---------- */
function footprintAt(pc, pose) {
  const yaw = new THREE.Euler().setFromQuaternion(pose.quat, 'YXZ').y, ax = Math.cos(yaw) * pc.half, az = -Math.sin(yaw) * pc.half;
  return { ax: pose.pos.x - ax, az: pose.pos.z - az, bx: pose.pos.x + ax, bz: pose.pos.z + az, r: pc.rad };
}
function spineAt(pc, pose) {   // base-to-top line of a piece, for leaning pieces whose tops might meet
  const up = new THREE.Vector3(0, pc.dims[1], 0).applyQuaternion(pose.quat);
  return { a: pose.pos.clone(), b: pose.pos.clone().add(up), r: Math.min(pc.dims[0], pc.dims[2]) / 2 };
}
function spineDist(A, B) {
  let best = Infinity; const p = new THREE.Vector3(), q = new THREE.Vector3();
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) { p.lerpVectors(A.a, A.b, i / 8); q.lerpVectors(B.a, B.b, j / 8); best = Math.min(best, p.distanceTo(q)); }
  return best;
}
function checkScene(pieces, state, pocket = null, pocketRadius = 0) {
  const out = [], list = pieces.map((pc) => ({ pc, pose: pc.poses[state] || pc.poses.neutral })).filter((x) => x.pose);
  for (let i = 0; i < list.length; i++) {
    const A = list[i], fa = footprintAt(A.pc, A.pose), onFloorA = A.pose.pos.y > -A.pc.dims[1] + 0.2;
    if (pocket && onFloorA && !A.pc.floating) { const d = segPoint(fa, pocket.x, pocket.z).d - fa.r; if (d < pocketRadius + 0.25) out.push(`${state}: ${A.pc.id} enters the pocket (${(pocketRadius - d).toFixed(2)} m)`); }
    for (let j = i + 1; j < list.length; j++) {
      const B = list[j], fb = footprintAt(B.pc, B.pose), onFloorB = B.pose.pos.y > -B.pc.dims[1] + 0.2;
      if (!onFloorA || !onFloorB || A.pc.floating || B.pc.floating) continue;
      if (!shareHeight(A.pose.pos.y, A.pc.dims[1], B.pose.pos.y, B.pc.dims[1])) continue;
      const d = segSeg(fa, fb).d, need = fa.r + fb.r;
      if (d < need - 0.05) out.push(`${state}: ${A.pc.id} / ${B.pc.id} overlap ${(need - d).toFixed(2)} m`);
      else if ((A.pose.lean > 2 || B.pose.lean > 2) && A.pose.pos.distanceTo(B.pose.pos) < 25) {
        const sa = spineAt(A.pc, A.pose), sb = spineAt(B.pc, B.pose), ds = spineDist(sa, sb);
        if (ds < (sa.r + sb.r) * 0.9) out.push(`${state}: ${A.pc.id} / ${B.pc.id} tops touch`);
      }
    }
  }
  return out;
}
function checkAll() {
  const A = world.acts, rep = [];
  for (const st of ['approach', 'gather', 'neutral', 'don', 'anna', 'servant', 'exit']) rep.push(...checkScene(A.act1.memory.pieces, st, ['neutral', 'gather', 'don', 'anna', 'servant'].includes(st) ? A.act1.pocket : null, 4.2));
  for (const st of ['neutral', 'don', 'anna', 'servant', 'exit']) rep.push(...checkScene(A.act2.memory.pieces.filter((p) => p.group === 'act2'), st, st === 'exit' ? null : A.act2.C, 3.5));
  rep.push(...checkScene(A.opening.pieces, 'wreck'), ...checkScene(A.opening.pieces.filter((p) => p.poses.clear), 'clear'));
  for (const st of ['open']) rep.push(...checkScene(world.corridor.pieces, st));
  return rep;
}
/** While playing: the worst overlap between any two floor pieces seen so far (steering should keep it near zero). */
const motionStats = { worst: 0, pair: '', frames: 0 };
function sampleMotion() {
  const live = world.stage.pieces.filter((p) => !p.floating && p.collide && !p.override && dist2(p.pos, world.player.pos) < 45);
  const segs = live.map((p) => p.segment({}));
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    if (!live[i].moving && !live[j].moving) continue;
    if (!shareHeight(live[i].pos.y, live[i].dims[1], live[j].pos.y, live[j].dims[1])) continue;
    const d = segSeg(segs[i], segs[j]).d, ov = segs[i].r + segs[j].r - d;
    if (ov > motionStats.worst) { motionStats.worst = ov; motionStats.pair = `${live[i].id}/${live[j].id}`; }
  }
  motionStats.frames++;
}

/* ---------- export: layout.json for UE ---------- */
function poseOut(pc, pose) {
  const s = new THREE.Vector3(...pc.dims);
  return { three: { pos: pose.pos.toArray().map(round6), quat_xyzw: pose.quat.toArray().map(round6) }, ue: toUE(pose.pos, pose.quat, s) };
}
function exportLayout() {
  const R = world.route, A = world.acts, g = world.giant;
  const samples = []; for (let s = 0; s <= R.length; s += 1) { const p = R.at(s); samples.push({ s: round(s), three: [round(p.x), round(p.z)], ue_cm: [round(p.x * 100), round(p.z * 100)], half_width_m: round(p.w) }); }
  return {
    version: '0.2', generated_by: 'prototype/index.html (greybox v0.2)',
    conventions: {
      three: 'metres; +x east, +y up, -z north; right-handed. The world centre (the giant) is the origin.',
      ue: 'centimetres; UE = (x, z, y) * 100, quat = (-qx, -qz, -qy, qw), scale = (sx, sz, sy). Assumes the UE glTF importer maps glTF (x, y, z) to UE (x, z, y); check with kit/DG_AxisMarker.glb first.',
      pivot: 'every kit mesh has its pivot at the centre of its base; scale = dims_m',
      poses: 'each piece lists named poses; the game moves pieces between them with the steering rules in motion{}',
    },
    kit: Object.fromEntries(Object.entries(KIT_DEF).map(([k, d]) => [k, { sizes_m: d.sizes, dims_m: d.sizes.map((s) => d.dims(s).map(round)), category: d.cat, footprint: d.shape }])),
    motion: { speed_m_s: 'clamp(3.3 - 0.07 * height, 1.5, 3.2) unless set', separation_gap_m: 0.35, separation_gain: 3.2, sideways_bias: 0.35, yield_to_player_m: 1.1, accel_rate: 2.6, mask_speed_multiplier: 2.1, unmask_speed_multiplier: 1.7, far_glide_beyond_m: 95 },
    route: { stations: ROUTE_STATIONS, length_m: round(R.length), samples_every_1m: samples },
    corridor: { rule: 'pose = ahead if slot.s > progress + open_at_m; behind if slot.s < progress - close_at_m; else open. progress = furthest route distance reached, capped by the current scene.' },
    scenes: {
      opening: { player_start_three: A.opening.F.pt(-0.6, 0) },
      act1: { mark_s: round(A.act1.sMark), pocket_three: A.act1.pocket.toArray().map(round), pocket_radius_m: 4.2, range_s: A.act1.range.map(round), courtyard_centre_three: A.act1.centre.toArray().map(round), gather_seconds: 18 },
      balcony: { nook_s: round(A.balcony.sNook), viewpoint_eye_three: A.balcony.eye.toArray().map(round6), viewpoint_eye_ue_cm: toUE(A.balcony.eye, new THREE.Quaternion(), v3(1, 1, 1)).location_cm, tolerance: { distance_m: 1.4, angle_deg: 12, aim_at_three: [g.centre.x, 13, g.centre.z] } },
      act2: { centre_three: A.act2.C.toArray().map(round), turntable_radius_m: A.act2.R, turntable_height_m: 0.35, pocket_radius_m: 3.5, range_s: A.act2.range.map(round) },
      act3: { start_s: round(A.act3.s0), end_s: round(A.act3.sEnd), glass_three: A.act3.glassPos.toArray().map(round), floor_mask_count: A.act3.maskCount },
    },
    giant: { centre_three: g.centre.toArray(), states: ['cloud', 'stand', 'crouch'], head_group: Object.values(g.pieces).filter((p) => p.part === 'head').map((p) => p.id), head_turn_deg_s: 14, head_turn_limit_deg: 80 },
    palettes: PALETTE,
    pieces: world.stage.pieces.map((pc) => ({
      id: pc.id, group: pc.group, kit: pc.kit, size_index: pc.sizeIdx, dims_m: pc.dims.map(round6), category: pc.cat, floating: pc.floating, collide: pc.collide,
      corridor: pc.slot ? { s: round(pc.slot.s), side: pc.slot.side > 0 ? 'outer' : 'inner', open_at_m: round(pc.slot.A), close_at_m: round(pc.slot.B), gate: pc.slot.gate } : undefined,
      drift: pc.drift ? { amplitude_m: round(pc.drift.a), turn_deg: round(pc.drift.r / D2R), period_s: round(2 * Math.PI / pc.drift.w) } : undefined,
      poses: Object.fromEntries(Object.entries(pc.poses).map(([k, p]) => [k, poseOut(pc, p)])),
    })),
  };
}
async function exportKit() {
  const exporter = new GLTFExporter(), out = {};
  for (const name of Object.keys(KIT_GEO)) { const mesh = new THREE.Mesh(KIT_GEO[name], new THREE.MeshStandardMaterial({ color: 0x808080 })); mesh.name = `DG_${name}`; out[name] = await exporter.parseAsync(mesh, { binary: true }); }
  { const plane = new THREE.Mesh(KIT.Plane, new THREE.MeshStandardMaterial({ color: 0x808080 })); plane.name = 'DG_Plane'; out.Plane = await exporter.parseAsync(plane, { binary: true }); }   // silhouettes: 1 x 1, pivot at the bottom edge
  const g = new THREE.Group(); g.name = 'DG_AxisMarker';
  for (const [len, axis] of [[1, 'x'], [0.6, 'y'], [0.3, 'z']]) { const s = { x: [len, 0.04, 0.04], y: [0.04, len, 0.04], z: [0.04, 0.04, len] }[axis]; const b = new THREE.Mesh(new THREE.BoxGeometry(...s), new THREE.MeshStandardMaterial({ color: 0xffffff })); b.name = `arm_${axis}`; b.position[axis] = len / 2; g.add(b); }
  out.AxisMarker = await exporter.parseAsync(g, { binary: true });
  const poses = {}; for (const p of [...Object.keys(POSE_SPECS), 'bust', 'hand']) poses[p] = poseTexture(p).userData.canvas.toDataURL('image/png');
  poses.marble = marbleTex.userData.canvas.toDataURL('image/png');
  return { glb: out, poses };
}
/** Top-down plan of the whole world (SVG) in a given scene state, for the level design document. */
function planSVG({ states = {}, size = 1400, extent = 160, focus = null, highlight = null, pocket = null } = {}) {
  const R = world.route, cx = focus ? focus.x : 0, cz = focus ? focus.z : 0, sc = size / (2 * extent);
  const X = (x) => ((x - cx) * sc + size / 2).toFixed(1), Z = (z) => ((z - cz) * sc + size / 2).toFixed(1);
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" fill="#f4f1ea"/>`];
  const path = []; for (let s = 0; s <= R.length; s += 1) { const p = R.at(s); path.push(`${X(p.x)},${Z(p.z)}`); }
  parts.push(`<polyline points="${path.join(' ')}" fill="none" stroke="#c9a35a" stroke-width="${Math.max(1.5, 0.5 * sc)}" stroke-dasharray="${6} ${5}" stroke-linecap="round"/>`);
  if (pocket) parts.push(`<circle cx="${X(pocket.x)}" cy="${Z(pocket.z)}" r="${pocket.r * sc}" fill="#e8d9b0" fill-opacity="0.5" stroke="#b08a40" stroke-dasharray="4 3"/>`);
  const col = { plum: '#3a2b3e', green: '#5f8f42', marble: '#9a9a9a', orb: '#151515', white: '#cfc9bd', eye: '#ffffff', table: '#3a2b3e' };
  for (const pc of world.stage.pieces) {
    const name = states[pc.group] || states[pc.id] || pc.pose || 'home', pose = pc.poses[name] || pc.poses.open || pc.poses.neutral || pc.poses.home || pc.poses.stand;
    if (!pose || pose.pos.y + pc.dims[1] < 0.3) continue;   // below the floor (a lowered lift)
    const fp = footprintAt(pc, pose), op = highlight ? (pc.group === highlight ? 0.95 : 0.18) : (pc.group === 'dressing' ? 0.35 : 0.9);
    if (pc.half > 0.05) parts.push(`<line x1="${X(fp.ax)}" y1="${Z(fp.az)}" x2="${X(fp.bx)}" y2="${Z(fp.bz)}" stroke="${col[pc.cat] || '#333'}" stroke-opacity="${op}" stroke-width="${Math.max(1, fp.r * 2 * sc)}" stroke-linecap="square"/>`);
    else parts.push(`<circle cx="${X(fp.ax)}" cy="${Z(fp.az)}" r="${Math.max(0.8, fp.r * sc)}" fill="${col[pc.cat] || '#333'}" fill-opacity="${op}"/>`);
  }
  return parts.join('') + '</svg>';
}

/* ---------- director ---------- */
const PARTS = ['opening', 'act1', 'balcony', 'act2', 'act3'];
let running = false, paused = false;
async function play(startAt) {
  running = true; world.audio.start(); world.hum.start();
  const A = world.acts, at = startAt === 'ending' ? 'act3' : (startAt === 'shadow' ? 'balcony' : startAt), idx = Math.max(0, PARTS.indexOf(at));
  for (let i = 0; i < idx; i++) A[PARTS[i]].skip();
  if (idx > 0) {
    world.atmo.set('neutral'); A[PARTS[idx]].placePlayer();
    const pr = world.route.project(world.player.pos.x, world.player.pos.z, world.route.length / 2, 1000, 1000);
    world.progress.s = pr.s; world.progress.cap = Math.max(world.progress.cap, pr.s + 1); world.corridor.enabled = true;
    for (const pc of world.corridor.pieces) { const { s, A: a, B } = pc.slot; pc.snap(s > pr.s + a ? 'ahead' : (s < pr.s - B ? 'behind' : 'open')); }
    world.ui.fade(0, 1.2);
  }
  for (let i = idx; i < PARTS.length; i++) {
    if (PARTS[i] === 'act3' && startAt === 'ending') { A.act3.skipToEnd(); await A.act3.run({ jumpToEnd: true }); }
    else await A[PARTS[i]].run();
  }
  running = false;
  document.getElementById('menu').classList.remove('hidden'); document.exitPointerLock?.();
  document.querySelector('#menu h2').textContent = 'THANK YOU FOR PLAYING THE GREYBOX';
}

const input = new Input(renderer.domElement);
input.on((type, e) => {
  if (!running) return;
  if (type === 'key') {
    if (e.code === 'Tab') world.masks.setPicking(!world.masks.picking);
    else if (MASK_KEY[e.code]) world.masks.wear(MASK_KEY[e.code]);
    else if (e.code === 'KeyE') world.interact?.();
    else if (e.code === 'Space' || e.code === 'Enter') world.ui.advance();
    else if (e.code === 'Backquote') toggleDebug();
  } else if (type === 'mouse') {
    if (e.button === 2) world.masks.remove();
    else if (e.button === 0) { world.ui.advance(); if (!world.masks.picking && document.pointerLockElement !== renderer.domElement) world.lockPointer(); }
  }
});
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  document.getElementById('crosshair').classList.toggle('hidden', !locked);
  if (!locked && running && !world.masks.picking && document.getElementById('choices').style.display !== 'flex' && !world.acts.act3.ended) { paused = true; document.getElementById('pause').classList.remove('hidden'); }
});
document.querySelectorAll('.screen button').forEach((b) => b.addEventListener('click', () => {
  const act = b.dataset.act;
  if (act === 'start') { document.getElementById('menu').classList.add('hidden'); world.lockPointer(); if (!running) play(START_AT); }
  if (act === 'continue') { paused = false; document.getElementById('pause').classList.add('hidden'); world.lockPointer(); }
  if (act === 'quit') location.href = location.pathname;
}));
function toggleDebug() {
  const d = document.getElementById('debug'); d.classList.toggle('hidden');
  if (!d.classList.contains('hidden') && !d.dataset.built) {
    d.dataset.built = 1;
    d.innerHTML = `<div>jump: ${['opening', 'act1', 'shadow', 'act2', 'act3', 'ending'].map((a) => `<button data-at="${a}">${a}</button>`).join('')}</div><div><button id="dbgExport">download layout.json</button> <button id="dbgCheck">check overlaps</button></div><div id="dbgPos"></div><div id="dbgCheckOut" style="max-width:420px;max-height:200px;overflow:auto"></div>`;
    d.querySelectorAll('[data-at]').forEach((b) => { b.onclick = () => { location.search = `?at=${b.dataset.at}`; }; });
    d.querySelector('#dbgExport').onclick = () => { const blob = new Blob([JSON.stringify(exportLayout(), null, 1)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'layout.json'; a.click(); };
    d.querySelector('#dbgCheck').onclick = () => { const r = checkAll(); d.querySelector('#dbgCheckOut').textContent = r.length ? r.join('\n') : 'no overlaps'; };
  }
}

/* ---------- frame loop ---------- */
let last = performance.now();
function frame(now) {
  const dt = Math.min(DT_MAX, (now - last) / 1000); last = now;
  if (!paused) {
    const time = sched.time, pl = world.player;
    sched.tick(dt); world.tweens.update(dt); world.atmo.update(dt);
    pl.update(dt, input);
    const pr = world.route.project(pl.pos.x, pl.pos.z, world.progress.s, 12, 25);
    world.progress.s = Math.max(world.progress.s, Math.min(pr.s, world.progress.cap));
    world.corridor.update();
    world.stage.update(dt, time);
    world.giant.update(dt, time);
    for (const a of Object.values(world.acts)) a.update(dt, time);
    world.lights.update(dt);
    world.mist.update(dt, pl.pos, scene.fog.color);
    world.crows.update(dt, time);
    world.hum.set(world.stage.activity / 500);
    keyLight.position.set(pl.pos.x - 34, 70, pl.pos.z + 22); keyLight.target.position.set(pl.pos.x, 0, pl.pos.z);
    fillLight.color.copy(world.atmo.cur.sky); fillLight.intensity = 0.32 * world.atmo.cur.hemi;
    world.masks.refresh(); world.ui.update();
    const mem = world.masks.memory;
    if (mem && mem.enabled && !mem.complete) { const h = mem.hint(); if (!world.ui.promptUntil && world.ui.promptText !== h) world.ui.prompt(h); }
    for (const f of world.onFrame) f(dt);
    if (params.has('motioncheck') && running) sampleMotion();
    const dbg = document.getElementById('dbgPos'); if (dbg && !document.getElementById('debug').classList.contains('hidden')) dbg.textContent = `pos ${pl.pos.x.toFixed(1)}, ${pl.pos.z.toFixed(1)}  s ${world.progress.s.toFixed(1)} / cap ${world.progress.cap.toFixed(1)}`;
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// boot
world.acts.opening.placePlayer();
loadMasks().then((models) => {
  world.maskModels = models; world.acts.opening.attachMasks(models); world.masks.hand.attach(models);
}).catch((e) => console.warn('masks not loaded', e)).finally(() => {
  document.getElementById('loading').classList.add('hidden');
  if (AUTOSTART) play(START_AT); else document.getElementById('menu').classList.remove('hidden');
});
requestAnimationFrame(frame);

// test / tooling hooks
window.DG = { world, exportLayout, exportKit, checkAll, motionStats, planSVG, play, SCRIPT };
