// Cinderworks Foundry — the map. An original industrial yard, 44 x 36 m, built only
// from boxes: two bomb sites (A Furnace west, B Crane Dock east), three lanes from
// the south attacker spawn to the north defender side (Long west, Mid centre,
// Short east), and cover crates that force real sightlines. Every box is both a
// mesh and a collider, and a bullet stops on it. The waypoint graph at the bottom
// is what the bots walk; nav.js only reads it, it never edits the map.
//
//   z -18  ┌──────────── Defender spawn ────────────┐
//          │  [A Furnace]      mid wall     [B Crane]│
//          │      │              │               │   │
//          │   Long           Mid            Short  │
//          │      │              │               │   │
//   z +18  └──────────── Attacker spawn ───────────┘
//          x -22                                    x +22
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const MAP = {
  bounds: { minX: -22, maxX: 22, minZ: -18, maxZ: 18 },
  sites: {
    A: { name: 'Furnace', rect: { x0: -20, x1: -9, z0: -17, z1: -7 } },
    B: { name: 'Crane Dock', rect: { x0: 9, x1: 20, z0: -17, z1: -7 } },
  },
  spawns: {
    attack: [
      [-6, 15.5], [0, 15.8], [6, 15.5],
    ],
    defend: [
      [-14, -14.5], [-4, -15.2], [5, -15.2], [14, -14.5],
    ],
  },
  roundSeconds: 100,
  plantSeconds: 3.2,
  fuseSeconds: 35,
  defuseSeconds: 5,
};

// Boxes: [w, h, d, x, y, z, material, tag]. y is the centre height.
// tag 'glow' marks furnace panels that also get an emissive light.
const BOXES = [
  // Floor and outer walls.
  [44.4, 0.4, 36.4, 0, -0.2, 0, 'surface', 'floor'],
  [0.5, 5.0, 36.4, -22.2, 2.5, 0, 'surface', 'wall'],
  [0.5, 5.0, 36.4, 22.2, 2.5, 0, 'surface', 'wall'],
  [44.4, 5.0, 0.5, 0, 2.5, -18.2, 'surface', 'wall'],
  [44.4, 5.0, 0.5, 0, 2.5, 18.2, 'surface', 'wall'],
  // Mid divider: two walls leaving a centre gap (mid door), side gaps, and a
  // clear run down each outer lane (the walls stop short of the map edges).
  [7.0, 4.2, 0.6, -12.0, 2.1, -2.0, 'hairline', 'wall'],
  [7.0, 4.2, 0.6, 12.0, 2.1, -2.0, 'hairline', 'wall'],
  [6.0, 4.2, 0.6, 0, 2.1, -2.0, 'hairline', 'wall'],
  // Long lane (west): furnace hall divider and a pillar row.
  [0.6, 4.2, 12.0, -11.0, 2.1, -10.0, 'hairline', 'wall'],
  [1.4, 3.4, 1.4, -17.5, 1.7, -4.0, 'hairline', 'pillar'],
  [1.4, 3.4, 1.4, -17.5, 1.7, 4.0, 'hairline', 'pillar'],
  // Short lane (east): dock divider and pillar row.
  [0.6, 4.2, 12.0, 11.0, 2.1, -10.0, 'hairline', 'wall'],
  [1.4, 3.4, 1.4, 17.5, 1.7, -4.0, 'hairline', 'pillar'],
  [1.4, 3.4, 1.4, 17.5, 1.7, 4.0, 'hairline', 'pillar'],
  // Site A — Furnace: the furnace block itself (tall, glowing mouth) and side cover.
  [5.0, 4.6, 2.2, -16.5, 2.3, -16.4, 'surface', 'furnace'],
  [2.2, 1.0, 2.2, -12.0, 0.5, -13.5, 'hairline', 'crate'],
  [1.2, 1.0, 1.2, -11.0, 0.5, -9.5, 'hairline', 'crate'],
  [3.4, 1.1, 1.2, -16.0, 0.55, -8.6, 'hairline', 'crate'],
  // Site B — Crane Dock: container stacks and the crane leg.
  [4.6, 2.4, 2.2, 16.8, 1.2, -15.8, 'hairline', 'container'],
  [2.2, 1.2, 2.2, 12.4, 0.6, -15.2, 'hairline', 'container'],
  [1.2, 1.0, 1.2, 12.0, 0.5, -9.8, 'hairline', 'crate'],
  [3.4, 1.1, 1.2, 16.0, 0.55, -8.8, 'hairline', 'crate'],
  [1.2, 5.0, 1.2, 18.5, 2.5, -12.5, 'hairline', 'pillar'],
  // Mid cover: vent block, crates, and the low wall at the mid door.
  [2.6, 2.2, 1.4, -3.2, 1.1, 2.0, 'hairline', 'vent'],
  [2.6, 2.2, 1.4, 3.2, 1.1, 2.0, 'hairline', 'vent'],
  [1.4, 1.0, 1.4, -6.5, 0.5, 8.0, 'hairline', 'crate'],
  [1.4, 1.0, 1.4, 6.5, 0.5, 8.0, 'hairline', 'crate'],
  [4.0, 1.0, 0.8, 0, 0.5, 6.0, 'hairline', 'crate'],
  // Spawn cover so neither spawn is a fishbowl.
  [2.0, 1.1, 1.0, -8.0, 0.55, 12.0, 'hairline', 'crate'],
  [2.0, 1.1, 1.0, 8.0, 0.55, 12.0, 'hairline', 'crate'],
  [2.0, 1.1, 1.0, -8.0, 0.55, -13.0, 'hairline', 'crate'],
  [2.0, 1.1, 1.0, 8.0, 0.55, -13.0, 'hairline', 'crate'],
];

