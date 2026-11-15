// Builds the yard in three.js from map.js's boxes. One material per surface
// kind, one merged-look set of box meshes (kept separate so the hitscan can
// name what it hit), dusk lighting from a low sun with shadows, painted site
// zones on the concrete, and a few dressing props — lamp poles, a gantry
// sign — that carry no collision. Every collider mesh is registered in
// map.js's SHOOTABLES so a bullet stops where the eye says it should.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { COLLIDERS, SHOOTABLES, SITES } from './map.js';

const MATERIALS = {
  wall: new THREE.MeshStandardMaterial({ color: '#4f463c', roughness: 0.95 }),
  hut: new THREE.MeshStandardMaterial({ color: PALETTE.concreteDark, roughness: 0.9 }),
  fence: new THREE.MeshStandardMaterial({ color: PALETTE.metal, roughness: 0.6, metalness: 0.5 }),
  crate: new THREE.MeshStandardMaterial({ color: '#7a6248', roughness: 0.85 }),
  rust: new THREE.MeshStandardMaterial({ color: PALETTE.rust, roughness: 0.8, metalness: 0.25 }),
  metal: new THREE.MeshStandardMaterial({ color: PALETTE.metal, roughness: 0.55, metalness: 0.5 }),
  sand: new THREE.MeshStandardMaterial({ color: '#b08c5a', roughness: 0.85 }),
};

const boxGeoCache = new Map();
function boxGeometry(w, h, d) {
  const key = `${w}|${h}|${d}`;
  let geo = boxGeoCache.get(key);
  if (!geo) {
    geo = new THREE.BoxGeometry(w, h, d);
    boxGeoCache.set(key, geo);
  }
  return geo;
}

// Container ribs: a slightly larger wireframe-ish edge box is too costly; a
// darker top face reads as a lid and is enough at a glance.
function addBox(scene, def) {
  const material = MATERIALS[def.color ?? def.kind] ?? MATERIALS.wall;
  const mesh = new THREE.Mesh(boxGeometry(def.w, def.h, def.d), material);
  mesh.position.set(def.cx, def.h / 2, def.cz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.collider = def;
  scene.add(mesh);
  SHOOTABLES.push(mesh);
  if (def.kind === 'container') {
    const lid = new THREE.Mesh(
      boxGeometry(def.w + 0.12, 0.1, def.d + 0.12),
      new THREE.MeshStandardMaterial({ color: PALETTE.hairline, roughness: 0.7, metalness: 0.4 }),
    );
    lid.position.set(def.cx, def.h + 0.05, def.cz);
    lid.castShadow = true;
    scene.add(lid);
  }
  return mesh;
}

function addGround(scene) {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(76, 76),
    new THREE.MeshStandardMaterial({ color: PALETTE.concrete, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.userData.ground = true;
  scene.add(ground);
  SHOOTABLES.push(ground);

  // Painted site zones: a flat ring and letter on the concrete.
  for (const site of Object.values(SITES)) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.r - 0.35, site.r, 40),
      new THREE.MeshBasicMaterial({ color: PALETTE.accent, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.cx, 0.02, site.cz);
    scene.add(ring);
  }

  // Lane paint: worn centre lines down mid and both alleys.
  const paint = new THREE.MeshBasicMaterial({ color: PALETTE.ink, transparent: true, opacity: 0.16 });
  for (const [x, z, w, d] of [[0, -2, 0.35, 52], [-29.5, 2, 0.35, 44], [29.5, 2, 0.35, 40]]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(w, d), paint);
    line.rotation.x = -Math.PI / 2;
    line.position.set(x, 0.015, z);
    scene.add(line);
  }
}

function addProps(scene) {
  // Lamp poles at the corners of mid and the sites: a pole, an arm, and a
  // glowing head. Point lights are too costly to scatter; the heads are
  // emissive and the sun does the lighting.
  const poleMat = new THREE.MeshStandardMaterial({ color: PALETTE.hairline, roughness: 0.6, metalness: 0.6 });
  const headMat = new THREE.MeshStandardMaterial({ color: PALETTE.accent, emissive: PALETTE.accent, emissiveIntensity: 1.6 });
  for (const [x, z] of [[-8, -22], [8, -22], [-8, 12], [8, 12], [-28, -28], [28, -26]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 5.4, 6), poleMat);
    pole.position.set(x, 2.7, z);
    pole.castShadow = true;
    scene.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.3), headMat);
    head.position.set(x, 5.45, z);
    scene.add(head);
  }
  // The yard gantry over mid's north end: two posts and a beam with the
  // yard's name-board (a plain amber slab — signage without lettering).
  const post = new THREE.BoxGeometry(0.4, 6, 0.4);
  for (const x of [-6, 6]) {
    const p = new THREE.Mesh(post, poleMat);
    p.position.set(x, 3, -24);
    p.castShadow = true;
    scene.add(p);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(12.4, 0.5, 0.4), poleMat);
  beam.position.set(0, 6, -24);
  scene.add(beam);
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(5.4, 1.1, 0.16),
    new THREE.MeshStandardMaterial({ color: PALETTE.rust, roughness: 0.7 }),
  );
  board.position.set(0, 5.2, -24);
  scene.add(board);
}

// A dusk sky dome: a big sphere, vertex-coloured from a rust horizon to a
// deep blue-brown zenith, drawn inside-out behind everything.
function addSky(scene) {
  const geo = new THREE.SphereGeometry(150, 28, 14);
  const colors = [];
  const pos = geo.attributes.position;
  const horizon = new THREE.Color('#7a4a28');
  const mid = new THREE.Color('#3d2f24');
  const zenith = new THREE.Color('#191d26');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, Math.min(1, pos.getY(i) / 150 * 0.5 + 0.5));
    if (t < 0.5) c.lerpColors(horizon, mid, t * 2);
    else c.lerpColors(mid, zenith, (t - 0.5) * 2);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  scene.add(sky);
}

export function createWorld(scene) {
  scene.background = new THREE.Color('#2c2119');
  scene.fog = new THREE.Fog(new THREE.Color('#4a3826'), 40, 130);
  addSky(scene);

  const hemi = new THREE.HemisphereLight(0xe8d3a8, 0x3a3128, 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffbe78, 2.5);
  sun.position.set(-28, 34, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -45;
  sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45;
  sun.shadow.camera.bottom = -45;
  sun.shadow.camera.far = 110;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x8fa8c8, 0.35);
  fill.position.set(24, 20, -26);
  scene.add(fill);

  addGround(scene);
  for (const def of COLLIDERS) addBox(scene, def);
  addProps(scene);

  // The bomb prop: a dark case with an amber light, shown when dropped or
  // planted. match.js moves it; it starts hidden.
  const bomb = new THREE.Group();
  const caseMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.18, 0.34),
    new THREE.MeshStandardMaterial({ color: '#22201c', roughness: 0.5, metalness: 0.3 }),
  );
  caseMesh.position.y = 0.09;
  bomb.add(caseMesh);
  const lightMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.05, 0.1),
    new THREE.MeshStandardMaterial({ color: PALETTE.danger, emissive: PALETTE.danger, emissiveIntensity: 2 }),
  );
  lightMesh.position.y = 0.21;
  bomb.add(lightMesh);
  bomb.visible = false;
  scene.add(bomb);

  return { bomb, bombLight: lightMesh };
}
