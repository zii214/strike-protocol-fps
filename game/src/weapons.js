// Weapons: definitions, the per-actor gun controller, hitscan shooting with
// body/head hit parts, and thrown grenades. One code path fires for the
// player and the bots — a shot is an origin, a direction and a spread, tested
// with a ray against the world's shootable meshes and every actor's hit
// boxes, so a head shot is a ray that struck the head box, whoever fired it.
//
// Accuracy is the game's spine: spread grows with the shooter's speed, with
// sustained fire, and in the air; crouching and standing still shrink it.
// Recoil kicks the view (player) or the aim point (bots) up and sideways.
import * as THREE from 'three';
import { G, pushFeed, pushNoise } from './state.js';
import { SHOOTABLES } from './map.js';
import { segmentBlocked } from './physics.js';
import { COLLIDERS } from './map.js';
import * as sfx from './audio.js';

const VIEWMODEL_AMBER = '#f59a23';

export const WEAPONS = {
  knife: { key: 'knife', name: 'Fang Knife', slot: 'knife', damage: 55, headMult: 1, rpm: 55, mag: 0, reserve: 0, reloadTime: 0, spread: 0, recoil: 0, range: 1.8, price: 0, auto: false, noise: 0 },
  wasp: { key: 'wasp', name: 'Wasp P9', slot: 'sidearm', damage: 26, headMult: 3, rpm: 380, mag: 12, reserve: 48, reloadTime: 1.5, spread: 0.010, recoil: 0.010, range: 60, price: 0, auto: false, noise: 20, falloffFrom: 16 },
  kestrel: { key: 'kestrel', name: 'Kestrel-9 SMG', slot: 'primary', damage: 22, headMult: 2.6, rpm: 750, mag: 30, reserve: 90, reloadTime: 2.1, spread: 0.020, recoil: 0.011, range: 55, price: 1000, auto: true, noise: 22, falloffFrom: 13 },
  boar: { key: 'boar', name: 'Boar-12', slot: 'primary', damage: 11, headMult: 2, rpm: 68, mag: 6, reserve: 24, reloadTime: 2.8, spread: 0.052, recoil: 0.05, range: 22, price: 1200, auto: false, noise: 24, pellets: 8, falloffFrom: 7 },
  meridian: { key: 'meridian', name: 'Meridian Rifle', slot: 'primary', damage: 34, headMult: 3, rpm: 600, mag: 25, reserve: 75, reloadTime: 2.4, spread: 0.013, recoil: 0.019, range: 80, price: 2700, auto: true, noise: 24, falloffFrom: 22 },
  longbow: { key: 'longbow', name: 'Longbow DMR', slot: 'primary', damage: 68, headMult: 2.2, rpm: 150, mag: 8, reserve: 32, reloadTime: 2.6, spread: 0.0035, recoil: 0.045, range: 110, price: 3100, auto: false, noise: 26, zoom: 2.1, falloffFrom: 34 },
};

export const GRENADES = {
  frag: { key: 'frag', name: 'Shard Grenade', price: 300, fuse: 1.7, radius: 5.6, damage: 92 },
  flash: { key: 'flash', name: 'Flash Charge', price: 200, fuse: 1.4, radius: 13 },
  smoke: { key: 'smoke', name: 'Smoke Canister', price: 250, fuse: 1.1, radius: 3.1, duration: 7 },
};

export const ARMOR_PRICE = 650;

// What the buy menu sells, in display order (keys 1-7 in match.js).
export const CATALOG = [
  { kind: 'weapon', key: 'kestrel' },
  { kind: 'weapon', key: 'boar' },
  { kind: 'weapon', key: 'meridian' },
  { kind: 'weapon', key: 'longbow' },
  { kind: 'grenade', key: 'frag' },
  { kind: 'grenade', key: 'smoke' },
  { kind: 'grenade', key: 'flash' },
  { kind: 'armor', key: 'armor' },
];

