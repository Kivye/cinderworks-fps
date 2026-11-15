// bots.js — 5v5 bot brains: roles, A* routes, vision, bursts, grenades, plant/defuse.
// Bots are entities {x,z,yaw,hp,alive,...} with three.js body meshes + name tags.
import * as THREE from 'three';
import { pickBotLoadout, WEAPONS, COMMS, ALLY_NAMES, ENEMY_NAMES, ALLY_ROLES, ENEMY_ROLES } from './state.js';
import { route, hasLOS, pointBlocked, dist2 } from './nav.js';
import { traceShot, falloff, inSmoke, throwGrenade } from './weapons.js';
import { nameTexture } from './textures.js';

const BODY_H = 1.75;
const SPEEDS = { carrier: 4.1, entry: 4.6, support: 4.2, holder: 3.6, roamer: 4.4 };

export function makeBot(scene, name, role, team, x, z) {
  const color = team === 0 ? 0x2fae5f : 0xd84a2a;
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 1.15, 10), bodyMat);
  body.position.y = 0.85; body.castShadow = true; group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xd9b48a, roughness: 0.8 }));
  head.position.y = 1.62; head.castShadow = true; group.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2, metalness: 0.6 }));
  visor.position.set(0, 1.64, 0.2); group.add(visor);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.85),
    new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.4, metalness: 0.6 }));
  gun.position.set(0.3, 1.15, 0.4); group.add(gun);
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTexture(name, team === 0 ? '#7dff9e' : '#ff9a7d'), transparent: true, depthTest: false }));
  tag.scale.set(2.2, 0.55, 1); tag.position.y = 2.15; group.add(tag);
  group.position.set(x, 0, z);
  scene.add(group);
  return {
    name, role, team, x, z, yaw: 0, hp: 100, alive: true,
    weapon: 'pistol', ammo: 12, reserve: 48, armour: false, frag: 0, smoke: 0, money: 800,
    path: [], pathI: 0, thinkT: Math.random() * 0.3, burst: 0, fireT: 0, reloadT: 0,
    mode: 'move', holdX: x, holdZ: z, holdYaw: 0, site: 'A',
    stuckX: x, stuckZ: z, stuckT: 0, plantT: 0, defuseT: 0, saidT: 0,
    group, bodyMat, speed: SPEEDS[role] || 4.2,
    get headY() { return 1.62; },
  };
}

export function spawnTeams(scene, world, state) {
  const bots = [];
  world.spawnAttack.forEach(([x, z], i) => {
    if (i === 0) return; // slot 0 is the player
    bots.push(makeBot(scene, ALLY_NAMES[i - 1], ALLY_ROLES[i - 1], 0, x, z));
  });
  world.spawnDefend.forEach(([x, z], i) => {
    bots.push(makeBot(scene, ENEMY_NAMES[i], ENEMY_ROLES[i], 1, x, z));
  });
  return bots;
}

// Economy: each bot gets round money, then buys its role loadout.
export function buyBotLoadouts(bots, state) {
  for (const b of bots) {
    b.money += 800;
    const load = pickBotLoadout(b.role, b.money);
    b.money -= WEAPONS[load.weapon].price;
    if (load.armour) b.money -= 650;
    b.money -= (load.frag + load.smoke) * 300;
    if (b.money < 0) b.money = 0;
    b.weapon = load.weapon;
    b.ammo = WEAPONS[load.weapon].mag;
    b.reserve = WEAPONS[load.weapon].reserve;
    b.armour = load.armour; b.frag = load.frag; b.smoke = load.smoke;
  }
}

