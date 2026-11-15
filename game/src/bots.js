// Bots: the other seven combatants. Each is a low-poly figure (legs, torso,
// head — separate hit boxes, team-coloured torso) driven by a small brain:
//
//   route      follow the waypoint graph toward an objective node
//   hold       stay on a post, watch a lane, engage what appears
//   engage     an enemy is seen: stop, aim, fire bursts, reposition
//   investigate  a shot was heard: move to the noise and look
//   plant/defuse  stand on the spot; match.js runs the channel
//
// Perception is honest: a bot sees an enemy only inside its view cone, in
// range, with a clear sight line (smoke blocks it), checked on a stagger;
// it hears gunfire as noise events. Reaction time, burst discipline and aim
// error keep fights fair — and a bot that stops to shoot is far more
// accurate than one firing on the move, like the player.
import * as THREE from 'three';
import { G } from './state.js';
import { TEAM_COLORS } from './palette.js';
import { makeBody, moveBody, accelerate, groundSpeed, eyeHeight, segmentBlocked } from './physics.js';
import { COLLIDERS, NODES, nearestNode, route } from './map.js';

const WALK = 4.3;
const ACCEL = 40;
const VIEW_DIST = 48;
const VIEW_COS = Math.cos(1.0); // ~57° half-angle

const _eye = new THREE.Vector3();
const _chest = new THREE.Vector3();

export function createBotMeshes(scene, actor) {
  const teamColor = new THREE.MeshStandardMaterial({ color: TEAM_COLORS[actor.team], roughness: 0.7 });
  const cloth = new THREE.MeshStandardMaterial({ color: '#3a3733', roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: '#c9a184', roughness: 0.8 });
  const group = new THREE.Group();

  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.78, 0.32), cloth);
  legs.position.y = 0.39;
  legs.userData = { actor, part: 'body' };
  group.add(legs);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.36), teamColor);
  torso.position.y = 1.09;
  torso.castShadow = true;
  torso.userData = { actor, part: 'body' };
  group.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), skin);
  head.position.y = 1.58;
  head.castShadow = true;
  head.userData = { actor, part: 'head' };
  group.add(head);
  const gunMesh = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.62), cloth);
  gunMesh.position.set(0.18, 1.12, -0.3);
  group.add(gunMesh);

  scene.add(group);
  actor.group = group;
  actor.hitMeshes = [legs, torso, head];
  actor.body = makeBody(0, 0);
  return actor;
}

export function makeBrain(role) {
  return {
    role, // 'attack' | 'defend'
    state: 'route',
    path: [], // node ids left to visit
    goalPos: null, // exact final position {x, z} after the path
    holdYaw: 0,
    target: null,
    lastSeenAt: -9,
    lastSeenPos: { x: 0, z: 0 },
    engageSince: -9,
    nextThinkAt: 0,
    burstLeft: 0,
    burstWaitUntil: 0,
    blindUntil: -9,
    alertPos: null,
    threwSmoke: false,
    threwFrag: false,
    lastPos: { x: 0, z: 0 },
    stuckFor: 0,
  };
}

// Plan a route to a node (or an exact position via its nearest node).
export function sendTo(actor, nodeId, goalPos = null) {
  const ai = actor.ai;
  const from = nearestNode(actor.body.pos.x, actor.body.pos.z);
  ai.path = route(from, nodeId).slice(1);
  ai.goalPos = goalPos;
  ai.state = 'route';
}

function eyeOf(actor, out) {
  out.set(actor.body.pos.x, actor.body.pos.y + eyeHeight(actor.body), actor.body.pos.z);
  return out;
}

function canSee(bot, other) {
  const dx = other.body.pos.x - bot.body.pos.x;
  const dz = other.body.pos.z - bot.body.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist > VIEW_DIST) return false;
  if (dist > 7) {
    const fx = -Math.sin(bot.yaw);
    const fz = -Math.cos(bot.yaw);
    if ((dx * fx + dz * fz) / (dist || 1) < VIEW_COS) return false;
  }
  eyeOf(bot, _eye);
  _chest.set(other.body.pos.x, other.body.pos.y + 1.15, other.body.pos.z);
  return !segmentBlocked(_eye.x, _eye.y, _eye.z, _chest.x, _chest.y, _chest.z, COLLIDERS, G.smokes);
}

