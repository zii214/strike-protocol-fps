// The human's body and camera. Mouse look with recoil that the view must
// recover from, acceleration movement with crouch and jump, and the invisible
// hit proxy the bots' shots test against (a body box and a head box that
// follow the physics body, lower when crouched). Firing itself lives in
// main.js: it reads this controller's eye and direction.
import * as THREE from 'three';
import { makeBody, moveBody, accelerate, groundSpeed, eyeHeight } from './physics.js';
import { COLLIDERS } from './map.js';

const WALK = 4.6;
const CROUCH_WALK = 2.3;
const ACCEL = 42;

export function createPlayer(actor) {
  const body = makeBody(0, 29);
  actor.body = body;
  const state = {
    body,
    yaw: 0,
    pitch: 0,
    recoilPitch: 0, // unrecovered recoil; decays, and pulls the aim up
    recoilYaw: 0,
    speed: () => groundSpeed(body),
  };

  // Invisible hit proxy: colour/depth writes off, so it raycasts but never
  // renders. Head and body are separate boxes — a headshot is a head hit.
  const proxyMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(0.64, 1.3, 0.4), proxyMat);
  const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), proxyMat);
  bodyMesh.userData = { actor, part: 'body' };
  headMesh.userData = { actor, part: 'head' };
  actor.hitMeshes = [bodyMesh, headMesh];

  function addToScene(scene) {
    scene.add(bodyMesh);
    scene.add(headMesh);
  }

  function syncProxy() {
    const h = body.crouching ? body.crouchHeight : body.height;
    bodyMesh.position.set(body.pos.x, body.pos.y + h * 0.44, body.pos.z);
    bodyMesh.scale.y = h / body.height;
    headMesh.position.set(body.pos.x, body.pos.y + h - 0.18, body.pos.z);
  }

  function look(dx, dy) {
    state.yaw -= dx * 0.0021;
    state.pitch -= dy * 0.0021;
    const lim = 1.45;
    state.pitch = Math.max(-lim, Math.min(lim, state.pitch));
  }

  function addRecoil(pitchKick, yawKick) {
    state.recoilPitch += pitchKick;
    state.recoilYaw += yawKick;
    state.pitch += pitchKick; // the view actually jumps
    state.yaw += yawKick;
  }

  function eye(out) {
    out.set(body.pos.x, body.pos.y + eyeHeight(body), body.pos.z);
    return out;
  }

  function step(dt, keys) {
    // Recoil recovery: the unrecovered part eases back out of the view.
    const recover = Math.min(1, dt * 7);
    state.pitch -= state.recoilPitch * recover;
    state.yaw -= state.recoilYaw * recover;
    state.recoilPitch *= 1 - recover;
    state.recoilYaw *= 1 - recover;

    body.crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    let fwd = 0;
    let strafe = 0;
    if (keys.has('KeyW')) fwd += 1;
    if (keys.has('KeyS')) fwd -= 1;
    if (keys.has('KeyA')) strafe -= 1;
    if (keys.has('KeyD')) strafe += 1;
    const len = Math.hypot(fwd, strafe) || 1;
    // Facing convention: forward = (-sin yaw, -cos yaw) in xz.
    const sin = Math.sin(state.yaw);
    const cos = Math.cos(state.yaw);
    const wishX = (-sin * fwd + cos * strafe) / len * (fwd || strafe ? 1 : 0);
    const wishZ = (-cos * fwd - sin * strafe) / len * (fwd || strafe ? 1 : 0);
    const maxSpeed = body.crouching ? CROUCH_WALK : WALK;
    accelerate(body, wishX, wishZ, maxSpeed, ACCEL, dt);
    if (keys.has('Space') && body.grounded) {
      body.vel.y = 7.6;
      body.grounded = false;
    }
    moveBody(body, dt, COLLIDERS);
    syncProxy();
  }

  return { state, look, addRecoil, eye, step, addToScene, syncProxy };
}
