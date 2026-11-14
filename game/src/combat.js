// Combat: the one place a bullet is resolved. A shot is a ray from an eye along
// a direction. The world is tested with the three.js raycaster against the map's
// shootable meshes; actors are tested analytically — a head sphere and a torso
// sphere per body — so a hit never depends on a mesh's visibility flag. The
// nearest of the two wins. Grenades are small physics bodies: gravity, a bounce
// off the world's AABBs, a fuse, then radial damage that falls off with distance
// and is halved through a wall. Tracers and impact sparks are pooled line/point
// meshes, reused so the hot loop allocates nothing.
import * as THREE from 'three';
import { BODY, applyDamage } from './actors.js';
import { damageAt } from './weapons.js';
import { PALETTE } from './palette.js';

const _hit = new THREE.Vector3();
const _bestPoint = new THREE.Vector3();
const _toCenter = new THREE.Vector3();
const _tracerDir = new THREE.Vector3();

// Ray vs sphere, analytic. Returns the distance along the ray, or Infinity.
export function raySphere(origin, dir, center, radius) {
  _toCenter.subVectors(center, origin);
  const tca = _toCenter.dot(dir);
  if (tca < 0) return Infinity;
  const d2 = _toCenter.lengthSq() - tca * tca;
  const r2 = radius * radius;
  if (d2 > r2) return Infinity;
  return tca - Math.sqrt(r2 - d2);
}

// Resolve one bullet. shooter is the actor object ({kind, team, body}) or null.
// Returns {actor, part, damage, distance, point} or null for a world/no hit.
// The caller applies damage and feedback; this function only measures.
export function resolveShot(state, shooter, origin, dir, def, _hintDist) {
  const raycaster = state.raycaster;
  raycaster.set(origin, dir);
  raycaster.far = def.range;
  const worldHit = raycaster.intersectObjects(state.world.shootables, false)[0];
  const worldDist = worldHit ? worldHit.distance : Infinity;

  let best = null;
  let bestDist = worldDist;
  let bestPoint = worldHit ? worldHit.point : null;
  for (const actor of state.allActors) {
    if (!actor.body.alive || actor === shooter) continue;
    const body = actor.body;
    const feet = body.position;
    // Head sphere, then torso sphere, then legs sphere. Crouching lowers all three.
    _hit.set(feet.x, feet.y + body.height - 0.14, feet.z);
    let dist = raySphere(origin, dir, _hit, 0.17);
    let part = 'head';
    if (dist === Infinity) {
      _hit.set(feet.x, feet.y + body.height * 0.58, feet.z);
      dist = raySphere(origin, dir, _hit, 0.46);
      part = 'torso';
    }
    if (dist === Infinity) {
      _hit.set(feet.x, feet.y + body.height * 0.22, feet.z);
      dist = raySphere(origin, dir, _hit, 0.34);
      part = 'leg';
    }
    if (dist < bestDist) {
      bestDist = dist;
      best = { actor, part };
      _bestPoint.copy(origin).addScaledVector(dir, dist);
      bestPoint = _bestPoint;
    }
  }
  if (!best) {
    return worldHit ? { actor: null, part: 'world', damage: 0, distance: worldDist, point: worldHit.point } : null;
  }
  const mult = best.part === 'head' ? def.headMult : best.part === 'leg' ? def.legMult : def.bodyMult;
  const damage = damageAt(def, bestDist) * mult;
  return { actor: best.actor, part: best.part, damage, distance: bestDist, point: bestPoint };
}

