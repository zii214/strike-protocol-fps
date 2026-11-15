// Cinderyard — boot and the one loop. A fixed 60 Hz simulation (match, bots,
// player, projectiles) feeds rendering at the display's rate; the camera is
// synced from the player body after each step batch. This module wires the
// others together: it owns the renderer, the actor roster, the player's gun
// handling, and the deterministic ?shot= scenes the screenshots come from
// (?shot=cover|fight|plant|buy&seed=N poses a scene, renders it, freezes it
// and sets window.__shotReady).
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { G, PHASE, makeActor } from './state.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createBotMeshes, makeBrain, stepBot, separateBots, hearNoises, handleFlash } from './bots.js';
import { createLoadout, createGun, refreshHitList, setKillHandler, setFlashHandler, initWeaponFx, updateProjectiles } from './weapons.js';
import { createMatch, onKill as matchOnKill } from './match.js';
import { createViewmodel } from './weapons.js';
import { createHud } from './hud.js';
import { inSite } from './map.js';
import { segmentBlocked } from './physics.js';
import { COLLIDERS } from './map.js';
import * as sfx from './audio.js';

window.addEventListener('error', (e) => { document.title = `ERR: ${e.message}`; });

// A read-only window onto the state store, for automated playtests and for
// anyone poking at the game from the console. Nothing reads it back.
window.__cinderyard = { state: G };

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed * 7919 + 13);

// --- Renderer, scene, camera -------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 320);
camera.rotation.order = 'YXZ';
scene.add(camera);
const world = createWorld(scene);
initWeaponFx(scene);

// --- Actors ------------------------------------------------------------------
const playerActor = makeActor('ember', 'You', true);
G.player = playerActor;
const playerCtl = createPlayer(playerActor);
playerCtl.addToScene(scene);
playerActor.loadout = createLoadout();

const EMBER_BOTS = ['Vex', 'Onyx', 'Rook'];
const WATCH_BOTS = ['Hale', 'Moss', 'Ivers', 'Tarn'];
for (const name of EMBER_BOTS) {
  const bot = makeActor('ember', name, false);
  bot.ai = makeBrain('attack');
  bot.loadout = createLoadout();
  createBotMeshes(scene, bot);
}
for (const name of WATCH_BOTS) {
  const bot = makeActor('watch', name, false);
  bot.ai = makeBrain('defend');
  bot.loadout = createLoadout();
  createBotMeshes(scene, bot);
}
for (const a of G.actors) a.gun = createGun(a, random);
refreshHitList();

// --- Match, HUD, input --------------------------------------------------------
const match = createMatch(random, {
  placePlayer(spawn) {
    playerCtl.state.yaw = spawn.yaw;
    playerCtl.state.pitch = 0;
    playerCtl.state.recoilPitch = 0;
    playerCtl.state.recoilYaw = 0;
    playerCtl.syncProxy();
  },
});
setKillHandler(matchOnKill);
setFlashHandler((pos, radius) => {
  handleFlash(pos, radius);
  // The human is blinded when caught looking at the burst.
  const p = playerActor.body.pos;
  const d = Math.hypot(pos.x - p.x, pos.z - p.z);
  if (playerActor.alive && d < radius) {
    const eye = playerCtl.eye(new THREE.Vector3());
    if (!segmentBlocked(eye.x, eye.y, eye.z, pos.x, pos.y + 0.3, pos.z, COLLIDERS, null)) {
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const to = new THREE.Vector3(pos.x - eye.x, 0, pos.z - eye.z).normalize();
      if (d < 2.5 || dir.dot(to) > 0.2) hud.flash(Math.max(0.7, 2.6 - d * 0.12));
    }
  }
});

const hud = createHud();
const input = createInput(renderer.domElement, onLockChange);
let started = false;
let paused = false;

hud.onPlay = () => {
  sfx.initAudio();
  if (G.phase === PHASE.MATCH_END) match.start();
  input.requestLock();
};
hud.onBuy = (index) => {
  if (match.tryBuy(playerActor, index)) hud.frame(playerActor, playerActor.gun, 6);
};

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    paused = false;
    hud.hideOverlay();
  } else if (started && !G.over) {
    paused = true;
    hud.showOverlay('Paused', 'The yard waits. Click to jump back in.', 'Resume');
  }
}

// --- Player combat -------------------------------------------------------------
const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _right = new THREE.Vector3();
let prevFiring = false;
let lastPlayerHealth = 100;
let wasReloading = false;