export function createLoadout() {
  const loadout = {
    owned: { knife: true, wasp: true }, // weapon keys the actor has bought
    primary: null, // owned primary key, or null
    current: 'wasp', // weapon key in hand ('knife', a gun key) or 'grenade:<key>'
    ammo: {}, // key -> {mag, reserve}
    grenades: { frag: 0, flash: 0, smoke: 0 },
  };
  for (const key of Object.keys(WEAPONS)) {
    loadout.ammo[key] = { mag: WEAPONS[key].mag, reserve: WEAPONS[key].reserve };
  }
  return loadout;
}

export function currentDef(loadout) {
  if (loadout.current.startsWith('grenade:')) return null;
  return WEAPONS[loadout.current];
}

// ---------------------------------------------------------------------------
// Hit testing

const raycaster = new THREE.Raycaster();
const hitList = []; // rebuilt by refreshHitList: world meshes + actor boxes

export function refreshHitList() {
  hitList.length = 0;
  for (const m of SHOOTABLES) hitList.push(m);
  for (const a of G.actors) for (const m of a.hitMeshes) hitList.push(m);
}

const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();

// Damage with armour and falloff applied. Returns true when the target died.
let killHandler = null;
export function setKillHandler(fn) { killHandler = fn; }

export function applyDamage(target, amount, attacker, part) {
  if (!target.alive || G.phase === 'buy' || G.phase === 'end' || G.phase === 'match-end') return false;
  let dmg = amount;
  if (target.armor) dmg *= part === 'head' ? 0.7 : 0.55;
  target.health -= dmg;
  target.lastDamageFrom = attacker;
  target.lastDamageAt = G.time;
  if (target.health <= 0) {
    target.health = 0;
    target.alive = false;
    if (attacker && attacker !== target) {
      attacker.kills += 1;
      attacker.money += 300;
    }
    target.deaths += 1;
    pushFeed(`${attacker ? attacker.name : '—'} ▸ ${target.name}${part === 'head' ? ' (headshot)' : ''}`);
    if (killHandler) killHandler(target, attacker);
    return true;
  }
  return false;
}

function falloff(def, distance) {
  if (!def.falloffFrom || distance <= def.falloffFrom) return 1;
  return Math.max(0.4, 1 - (distance - def.falloffFrom) * 0.011);
}

// Fire one round (or one pellet) for an actor. spreadRad is the shooter's
// total inaccuracy this shot. Returns {hitActor, part, killed, point}.
export function fireRound(shooter, origin, dir, def, spreadRad, random) {
  _dir.copy(dir);
  if (spreadRad > 0) {
    _dir.x += (random() * 2 - 1) * spreadRad;
    _dir.y += (random() * 2 - 1) * spreadRad;
    _dir.z += (random() * 2 - 1) * spreadRad;
    _dir.normalize();
  }
  _origin.copy(origin);
  raycaster.set(_origin, _dir);
  raycaster.far = def.range;
  const hits = raycaster.intersectObjects(hitList, false);
  for (const hit of hits) {
    const ud = hit.object.userData;
    if (ud.actor === shooter) continue; // never shoot yourself
    if (ud.actor && !ud.actor.alive) continue;
    if (ud.ground && hit.point.y > 0.05) continue;
    effects.impact(hit.point, ud.actor ? 'flesh' : 'world');
    if (ud.actor) {
      const dmg = def.damage * (ud.part === 'head' ? def.headMult : 1) * falloff(def, hit.distance);
      const killed = applyDamage(ud.actor, dmg, shooter, ud.part);
      return { hitActor: ud.actor, part: ud.part, killed, point: hit.point };
    }
    return { hitActor: null, part: null, killed: false, point: hit.point };
  }
  return { hitActor: null, part: null, killed: false, point: null };
}

// ---------------------------------------------------------------------------
// The gun controller: timing, magazines, reloading, switching, grenades.