// The player's shot: one ray per pellet, tracer + impact feedback included.
export function playerShoot(state, gun) {
  const origin = state.camera.position;
  const pellets = gun.def.pellets || 1;
  let anyHit = false;
  let anyKill = false;
  for (let i = 0; i < pellets; i += 1) {
    state.camera.getWorldDirection(_tracerDir);
    const spread = gun.spread(state.mover.groundSpeed(state.player.body), true, state.input.state.aiming);
    _tracerDir.x += (state.random() * 2 - 1) * spread;
    _tracerDir.y += (state.random() * 2 - 1) * spread;
    _tracerDir.z += (state.random() * 2 - 1) * spread;
    _tracerDir.normalize();
    const result = resolveShot(state, state.player, origin, _tracerDir, gun.def, gun.def.pellets || 1);
    if (!result) continue;
    // Debug hook for the maker's own playtests: what the last shot resolved to.
    state.lastShot = result.actor
      ? { hit: result.actor.name, part: result.part, damage: Math.round(result.damage), distance: Math.round(result.distance * 10) / 10 }
      : { hit: result.part, part: result.part, damage: 0, distance: Math.round(result.distance * 10) / 10 };
    addTracer(state, origin, result.point, state.player.team);
    if (result.actor) {
      const lost = applyDamage(result.actor.body, result.damage);
      void lost;
      anyHit = true;
      state.hud.hitMarker(result.actor.body.alive === false);
      state.audio.hit();
      if (!result.actor.body.alive) {
        anyKill = true;
        state.events.push({ type: 'kill', victim: result.actor, killer: state.player, part: result.part });
      }
    } else {
      addImpact(state, result.point);
    }
  }
  state.audio.shot(gun.def.kind);
  return { anyHit, anyKill };
}

// --- Tracers and impacts: fixed pools, reused every frame. ---
const TRACER_POOL = 24;
const IMPACT_POOL = 24;

export function createEffects(scene) {
  const tracers = [];
  const tracerMat = new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9 });
  const allyMat = new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.ally), transparent: true, opacity: 0.9 });
  for (let i = 0; i < TRACER_POOL; i += 1) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, tracerMat.clone());
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0, ally: false });
  }
  const impacts = [];
  const impactMat = new THREE.PointsMaterial({ color: new THREE.Color(PALETTE.accent), size: 0.14, transparent: true, opacity: 0.95, sizeAttenuation: true });
  for (let i = 0; i < IMPACT_POOL; i += 1) {
    const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6 * 3), 3));
    const points = new THREE.Points(geo, impactMat.clone());
    points.visible = false;
    points.frustumCulled = false;
    scene.add(points);
    impacts.push({ points, life: 0 });
  }
  return { tracers, impacts, tracerIndex: 0, impactIndex: 0 };
}

export function addTracer(state, from, to, team) {
  const fx = state.effects;
  const slot = fx.tracers[fx.tracerIndex];
  fx.tracerIndex = (fx.tracerIndex + 1) % TRACER_POOL;
  const pos = slot.line.geometry.attributes.position;
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, to.x, to.y, to.z);
  pos.needsUpdate = true;
  slot.line.material.color.set(team === 'cinder' ? PALETTE.accent : PALETTE.enemy);
  slot.line.visible = true;
  slot.life = 0.09;
}

export function addImpact(state, point) {
  const fx = state.effects;
  const slot = fx.impacts[fx.impactIndex];
  fx.impactIndex = (fx.impactIndex + 1) % IMPACT_POOL;
  const pos = slot.points.geometry.attributes.position;
  for (let i = 0; i < 6; i += 1) {
    pos.setXYZ(i, point.x + (state.random() - 0.5) * 0.12, point.y + (state.random() - 0.5) * 0.12, point.z + (state.random() - 0.5) * 0.12);
  }
  pos.needsUpdate = true;
  slot.points.visible = true;
  slot.life = 0.28;
}

export function stepEffects(state, dt) {
  for (const tracer of state.effects.tracers) {
    if (tracer.life <= 0) continue;
    tracer.life -= dt;
    if (tracer.life <= 0) tracer.line.visible = false;
    else tracer.line.material.opacity = Math.max(0, tracer.life / 0.09) * 0.9;
  }
  for (const impact of state.effects.impacts) {
    if (impact.life <= 0) continue;
    impact.life -= dt;
    if (impact.life <= 0) impact.points.visible = false;
    else impact.points.material.opacity = Math.max(0, impact.life / 0.28) * 0.95;
  }
}

