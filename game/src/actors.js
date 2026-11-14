// Actors: one body model for the player and every bot. A body is a standing box
// (0.34 m radius, 1.72 m tall, 1.12 m crouched) moved one axis at a time against
// the world's colliders, with acceleration, friction, gravity and a jump. All
// combat reads the same fields: health, armour, alive, and the head/torso hit
// boxes the raycaster tests. Nothing here knows about input or AI; player.js
// and bots.js drive bodies, combat.js damages them.
import * as THREE from 'three';

export const BODY = {
  radius: 0.34,
  standHeight: 1.72,
  crouchHeight: 1.12,
  standEye: 1.6,
  crouchEye: 1.02,
  walkSpeed: 5.2,
  crouchSpeed: 2.4,
  groundAccel: 42,
  airAccel: 9,
  friction: 9,
  gravity: 20,
  jumpSpeed: 6.2,
  maxHealth: 100,
};

export function createBody(x, z, yaw) {
  return {
    position: new THREE.Vector3(x, 0, z),
    velocity: new THREE.Vector3(),
    yaw, pitch: 0,
    eye: BODY.standEye, height: BODY.standHeight,
    onGround: true, crouching: false,
    health: BODY.maxHealth, armor: 0, alive: true,
  };
}

// Shared scratch, allocated once: the hot loop never news a Vector3 or Box3.
const probe = new THREE.Box3();
const wish = new THREE.Vector3();

export function makeMover(colliders) {
  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - BODY.radius, y + lift, z - BODY.radius);
    probe.max.set(x + BODY.radius, y + height - lift, z + BODY.radius);
    for (const collider of colliders) {
      if (probe.intersectsBox(collider)) return collider;
    }
    return null;
  }

  // wishX/wishZ is the desired horizontal direction (already normalised, or
  // zero); speed is the target speed; jump is an edge trigger.
  function stepBody(body, dt, wishX, wishZ, speed, jump) {
    const targetEye = body.crouching ? BODY.crouchEye : BODY.standEye;
    body.eye += (targetEye - body.eye) * Math.min(1, dt * 12);
    const blend = Math.min(1, (body.onGround ? BODY.groundAccel : BODY.airAccel) * dt / Math.max(0.1, speed));
    body.velocity.x += (wishX * speed - body.velocity.x) * blend;
    body.velocity.z += (wishZ * speed - body.velocity.z) * blend;
    if (body.onGround && wishX === 0 && wishZ === 0) {
      const damp = Math.max(0, 1 - BODY.friction * dt);
      body.velocity.x *= damp;
      body.velocity.z *= damp;
    }
    if (jump && body.onGround) {
      body.velocity.y = BODY.jumpSpeed;
      body.onGround = false;
    }
    body.velocity.y -= BODY.gravity * dt;
    const nextX = body.position.x + body.velocity.x * dt;
    if (!overlaps(nextX, body.position.y, body.position.z, body.height, 0.04)) body.position.x = nextX;
    else body.velocity.x = 0;
    const nextZ = body.position.z + body.velocity.z * dt;
    if (!overlaps(body.position.x, body.position.y, nextZ, body.height, 0.04)) body.position.z = nextZ;
    else body.velocity.z = 0;
    body.position.y += body.velocity.y * dt;
    body.onGround = false;
    const hit = overlaps(body.position.x, body.position.y, body.position.z, body.height, 0);
    if (hit && body.velocity.y <= 0) {
      body.position.y = hit.max.y;
      body.velocity.y = 0;
      body.onGround = true;
    } else if (hit) {
      body.position.y = hit.min.y - body.height;
      body.velocity.y = 0;
    }
    if (body.position.y < 0) {
      body.position.y = 0;
      body.velocity.y = 0;
      body.onGround = true;
    }
    body.velocity.y = Math.max(-30, body.velocity.y);
  }

  function setCrouch(body, want) {
    if (want && !body.crouching) {
      body.crouching = true;
      body.height = BODY.crouchHeight;
    } else if (!want && body.crouching && !overlaps(body.position.x, body.position.y, body.position.z, BODY.standHeight, 0.02)) {
      body.crouching = false;
      body.height = BODY.standHeight;
    }
  }

  function groundSpeed(body) {
    return Math.hypot(body.velocity.x, body.velocity.z);
  }

  // wish vector from a yaw and forward/strafe intents, into shared scratch.
  function wishFromYaw(yaw, forward, strafe) {
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe);
    if (wish.lengthSq() > 0) wish.normalize();
    return wish;
  }

  return { stepBody, setCrouch, groundSpeed, wishFromYaw, overlaps };
}

// Damage: armour absorbs its share first, then health. Returns the health lost.
export function applyDamage(body, amount) {
  if (!body.alive) return 0;
  let remaining = amount;
  if (body.armor > 0) {
    const absorbed = Math.min(body.armor, remaining * 0.5);
    body.armor -= absorbed;
    remaining -= absorbed;
  }
  const lost = Math.min(body.health, remaining);
  body.health -= remaining;
  if (body.health <= 0) {
    body.health = 0;
    body.alive = false;
  }
  return lost;
}

export function eyePosition(body, out) {
  out.set(body.position.x, body.position.y + body.eye, body.position.z);
  return out;
}