function playerActions(dt) {
  const actor = playerActor;
  const gun = actor.gun;
  const pressed = input.takePressed();

  if (G.phase === PHASE.BUY) {
    for (let i = 0; i < 8; i++) {
      if (pressed.has(`Digit${i + 1}`)) match.tryBuy(actor, i);
    }
    return;
  }
  if (G.phase !== PHASE.LIVE && G.phase !== PHASE.PLANTED) return;

  // Weapon slots outside the buy phase: 1 primary, 2 sidearm, 3 knife,
  // 4 cycles grenades.
  if (pressed.has('Digit1') && actor.loadout.primary) gun.switchTo(actor.loadout.primary);
  if (pressed.has('Digit2')) gun.switchTo('wasp');
  if (pressed.has('Digit3')) gun.switchTo('knife');
  if (pressed.has('Digit4')) {
    const owned = Object.keys(actor.loadout.grenades).filter((k) => actor.loadout.grenades[k] > 0);
    if (owned.length) {
      const cur = actor.loadout.current.startsWith('grenade:') ? actor.loadout.current.slice(8) : null;
      const next = owned[(owned.indexOf(cur) + 1) % owned.length];
      gun.switchTo(`grenade:${next}`);
    }
  }
  if (pressed.has('KeyR')) gun.reload();
  match.setPlayerChannel(input.state.keys.has('KeyE'));

  if (!actor.alive) return;
  const firing = input.state.firing;
  const def = gun.def;
  playerCtl.eye(_eye);
  camera.getWorldDirection(_dir);

  if (actor.loadout.current.startsWith('grenade:')) {
    if (firing && !prevFiring) {
      _muzzle.copy(_eye).addScaledVector(_dir, 0.4);
      gun.throwGrenade(_muzzle, _dir, 13.5);
    }
  } else if (def && firing && (def.auto || !prevFiring)) {
    const speed = playerCtl.state.speed();
    // The shot leaves from the viewmodel's barrel tip, not the eye: forward,
    // right and down from the camera, so the tracer and flash sit on the gun.
    _right.setFromMatrixColumn(camera.matrixWorld, 0);
    _muzzle.copy(_eye).addScaledVector(_dir, 0.85).addScaledVector(_right, 0.2);
    _muzzle.y -= 0.16;
    const result = gun.fire(_muzzle, _dir, speed, {
      crouching: actor.body.crouching,
      grounded: actor.body.grounded,
      aiming: input.state.aiming,
    });
    if (result) {
      viewmodel.pullTrigger();
      playerCtl.addRecoil(def.recoil * (0.8 + random() * 0.5), (random() * 2 - 1) * def.recoil * 0.35);
      if (result.hitActor && result.hitActor.team !== actor.team) {
        hud.hitmarker(result.killed);
        sfx.hit(result.killed);
      }
      if (gun.ammo && gun.ammo.mag === 0) gun.reload();
    }
  }
  prevFiring = firing;
}

// --- Simulation step -----------------------------------------------------------
function step(dt) {
  match.step(dt);
  const phase = G.phase;
  playerActor.gun.update(dt);
  viewmodel.setWeapon(playerActor.loadout.current);
  viewmodel.setAiming(input.state.aiming && playerActor.alive);
  if (playerActor.gun.reloading && !wasReloading) viewmodel.reloadDip();
  wasReloading = playerActor.gun.reloading;
  viewmodel.step(dt, playerActor.alive ? playerCtl.state.speed() : 0, playerActor.body.grounded);

  if (phase === PHASE.LIVE || phase === PHASE.PLANTED) {
    playerActions(dt);
    if (playerActor.alive && !paused) playerCtl.step(dt, input.state.keys);
    for (const a of G.actors) if (a.ai) stepBot(a, dt, random);
    separateBots();
    hearNoises();
    updateProjectiles(dt);
  } else if (phase === PHASE.BUY) {
    playerActions(dt); // reads the buy keys itself
  } else if (phase === PHASE.END) {
    // Let the fallen finish falling.
    for (const a of G.actors) {
      if (a.ai && !a.alive && a.group && !a.group.userData.fell) stepBot(a, dt, random);
    }
    updateProjectiles(dt);
  }

  // Bomb prop: on the carrier's back, or on the ground where it lies.
  const bomb = G.bomb;
  if (bomb.state === 'carried' && bomb.carrier) {
    world.bomb.visible = true;
    world.bomb.position.set(bomb.carrier.body.pos.x, bomb.carrier.body.pos.y + 0.95, bomb.carrier.body.pos.z);
    world.bomb.rotation.y = bomb.carrier.yaw || 0;
  } else if (bomb.state === 'dropped' || bomb.state === 'planted' || bomb.state === 'defusing' || bomb.state === 'planting') {
    world.bomb.visible = true;
    const at = bomb.state === 'planting' && bomb.channelBy ? bomb.channelBy.body.pos : bomb.pos;
    world.bomb.position.set(at.x, at.y ?? 0, at.z);
    const urgency = bomb.state === 'planted' || bomb.state === 'defusing' ? Math.max(0.15, bomb.timer / BOMB_BLINK_FROM) : 1;
    world.bombLight.material.emissiveIntensity = (Math.sin(G.time * (6 / urgency)) > 0 ? 2.4 : 0.3);
  } else {
    world.bomb.visible = false;
  }

  // Hurt feedback.
  if (playerActor.health < lastPlayerHealth && playerActor.alive) {
    hud.damage();
    sfx.hurt();
  }
  lastPlayerHealth = playerActor.health;

  syncCamera();
}

