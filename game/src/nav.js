// nav.js — A* over the waypoint graph, LOS smoothing, stuck recovery helpers.
// Colliders are 2D AABBs {x, z, hx, hz}; all nav math is 2D (x, z).
export function dist2(ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  return Math.hypot(dx, dz);
}
// Segment (x1,z1)-(x2,z2) vs AABB: true when blocked.
export function segHitsBox(x1, z1, x2, z2, b) {
  const dx = x2 - x1, dz = z2 - z1;
  let tmin = 0, tmax = 1;
  const minX = b.x - b.hx, maxX = b.x + b.hx, minZ = b.z - b.hz, maxZ = b.z + b.hz;
  for (const [p, d, mn, mx] of [[x1, dx, minX, maxX], [z1, dz, minZ, maxZ]]) {
    if (Math.abs(d) < 1e-9) { if (p < mn || p > mx) return false; }
    else {
      let t1 = (mn - p) / d, t2 = (mx - p) / d;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return true;
}
export function hasLOS(x1, z1, x2, z2, colliders) {
  for (const b of colliders) if (segHitsBox(x1, z1, x2, z2, b)) return false;
  return true;
}
export function pointBlocked(x, z, colliders, pad = 0.45) {
  for (const b of colliders) {
    if (Math.abs(x - b.x) < b.hx + pad && Math.abs(z - b.z) < b.hz + pad) return true;
  }
  return false;
}
// A* from node si to node gi over nodes [{x,z,links:[idx]}]. Returns node index list.
export function astar(nodes, si, gi) {
  if (si === gi) return [si];
  const open = [si];
  const came = new Map();
  const g = new Array(nodes.length).fill(Infinity);
  const f = new Array(nodes.length).fill(Infinity);
  g[si] = 0;
  f[si] = dist2(nodes[si].x, nodes[si].z, nodes[gi].x, nodes[gi].z);
  const closed = new Set();
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur === gi) {
      const path = [cur]; let n = cur;
      while (came.has(n)) { n = came.get(n); path.unshift(n); }
      return path;
    }
    closed.add(cur);
    for (const nb of nodes[cur].links) {
      if (closed.has(nb)) continue;
      const ng = g[cur] + dist2(nodes[cur].x, nodes[cur].z, nodes[nb].x, nodes[nb].z);
      if (ng < g[nb]) {
        came.set(nb, cur); g[nb] = ng;
        f[nb] = ng + dist2(nodes[nb].x, nodes[nb].z, nodes[gi].x, nodes[gi].z);
        if (!open.includes(nb)) open.push(nb);
      }
    }
  }
  return [si];
}
export function nearestNode(nodes, x, z) {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const d = dist2(x, z, nodes[i].x, nodes[i].z);
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}
// Drop intermediate waypoints that have a direct line of sight.
export function smoothPath(pts, colliders) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !hasLOS(pts[i].x, pts[i].z, pts[j].x, pts[j].z, colliders)) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}
// Full route: nearest nodes -> A* -> smoothed world points, ending at the target.
export function route(nodes, colliders, fx, fz, tx, tz) {
  const si = nearestNode(nodes, fx, fz);
  const gi = nearestNode(nodes, tx, tz);
  const ids = astar(nodes, si, gi);
  const pts = ids.map((id) => ({ x: nodes[id].x, z: nodes[id].z }));
  pts.push({ x: tx, z: tz });
  return smoothPath(pts, colliders);
}