export function createGun(actor, random) {
  const gun = {
    actor,
    // Read the loadout through the actor every time: match.js replaces an
    // actor's loadout object on death and at match start.
    get loadout() { return actor.loadout; },
    nextShotAt: 0,
    reloadEndsAt: -1,
    heat: 0, // sustained-fire spread growth, 0..1
    lastShotAt: -9,

    get def() { return currentDef(this.loadout); },
    get reloading() { return this.reloadEndsAt > G.time; },
    get ammo() { const d = this.def; return d ? this.loadout.ammo[d.key] : null; },

    update(dt) {
      this.heat = Math.max(0, this.heat - dt * 1.6);
      if (this.reloadEndsAt > 0 && G.time >= this.reloadEndsAt) {
        const ammo = this.ammo;
        const def = this.def;
        if (ammo && def) {
          const take = Math.min(def.mag - ammo.mag, ammo.reserve);
          ammo.mag += take;
          ammo.reserve -= take;
        }
        this.reloadEndsAt = -1;
      }
    },

    reload() {
      const def = this.def;
      if (!def || def.mag === 0 || this.reloading) return;
      const ammo = this.ammo;
      if (ammo.mag >= def.mag || ammo.reserve <= 0) return;
      this.reloadEndsAt = G.time + def.reloadTime;
      sfx.reload(actor.isPlayer);
    },

    switchTo(key) {
      if (key === this.loadout.current) return;
      if (key.startsWith('grenade:')) {
        const g = key.slice(8);
        if (this.loadout.grenades[g] <= 0) return;
      } else if (!this.loadout.owned[key]) return;
      this.loadout.current = key;
      this.reloadEndsAt = -1;
      this.nextShotAt = Math.max(this.nextShotAt, G.time + 0.28); // draw time
    },

    // Total spread for a shot right now, given the shooter's speed.
    spreadFor(speed, crouching, grounded, aiming) {
      const def = this.def;
      if (!def) return 0;
      let s = def.spread;
      s *= 1 + this.heat * 1.8;
      s *= 1 + Math.min(speed / 4.6, 1) * 2.4; // moving is the big sin
      if (!grounded) s *= 3.2;
      if (crouching) s *= 0.72;
      if (aiming) s *= 0.55;
      return s;
    },

    // Attempt to fire. origin/dir are the muzzle ray; returns fireRound's
    // result, or null when the gun could not fire (timing, empty, reloading).
    fire(origin, dir, speed, opts = {}) {
      const def = this.def;
      if (!def || this.reloading || G.time < this.nextShotAt) return null;
      if (def.key === 'knife') {
        this.nextShotAt = G.time + 60 / def.rpm;
        sfx.swing();
        return fireRound(this.actor, origin, dir, def, 0, random);
      }
      const ammo = this.ammo;
      if (ammo.mag <= 0) {
        this.nextShotAt = G.time + 0.3;
        sfx.empty(this.actor.isPlayer);
        return null;
      }
      ammo.mag -= 1;
      this.nextShotAt = G.time + 60 / def.rpm;
      this.lastShotAt = G.time;
      this.heat = Math.min(1, this.heat + 0.16);
      const spread = this.spreadFor(speed, opts.crouching, opts.grounded !== false, opts.aiming);
      let result = null;
      const pellets = def.pellets ?? 1;
      for (let i = 0; i < pellets; i++) {
        const r = fireRound(this.actor, origin, dir, def, spread, random);
        if (r.hitActor) result = r;
      }
      if (def.noise) pushNoise(origin.x, origin.z, def.noise, this.actor.team);
      sfx.shot(def.key, this.actor.isPlayer);
      effects.tracer(origin, result?.point ?? null, dir, def);
      effects.muzzle(origin, dir);
      return result ?? { hitActor: null, part: null, killed: false, point: null };
    },

    throwGrenade(origin, dir, power) {
      const cur = this.loadout.current;
      if (!cur.startsWith('grenade:')) return false;
      const key = cur.slice(8);
      if (this.loadout.grenades[key] <= 0 || G.time < this.nextShotAt) return false;
      this.loadout.grenades[key] -= 1;
      this.nextShotAt = G.time + 0.7;
      projectiles.throw(key, this.actor, origin, dir, power);
      sfx.throwIt();
      this.switchTo(this.loadout.primary ?? 'wasp');
      return true;
    },
  };
  return gun;
}