function perceive(bot) {
  const ai = bot.ai;
  let best = null;
  let bestDist = Infinity;
  for (const other of G.actors) {
    if (!other.alive || other.team === bot.team) continue;
    const d = Math.hypot(other.body.pos.x - bot.body.pos.x, other.body.pos.z - bot.body.pos.z);
    if (d < bestDist && canSee(bot, other)) {
      best = other;
      bestDist = d;
    }
  }
  if (best) {
    if (ai.target !== best) ai.engageSince = G.time;
    ai.target = best;
    ai.lastSeenAt = G.time;
    ai.lastSeenPos = { x: best.body.pos.x, z: best.body.pos.z };
    ai.alertPos = null;
  }
}

// Gunfire the bot hears: the nearest noise an enemy made within earshot.
export function hearNoises() {
  for (const noise of G.noises) {
    for (const bot of G.actors) {
      if (!bot.ai || !bot.alive || bot.team === noise.team) continue;
      const d = Math.hypot(bot.body.pos.x - noise.x, bot.body.pos.z - noise.z);
      if (d < noise.radius && G.time - bot.ai.lastSeenAt > 1.2) {
        bot.ai.alertPos = { x: noise.x, z: noise.z };
      }
    }
  }
  G.noises.length = 0;
}

// Flash charges: bots caught looking at the burst are blinded.
export function handleFlash(pos, radius) {
  for (const bot of G.actors) {
    if (!bot.ai || !bot.alive) continue;
    const dx = pos.x - bot.body.pos.x;
    const dz = pos.z - bot.body.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > radius) continue;
    eyeOf(bot, _eye);
    if (segmentBlocked(_eye.x, _eye.y, _eye.z, pos.x, pos.y + 0.3, pos.z, COLLIDERS, null)) continue;
    const fx = -Math.sin(bot.yaw);
    const fz = -Math.cos(bot.yaw);
    const facing = dist < 2.5 || (dx * fx + dz * fz) / (dist || 1) > 0.15;
    if (facing) bot.ai.blindUntil = G.time + Math.max(0.8, 3.4 - dist * 0.16);
  }
}

const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();

function faceToward(bot, x, z, dt, rate = 10) {
  const want = Math.atan2(-(x - bot.body.pos.x), -(z - bot.body.pos.z));
  let diff = want - bot.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  bot.yaw += Math.max(-rate * dt, Math.min(rate * dt, diff));
}

function moveToward(bot, x, z, dt, speedScale = 1) {
  const dx = x - bot.body.pos.x;
  const dz = z - bot.body.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.05) return true;
  accelerate(bot.body, dx / dist, dz / dist, WALK * speedScale, ACCEL, dt);
  faceToward(bot, x, z, dt);
  return dist < 0.7;
}

function engage(bot, dt, random) {
  const ai = bot.ai;
  const target = ai.target;
  const seenNow = target && target.alive && G.time - ai.lastSeenAt < 0.35;
  if (!target || !target.alive || G.time - ai.lastSeenAt > 2.2) {
    ai.target = null;
    ai.state = ai.alertPos ? 'investigate' : (ai.path.length || ai.goalPos ? 'route' : 'hold');
    return;
  }
  const dx = target.body.pos.x - bot.body.pos.x;
  const dz = target.body.pos.z - bot.body.pos.z;
  const dist = Math.hypot(dx, dz);
  faceToward(bot, target.body.pos.x, target.body.pos.z, dt, 14);

  // Movement: close a long gap, hold a good range, back off from a knife's
  // reach. While a burst is being fired the bot plants its feet.
  const firing = ai.burstLeft > 0 && seenNow;
  if (!firing) {
    if (dist > 30) moveToward(bot, target.body.pos.x, target.body.pos.z, dt, 1);
    else if (dist < 4) moveToward(bot, bot.body.pos.x - dx, bot.body.pos.z - dz, dt, 0.7);
    else accelerate(bot.body, 0, 0, 0, ACCEL, dt);
  } else {
    accelerate(bot.body, 0, 0, 0, ACCEL, dt);
  }

  if (!seenNow) return;
  // Burst discipline: reaction time first, then bursts with pauses.
  if (G.time - ai.engageSince < 0.32) return;
  if (ai.burstLeft <= 0) {
    if (G.time < ai.burstWaitUntil) return;
    ai.burstLeft = 3 + Math.floor(random() * 3);
  }
  const gun = bot.gun;
  if (gun.reloading) return;
  if (gun.ammo && gun.ammo.mag <= 0) { gun.reload(); ai.burstLeft = 0; return; }
  eyeOf(bot, _origin);
  const aimY = target.body.pos.y + (random() < 0.22 ? 1.52 : 1.12);
  _dir.set(target.body.pos.x - _origin.x, aimY - _origin.y, target.body.pos.z - _origin.z).normalize();
  // Aim error: worse against a moving target, worse at range.
  const err = 0.016 + Math.min(groundSpeed(target.body) / 5, 1) * 0.03 + dist * 0.0004;
  _dir.x += (random() * 2 - 1) * err;
  _dir.y += (random() * 2 - 1) * err * 0.7;
  _dir.normalize();
  const result = gun.fire(_origin, _dir, groundSpeed(bot.body), { crouching: bot.body.crouching, grounded: bot.body.grounded });
  if (result) {
    ai.burstLeft -= 1;
    if (ai.burstLeft <= 0) ai.burstWaitUntil = G.time + 0.35 + random() * 0.4;
  }
}

