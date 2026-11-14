// Bots: the other eight players. Two ally bots (Cinder, with the player) and four
// enemy bots (Slag). A bot is a body (actors.js) plus a brain: a waypoint path, a
// state (push / hold / plant / defuse / hunt), a reaction timer, and burst fire.
// Defenders hold site angles and rotate on sound; attackers push a lane in a
// pair; the charge carrier plants when the site is clear; on a plant everyone
// converges and one defender channels the defuse. Bots stop to shoot — moving
// fire is as inaccurate for them as it is for the player.
import * as THREE from 'three';
import { BODY, createBody, applyDamage, eyePosition } from './actors.js';
import { WEAPONS, createGun, damageAt } from './weapons.js';
import { MAP, siteAt } from './map.js';
import { nearestNode, findPath, nodePosition } from './nav.js';
import { resolveShot } from './combat.js';
import { range } from './rng.js';

const BOT_NAMES = {
  cinder: ['Rook', 'Ash'],
  slag: ['Vex', 'Marrow', 'Soot', 'Gravel'],
};
const BOT_SKILL = [0.9, 1.0, 1.1, 1.25]; // reaction/accuracy scale per bot index
const THINK_EVERY = 0.15;
const SEE_RANGE = 42;
const FOV_COS = Math.cos((110 * Math.PI) / 180 / 2);

const _eye = new THREE.Vector3();
const _target = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _toTarget = new THREE.Vector3();