const BOMB_BLINK_FROM = 40;

function syncCamera() {
  const body = playerActor.body;
  if (playerActor.alive) {
    playerCtl.eye(_eye);
    camera.position.copy(_eye);
    camera.rotation.set(playerCtl.state.pitch, playerCtl.state.yaw, 0);
  } else {
    camera.position.set(body.pos.x, body.pos.y + 0.4, body.pos.z);
    camera.rotation.set(-0.25, playerCtl.state.yaw, 0.5);
  }
  // Aim-down-sights: narrow the field of view, more for the DMR's scope.
  const def = playerActor.gun.def;
  const aiming = input.state.aiming && playerActor.alive && def && def.key !== 'knife';
  const targetFov = aiming ? 74 / (def.zoom ?? 1.35) : 74;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * 0.35;
    camera.updateProjectionMatrix();
  }
  viewmodel.group.visible = playerActor.alive;
}

const viewmodel = createViewmodel(camera);

// --- The loop ------------------------------------------------------------------
let accumulator = 0;
let lastTime = performance.now();
let frozen = false;
let matchEndShown = false;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    if (!shot) {
      const look = input.takeLook();
      if (input.state.locked) playerCtl.look(look.x, look.y);
    }
    if (!paused || shot) {
      accumulator += dt;
      let steps = 0;
      while (accumulator >= FIXED_STEP && steps < 5) {
        step(FIXED_STEP);
        accumulator -= FIXED_STEP;
        steps += 1;
      }
      if (accumulator > FIXED_STEP * 5) accumulator = 0;
    }
    const spread = playerActor.gun.def
      ? playerActor.gun.spreadFor(playerCtl.state.speed(), playerActor.body.crouching, playerActor.body.grounded, input.state.aiming)
      : 0;
    hud.frame(playerActor, playerActor.gun, 6 + spread * 900);
    if (G.phase === PHASE.MATCH_END && !matchEndShown) {
      matchEndShown = true;
      const emberWon = G.score.ember > G.score.watch;
      hud.showOverlay(
        emberWon ? 'Ember wins the match' : 'Watch wins the match',
        `Final score — Ember ${G.score.ember}, Watch ${G.score.watch}. Your line: ${playerActor.kills} kills, ${playerActor.deaths} deaths.`,
        'Play again',
      );
      if (document.pointerLockElement) document.exitPointerLock();
    }
    if (G.phase !== PHASE.MATCH_END) matchEndShown = false;
  }
  renderer.render(scene, camera);
}

// --- Shot scenes (deterministic screenshot poses) -------------------------------
function syncBotMesh(a) {
  if (!a.group) return;
  a.group.position.set(a.body.pos.x, a.body.pos.y, a.body.pos.z);
  a.group.rotation.set(0, a.yaw, 0);
  a.group.scale.y = a.body.crouching ? 0.76 : 1;
}

function place(a, x, z, yaw) {
  a.body.pos.x = x;
  a.body.pos.z = z;
  a.body.pos.y = 0;
  a.yaw = yaw;
  if (a.ai) a.ai.state = 'hold';
  syncBotMesh(a);
}