// --- Grenades: thrown by the player (key G), one live at a time per thrower. ---
export function throwGrenade(state, actor) {
  const from = actor.body.position;
  const eye = from.y + actor.body.eye;
  const dir = _tracerDir.set(-Math.sin(actor.body.yaw), 0.35, -Math.cos(actor.body.yaw)).normalize();
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.4, metalness: 0.5, emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.5 }),
  );
  mesh.position.set(from.x, eye - 0.1, from.z);
  state.scene.add(mesh);
  state.grenades.push({
    mesh,
    vel: new THREE.Vector3(dir.x * 13, dir.y * 13 + 2.5, dir.z * 13),
    fuse: 2.2,
    bounced: false,
    owner: actor,
  });
  state.audio.grenadeBounce();
}

const _gMin = new THREE.Vector3();
const _gMax = new THREE.Vector3();

export function stepGrenades(state, dt) {
  for (let i = state.grenades.length - 1; i >= 0; i -= 1) {
    const g = state.grenades[i];
    g.fuse -= dt;
    g.vel.y -= 14 * dt;
    const p = g.mesh.position;
    p.x += g.vel.x * dt;
    p.y += g.vel.y * dt;
    p.z += g.vel.z * dt;
    let bounced = false;
    // Floor and wall bounces against the world's AABBs (cheap: test the point
    // expanded by the grenade radius against each collider).
    _gMin.set(p.x - 0.09, p.y - 0.09, p.z - 0.09);
    _gMax.set(p.x + 0.09, p.y + 0.09, p.z + 0.09);
    for (const box of state.world.colliders) {
      if (_gMax.x < box.min.x || _gMin.x > box.max.x || _gMax.y < box.min.y || _gMin.y > box.max.y || _gMax.z < box.min.z || _gMin.z > box.max.z) continue;
      // Push out along the smallest penetration axis and damp the velocity.
      const pushX = Math.min(p.x + 0.09 - box.min.x, box.max.x - (p.x - 0.09));
      const pushY = Math.min(p.y + 0.09 - box.min.y, box.max.y - (p.y - 0.09));
      const pushZ = Math.min(p.z + 0.09 - box.min.z, box.max.z - (p.z - 0.09));
      if (pushY <= pushX && pushY <= pushZ) {
        p.y = p.y + 0.09 - box.min.y < box.max.y - (p.y - 0.09) ? box.min.y - 0.09 : box.max.y + 0.09;
        g.vel.y = Math.abs(g.vel.y) * 0.45;
      } else if (pushX <= pushZ) {
        g.vel.x *= -0.45;
      } else {
        g.vel.z *= -0.45;
      }
      bounced = true;
      break;
    }
    if (bounced && !g.bounced) {
      g.bounced = true;
      g.fuse = Math.min(g.fuse, 1.7);
      state.audio.grenadeBounce();
    }
    if (g.fuse <= 0) {
      explodeGrenade(state, g);
      state.scene.remove(g.mesh);
      state.grenades.splice(i, 1);
    }
  }
}

function explodeGrenade(state, g) {
  const pos = g.mesh.position;
  state.audio.explosion();
  addImpact(state, pos);
  // Flash + smoke: reuse the impact pool at a bigger spread is enough; the
  // damage is the point. Radius 7.5 m, full damage inside 2.5 m.
  for (const actor of state.allActors) {
    if (!actor.body.alive) continue;
    const dx = actor.body.position.x - pos.x;
    const dy = actor.body.position.y + 1 - pos.y;
    const dz = actor.body.position.z - pos.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > 7.5) continue;
    let damage = 110 * (1 - Math.max(0, dist - 2.5) / 5);
    // A wall between the blast and the victim halves the damage.
    state.raycaster.set(pos, _tracerDir.set(dx / (dist || 1), dy / (dist || 1), dz / (dist || 1)));
    state.raycaster.far = dist;
    if (state.raycaster.intersectObjects(state.world.shootables, false)[0]) damage *= 0.5;
    const wasAlive = actor.body.alive;
    applyDamage(actor.body, damage);
    if (wasAlive && !actor.body.alive) {
      state.events.push({ type: 'kill', victim: actor, killer: g.owner, part: 'blast' });
    }
  }
  if (state.player.body.alive) {
    const dx = state.player.body.position.x - pos.x;
    const dz = state.player.body.position.z - pos.z;
    if (Math.hypot(dx, dz) < 9) state.hud.damageFlash();
  }
}
