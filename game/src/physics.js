// Character physics shared by the player and every bot: a capsule treated as
// a vertical cylinder (radius, height) moving through a world of axis-aligned
// boxes. Movement is acceleration-based — a body has a wish direction and a
// max speed, and velocity is pulled toward it, so starting and stopping have
// weight and strafing bleeds speed. Collision resolves one axis at a time
// (x, then z, then y), which keeps corners honest; low boxes (stepHeight or
// less above the feet) are stepped onto, so crates are cover you can climb.

export const GRAVITY = 22;

export function makeBody(x, z, opts = {}) {
  return {
    pos: { x, y: opts.y ?? 0, z }, // feet position
    vel: { x: 0, y: 0, z: 0 },
    radius: opts.radius ?? 0.36,
    height: opts.height ?? 1.78, // standing eye-to-feet is height - 0.14
    crouchHeight: 1.28,
    crouching: false,
    grounded: false,
  };
}

export function bodyHeight(body) {
  return body.crouching ? body.crouchHeight : body.height;
}

export function eyeHeight(body) {
  return bodyHeight(body) - 0.14;
}

// Accelerate the horizontal velocity toward wishX/wishZ at maxSpeed.
export function accelerate(body, wishX, wishZ, maxSpeed, accel, dt) {
  const targetX = wishX * maxSpeed;
  const targetZ = wishZ * maxSpeed;
  const rate = body.grounded ? accel : accel * 0.25; // little air control
  const dx = targetX - body.vel.x;
  const dz = targetZ - body.vel.z;
  const maxDelta = rate * dt;
  const len = Math.hypot(dx, dz);
  if (len <= maxDelta || len === 0) {
    body.vel.x = targetX;
    body.vel.z = targetZ;
  } else {
    body.vel.x += (dx / len) * maxDelta;
    body.vel.z += (dz / len) * maxDelta;
  }
}

export function groundSpeed(body) {
  return Math.hypot(body.vel.x, body.vel.z);
}

// Does the cylinder at (x, z) with feet at y overlap this box?
function overlaps(body, x, y, z, box) {
  if (y + bodyHeight(body) <= box.y0 || y >= box.y1) return false;
  const nx = Math.max(box.x0, Math.min(x, box.x1));
  const nz = Math.max(box.z0, Math.min(z, box.z1));
  const dx = x - nx;
  const dz = z - nz;
  return dx * dx + dz * dz < body.radius * body.radius;
}

// Highest box top the body could stand on at (x, z), or -Infinity.
function supportAt(body, x, z, colliders, maxTop) {
  let best = -Infinity;
  for (const box of colliders) {
    if (box.y1 > maxTop) continue;
    const nx = Math.max(box.x0, Math.min(x, box.x1));
    const nz = Math.max(box.z0, Math.min(z, box.z1));
    const dx = x - nx;
    const dz = z - nz;
    if (dx * dx + dz * dz < body.radius * body.radius && box.y1 > best) best = box.y1;
  }
  return best;
}

const STEP = 0.55;

// Integrate one step and resolve collisions. colliders: [{x0,x1,y0,y1,z0,z1}].
export function moveBody(body, dt, colliders) {
  body.vel.y -= GRAVITY * dt;
  if (body.vel.y < -30) body.vel.y = -30;

  // Horizontal, one axis at a time. A box whose top is within a step of the
  // feet is not a wall: the support check below lifts the body onto it.
  for (const axis of ['x', 'z']) {
    body.pos[axis] += body.vel[axis] * dt;
    for (const box of colliders) {
      if (box.y1 - body.pos.y <= STEP && box.y1 >= body.pos.y - 0.01) continue; // steppable
      if (overlaps(body, body.pos.x, body.pos.y, body.pos.z, box)) {
        if (axis === 'x') {
          body.pos.x = body.vel.x > 0 ? box.x0 - body.radius - 0.001 : box.x1 + body.radius + 0.001;
          // the push-out may have left the cylinder clipping in z; re-test cheaply
          if (overlaps(body, body.pos.x, body.pos.y, body.pos.z, box)) {
            body.pos.x = body.vel.x > 0 ? box.x0 - body.radius - 0.001 : box.x1 + body.radius + 0.001;
          }
          body.vel.x = 0;
        } else {
          body.pos.z = body.vel.z > 0 ? box.z0 - body.radius - 0.001 : box.z1 + body.radius + 0.001;
          body.vel.z = 0;
        }
      }
    }
  }

  // Vertical: land on the floor (y = 0) or on a box top.
  body.pos.y += body.vel.y * dt;
  const support = Math.max(0, supportAt(body, body.pos.x, body.pos.z, colliders, body.pos.y + STEP));
  if (body.pos.y <= support) {
    body.pos.y = support;
    body.vel.y = 0;
    body.grounded = true;
  } else {
    // Stepping up onto a low box while walking: if a support sits within a
    // step above the feet and the body is not jumping, take it.
    const stepUp = supportAt(body, body.pos.x, body.pos.z, colliders, body.pos.y + STEP);
    if (body.vel.y <= 0.01 && stepUp > body.pos.y && stepUp - body.pos.y <= STEP) {
      body.pos.y = stepUp;
      body.vel.y = 0;
      body.grounded = true;
    } else {
      body.grounded = body.pos.y <= 0.001;
    }
  }
}

// Segment vs smoke spheres and boxes, for sight lines. Returns true when the
// segment from a to b is clear. Boxes use a slab test; smoke uses the
// segment's closest approach to each cloud centre.
export function segmentBlocked(ax, ay, az, bx, by, bz, colliders, smokes) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  for (const box of colliders) {
    let t0 = 0;
    let t1 = 1;
    let hit = true;
    const mins = [box.x0, box.y0, box.z0];
    const maxs = [box.x1, box.y1, box.z1];
    const a = [ax, ay, az];
    const d = [dx, dy, dz];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) {
        if (a[i] < mins[i] || a[i] > maxs[i]) { hit = false; break; }
      } else {
        let ta = (mins[i] - a[i]) / d[i];
        let tb = (maxs[i] - a[i]) / d[i];
        if (ta > tb) { const t = ta; ta = tb; tb = t; }
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) { hit = false; break; }
      }
    }
    if (hit && t1 > 0.001 && t0 < 0.999) return true;
  }
  if (smokes) {
    for (const s of smokes) {
      // Ignore a cloud the shooter is standing inside of: you can see out of
      // your own smoke's edge poorly, but the check that matters is a cloud
      // between the two actors.
      const len2 = dx * dx + dy * dy + dz * dz || 1;
      let t = ((s.x - ax) * dx + (s.y - ay) * dy + (s.z - az) * dz) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = ax + dx * t - s.x;
      const py = ay + dy * t - s.y;
      const pz = az + dz * t - s.z;
      if (px * px + py * py + pz * pz < s.r * s.r && t > 0.05 && t < 0.95) return true;
    }
  }
  return false;
}
