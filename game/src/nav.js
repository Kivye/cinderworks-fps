// Waypoint navigation: a small hand-placed graph (map.js) with a breadth-first
// search. Bots ask for a path between named nodes; the search returns the node
// list, and the bot walks it one node at a time. No per-frame allocation: the
// open queue and the came-from map are reused scratch, rebuilt per query.
import { WAYPOINTS, EDGES } from './map.js';

const queue = [];
const cameFrom = new Map();
const visited = new Set();

export function nearestNode(x, z) {
  let best = null;
  let bestDist = Infinity;
  for (const [name, [nx, nz]] of Object.entries(WAYPOINTS)) {
    const dx = nx - x;
    const dz = nz - z;
    const dist = dx * dx + dz * dz;
    if (dist < bestDist) {
      bestDist = dist;
      best = name;
    }
  }
  return best;
}

export function findPath(fromName, toName) {
  if (fromName === toName) return [toName];
  queue.length = 0;
  cameFrom.clear();
  visited.clear();
  queue.push(fromName);
  visited.add(fromName);
  while (queue.length > 0) {
    const current = queue.shift();
    const neighbours = EDGES[current] || [];
    for (const next of neighbours) {
      if (visited.has(next)) continue;
      visited.add(next);
      cameFrom.set(next, current);
      if (next === toName) {
        const path = [toName];
        let node = toName;
        while (cameFrom.get(node) !== fromName) {
          node = cameFrom.get(node);
          path.unshift(node);
        }
        path.unshift(fromName);
        return path;
      }
      queue.push(next);
    }
  }
  return [fromName, toName];
}

export function nodePosition(name) {
  const [x, z] = WAYPOINTS[name];
  return { x, z };
}