export function createBots(scene, world, random) {
  const list = [];
  const torsoGeo = new THREE.BoxGeometry(0.54, 0.8, 0.32);
  const headGeo = new THREE.SphereGeometry(0.16, 14, 10);
  const gunGeo = new THREE.BoxGeometry(0.08, 0.09, 0.62);
  const visorGeo = new THREE.BoxGeometry(0.3, 0.06, 0.05);
  const shoulderGeo = new THREE.BoxGeometry(0.56, 0.1, 0.34);
  const torsoMatCinder = new THREE.MeshStandardMaterial({ color: new THREE.Color('#4a5a52'), roughness: 0.8 });
  const torsoMatSlag = new THREE.MeshStandardMaterial({ color: new THREE.Color('#5a4636'), roughness: 0.8 });
  const headMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2b2620'), roughness: 0.6, metalness: 0.2 });
  const gunMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#171310'), roughness: 0.5, metalness: 0.4 });
  const visorCinder = new THREE.MeshBasicMaterial({ color: new THREE.Color('#57c785') });
  const visorSlag = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff5a4e') });

  function buildMesh(team) {
    const group = new THREE.Group();
    const torso = new THREE.Mesh(torsoGeo, team === 'cinder' ? torsoMatCinder : torsoMatSlag);
    torso.position.y = 1.0;
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.58;
    const visor = new THREE.Mesh(visorGeo, team === 'cinder' ? visorCinder : visorSlag);
    visor.position.set(0, 1.6, 0.14);
    const gun = new THREE.Mesh(gunGeo, gunMat);
    gun.position.set(0.28, 1.05, -0.25);
    const shoulder = new THREE.Mesh(shoulderGeo, team === 'cinder' ? visorCinder : visorSlag);
    shoulder.position.y = 1.38;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.24), headMat);
    legL.position.set(-0.14, 0.3, 0);
    const legR = legL.clone();
    legR.position.x = 0.14;
    group.add(torso, head, visor, gun, shoulder, legL, legR);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    scene.add(group);
    return { group, torso, head, gun, legL, legR };
  }

  function makeBot(team, index, spawn) {
    const name = BOT_NAMES[team][index];
    const body = createBody(spawn[0], spawn[1], team === 'cinder' ? 0 : Math.PI);
    const gunDef = team === 'cinder' ? WEAPONS.rifle : WEAPONS.rifle;
    const gun = createGun(gunDef);
    const mesh = buildMesh(team);
    const bot = {
      kind: 'bot', team, index, name, body, gun, mesh,
      state: 'hold', path: [], pathIndex: 0, holdNode: null, holdYaw: 0,
      target: null, seenAt: -10, reactionUntil: 0, burstLeft: 0, burstAt: 0,
      thinkAt: random() * THINK_EVERY, strafeAt: 0, strafeDir: 0,
      hearPos: null, hearAt: -10, plantAt: 0, defuseAt: 0, walkPhase: random() * 6,
      skill: BOT_SKILL[index % BOT_SKILL.length],
      lane: null, site: null, isCarrier: false, lastShotAt: -10,
    };
    list.push(bot);
    return bot;
  }

  for (let i = 0; i < 2; i += 1) makeBot('cinder', i, MAP.spawns.attack[i + 1] || MAP.spawns.attack[0]);
  for (let i = 0; i < 4; i += 1) makeBot('slag', i, MAP.spawns.defend[i]);

  function reset(roundNumber) {
    // Defenders: two hold A angles, one holds B, one roams mid. Attackers push a
    // lane each; the first ally carries the charge when the player is not.
    const lanes = ['long', 'mid', 'short'];
    const lanePick = lanes[Math.floor(random() * lanes.length)];
    list.forEach((bot) => {
      bot.body.health = BODY.maxHealth;
      bot.body.armor = 0;
      bot.body.alive = true;
      bot.body.velocity.set(0, 0, 0);
      bot.gun.refill();
      bot.target = null;
      bot.seenAt = -10;
      bot.burstLeft = 0;
      bot.hearPos = null;
      bot.isCarrier = false;
      bot.mesh.group.rotation.set(0, 0, 0);
      bot.mesh.group.visible = true;
      if (bot.team === 'cinder') {
        const spawn = MAP.spawns.attack[bot.index + 1] || MAP.spawns.attack[0];
        bot.body.position.set(spawn[0], 0, spawn[1]);
        bot.body.yaw = 0;
        bot.lane = bot.index === 0 ? lanePick : lanes[(lanes.indexOf(lanePick) + 1) % 3];
        bot.state = 'push';
        bot.path = pathForLane(bot.lane, random);
        bot.pathIndex = 0;
      } else {
        const spawn = MAP.spawns.defend[bot.index];
        bot.body.position.set(spawn[0], 0, spawn[1]);
        bot.body.yaw = Math.PI;
        bot.state = 'hold';
        const holds = ['siteA', 'siteB', 'midNorth', 'defEast'];
        bot.holdNode = holds[bot.index];
        bot.holdYaw = holdYawFor(bot.holdNode, random);
        bot.path = [];
        bot.pathIndex = 0;
      }
    });
    // The charge rides with the player; ally bots only carry it if told to.
    return list;
  }

  function pathForLane(lane, rnd) {
    const starts = { long: 'longSouth', mid: 'midLow', short: 'shortSouth' };
    const ends = { long: 'siteA', mid: 'midNorth', short: 'siteB' };
    void rnd;
    const start = starts[lane];
    const from = nearestNode(0, 15);
    const first = findPath(from, start);
    const second = findPath(start, ends[lane]);
    return first.concat(second.slice(1));
  }

  function holdYawFor(node, rnd) {
    // Defenders face south, toward the attackers' approaches.
    const table = { siteA: Math.PI, siteB: Math.PI, midNorth: Math.PI, defEast: Math.PI * 0.8 };
    return (table[node] || Math.PI) + (rnd() - 0.5) * 0.4;
  }

  // Line of sight: eye to the target's chest, blocked only by world geometry.
  function canSee(state, bot, targetBody) {
    eyePosition(bot.body, _eye);
    _target.set(targetBody.position.x, targetBody.position.y + 1.1, targetBody.position.z);
    _toTarget.subVectors(_target, _eye);
    const dist = _toTarget.length();
    if (dist > SEE_RANGE) return false;
    _toTarget.normalize();
    const forward = _dir.set(-Math.sin(bot.body.yaw), 0, -Math.cos(bot.body.yaw));
    if (forward.dot(_toTarget) < FOV_COS && dist > 4) return false;
    const hit = state.raycaster;
    hit.set(_eye, _toTarget);
    hit.far = dist;
    const blocked = hit.intersectObjects(state.world.shootables, false)[0];
    return !blocked;
  }

  function nearestVisibleEnemy(state, bot) {
    let best = null;
    let bestDist = Infinity;
    const enemies = bot.team === 'cinder' ? state.enemiesOfCinder : state.enemiesOfSlag;
    for (const actor of enemies) {
      if (!actor.body.alive) continue;
      const dx = actor.body.position.x - bot.body.position.x;
      const dz = actor.body.position.z - bot.body.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= bestDist) continue;
      if (canSee(state, bot, actor.body)) {
        best = actor;
        bestDist = dist;
      }
    }
    return best ? { actor: best, dist: bestDist } : null;
  }

  function setPathTo(bot, nodeName) {
    const from = nearestNode(bot.body.position.x, bot.body.position.z);
    bot.path = findPath(from, nodeName);
    bot.pathIndex = 0;
  }

  function stepBot(state, bot, dt) {
    const body = bot.body;
    if (!body.alive) {
      // Fallen: lie flat where the body dropped, then stay there.
      bot.mesh.group.position.set(body.position.x, body.position.y, body.position.z);
      bot.mesh.group.rotation.x = -Math.PI / 2;
      return;
    }
    bot.thinkAt -= dt;
    bot.gun.step(dt);

    // --- Think (10 Hz, staggered): pick a target, react, choose a goal. ---
    // Bots only fight once the round is live (or the charge is planted); the
    // buy phase is for moving into position, not for shooting.
    if (bot.thinkAt <= 0) {
      bot.thinkAt = THINK_EVERY + random() * 0.06;
      const fightingPhase = state.phase === 'live' || state.phase === 'planted';
      const seen = fightingPhase ? nearestVisibleEnemy(state, bot) : null;
      if (seen) {
        if (!bot.target) {
          bot.reactionUntil = state.time + (0.35 + random() * 0.3) * bot.skill;
        }
        bot.target = seen.actor;
        bot.seenAt = state.time;
        bot.lastSeenX = seen.actor.body.position.x;
        bot.lastSeenZ = seen.actor.body.position.z;
      } else if (bot.target && state.time - bot.seenAt > 1.2) {
        bot.target = null;
      }
      // Goal selection by phase.
      if (state.phase === 'planted') {
        if (bot.team === 'slag') {
          if (state.charge.defuser === bot) {
            bot.state = 'defuse';
          } else if (!state.charge.defuser && bot.index === 0) {
            state.charge.defuser = bot;
            bot.state = 'defuse';
          } else {
            bot.state = 'hunt';
            if (bot.path.length === 0 || bot.path[bot.path.length - 1] !== state.charge.siteNode) {
              setPathTo(bot, state.charge.siteNode);
            }
          }
        } else {
          bot.state = 'hold';
          if (bot.path.length === 0) setPathTo(bot, state.charge.siteNode);
        }
      } else if (state.phase === 'live') {
        if (bot.team === 'slag' && bot.hearPos && state.time - bot.hearAt < 6 && bot.state === 'hold') {
          // A shot nearby pulls one defender off its angle to investigate.
          if (bot.index === 3) {
            bot.state = 'hunt';
            const node = nearestNode(bot.hearPos.x, bot.hearPos.z);
            setPathTo(bot, node);
          }
        }
        if (bot.team === 'cinder' && bot.isCarrier && bot.state === 'push') {
          const site = siteAt(body.position.x, body.position.z);
          if (site && !bot.target) {
            bot.state = 'plant';
            bot.plantAt = state.time;
          }
        }
      }
    }

    // --- Aim: face the target when fighting, the path when walking. ---
    let moveX = 0;
    let moveZ = 0;
    let speed = 0;
    let wantCrouch = false;
    const fighting = !!bot.target && state.time >= bot.reactionUntil;
    if (bot.state === 'plant') {
      // Stand still, channel the plant.
      if (state.time - bot.plantAt >= MAP.plantSeconds) {
        state.events.push({ type: 'planted', by: bot });
      }
    } else if (bot.state === 'defuse') {
      const charge = state.charge;
      const dx = charge.pos.x - body.position.x;
      const dz = charge.pos.z - body.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 1.6) {
        const w = moveTo(state, bot, charge.pos.x, charge.pos.z, dt);
        moveX = w.x;
        moveZ = w.z;
        speed = 4.4;
      } else if (!bot.target) {
        charge.defuseProgress += dt;
        if (charge.defuseProgress >= MAP.defuseSeconds) {
          state.events.push({ type: 'defused', by: bot });
        }
      }
    } else if (fighting) {
      // Face the target, strafe sideways, stop to shoot straight.
      aimAt(bot, bot.target.body.position.x, bot.target.body.position.y + 1.2, bot.target.body.position.z, dt);
      if (bot.strafeAt <= state.time) {
        bot.strafeAt = state.time + 0.7 + random() * 0.7;
        bot.strafeDir = random() < 0.5 ? -1 : 1;
      }
      const still = bot.burstLeft > 0;
      if (!still) {
        const w = state.mover.wishFromYaw(body.yaw, 0, bot.strafeDir);
        moveX = w.x;
        moveZ = w.z;
        speed = 2.6;
      }
      wantCrouch = random() < 0.001;
    } else if (bot.state === 'hold' && bot.holdNode) {
      const node = nodePosition(bot.holdNode);
      const dx = node.x - body.position.x;
      const dz = node.z - body.position.z;
      if (Math.hypot(dx, dz) > 0.6) {
        const w = moveTo(state, bot, node.x, node.z, dt);
        moveX = w.x;
        moveZ = w.z;
        speed = 4.0;
      } else {
        body.yaw += (bot.holdYaw - body.yaw) * Math.min(1, dt * 4);
      }
      wantCrouch = true;
    } else if (bot.path.length > 0) {
      const nodeName = bot.path[Math.min(bot.pathIndex, bot.path.length - 1)];
      const node = nodePosition(nodeName);
      const dx = node.x - body.position.x;
      const dz = node.z - body.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.7) {
        bot.pathIndex += 1;
        if (bot.pathIndex >= bot.path.length) {
          bot.path = [];
          if (bot.state === 'push') {
            // Reached the lane end: hold the site approach.
            bot.state = 'hold';
            bot.holdNode = bot.path.length ? null : nodeName;
            bot.holdYaw = body.yaw;
          }
        }
      } else {
        const w = moveTo(state, bot, node.x, node.z, dt);
        moveX = w.x;
        moveZ = w.z;
        speed = bot.team === 'cinder' ? 4.6 : 4.2;
      }
    }

    state.mover.setCrouch(body, wantCrouch);
    const moverSpeed = body.crouching ? 2.4 : speed;
    state.mover.stepBody(body, dt, moveX, moveZ, moverSpeed, false);

    // --- Fire bursts at the target. ---
    if (fighting && bot.gun.ready() && bot.burstLeft <= 0 && state.time >= bot.burstAt) {
      bot.burstLeft = 2 + Math.floor(random() * 3);
    }
    if (fighting && bot.burstLeft > 0 && bot.gun.ready()) {
      botFire(state, bot);
      bot.burstLeft -= 1;
      if (bot.burstLeft === 0) bot.burstAt = state.time + 0.7 + random() * 0.5;
    }

    // --- Mesh follows the body. ---
    const mesh = bot.mesh.group;
    mesh.position.set(body.position.x, body.position.y, body.position.z);
    mesh.rotation.y = body.yaw;
    const moving = state.mover.groundSpeed(body) > 0.5;
    bot.walkPhase += dt * (moving ? 9 : 0);
    mesh.position.y = body.position.y + (moving ? Math.abs(Math.sin(bot.walkPhase)) * 0.04 : 0);
    mesh.rotation.x = 0;
  }

  // Turn toward a point and return the forward wish vector for the mover.
  function moveTo(state, bot, x, z, dt) {
    const body = bot.body;
    const dx = x - body.position.x;
    const dz = z - body.position.z;
    const targetYaw = Math.atan2(-dx, -dz);
    let diff = targetYaw - body.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    body.yaw += Math.max(-3.4 * dt, Math.min(3.4 * dt, diff));
    return state.mover.wishFromYaw(body.yaw, 1, 0);
  }

  function aimAt(bot, x, y, z, dt) {
    const body = bot.body;
    const dx = x - body.position.x;
    const dy = y - (body.position.y + body.eye);
    const dz = z - body.position.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const targetYaw = Math.atan2(-dx, -dz);
    const targetPitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
    let diff = targetYaw - body.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    body.yaw += Math.max(-6 * dt, Math.min(6 * dt, diff));
    body.pitch += Math.max(-6 * dt, Math.min(6 * dt, targetPitch - body.pitch));
  }

  function botFire(state, bot) {
    if (!bot.target) return;
    const gun = bot.gun;
    if (!gun.fire()) return;
    const targetBody = bot.target.body;
    eyePosition(bot.body, _eye);
    _target.set(targetBody.position.x, targetBody.position.y + 1.05, targetBody.position.z);
    _dir.subVectors(_target, _eye).normalize();
    // Aim error: grows with distance and target speed, shrinks when the bot
    // stands still. Skill scales it down. A bot at 12 m still misses about
    // half its shots, so a peek costs health instead of a life.
    const dist = _eye.distanceTo(_target);
    const targetSpeed = state.mover.groundSpeed(targetBody);
    const error = (0.03 + dist * 0.002 + targetSpeed * 0.006) * bot.skill;
    _dir.x += (random() * 2 - 1) * error;
    _dir.y += (random() * 2 - 1) * error;
    _dir.z += (random() * 2 - 1) * error;
    _dir.normalize();
    const result = resolveShot(state, bot, _eye, _dir, gun.def, dist);
    bot.lastShotAt = state.time;
    state.audio.distantShot();
    state.events.push({ type: 'shot', pos: { x: bot.body.position.x, z: bot.body.position.z }, team: bot.team });
    if (result && result.actor) {
      state.events.push({ type: 'hit', victim: result.actor, killer: bot, part: result.part, damage: result.damage });
    }
  }

  function step(state, dt) {
    for (const bot of list) stepBot(state, bot, dt);
  }

  function hearShot(pos, team, time) {
    for (const bot of list) {
      if (!bot.body.alive || bot.team === team) continue;
      const dx = bot.body.position.x - pos.x;
      const dz = bot.body.position.z - pos.z;
      if (Math.hypot(dx, dz) < 26) {
        bot.hearPos = { x: pos.x, z: pos.z };
        bot.hearAt = time;
      }
    }
  }

  return { list, reset, step, hearShot, canSee };
}
