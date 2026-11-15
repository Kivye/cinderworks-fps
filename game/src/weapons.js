// weapons.js — hitscan gunplay: capsule head/body hits, falloff, per-weapon recoil
// tables, grenade flight + frag/smoke effects. Pure math, no rendering.
import { WEAPONS, GRENADE } from './state.js';
import { segHitsBox } from './nav.js';

// Ray vs vertical capsule (segment y0..y1 at x,z, radius r). Returns dist or Infinity.
export function rayCapsule(ox, oy, oz, dx, dy, dz, x, z, y0, y1, r) {
  // Closest approach between ray P+tD and segment A+sU.
  const ax = x, ay = y0, az = z;
  const ux = 0, uy = y1 - y0, uz = 0;
  const wx = ox - ax, wy = oy - ay, wz = oz - az;
  const a = dx * dx + dy * dy + dz * dz;
  const b = dx * ux + dy * uy + dz * uz;
  const c = ux * ux + uy * uy + uz * uz;
  const d = dx * wx + dy * wy + dz * wz;
  const e = ux * wx + uy * wy + uz * wz;
  const denom = a * c - b * b;
  let s = 0, t = 0;
  if (denom > 1e-9) {
    s = (b * e - c * d) / denom;
    t = (a * e - b * d) / denom;
  } else { t = 0; s = d / a; }
  s = Math.max(0, Math.min(1, s));
  t = Math.max(0, t);
  // Recompute with clamped s for stability.
  const px = ox + t * dx, py = oy + t * dy, pz = oz + t * dz;
  const qx = ax + s * ux, qy = ay + s * uy, qz = az + s * uz;
  const dist = Math.hypot(px - qx, py - qy, pz - qz);
  return dist <= r ? t : Infinity;
}
// Ray vs AABB walls (2D slab test + height check). Returns dist or Infinity.
export function rayWalls(ox, oy, oz, dx, dy, dz, colliders, maxD) {
  let best = Infinity;
  for (const b of colliders) {
    const dxn = dx, dzn = dz;
    let tmin = 0, tmax = maxD;
    let ok = true;
    for (const [p, d, mn, mx] of [[ox, dxn, b.x - b.hx, b.x + b.hx], [oz, dzn, b.z - b.hz, b.z + b.hz]]) {
      if (Math.abs(d) < 1e-9) { if (p < mn || p > mx) { ok = false; break; } }
      else {
        let t1 = (mn - p) / d, t2 = (mx - p) / d;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) { ok = false; break; }
      }
    }
    if (!ok || tmin > maxD) continue;
    const y = oy + tmin * dy;
    if (y < 0 || y > 5.2) continue; // walls are 5 high; shots over them pass
    if (tmin < best) best = tmin;
  }
  return best;
}
// Full shot: walls vs targets [{x,z,alive,headY,bodyY0,bodyY1,r,ref}].
// Returns {kind:'wall'|'head'|'body'|'none', dist, target}.
export function traceShot(o, d, colliders, targets, maxD = 120) {
  const wallD = rayWalls(o.x, o.y, o.z, d.x, d.y, d.z, colliders, maxD);
  let best = { kind: 'none', dist: wallD, target: null };
  if (wallD < maxD) best = { kind: 'wall', dist: wallD, target: null };
  for (const t of targets) {
    if (!t.alive) continue;
    // Head sphere first (small capsule at head height).
    const hd = rayCapsule(o.x, o.y, o.z, d.x, d.y, d.z, t.x, t.z, t.headY - 0.12, t.headY + 0.12, 0.24);
    if (hd < best.dist) { best = { kind: 'head', dist: hd, target: t }; continue; }
    const bd = rayCapsule(o.x, o.y, o.z, d.x, d.y, d.z, t.x, t.z, 0.15, t.headY - 0.1, 0.42);
    if (bd < best.dist) best = { kind: 'body', dist: bd, target: t };
  }
  return best;
}
export function falloff(w, dist) {
  if (dist <= w.fallStart) return 1;
  if (dist >= w.fallEnd) return w.fallMin;
  const k = (dist - w.fallStart) / (w.fallEnd - w.fallStart);
  return 1 - k * (1 - w.fallMin);
}
// Recoil offset for the n-th shot of a spray (0-based), from the weapon table.
export function recoilFor(w, n) {
  const t = w.recoil;
  return t[Math.min(n, t.length - 1)];
}
// Throw a grenade: returns a flying-grenade record.
export function throwGrenade(from, dir, kind, team) {
  return {
    x: from.x, y: from.y, z: from.z,
    vx: dir.x * 14 + (Math.random() - 0.5), vy: dir.y * 14 + 4.2, vz: dir.z * 14,
    kind, team, t: 0, fuse: kind === 'frag' ? 1.6 : 1.1,
  };
}
// Step flying grenades; onBoom(kind, x, z, team) when one detonates.
export function stepGrenades(list, dt, colliders, onBoom) {
  for (let i = list.length - 1; i >= 0; i--) {
    const g = list[i];
    g.t += dt;
    g.vy -= 14 * dt;
    let nx = g.x + g.vx * dt, nz = g.z + g.vz * dt, ny = g.y + g.vy * dt;
    if (ny < 0.25) { ny = 0.25; g.vy = -g.vy * 0.35; g.vx *= 0.7; g.vz *= 0.7; }
    for (const b of colliders) {
      if (Math.abs(nx - b.x) < b.hx + 0.2 && Math.abs(nz - b.z) < b.hz + 0.2 && ny < 5) {
        if (Math.abs(g.x - b.x) >= b.hx + 0.2) { nx = g.x; g.vx = -g.vx * 0.4; }
        else { nz = g.z; g.vz = -g.vz * 0.4; }
      }
    }
    g.x = nx; g.y = ny; g.z = nz;
    if (g.t >= g.fuse) { list.splice(i, 1); onBoom(g.kind, g.x, g.z, g.team); }
  }
}
// Frag damage at distance d from blast centre.
export function fragDamage(d) {
  const r = GRENADE.frag.radius;
  if (d > r) return 0;
  return Math.round(GRENADE.frag.dmg * (1 - (d / r) * 0.7));
}
// Is point (x,z) inside any live smoke cloud? (blocks bot vision)
export function inSmoke(x, z, smokes) {
  for (const s of smokes) {
    const d = Math.hypot(x - s.x, z - s.z);
    if (d < s.r) return true;
  }
  return false;
}
export function weaponOf(id) { return WEAPONS[id]; }