// ---------------------------------------------------------------------------
// Grenade projectiles and area effects. A small fixed pool of meshes; the
// simulation is a list of live rounds with velocity, gravity and one bounce.

const projectiles = {
  live: [],
  pool: [],
  scene: null,
  init(scene) {
    this.scene = scene;
    const geo = new THREE.SphereGeometry(0.07, 10, 8);
    const mats = {
      frag: new THREE.MeshStandardMaterial({ color: '#3d4436', roughness: 0.5 }),
      flash: new THREE.MeshStandardMaterial({ color: '#c8c2b4', roughness: 0.4 }),
      smoke: new THREE.MeshStandardMaterial({ color: '#6a6f72', roughness: 0.6 }),
    };
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(geo, mats.frag);
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({ mesh, mats });
    }
  },
  throw(key, owner, origin, dir, power) {
    const slot = this.pool.find((p) => !p.mesh.visible) ?? this.pool[0];
    slot.mesh.material = slot.mats[key];
    slot.mesh.position.copy(origin);
    slot.mesh.visible = true;
    this.live.push({
      key, owner, slot,
      pos: origin.clone(),
      vel: new THREE.Vector3(dir.x * power, dir.y * power + 2.2, dir.z * power),
      fuse: GRENADES[key].fuse,
    });
  },
  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.fuse -= dt;
      p.vel.y -= 14 * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.07) { // bounce once, then roll dead
        p.pos.y = 0.07;
        p.vel.y = Math.abs(p.vel.y) * 0.35;
        p.vel.x *= 0.6;
        p.vel.z *= 0.6;
      }
      p.slot.mesh.position.copy(p.pos);
      if (p.fuse <= 0) {
        this.live.splice(i, 1);
        p.slot.mesh.visible = false;
        detonate(p);
      }
    }
  },
};

function detonate(p) {
  const def = GRENADES[p.key];
  if (p.key === 'frag') {
    sfx.explosion();
    effects.boom(p.pos);
    for (const a of G.actors) {
      if (!a.alive) continue;
      const dx = a.body.pos.x - p.pos.x;
      const dy = a.body.pos.y + 0.9 - p.pos.y;
      const dz = a.body.pos.z - p.pos.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > def.radius) continue;
      let dmg = def.damage * (1 - dist / def.radius) + 8;
      if (segmentBlocked(p.pos.x, p.pos.y + 0.2, p.pos.z, a.body.pos.x, a.body.pos.y + 0.9, a.body.pos.z, COLLIDERS, null)) dmg *= 0.4;
      applyDamage(a, dmg, p.owner, 'body');
    }
    pushNoise(p.pos.x, p.pos.z, 30, p.owner.team);
  } else if (p.key === 'flash') {
    sfx.flash();
    effects.boom(p.pos, true);
    flashHandler?.(p.pos, def.radius);
  } else if (p.key === 'smoke') {
    sfx.smokePop();
    G.smokes.push({ x: p.pos.x, y: 1.1, z: p.pos.z, r: def.radius, until: G.time + def.duration });
    effects.smokeCloud(p.pos, def.radius, def.duration);
  }
}

let flashHandler = null;
export function setFlashHandler(fn) { flashHandler = fn; }

export function updateProjectiles(dt) {
  projectiles.update(dt);
  effects.update(dt);
  // Expire smoke clouds from the sight-line list.
  for (let i = G.smokes.length - 1; i >= 0; i--) {
    if (G.time >= G.smokes[i].until) G.smokes.splice(i, 1);
  }
}

// ---------------------------------------------------------------------------
// Effects: tracers, muzzle flash, impacts, explosions, smoke clouds. All
// pooled meshes with lifetimes; nothing is allocated per frame.