export function stepBot(bot, dt, random) {
  const ai = bot.ai;
  const body = bot.body;
  if (!bot.alive) {
    if (bot.group && !bot.group.userData.fell) {
      bot.group.userData.fell = true;
      bot.group.rotation.x = -Math.PI / 2;
      bot.group.position.y = 0.25;
    }
    return;
  }
  if (G.time >= ai.nextThinkAt) {
    ai.nextThinkAt = G.time + 0.12;
    perceive(bot);
  }

  const blinded = G.time < ai.blindUntil;
  const gun = bot.gun;
  gun.update(dt);
  if (gun.ammo && gun.ammo.mag === 0 && !gun.reloading && ai.state !== 'engage') gun.reload();

  if (blinded) {
    accelerate(body, 0, 0, 0, ACCEL, dt);
  } else if (ai.target && G.time - ai.lastSeenAt <= 2.2) {
    ai.state = 'engage';
    engage(bot, dt, random);
  } else if (ai.state === 'plant' || ai.state === 'defuse') {
    accelerate(body, 0, 0, 0, ACCEL, dt); // match.js runs the channel
  } else if (ai.state === 'investigate' && ai.alertPos) {
    if (moveToward(bot, ai.alertPos.x, ai.alertPos.z, dt)) {
      ai.alertPos = null;
      ai.state = ai.path.length || ai.goalPos ? 'route' : 'hold';
    }
  } else if (ai.path.length || ai.goalPos) {
    ai.state = 'route';
    let tx;
    let tz;
    if (ai.path.length) {
      const node = NODES[ai.path[0]];
      tx = node[0];
      tz = node[1];
      if (Math.hypot(tx - body.pos.x, tz - body.pos.z) < 0.8) ai.path.shift();
    } else {
      tx = ai.goalPos.x;
      tz = ai.goalPos.z;
    }
    if (moveToward(bot, tx, tz, dt)) {
      ai.goalPos = null;
      ai.state = 'hold';
    }
    // Stuck detection: barely moved while trying to — drop the path and let
    // the next order re-plan.
    ai.stuckFor += dt;
    if (ai.stuckFor > 0.5) {
      ai.stuckFor = 0;
      const moved = Math.hypot(body.pos.x - ai.lastPos.x, body.pos.z - ai.lastPos.z);
      ai.lastPos = { x: body.pos.x, z: body.pos.z };
      if (moved < 0.15 && (ai.path.length || ai.goalPos)) {
        ai.path = [];
        ai.goalPos = null;
        ai.state = 'hold';
      }
    }
  } else {
    ai.state = 'hold';
    accelerate(body, 0, 0, 0, ACCEL, dt);
    faceToward(bot, bot.body.pos.x - Math.sin(ai.holdYaw), bot.body.pos.z - Math.cos(ai.holdYaw), dt, 2.5);
  }

  moveBody(body, dt, COLLIDERS);
  if (bot.group) {
    bot.group.position.set(body.pos.x, body.pos.y, body.pos.z);
    // The figure is built facing -z (gun box at -z); rotating the group by
    // yaw around Y turns -z to (-sin yaw, -cos yaw) — the facing convention
    // every module uses.
    bot.group.rotation.set(0, bot.yaw, 0);
  }
}

// Light separation so bots do not stack inside each other.
export function separateBots() {
  const actors = G.actors;
  for (let i = 0; i < actors.length; i++) {
    const a = actors[i];
    if (!a.alive || !a.body) continue;
    for (let j = i + 1; j < actors.length; j++) {
      const b = actors[j];
      if (!b.alive || !b.body) continue;
      const dx = b.body.pos.x - a.body.pos.x;
      const dz = b.body.pos.z - a.body.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 0.0001 && d2 < 0.64) {
        const d = Math.sqrt(d2);
        const push = (0.8 - d) / 2;
        const nx = dx / d;
        const nz = dz / d;
        if (!a.isPlayer) { a.body.pos.x -= nx * push; a.body.pos.z -= nz * push; }
        if (!b.isPlayer) { b.body.pos.x += nx * push; b.body.pos.z += nz * push; }
      }
    }
  }
}