// Waypoints the bots walk. id: [x, z]. Edges are listed per node; the graph is
// symmetric, so nav.js only needs one direction written here.
export const WAYPOINTS = {
  atkSpawn: [-0, 15], atkMid: [0, 9], atkWest: [-13, 11], atkEast: [13, 11],
  midDoor: [0, -2], midLow: [0, 3.5], midNorth: [0, -8],
  longSouth: [-17, 8], longMid: [-17, 0], longNorth: [-17, -7],
  shortSouth: [17, 8], shortMid: [17, 0], shortNorth: [17, -7],
  siteA: [-14, -11], siteAEdge: [-11, -6], siteB: [14, -11], siteBEdge: [11, -6],
  defWest: [-6, -13], defEast: [6, -13], defMid: [-2, -11],
  ventWest: [-6, 2], ventEast: [6, 2],
};
export const EDGES = {
  atkSpawn: ['atkMid', 'atkWest', 'atkEast'],
  atkMid: ['atkSpawn', 'midLow', 'ventWest', 'ventEast'],
  atkWest: ['atkSpawn', 'longSouth'],
  atkEast: ['atkSpawn', 'shortSouth'],
  midLow: ['atkMid', 'midDoor', 'ventWest', 'ventEast'],
  midDoor: ['midLow', 'midNorth'],
  midNorth: ['midDoor', 'defMid', 'siteAEdge', 'siteBEdge'],
  longSouth: ['atkWest', 'longMid'],
  longMid: ['longSouth', 'longNorth'],
  longNorth: ['longMid', 'siteAEdge', 'defWest'],
  shortSouth: ['atkEast', 'shortMid'],
  shortMid: ['shortSouth', 'shortNorth'],
  shortNorth: ['shortMid', 'siteBEdge', 'defEast'],
  siteA: ['siteAEdge', 'longNorth'],
  siteAEdge: ['siteA', 'midNorth', 'longNorth'],
  siteB: ['siteBEdge', 'shortNorth'],
  siteBEdge: ['siteB', 'midNorth', 'shortNorth'],
  defWest: ['longNorth', 'defMid'],
  defEast: ['shortNorth', 'defMid'],
  defMid: ['defWest', 'defEast', 'midNorth'],
  ventWest: ['atkMid', 'midLow', 'longMid'],
  ventEast: ['atkMid', 'midLow', 'shortMid'],
};

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' ? 0.5 : 0.92,
      metalness: 0.04,
    });
  }
  // Molten mouth of the furnace: the one emissive surface on the map.
  const glowMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.accent),
    emissive: new THREE.Color(PALETTE.accent),
    emissiveIntensity: 2.2,
    roughness: 0.4,
  });

  const colliders = [];
  const shootables = [];
  for (const [w, h, d, x, y, z, material, tag] of BOXES) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    if (tag === 'furnace') {
      const mouth = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.6), glowMaterial);
      mouth.position.set(x, 1.0, z + d / 2 + 0.02);
      group.add(mouth);
      const glow = new THREE.PointLight(new THREE.Color(PALETTE.accent), 26, 16, 1.8);
      glow.position.set(x, 1.6, z + 3.2);
      scene.add(glow);
    }
  }

  // Site markers: flat ember rings on the floor, so the objective reads at a glance.
  for (const site of Object.values(MAP.sites)) {
    const r = site.rect;
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const w = r.x1 - r.x0;
    const d = r.z1 - r.z0;
    const ring = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.08, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(cx, 0.03, cz);
    group.add(ring);
    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, d)),
      new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.55 }),
    );
    frame.rotation.x = -Math.PI / 2;
    frame.position.set(cx, 0.04, cz);
    group.add(frame);
  }

  // Light: low ember sun from the west, cool sky fill, and a warm hemisphere.
  scene.add(new THREE.HemisphereLight(new THREE.Color('#8a7a68'), new THREE.Color(PALETTE.canvas), 1.22));
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb066'), 2.7);
  sun.position.set(-16, 18, 10);
  sun.target.position.set(0, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#7d8aa0'), 0.65);
  fill.position.set(12, 10, -14);
  scene.add(fill);

  return { colliders, shootables, group };
}

export function insideSite(siteKey, x, z) {
  const r = MAP.sites[siteKey].rect;
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
}

export function siteAt(x, z) {
  if (insideSite('A', x, z)) return 'A';
  if (insideSite('B', x, z)) return 'B';
  return null;
}