const effects = {
  scene: null,
  tracers: [],
  flashes: [],
  puffs: [],
  clouds: [],
  init(scene) {
    this.scene = scene;
    const tracerMat = new THREE.LineBasicMaterial({ color: 0xffcf7a, transparent: true, opacity: 0.75 });
    for (let i = 0; i < 24; i++) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(geo, tracerMat);
      line.visible = false;
      scene.add(line);
      this.tracers.push({ line, until: 0 });
    }
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffb84d, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.19), flashMat);
      m.visible = false;
      scene.add(m);
      this.flashes.push({ mesh: m, until: 0 });
    }
    const puffMat = new THREE.MeshBasicMaterial({ color: 0xcfc4ae, transparent: true, opacity: 0.55, depthWrite: false });
    for (let i = 0; i < 20; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), puffMat);
      m.visible = false;
      scene.add(m);
      this.puffs.push({ mesh: m, until: 0, grow: 1 });
    }
  },
  tracer(origin, point, dir, def) {
    const end = point ?? new THREE.Vector3(origin.x + dir.x * def.range, origin.y + dir.y * def.range, origin.z + dir.z * def.range);
    const slot = this.tracers.find((t) => !t.line.visible) ?? this.tracers[0];
    const pos = slot.line.geometry.attributes.position;
    pos.setXYZ(0, origin.x, origin.y, origin.z);
    pos.setXYZ(1, end.x, end.y, end.z);
    pos.needsUpdate = true;
    slot.line.visible = true;
    slot.until = G.time + 0.05;
  },
  muzzle(origin, dir) {
    const slot = this.flashes.find((f) => !f.mesh.visible) ?? this.flashes[0];
    slot.mesh.position.set(origin.x + dir.x * 0.3, origin.y + dir.y * 0.3, origin.z + dir.z * 0.3);
    slot.mesh.lookAt(origin.x + dir.x, origin.y + dir.y, origin.z + dir.z);
    slot.mesh.visible = true;
    slot.until = G.time + 0.045;
  },
  impact(point, kind) {
    const slot = this.puffs.find((p) => !p.mesh.visible) ?? this.puffs[0];
    slot.mesh.position.copy(point);
    slot.mesh.scale.setScalar(kind === 'flesh' ? 0.7 : 1);
    slot.mesh.visible = true;
    slot.until = G.time + 0.16;
  },
  boom(pos, isFlash = false) {
    const slot = this.puffs.find((p) => !p.mesh.visible) ?? this.puffs[0];
    slot.mesh.position.copy(pos).y += 0.3;
    slot.mesh.scale.setScalar(isFlash ? 5 : 8);
    slot.mesh.visible = true;
    slot.until = G.time + (isFlash ? 0.12 : 0.3);
  },
  smokeCloud(pos, r, duration) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(r, 14, 10),
      new THREE.MeshStandardMaterial({ color: 0x9aa0a2, transparent: true, opacity: 0.82, roughness: 1, depthWrite: false }),
    );
    mesh.position.set(pos.x, 1.1, pos.z);
    this.scene.add(mesh);
    this.clouds.push({ mesh, until: G.time + duration });
  },
  update(dt) {
    for (const t of this.tracers) if (t.line.visible && G.time >= t.until) t.line.visible = false;
    for (const f of this.flashes) if (f.mesh.visible && G.time >= f.until) f.mesh.visible = false;
    for (const p of this.puffs) if (p.mesh.visible && G.time >= p.until) p.mesh.visible = false;
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      if (G.time >= this.clouds[i].until) {
        this.scene.remove(this.clouds[i].mesh);
        this.clouds[i].mesh.geometry.dispose();
        this.clouds[i].mesh.material.dispose();
        this.clouds.splice(i, 1);
      }
    }
  },
};

export function initWeaponFx(scene) {
  effects.init(scene);
  projectiles.init(scene);
}