function aimPlayerAt(x, y, z) {
  playerCtl.eye(_eye);
  const dx = x - _eye.x;
  const dy = y - _eye.y;
  const dz = z - _eye.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  playerCtl.state.yaw = Math.atan2(-dx, -dz);
  playerCtl.state.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

function runShot(name) {
  hud.hideOverlay();
  match.start();
  const ember = G.actors.filter((a) => a.team === 'ember');
  const watch = G.actors.filter((a) => a.team === 'watch');
  const bots = Object.fromEntries(G.actors.map((a) => [a.name, a]));
  G.phase = PHASE.LIVE;
  G.phaseTime = 88;
  G.banner = null;
  playerActor.loadout.owned.meridian = true;
  playerActor.loadout.primary = 'meridian';
  playerActor.loadout.current = 'meridian';
  playerActor.armor = true;

  if (name === 'cover') {
    G.phaseTime = 96;
    place(playerActor, -5.5, 23, 0);
    place(bots.Vex, -4.2, 11, 0.15);
    place(bots.Onyx, 4.6, 9, -0.2);
    place(bots.Rook, -9.5, 17.5, 0.1);
    place(bots.Hale, -2, -14, Math.PI);
    place(bots.Moss, 4.5, -18.5, Math.PI - 0.3);
    place(bots.Ivers, -20, -18, 2.2);
    place(bots.Tarn, 21, -15, -2.4);
    G.bomb.carrier = bots.Vex;
    aimPlayerAt(-1, 1.3, -12);
  } else if (name === 'fight') {
    place(playerActor, -12.5, -15.5, 0);
    playerActor.health = 68;
    playerActor.loadout.ammo.meridian = { mag: 17, reserve: 75 };
    place(bots.Ivers, -19.5, -19, 2.35); // in the A pocket, facing the player
    place(bots.Hale, -24, -13.5, 2.8);
    place(bots.Vex, -9, -8, -0.5);
    place(bots.Onyx, -16, -24, 0.9);
    place(bots.Rook, 2, 6, 0);
    place(bots.Moss, 21, -16, -1.8);
    place(bots.Tarn, 10, -24, Math.PI);
    G.bomb.carrier = bots.Onyx;
    aimPlayerAt(-19.5, 1.35, -19);
    // One shot in flight: muzzle flash, tracer, hitmarker.
    scene.updateMatrixWorld(true);
    playerCtl.eye(_eye);
    camera.getWorldDirection(_dir);
    _right.setFromMatrixColumn(camera.matrixWorld, 0);
    _muzzle.copy(_eye).addScaledVector(_dir, 0.85).addScaledVector(_right, 0.2);
    _muzzle.y -= 0.16;
    playerActor.gun.fire(_muzzle, _dir, 0, { grounded: true });
    hud.hitmarker(false);
    viewmodel.pullTrigger();
  } else if (name === 'plant') {
    place(playerActor, 24, -9.6, 0);
    playerActor.loadout.ammo.meridian = { mag: 21, reserve: 54 };
    place(bots.Tarn, 22.6, -16.2, -0.7);
    bots.Tarn.body.crouching = true; // at the bomb, defusing
    place(bots.Moss, 17.5, -12.5, 0.9);
    place(bots.Vex, 19, -20.5, 2.6);
    place(bots.Onyx, -20, -18, 0);
    place(bots.Rook, -28, 4, 0);
    place(bots.Hale, -18, -22, 0);
    place(bots.Ivers, 0, -26, Math.PI);
    G.phase = PHASE.PLANTED;
    G.phaseTime = 23;
    G.bomb.state = 'defusing';
    G.bomb.site = 'B';
    G.bomb.pos = { x: 22, y: 0, z: -17 };
    G.bomb.timer = 23;
    G.bomb.channel = 2.6;
    G.bomb.channelBy = bots.Tarn;
    G.score.ember = 4;
    G.score.watch = 3;
    G.round = 8;
    aimPlayerAt(22.4, 1.0, -16.4);
  } else if (name === 'buy') {
    G.phase = PHASE.BUY;
    G.phaseTime = 12;
    playerActor.money = 3400;
    playerActor.loadout.grenades.frag = 1;
    place(playerActor, 0, 29, 0);
    aimPlayerAt(0, 1.3, 0);
  }

  for (const a of G.actors) syncBotMesh(a);
  playerCtl.syncProxy();
  viewmodel.setWeapon(playerActor.loadout.current);
  viewmodel.step(0.016, 0, true);
  syncCamera();
  hud.frame(playerActor, playerActor.gun, 7);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

match.start();
G.banner = null; // the start overlay carries the introduction instead
if (shot) runShot(shot);
else {
  hud.showOverlay(
    'Cinderyard',
    'A round-based tactical FPS in a dusk freight yard. Ember plants the bomb; Watch runs down the clock. First to 7 rounds. Stopping to aim pays — spread blooms on the move.',
    'Click to play',
  );
  requestAnimationFrame(frame);
}
