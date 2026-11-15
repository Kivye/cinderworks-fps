// world.js — Cinderworks foundry-yard map: 3 lanes, 2 sites, bright daylight.
// Builds meshes + colliders + waypoint graph + spawns. All art procedural.
import * as THREE from 'three';
import { brickTexture, concreteTexture, metalTexture, floorTexture, hazardTexture, siteTexture } from './textures.js';
import { hasLOS } from './nav.js';

const W = 92, D = 72; // map extents (x: -46..46, z: -36..36)

function box(scene, mat, x, y, z, w, h, d, colliders, collide = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z);
  m.receiveShadow = true; m.castShadow = true;
  scene.add(m);
  if (collide) colliders.push({ x, z, hx: w / 2, hz: d / 2 });
  return m;
}

export function buildWorld(scene) {
  const colliders = [];
  const brick = new THREE.MeshStandardMaterial({ map: brickTexture(), roughness: 0.9 });
  const conc = new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.95 });
  const metal = new THREE.MeshStandardMaterial({ map: metalTexture(), roughness: 0.55, metalness: 0.5 });
  const floor = new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.9 });
  floor.map.repeat.set(8, 6);
  const hazard = new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.8 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x3c424c, roughness: 0.5, metalness: 0.6 });

  scene.background = new THREE.Color(0xbfd9ee);
  scene.fog = new THREE.Fog(0xbfd9ee, 90, 220);

  // Ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floor);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);

  // Perimeter walls (height 5)
  box(scene, brick, 0, 0, -36, W, 5, 1.2, colliders);
  box(scene, brick, 0, 0, 36, W, 5, 1.2, colliders);
  box(scene, brick, -46, 0, 0, 1.2, 5, D, colliders);
  box(scene, brick, 46, 0, 0, 1.2, 5, D, colliders);

  // --- Interior: lane walls + corner blocks (sightlines + cover) ---
  // Mid lane pillars
  box(scene, conc, -6, 0, -8, 3, 3.4, 3, colliders);
  box(scene, conc, 6, 0, 8, 3, 3.4, 3, colliders);
  box(scene, conc, 0, 0, -18, 8, 2.6, 2, colliders);
  box(scene, conc, 0, 0, 14, 8, 2.6, 2, colliders);
  // West (A) lane blocks
  box(scene, metal, -30, 0, -6, 4, 3, 8, colliders);
  box(scene, conc, -34, 0, 12, 6, 2.4, 3, colliders);
  box(scene, conc, -22, 0, -16, 3, 3, 6, colliders);
  box(scene, metal, -38, 0, -20, 5, 2.8, 2.5, colliders);
  // East (B) lane blocks
  box(scene, metal, 30, 0, 6, 4, 3, 8, colliders);
  box(scene, conc, 34, 0, -12, 6, 2.4, 3, colliders);
  box(scene, conc, 22, 0, 16, 3, 3, 6, colliders);
  box(scene, metal, 38, 0, 20, 5, 2.8, 2.5, colliders);
  // Cross-corridor walls with gaps (corners to peek)
  box(scene, brick, -18, 0, 0, 10, 3.6, 1.6, colliders);
  box(scene, brick, 18, 0, 0, 10, 3.6, 1.6, colliders);
  box(scene, brick, -12, 0, -26, 12, 3.2, 1.6, colliders);
  box(scene, brick, 14, 0, -26, 12, 3.2, 1.6, colliders);

  // --- Props: crates, pipes, furnace (site A), crane (site B) ---
  const crateMat = new THREE.MeshStandardMaterial({ color: 0xc98f3d, roughness: 0.85 });
  const crateMat2 = new THREE.MeshStandardMaterial({ color: 0x7a8a99, roughness: 0.8 });
  const crates = [[-36, -24, 2.2], [-33, -25, 1.6], [36, -24, 2.2], [33, -25, 1.6], [-14, 4, 1.8], [14, -4, 1.8], [-4, 26, 2], [4, -30, 1.6], [26, 26, 1.8], [-26, -28, 1.6]];
  for (const [x, z, s] of crates) box(scene, (x + z) % 2 ? crateMat : crateMat2, x, 0, z, s, s, s, colliders);
  // Pipes along the north wall
  for (const [x, z] of [[-20, -33], [0, -33], [20, -33]]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 16, 12), darkMetal);
    pipe.rotation.z = Math.PI / 2; pipe.position.set(x, 1.2, z);
    scene.add(pipe);
  }
  // Furnace at site A: glowing kiln + chimney
  const furnace = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.8, 5, 16),
    new THREE.MeshStandardMaterial({ color: 0x8a3d1e, roughness: 0.6, metalness: 0.4, emissive: 0xff5a00, emissiveIntensity: 0.55 }));
  furnace.position.set(-34, 2.5, -26); scene.add(furnace);
  colliders.push({ x: -34, z: -26, hx: 3.4, hz: 3.4 });
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.4, 14, 10), darkMetal);
  chimney.position.set(-40, 7, -30); scene.add(chimney);
  colliders.push({ x: -40, z: -30, hx: 1.2, hz: 1.2 });
  const glowA = new THREE.PointLight(0xff7a22, 60, 26, 1.6);
  glowA.position.set(-34, 4, -24); scene.add(glowA);
  // Crane at site B: tall mast + jib
  const mast = new THREE.Mesh(new THREE.BoxGeometry(1.6, 16, 1.6), new THREE.MeshStandardMaterial({ color: 0xe8a020, roughness: 0.5, metalness: 0.5 }));
  mast.position.set(40, 8, -28); scene.add(mast);
  colliders.push({ x: 40, z: -28, hx: 1, hz: 1 });
  const jib = new THREE.Mesh(new THREE.BoxGeometry(16, 1, 1), mast.material);
  jib.position.set(33, 15, -28); scene.add(jib);
  const glowB = new THREE.PointLight(0xffc040, 40, 22, 1.6);
  glowB.position.set(34, 5, -24); scene.add(glowB);

  // Site decals: giant A / B letters on the ground + hazard strips at site entries
  const decalA = new THREE.Mesh(new THREE.PlaneGeometry(12, 12),
    new THREE.MeshBasicMaterial({ map: siteTexture('A', '#ff5a2a'), transparent: true, opacity: 0.9 }));
  decalA.rotation.x = -Math.PI / 2; decalA.position.set(-32, 0.03, -22); scene.add(decalA);
  const decalB = new THREE.Mesh(new THREE.PlaneGeometry(12, 12),
    new THREE.MeshBasicMaterial({ map: siteTexture('B', '#2a7aff'), transparent: true, opacity: 0.9 }));
  decalB.rotation.x = -Math.PI / 2; decalB.position.set(32, 0.03, -22); scene.add(decalB);
  for (const [x, z, w] of [[-32, -12, 10], [32, -12, 10], [0, -30, 14], [0, 30, 14]]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.2), hazard);
    strip.rotation.x = -Math.PI / 2; strip.position.set(x, 0.04, z); scene.add(strip);
  }
  // Work lamps (emissive globes on poles)
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffe9a0, emissiveIntensity: 1.6 });
  for (const [x, z] of [[-20, 0], [20, 0], [0, -20], [-32, 20], [32, 20]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5, 8), darkMetal);
    pole.position.set(x, 2.5, z); scene.add(pole);
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 10), lampMat);
    globe.position.set(x, 5.2, z); scene.add(globe);
  }

  // --- Waypoint graph: lanes + cross links, auto-linked by LOS within 16 m ---
  const pts = [
    [-40, 30], [-30, 30], [-14, 30], [0, 30], [14, 30], [30, 30], [40, 30],
    [-40, 14], [-30, 14], [-14, 14], [0, 14], [14, 14], [30, 14], [40, 14],
    [-40, 0], [-30, 0], [-14, 0], [0, 0], [14, 0], [30, 0], [40, 0],
    [-40, -12], [-30, -12], [-14, -12], [0, -12], [14, -12], [30, -12], [40, -12],
    [-38, -22], [-32, -22], [-24, -22], [24, -22], [32, -22], [38, -22],
    [-14, -30], [0, -30], [14, -30], [-30, -30], [30, -30],
  ];
  const nodes = pts.map(([x, z]) => ({ x, z, links: [] }));
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x, dz = nodes[i].z - nodes[j].z;
      const d = Math.hypot(dx, dz);
      if (d < 17 && hasLOS(nodes[i].x, nodes[i].z, nodes[j].x, nodes[j].z, colliders)) {
        nodes[i].links.push(j); nodes[j].links.push(i);
      }
    }
  }

  // Charge prop: blinking beacon box (visibility driven by main.js)
  const chargeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.3, 0.8),
    new THREE.MeshStandardMaterial({ color: 0xff2a1a, emissive: 0xff2a1a, emissiveIntensity: 1.2 }));
  chargeMesh.position.set(0, 0.75, 30); chargeMesh.visible = false;
  scene.add(chargeMesh);
  const chargeLight = new THREE.PointLight(0xff2a1a, 12, 10, 1.5);
  chargeLight.position.copy(chargeMesh.position); chargeLight.visible = false;
  scene.add(chargeLight);

  return {
    colliders, nodes,
    sites: { A: { x: -32, z: -22, name: 'Furnace' }, B: { x: 32, z: -22, name: 'Crane Dock' } },
    spawnAttack: [[-40, 30], [-30, 30], [-14, 30], [0, 30], [14, 30]],
    spawnDefend: [[-32, -26], [-14, -30], [0, -30], [14, -30], [32, -26]],
    chargeMesh, chargeLight,
  };
}