// Viewmodel: the held weapon, built from boxes per weapon key, parented to
// the camera. Kicks on fire, dips on reload, bobs with movement.
export function createViewmodel(camera) {
  const group = new THREE.Group();
  group.position.set(0.24, -0.22, -0.45);
  camera.add(group);
  const mats = {
    body: new THREE.MeshStandardMaterial({ color: '#2e2c28', roughness: 0.45, metalness: 0.55 }),
    grip: new THREE.MeshStandardMaterial({ color: '#4a3b2a', roughness: 0.8 }),
    amber: new THREE.MeshStandardMaterial({ color: VIEWMODEL_AMBER, roughness: 0.5 }),
  };
  const parts = {};
  function build(key, builder) {
    const g = new THREE.Group();
    builder(g);
    g.visible = false;
    group.add(g);
    parts[key] = g;
  }
  const box = (g, w, h, d, x, y, z, mat = mats.body) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  build('wasp', (g) => {
    box(g, 0.055, 0.09, 0.24, 0, 0, -0.05);
    box(g, 0.05, 0.11, 0.06, 0, -0.08, 0.05, mats.grip);
  });
  build('kestrel', (g) => {
    box(g, 0.06, 0.1, 0.44, 0, 0, -0.12);
    box(g, 0.045, 0.16, 0.05, 0, -0.11, -0.02, mats.grip);
    box(g, 0.05, 0.1, 0.07, 0, -0.07, 0.1, mats.grip);
    box(g, 0.02, 0.05, 0.02, 0, 0.07, -0.3, mats.amber);
  });
  build('boar', (g) => {
    box(g, 0.07, 0.09, 0.52, 0, 0, -0.16);
    box(g, 0.06, 0.07, 0.2, 0, -0.055, -0.14, mats.grip);
    box(g, 0.05, 0.11, 0.06, 0, -0.08, 0.12, mats.grip);
  });
  build('meridian', (g) => {
    box(g, 0.06, 0.11, 0.56, 0, 0, -0.18);
    box(g, 0.045, 0.17, 0.05, 0, -0.12, 0.0, mats.grip);
    box(g, 0.05, 0.1, 0.07, 0, -0.07, 0.16, mats.grip);
    box(g, 0.025, 0.06, 0.025, 0, 0.085, -0.34, mats.amber);
    box(g, 0.03, 0.03, 0.14, 0, 0.02, -0.5);
  });
  build('longbow', (g) => {
    box(g, 0.055, 0.1, 0.72, 0, 0, -0.26);
    box(g, 0.045, 0.15, 0.05, 0, -0.11, 0.02, mats.grip);
    box(g, 0.06, 0.09, 0.16, 0, -0.05, 0.2, mats.grip);
    box(g, 0.045, 0.07, 0.18, 0, 0.1, -0.1); // scope
  });
  build('knife', (g) => {
    const blade = box(g, 0.015, 0.05, 0.3, 0, 0.02, -0.18, mats.amber);
    blade.material = new THREE.MeshStandardMaterial({ color: '#c9ccd2', roughness: 0.25, metalness: 0.85 });
    box(g, 0.04, 0.05, 0.1, 0, -0.02, 0.02, mats.grip);
  });
  build('grenade', (g) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), mats.grip);
    m.position.set(0, 0, -0.08);
    g.add(m);
  });

  let current = null;
  let kick = 0;
  let dip = 0;
  let bobT = 0;
  let aimT = 0;
  let aiming = false;
  return {
    group,
    setWeapon(key) {
      const name = key.startsWith('grenade:') ? 'grenade' : key;
      if (current === name) return;
      current = name;
      for (const [k, g] of Object.entries(parts)) g.visible = k === name;
    },
    setAiming(on) { aiming = on; },
    pullTrigger() { kick = 1; },
    reloadDip() { dip = 1; },
    step(dt, speed, grounded) {
      kick = Math.max(0, kick - dt * 9);
      dip = Math.max(0, dip - dt * 2.4);
      aimT += ((aiming ? 1 : 0) - aimT) * Math.min(1, dt * 11);
      bobT += dt * (2 + speed * 1.6);
      const bob = grounded ? Math.min(speed / 5, 1) * 0.012 * (1 - aimT) : 0;
      // Hip position (low right) blends to the centred sight picture.
      const px = 0.24 * (1 - aimT);
      const py = -0.22 + 0.057 * aimT;
      const pz = -0.45 + 0.13 * aimT;
      group.position.set(
        px + Math.sin(bobT) * bob,
        py + Math.abs(Math.cos(bobT)) * bob - dip * 0.13,
        pz + kick * 0.06,
      );
      group.rotation.x = kick * 0.09 + dip * 0.5;
    },
  };
}