// Vision: range + front cone + LOS + smoke blocks.
// Player yaw faces -z (camera), bots face +z convention: forward angle differs by PI.
export function canSee(a, b, world, state) {
  const d = dist2(a.x, a.z, b.x, b.z);
  if (d > 46) return false;
  const ang = Math.atan2(b.x - a.x, b.z - a.z);
  const fwd = a.isPlayer ? a.yaw + Math.PI : a.yaw;
  let diff = Math.abs(((ang - fwd) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
  if (diff > 1.15) return false;
  if (!hasLOS(a.x, a.z, b.x, b.z, world.colliders)) return false;
  if (inSmoke(b.x, b.z, state.smokes)) return false;
  const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
  if (inSmoke(mx, mz, state.smokes)) return false;
  return true;
}
function nearestEnemy(bot, entities) {
  let best = null, bd = Infinity;
  for (const e of entities) {
    if (!e.alive || e.team === bot.team) continue;
    const d = dist2(bot.x, bot.z, e.x, e.z);
    if (d < bd) { bd = d; best = e; }
  }
  return { e: best, d: bd };
}
function setRoute(bot, world, tx, tz) {
  bot.path = route(world.nodes, world.colliders, bot.x, bot.z, tx, tz);
  bot.pathI = 0;
}
function moveAlong(bot, dt, world) {
  if (bot.pathI >= bot.path.length) return true;
  const p = bot.path[bot.pathI];
  const dx = p.x - bot.x, dz = p.z - bot.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.5) { bot.pathI++; return bot.pathI >= bot.path.length; }
  const sp = bot.speed * dt;
  let nx = bot.x + (dx / d) * sp, nz = bot.z + (dz / d) * sp;
  // Circle-vs-AABB slide: try x then z separately.
  if (!pointBlocked(nx, bot.z, world.colliders)) bot.x = nx;
  if (!pointBlocked(bot.x, nz, world.colliders)) bot.z = nz;
  bot.yaw = Math.atan2(dx, dz);
  return false;
}

// One bot, one tick. ctx: {world, state, player, bots, dt, time,
//   damage(target, dmg, shooter, head), say(text, team), plantDone(), defuseDone()}
export function updateBot(bot, dt, ctx) {
  const { world, state, player, bots, time } = ctx;
  if (!bot.alive) { bot.group.visible = false; return; }
  bot.group.visible = true;
  bot.thinkT -= dt;
  bot.fireT -= dt;
  if (bot.reloadT > 0) { bot.reloadT -= dt; if (bot.reloadT <= 0) { bot.ammo = WEAPONS[bot.weapon].mag; } }

  // Stuck recovery: barely moved in 2 s -> re-path to current goal.
  const moved = dist2(bot.x, bot.z, bot.stuckX, bot.stuckZ);
  if (moved > 0.6) { bot.stuckX = bot.x; bot.stuckZ = bot.z; bot.stuckT = 0; }
  else {
    bot.stuckT += dt;
    if (bot.stuckT > 2 && bot.pathI < bot.path.length) {
      bot.stuckT = 0;
      const goal = bot.path[bot.path.length - 1];
      setRoute(bot, world, goal.x + (Math.random() - 0.5) * 3, goal.z + (Math.random() - 0.5) * 3);
    }
  }

  const entities = [player, ...bots];
  const { e: foe, d: foeD } = nearestEnemy(bot, entities);
  const planted = state.charge.state === 'planted';
  const charge = state.charge;

  // --- Decide goal every think tick ---
  if (bot.thinkT <= 0) {
    bot.thinkT = 0.25 + Math.random() * 0.15;
    const site = world.sites[bot.site];
    if (bot.team === 0) {
      if (planted) { bot.mode = 'hold'; bot.holdX = site.x; bot.holdZ = site.z; }
      else if (charge.state === 'dropped') { bot.mode = 'move'; setRoute(bot, world, charge.x, charge.z); }
      else if (bot.role === 'carrier') {
        bot.mode = 'move';
        const atSite = dist2(bot.x, bot.z, site.x, site.z) < 3.5;
        if (atSite) bot.mode = 'plant';
        else if (bot.pathI >= bot.path.length) setRoute(bot, world, site.x, site.z);
      } else if (bot.role === 'entry') {
        bot.mode = 'move';
        if (bot.pathI >= bot.path.length) setRoute(bot, world, site.x + (Math.random() - 0.5) * 6, site.z + (Math.random() - 0.5) * 6);
      } else if (bot.role === 'support') {
        const carrier = bots.find((b) => b.role === 'carrier' && b.team === 0 && b.alive);
        bot.mode = 'move';
        if (carrier && dist2(bot.x, bot.z, carrier.x, carrier.z) > 5) setRoute(bot, world, carrier.x, carrier.z);
        else if (bot.pathI >= bot.path.length) setRoute(bot, world, site.x, site.z);
      } else { // holder: mid hold
        bot.mode = 'hold'; bot.holdX = 0; bot.holdZ = 8; bot.holdYaw = Math.PI;
      }
    } else {
      if (planted) {
        bot.mode = 'move';
        const s2 = world.sites[charge.site];
        if (dist2(bot.x, bot.z, s2.x, s2.z) < 2.5) bot.mode = 'defuse';
        else if (bot.pathI >= bot.path.length) setRoute(bot, world, s2.x, s2.z);
      } else if (bot.role === 'holder') {
        bot.mode = 'hold';
        const s2 = world.sites[bot.site];
        bot.holdX = s2.x + (bot.name === 'Rook' ? -4 : 4); bot.holdZ = s2.z + 5;
        bot.holdYaw = Math.atan2(s2.x - bot.holdX, s2.z - bot.holdZ);
      } else { // roamer patrol
        bot.mode = 'move';
        if (bot.pathI >= bot.path.length) {
          const spots = [[0, 0], [0, 14], [-14, -12], [14, -12], [bot.site === 'A' ? -24 : 24, -22]];
          const s = spots[Math.floor(Math.random() * spots.length)];
          setRoute(bot, world, s[0], s[1]);
        }
      }
    }
    // Occasional short comms from attackers.
    if (bot.team === 0 && time - bot.saidT > 14 && Math.random() < 0.35) {
      bot.saidT = time;
      ctx.say(COMMS[Math.floor(Math.random() * COMMS.length)], 0);
    }
    // Support throws smoke at the site approach once per round.
    if (bot.role === 'support' && bot.smoke > 0 && dist2(bot.x, bot.z, site.x, site.z) < 22) {
      bot.smoke--;
      const dir = { x: site.x - bot.x, y: 0.3, z: site.z - bot.z };
      const len = Math.hypot(dir.x, dir.z) || 1;
      ctx.throwGrenade({ x: bot.x, y: 1.5, z: bot.z }, { x: dir.x / len, y: 0.25, z: dir.z / len }, 'smoke', 0);
      ctx.say('smoke out mid', 0);
    }
    // Entry throws frag when a foe is near but unseen.
    if (bot.role === 'entry' && bot.frag > 0 && foe && foeD < 18 && !canSee(bot, foe, world, state)) {
      bot.frag--;
      ctx.throwGrenade({ x: bot.x, y: 1.5, z: bot.z }, { x: (foe.x - bot.x) / foeD, y: 0.3, z: (foe.z - bot.z) / foeD }, 'frag', 0);
    }
  }

  // --- Act by mode ---
  if (bot.mode === 'move') {
    moveAlong(bot, dt, world);
    // Pickup dropped charge by walking over it.
    if (bot.team === 0 && charge.state === 'dropped' && dist2(bot.x, bot.z, charge.x, charge.z) < 1.3) {
      charge.state = 'carried'; charge.carrier = bot; ctx.say('charge picked up', 0);
    }
  } else if (bot.mode === 'hold') {
    bot.yaw = bot.holdYaw + Math.sin(time * 0.5 + bot.x) * 0.35;
  } else if (bot.mode === 'plant') {
    bot.plantT += dt;
    if (bot.plantT >= 3) { bot.plantT = 0; ctx.plantDone(bot); }
  } else if (bot.mode === 'defuse') {
    bot.defuseT += dt;
    if (bot.defuseT >= 5) { bot.defuseT = 0; ctx.defuseDone(bot); }
  }

  // --- Combat: burst fire at visible foes with real ray traces ---
  if (foe && canSee(bot, foe, world, state) && bot.reloadT <= 0) {
    const w = WEAPONS[bot.weapon];
    bot.yaw = Math.atan2(foe.x - bot.x, foe.z - bot.z);
    if (bot.burst <= 0 && bot.fireT <= 0) bot.burst = 3 + Math.floor(Math.random() * 3);
    if (bot.burst > 0 && bot.fireT <= 0) {
      bot.fireT = w.rate * (1.6 + Math.random() * 0.8);
      bot.burst--;
      if (bot.ammo <= 0) { bot.reloadT = w.reload; bot.ammo = 0; }
      else {
        bot.ammo--;
        const spread = w.spread + foeD * 0.00045 + (bot.pathI < bot.path.length ? w.moveSpread : 0);
        const ox = bot.x, oy = 1.5, oz = bot.z;
        const tx = foe.x + (Math.random() - 0.5) * spread * foeD * 2;
        const tz = foe.z + (Math.random() - 0.5) * spread * foeD * 2;
        const ty = 1.1 + Math.random() * 0.6;
        const len = Math.hypot(tx - ox, ty - oy, tz - oz) || 1;
        const d = { x: (tx - ox) / len, y: (ty - oy) / len, z: (tz - oz) / len };
        const targets = entities.filter((e) => e.alive && e.team !== bot.team).map((e) => ({
          x: e.x, z: e.z, alive: e.alive, headY: e.headY || 1.62, ref: e,
        }));
        const hit = traceShot({ x: ox, y: oy, z: oz }, d, world.colliders, targets, 90);
        if (hit.kind === 'head' || hit.kind === 'body') {
          const dmg = Math.round(w.dmg * falloff(w, hit.dist) * (hit.kind === 'head' ? w.head : 1) * (0.8 + Math.random() * 0.4));
          ctx.damage(hit.target.ref, dmg, bot, hit.kind === 'head');
        }
        ctx.botShot(bot, w.kind);
      }
    }
  } else if (bot.burst > 0 && bot.fireT <= 0) {
    bot.burst = 0;
  }
  if (bot.ammo === 0 && bot.reloadT <= 0) bot.reloadT = WEAPONS[bot.weapon].reload;

  // Sync mesh.
  bot.group.position.set(bot.x, 0, bot.z);
  bot.group.rotation.y = bot.yaw;
}
