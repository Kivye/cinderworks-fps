// main.js — Cinderworks v3 bootstrap + fixed-step simulation + rendering.
// Sim runs at 60 Hz fixed steps, fully separate from render; HUD/minimap read state.
import * as THREE from 'three';
import { TICK, ROUND_TIME, BUY_TIME, PLANT_TIME, DEFUSE_TIME, FUSE_TIME, MATCH_WIN, EYE, CROUCH_EYE, WEAPONS, GRENADE, ARMOUR_PRICE, WEAPON_ORDER, ALLY_NAMES, ENEMY_NAMES, makeState, rng } from './state.js';
import { traceShot, falloff, recoilFor, throwGrenade, stepGrenades, fragDamage, inSmoke } from './weapons.js';
import { route, hasLOS, pointBlocked, dist2 } from './nav.js';
import { spawnTeams, buyBotLoadouts, updateBot, canSee } from './bots.js';
import { buildWorld } from './world.js';
import { Hud } from './hud.js';
import { Sfx } from './audio.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');
const SEED = Number(params.get('seed') || 7);
const TEST = params.get('test') === '1';
const rand = rng(SEED * 7919 + 13);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.45;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.08, 400);
camera.rotation.order = 'YXZ';
scene.add(camera);

const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x9a8a68, 1.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d0, 2.4);
sun.position.set(45, 70, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -55; sun.shadow.camera.right = 55;
sun.shadow.camera.top = 55; sun.shadow.camera.bottom = -55;
sun.shadow.camera.far = 180;
scene.add(sun);

const world = buildWorld(scene);
const hud = new Hud(document.body, world);
const sfx = new Sfx();
const state = makeState();
state.seed = SEED;

const tmpV = new THREE.Vector3();
const tmpD = new THREE.Vector3();

// --- Viewmodel gun (attached to camera) ---
const gunMat = new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: 0.35, metalness: 0.7 });
const gun = new THREE.Group();
const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.62), gunMat);
gun.add(gunBody);
const gunBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8), gunMat);
gunBarrel.rotation.x = Math.PI / 2; gunBarrel.position.set(0, 0.02, -0.42);
gun.add(gunBarrel);
const gunSight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.03), new THREE.MeshStandardMaterial({ color: 0xffb020, emissive: 0xffb020, emissiveIntensity: 0.6 }));
gunSight.position.set(0, 0.1, -0.1);
gun.add(gunSight);
gun.position.set(0.24, -0.27, -0.5);
gun.scale.setScalar(0.62);
camera.add(gun);

// Tracer (one reusable line) + explosion flash (one reusable mesh).
const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0 });
const tracerGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const tracer = new THREE.Line(tracerGeo, tracerMat);
scene.add(tracer);
let tracerT = 0;
const boomMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10),
  new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0 }));
scene.add(boomMesh);
let boomT = 0;
const smokeMeshes = [];

// --- Player entity ---
const player = {
  name: 'You', team: 0, isPlayer: true, x: -30, z: 30, yaw: Math.PI, pitch: 0, hp: 100, alive: true,
  weapon: 'pistol', ammo: 12, reserve: 48, armour: false, frag: 0, smoke: 0,
  owned: new Set(['pistol']), money: 800, vx: 0, vz: 0, crouch: false, ads: false,
  shotIdx: 0, fireT: 0, reloadT: 0, recoilP: 0, recoilY: 0, bobT: 0,
  get headY() { return player.crouch ? CROUCH_EYE : EYE; },
};
let bots = [];
let attackSite = 'A';
let forceSite = null; // staging override (plant shot forces B)
let carrierBot = null;
let plantHold = 0, defuseHold = 0, interactLabel = '';
let roundEndT = 0;
let frames = 0;
let stageLock = false; // staged screenshots: freeze sim so the staged moment holds

function statsFor(name, team, role) {
  if (!state.stats[name]) state.stats[name] = { name, team, role, k: 0, d: 0 };
  return state.stats[name];
}
function say(text, team) {
  hud.pushComms(text, team);
  state.comms.push(text);
}
function feed(html) { hud.pushFeed(html); }

function awardMoney(n, why) {
  player.money += n;
  feed(`<span style="color:#ffd47a">+$${n} ${why}</span>`);
}

function damage(target, dmg, shooter, head) {
  if (!target.alive || state.phase !== 'live' && state.phase !== 'buy') return;
  let d = dmg;
  if (target.armour) d = Math.round(d * 0.5);
  target.hp -= d;
  if (target === player) {
    sfx.hurt();
    const ang = Math.atan2(shooter.x - player.x, shooter.z - player.z);
    hud.showHurt(ang - player.yaw + Math.PI);
  } else if (shooter === player) {
    sfx.hit(head);
  }
  if (target.hp <= 0) kill(target, shooter, head);
}
function kill(target, shooter, head) {
  target.hp = 0; target.alive = false;
  const ks = statsFor(shooter.name, shooter.team, shooter.role || 'player');
  const ds = statsFor(target.name, target.team, target.role || 'player');
  ks.k++; ds.d++;
  const sn = `<b style="color:${shooter.team === 0 ? '#7dff9e' : '#ff9a7d'}">${shooter.name}</b>`;
  const tn = `<b style="color:${target.team === 0 ? '#7dff9e' : '#ff9a7d'}">${target.name}</b>`;
  feed(`${sn} ${head ? '⌖ headshot ' : '✕ '} ${tn}`);
  if (shooter === player) { player.kills++; awardMoney(300, 'kill'); }
  if (target === player) player.deaths++;
  if (target === carrierBot || state.charge.carrier === target) {
    state.charge.state = 'dropped';
    state.charge.x = target.x; state.charge.z = target.z;
    state.charge.carrier = null;
    say('charge down!', 0);
    feed('<span style="color:#ff6a5a">⚠ charge dropped — pick it up</span>');
  }
  if (target.group) target.group.visible = false;
  checkRoundEnd();
}
function checkRoundEnd() {
  if (state.phase !== 'live') return;
  const atkAlive = (player.alive ? 1 : 0) + bots.filter((b) => b.alive && b.team === 0).length;
  const defAlive = bots.filter((b) => b.alive && b.team === 1).length;
  if (state.charge.state === 'planted') return; // fuse decides
  if (defAlive === 0) endRound(0, 'all defenders eliminated');
  else if (atkAlive === 0) endRound(1, 'attackers eliminated');
}
function endRound(winner, reason) {
  if (state.phase !== 'live') return;
  state.phase = 'end';
  state.winner = winner;
  state.score[winner]++;
  roundEndT = 4;
  const won = winner === 0;
  if (won) { awardMoney(3250, 'round win'); state.lossStreak = 0; sfx.win(); }
  else {
    state.lossStreak++;
    const bonus = Math.min(1900 + (state.lossStreak - 1) * 500, 3400);
    awardMoney(bonus, `round loss (streak ${state.lossStreak})`);
    sfx.lose();
  }
  hud.showBanner(won ? '🏆 ROUND WON' : '💥 ROUND LOST', `EMBER ${state.score[0]} — ${state.score[1]} ASH · ${reason}`, won ? '#7dff9e' : '#ff6a5a');
  feed(`<b>${won ? 'EMBER wins the round' : 'ASH wins the round'}</b> — ${reason}`);
}
function plantDone(byBot) {
  if (state.phase !== 'live' || state.charge.state !== 'carried') return;
  state.charge.state = 'planted';
  state.charge.site = attackSite;
  state.charge.fuse = FUSE_TIME;
  const s = world.sites[attackSite];
  state.charge.x = s.x; state.charge.z = s.z;
  if (byBot === player) awardMoney(300, 'plant');
  hud.showBanner('💣 CHARGE PLANTED', `${attackSite === 'A' ? 'Furnace' : 'Crane Dock'} — fuse ${FUSE_TIME}s`, '#ffb020');
  sfx.plantBeep(true);
  say('charge planted!', 0);
  feed(`<b style="color:#ffb020">💣 charge planted at ${attackSite}</b>`);
}
function defuseDone(byBot) {
  if (state.phase !== 'live' || state.charge.state !== 'planted') return;
  state.charge.state = 'defused';
  endRound(1, 'charge defused');
}
function explodeCharge() {
  state.charge.state = 'exploded';
  boomMesh.position.set(state.charge.x, 1, state.charge.z);
  boomT = 1;
  sfx.boom();
  // Blast hurts everyone near the site.
  const s = world.sites[state.charge.site];
  for (const e of [player, ...bots]) {
    if (!e.alive) continue;
    const d = dist2(e.x, e.z, s.x, s.z);
    if (d < 9) damage(e, Math.round(120 * (1 - d / 12)), { name: 'Charge', team: 0 }, false);
  }
  if (state.phase === 'live') endRound(0, 'charge detonated');
}

// --- Round setup ---
function resetBots() {
  for (const b of bots) scene.remove(b.group);
  bots = spawnTeams(scene, world, state);
  attackSite = forceSite || (rand() < 0.5 ? 'A' : 'B');
  for (const b of bots) {
    b.site = attackSite;
    if (b.team === 1) {
      if (b.name === 'Rook') b.site = 'A';
      else if (b.name === 'Sable') b.site = 'B';
      else if (b.name === 'Ferro') b.site = attackSite;
    }
    const spawn = b.team === 0 ? world.spawnAttack[ALLY_NAMES.indexOf(b.name) + 1] : world.spawnDefend[ENEMY_NAMES.indexOf(b.name)];
    b.x = spawn[0]; b.z = spawn[1];
    b.hp = 100; b.alive = true; b.path = []; b.pathI = 0; b.mode = 'move'; b.plantT = 0; b.defuseT = 0;
    b.group.visible = true;
    b.group.position.set(b.x, 0, b.z);
  }
  carrierBot = bots.find((b) => b.role === 'carrier');
  state.charge = { state: 'carried', x: carrierBot.x, z: carrierBot.z, carrier: carrierBot, plantProgress: 0, defuseProgress: 0, fuse: FUSE_TIME, site: null, blink: 0 };
  buyBotLoadouts(bots, state);
}
function startRound() {
  resetBots();
  const sp = world.spawnAttack[0];
  player.x = sp[0]; player.z = sp[1];
  player.yaw = 0; player.pitch = 0;
  player.hp = 100; player.alive = true; player.vx = 0; player.vz = 0;
  player.ammo = WEAPONS[player.weapon].mag;
  player.reserve = WEAPONS[player.weapon].reserve;
  state.phase = 'buy';
  state.timer = BUY_TIME;
  hud.clearBanner();
  hud.hideScoreboard();
  hud.el.comms.innerHTML = '';
  hud.openBuy(player.money, player.owned);
  say(attackSite === 'A' ? 'pushing A — Furnace' : 'pushing B — Crane Dock', 0);
}
function startMatch() {
  state.score = [0, 0]; state.round = 1; state.lossStreak = 0;
  player.money = 800; player.weapon = 'pistol'; player.owned = new Set(['pistol']);
  player.frag = 0; player.smoke = 0; player.armour = false;
  player.kills = 0; player.deaths = 0; state.stats = {};
  startRound();
  statsFor('You', 0, 'player');
  for (const b of bots) statsFor(b.name, b.team, b.role);
}
function endMatch() {
  state.phase = 'matchend';
  hud.closeBuy();
  const won = state.score[0] > state.score[1];
  hud.showBanner(won ? '🏆 MATCH WON' : '💥 MATCH LOST', `Final: EMBER ${state.score[0]} — ${state.score[1]} ASH · press R for rematch`, won ? '#7dff9e' : '#ff6a5a');
  const rows = Object.values(state.stats).sort((a, b) => b.k - a.k);
  hud.showScoreboard(rows, state.score, true, 'R = rematch');
  if (won) sfx.win(); else sfx.lose();
}

// --- Input ---
const keys = {};
let firing = false;
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyR') {
    if (state.phase === 'matchend') { startMatch(); return; }
    if (state.phase === 'live' && player.alive) startReload();
  }
  if (e.code === 'KeyB' && state.phase === 'buy') { hud.isBuyOpen() ? hud.closeBuy() : hud.openBuy(player.money, player.owned); }
  if (e.code === 'Escape') hud.closeBuy();
  if (e.code === 'Tab') { e.preventDefault(); showScoreboardNow(); }
  if (e.code === 'KeyG' && state.phase === 'live') throwPlayerGrenade('frag');
  if (e.code === 'KeyH' && state.phase === 'live') throwPlayerGrenade('smoke');
  if (hud.isBuyOpen()) {
    const buyMap = { Digit1: 'pistol', Digit2: 'smg', Digit3: 'shotgun', Digit4: 'rifle', Digit5: 'marksman', KeyG: 'frag', KeyH: 'smoke', Digit0: 'armour' };
    if (buyMap[e.code]) buyItem(buyMap[e.code]);
  } else if (/^Digit[1-5]$/.test(e.code)) {
    const id = WEAPON_ORDER[Number(e.code.slice(5)) - 1];
    if (player.owned.has(id)) switchWeapon(id);
  }
});
addEventListener('keyup', (e) => { keys[e.code] = false; if (e.code === 'Tab') hud.hideScoreboard(); });
addEventListener('mousedown', (e) => {
  if (e.target.closest('#buymenu') || e.target.closest('#scoreboard') || e.target.closest('#start')) return;
  if (e.button === 0) firing = true;
  if (e.button === 2) player.ads = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) firing = false; if (e.button === 2) player.ads = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  player.yaw -= e.movementX * 0.0021 * (player.ads ? 0.55 : 1);
  player.pitch -= e.movementY * 0.0021 * (player.ads ? 0.55 : 1);
  player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch));
});
hud.el.start.addEventListener('click', () => {
  sfx.ensure();
  hud.el.start.style.display = 'none';
  const p = renderer.domElement.requestPointerLock();
  if (p && p.catch) p.catch(() => {});
});
renderer.domElement.addEventListener('click', () => {
  if (hud.el.start.style.display !== 'none') return;
  if (document.pointerLockElement !== renderer.domElement) {
    const p = renderer.domElement.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  }
});
hud.el.buyList.addEventListener('click', (e) => {
  const row = e.target.closest('[data-buy]');
  if (row) buyItem(row.dataset.buy);
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function showScoreboardNow() {
  const rows = Object.values(state.stats).sort((a, b) => b.k - a.k);
  hud.showScoreboard(rows, state.score, state.phase === 'matchend', '');
}
function buyItem(id) {
  if (state.phase !== 'buy') return;
  if (id === 'frag' || id === 'smoke') {
    if (player.money < GRENADE[id].price) return;
    player.money -= GRENADE[id].price;
    player[id]++;
    sfx.click();
  } else if (id === 'armour') {
    if (player.money < ARMOUR_PRICE || player.armour) return;
    player.money -= ARMOUR_PRICE; player.armour = true; sfx.click();
  } else {
    const w = WEAPONS[id];
    if (!player.owned.has(id)) {
      if (player.money < w.price) return;
      player.money -= w.price;
      player.owned.add(id);
    }
    switchWeapon(id);
    sfx.click();
  }
  hud.openBuy(player.money, player.owned);
  hud.setRound(state.round, state.score, state.timer, state.phase, player.money);
}
function switchWeapon(id) {
  player.weapon = id;
  const w = WEAPONS[id];
  player.ammo = w.mag; player.reserve = w.reserve;
  player.shotIdx = 0; player.reloadT = 0;
}
function startReload() {
  const w = WEAPONS[player.weapon];
  if (player.reloadT > 0 || player.ammo === w.mag || player.reserve <= 0) return;
  player.reloadT = w.reload;
  sfx.reload();
}
function throwPlayerGrenade(kind) {
  if (player[kind] <= 0 || state.phase !== 'live') return;
  player[kind]--;
  const dir = { x: -Math.sin(player.yaw) * Math.cos(player.pitch), y: Math.sin(player.pitch) + 0.25, z: -Math.cos(player.yaw) * Math.cos(player.pitch) };
  state.frags.push(throwGrenade({ x: player.x, y: player.headY, z: player.z }, dir, kind, 0));
  sfx.click();
}
function playerFire() {
  const w = WEAPONS[player.weapon];
  if (player.reloadT > 0 || player.fireT > 0) return;
  if (player.ammo <= 0) { startReload(); player.fireT = 0.25; return; }
  player.fireT = w.rate;
  player.ammo--;
  player.shotIdx++;
  const move = Math.hypot(player.vx, player.vz) > 0.5;
  const spread = (w.spread + (move ? w.moveSpread : 0) + (player.crouch ? -0.002 : 0)) * (player.ads ? 0.45 : 1);
  const pellets = w.pellets || 1;
  const eyeY = player.headY;
  for (let p = 0; p < pellets; p++) {
    const yawErr = (Math.random() - 0.5) * spread * 2;
    const pitchErr = (Math.random() - 0.5) * spread * 2;
    const yaw = player.yaw + yawErr;
    const pitch = player.pitch + pitchErr;
    tmpD.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).normalize();
    const targets = bots.filter((b) => b.alive && b.team === 1).map((b) => ({ x: b.x, z: b.z, alive: b.alive, headY: b.headY, ref: b }));
    const hit = traceShot({ x: player.x, y: eyeY, z: player.z }, tmpD, world.colliders, targets, 120);
    if (hit.kind === 'head' || hit.kind === 'body') {
      const dmg = Math.round(w.dmg * falloff(w, hit.dist) * (hit.kind === 'head' ? w.head : 1) / pellets);
      damage(hit.target.ref, dmg, player, hit.kind === 'head');
    }
    if (p === 0) {
      const end = hit.dist < 120 ? hit.dist : 60;
      const pos = tracerGeo.attributes.position;
      pos.setXYZ(0, player.x - Math.sin(player.yaw) * 0.3, eyeY - 0.1, player.z - Math.cos(player.yaw) * 0.3);
      pos.setXYZ(1, player.x + tmpD.x * end, eyeY + tmpD.y * end, player.z + tmpD.z * end);
      pos.needsUpdate = true;
      tracerT = 0.06;
    }
  }
  const rec = recoilFor(w, player.shotIdx - 1);
  player.recoilY += rec[0];
  player.recoilP += rec[1];
  player.pitch += rec[1];
  player.yaw += rec[0];
  sfx.shot(w.kind);
  gun.position.z = -0.5 + 0.09;
}

// --- Grenade detonation ---
function onGrenadeBoom(kind, x, z, team) {
  if (kind === 'frag') {
    boomMesh.position.set(x, 0.8, z);
    boomT = 0.5;
    sfx.boom();
    for (const e of [player, ...bots]) {
      if (!e.alive) continue;
      const d = Math.hypot(e.x - x, e.z - z);
      const dmg = fragDamage(d);
      if (dmg > 0) damage(e, dmg, { name: team === 0 ? 'You' : 'Rook', team }, false);
    }
  } else {
    state.smokes.push({ x, z, r: GRENADE.smoke.radius, t: GRENADE.smoke.life });
    const m = new THREE.Mesh(new THREE.SphereGeometry(GRENADE.smoke.radius, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xdde3e8, transparent: true, opacity: 0.55, depthWrite: false }));
    m.position.set(x, 1.6, z);
    scene.add(m);
    smokeMeshes.push(m);
  }
}

// --- Fixed-step simulation ---
function simStep(dt) {
  if (stageLock) return;
  state.time += dt;
  if (state.phase === 'buy') {
    state.timer -= dt;
    if (state.timer <= 0) {
      state.phase = 'live';
      state.timer = ROUND_TIME;
      hud.closeBuy();
      feed('<b>Round started — plant at ' + attackSite + '</b>');
    }
  } else if (state.phase === 'live') {
    state.timer -= dt;
    if (state.timer <= 0 && state.charge.state !== 'planted') endRound(1, 'time expired — charge never planted');
    if (state.charge.state === 'planted') {
      state.charge.fuse -= dt;
      if (Math.floor(state.charge.fuse) !== Math.floor(state.charge.fuse + dt)) sfx.plantBeep(state.charge.fuse < 10);
      if (state.charge.fuse <= 0) explodeCharge();
    }
    // Player plant / defuse / pickup (hold E).
    const nearSite = (s) => dist2(player.x, player.z, s.x, s.z) < 3.5;
    if (player.alive && keys['KeyE']) {
      if (state.charge.state === 'carried' && state.charge.carrier === player && (nearSite(world.sites.A) || nearSite(world.sites.B))) {
        plantHold += dt;
        interactLabel = 'PLANTING…';
        if (plantHold >= PLANT_TIME) { plantHold = 0; plantDone(player); }
      } else if (state.charge.state === 'planted' && nearSite(world.sites[state.charge.site])) {
        defuseHold += dt;
        interactLabel = 'DEFUSING…';
        if (defuseHold >= DEFUSE_TIME) { defuseHold = 0; defuseDone(player); }
      } else { plantHold = 0; defuseHold = 0; }
    } else { plantHold = 0; defuseHold = 0; }
    if (state.charge.state === 'dropped' && dist2(player.x, player.z, state.charge.x, state.charge.z) < 1.3) {
      state.charge.state = 'carried'; state.charge.carrier = player;
      sfx.pickup();
      feed('<b style="color:#7dff9e">You picked up the charge — plant at ' + attackSite + '</b>');
    }
    // Player movement (accel-based) + collision.
    if (player.alive) {
      const fwd = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
      const str = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);
      const speed = player.crouch ? 2.6 : player.ads ? 3.2 : 5.4;
      const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
      let wx = (-sin * fwd + cos * str) * speed;
      let wz = (-cos * fwd - sin * str) * speed;
      const wl = Math.hypot(wx, wz);
      if (wl > speed) { wx = (wx / wl) * speed; wz = (wz / wl) * speed; }
      const acc = 34;
      player.vx += (wx - player.vx) * Math.min(1, acc * dt / speed * 4);
      player.vz += (wz - player.vz) * Math.min(1, acc * dt / speed * 4);
      let nx = player.x + player.vx * dt, nz = player.z + player.vz * dt;
      if (!pointBlocked(nx, player.z, world.colliders)) player.x = nx;
      if (!pointBlocked(player.x, nz, world.colliders)) player.z = nz;
      player.x = Math.max(-44.5, Math.min(44.5, player.x));
      player.z = Math.max(-34.5, Math.min(34.5, player.z));
      player.crouch = !!keys['ControlLeft'];
      player.bobT += Math.hypot(player.vx, player.vz) * dt;
      // Firing.
      player.fireT -= dt;
      if (firing && (WEAPONS[player.weapon].auto || true)) {
        if (WEAPONS[player.weapon].auto) playerFire();
        else if (firing) { playerFire(); firing = false; }
      }
      if (player.reloadT > 0) {
        player.reloadT -= dt;
        if (player.reloadT <= 0) {
          const w = WEAPONS[player.weapon];
          const need = w.mag - player.ammo;
          const take = Math.min(need, player.reserve);
          player.ammo += take; player.reserve -= take;
        }
      }
      // Recoil recovery.
      player.pitch -= player.recoilP * dt * 3;
      player.recoilP *= Math.max(0, 1 - dt * 6);
      player.recoilY *= Math.max(0, 1 - dt * 6);
      // ADS FOV.
      const w = WEAPONS[player.weapon];
      const targetFov = player.ads ? (w.zoom ? 78 / w.zoom : 52) : 78;
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 10);
      camera.updateProjectionMatrix();
    }
    // Bots.
    const ctx = {
      world, state, player, bots, dt, time: state.time,
      damage, say, plantDone: (b) => plantDone(b), defuseDone: (b) => defuseDone(b),
      throwGrenade: (from, dir, kind, team) => state.frags.push(throwGrenade(from, dir, kind, team)),
      botShot: (bot, kind) => { if (dist2(bot.x, bot.z, player.x, player.z) < 26) sfx.shot(kind); },
    };
    for (const b of bots) updateBot(b, dt, ctx);
    // Enemy "seen" flags for minimap (only when player could spot them).
    for (const b of bots) {
      if (b.team === 1) {
        b.seen = b.alive && canSee(player, b, world, state);
        if (b.seen && dist2(b.x, b.z, player.x, player.z) < 30) b.seen = true;
      }
    }
    // Grenades + smoke decay.
    stepGrenades(state.frags, dt, world.colliders, onGrenadeBoom);
    for (let i = state.smokes.length - 1; i >= 0; i--) {
      state.smokes[i].t -= dt;
      if (state.smokes[i].t <= 0) {
        state.smokes.splice(i, 1);
        const m = smokeMeshes.splice(i, 1)[0];
        if (m) scene.remove(m);
      }
    }
    // Charge blink (faster in the last 10 s of fuse).
    const cm = world.chargeMesh;
    if (state.charge.state === 'dropped' || state.charge.state === 'planted') {
      cm.visible = true;
      world.chargeLight.visible = true;
      const rate = state.charge.state === 'planted' && state.charge.fuse < 10 ? 14 : 5;
      const on = Math.sin(state.time * rate) > 0;
      cm.material.emissiveIntensity = on ? 2.2 : 0.4;
      cm.position.set(state.charge.x, 0.75 + Math.sin(state.time * 3) * 0.08, state.charge.z);
      world.chargeLight.position.set(state.charge.x, 1, state.charge.z);
    } else {
      cm.visible = false;
      world.chargeLight.visible = false;
    }
  } else if (state.phase === 'end') {
    roundEndT -= dt;
    if (roundEndT <= 0) {
      if (state.score[0] >= MATCH_WIN || state.score[1] >= MATCH_WIN || state.round >= 9) endMatch();
      else { state.round++; startRound(); }
    }
  }
  // Tracer + boom decay (visual only).
  if (tracerT > 0) { tracerT -= dt; tracerMat.opacity = Math.max(0, tracerT / 0.06) * 0.9; }
  else tracerMat.opacity = 0;
  if (boomT > 0) {
    boomT -= dt;
    const k = Math.max(0, boomT / 0.5);
    boomMesh.scale.setScalar(1 + (1 - k) * 8);
    boomMesh.material.opacity = k * 0.7;
  } else boomMesh.material.opacity = 0;
}

// --- Render ---
function render() {
  const eyeY = player.headY + Math.sin(player.bobT * 1.6) * 0.03 * Math.min(1, Math.hypot(player.vx, player.vz) / 5);
  camera.position.set(player.x, eyeY, player.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  gun.position.z += (-0.5 - gun.position.z) * 0.25;
  gun.position.y = -0.27 + Math.sin(player.bobT * 1.6) * 0.008;
  renderer.render(scene, camera);
}

// --- HUD refresh (every frame, cheap DOM writes only on change is overkill here) ---
function refreshHud(dt) {
  hud.setRound(state.round, state.score, state.timer, state.phase, player.money);
  const slots = WEAPON_ORDER.filter((id) => player.owned.has(id)).map((id, i) => ({ id, key: i + 1, name: WEAPONS[id].name.split(' ')[0] }));
  hud.setPlayer(player.hp, player.armour, player.ammo, player.reserve, player.weapon, slots, { frag: player.frag, smoke: player.smoke });
  hud.drawMinimap(player, bots, state, world);
  hud.drawHurt(dt);
  if (state.phase === 'live' && player.alive && keys['KeyE']) {
    if (state.charge.state === 'carried' && state.charge.carrier === player) hud.setPlant(interactLabel || 'PLANTING…', plantHold / PLANT_TIME);
    else if (state.charge.state === 'planted') hud.setPlant(interactLabel || 'DEFUSING…', defuseHold / DEFUSE_TIME);
    else hud.setPlant(null);
  } else hud.setPlant(null);
}

// --- Test hooks / staged screenshots ---
function stageShot(mode) {
  hud.el.start.style.display = 'none';
  if (mode === 'start') {
    startMatch();
    player.yaw = 0; // face north up mid
  } else if (mode === 'play') {
    startMatch();
    stageLock = true;
    state.phase = 'live'; state.timer = 85;
    hud.closeBuy();
    player.x = 0; player.z = 22; player.yaw = 0; player.pitch = 0;
    const e1 = bots.find((b) => b.name === 'Rook');
    const e2 = bots.find((b) => b.name === 'Sable');
    const a1 = bots.find((b) => b.name === 'Koda');
    if (e1) { e1.x = -10; e1.z = 8; e1.mode = 'hold'; e1.holdYaw = 0.62; e1.group.position.set(-10, 0, 8); e1.group.rotation.y = 0.62; e1.seen = true; }
    if (e2) { e2.x = 10; e2.z = 8; e2.mode = 'hold'; e2.holdYaw = -0.62; e2.group.position.set(10, 0, 8); e2.group.rotation.y = -0.62; e2.seen = true; }
    if (a1) { a1.x = -7; a1.z = 14; a1.mode = 'hold'; a1.group.position.set(-7, 0, 14); }
    player.weapon = 'rifle'; player.owned.add('rifle'); player.ammo = 30; player.reserve = 120;
  } else if (mode === 'plant') {
    forceSite = 'B';
    startMatch();
    stageLock = true;
    state.phase = 'live'; state.timer = 60;
    hud.closeBuy();
    attackSite = 'B';
    state.charge.state = 'planted'; state.charge.site = 'B'; state.charge.fuse = 20;
    state.charge.x = 32; state.charge.z = -22;
    world.chargeMesh.visible = true;
    world.chargeMesh.position.set(32, 0.75, -22);
    world.chargeLight.visible = true;
    world.chargeLight.position.set(32, 1, -22);
    player.x = 28; player.z = -14; player.yaw = -0.47; player.pitch = -0.08;
    const e1 = bots.find((b) => b.name === 'Sable');
    const e2 = bots.find((b) => b.name === 'Ferro');
    if (e1) { e1.x = 35; e1.z = -20; e1.mode = 'hold'; e1.group.position.set(35, 0, -20); e1.group.rotation.y = -0.86; e1.seen = true; }
    if (e2) { e2.x = 28; e2.z = -19; e2.mode = 'hold'; e2.group.position.set(28, 0, -19); e2.group.rotation.y = 0.2; e2.seen = true; }
    hud.showBanner('💣 CHARGE PLANTED', 'Crane Dock (B) — fuse 20s — defend it!', '#ffb020');
    feed('<b style="color:#ffb020">💣 charge planted at B</b>');
  } else if (mode === 'end') {
    startMatch();
    state.score = [5, 3];
    state.round = 8;
    state.stats['You'] = { name: 'You', team: 0, role: 'player', k: 14, d: 6 };
    state.stats['Vex'] = { name: 'Vex', team: 0, role: 'carrier', k: 9, d: 7 };
    state.stats['Koda'] = { name: 'Koda', team: 0, role: 'entry', k: 11, d: 8 };
    state.stats['Mira'] = { name: 'Mira', team: 0, role: 'support', k: 6, d: 9 };
    state.stats['Juno'] = { name: 'Juno', team: 0, role: 'holder', k: 7, d: 5 };
    state.stats['Rook'] = { name: 'Rook', team: 1, role: 'holder', k: 8, d: 10 };
    state.stats['Sable'] = { name: 'Sable', team: 1, role: 'holder', k: 10, d: 9 };
    state.stats['Hale'] = { name: 'Hale', team: 1, role: 'roamer', k: 5, d: 11 };
    state.stats['Onyx'] = { name: 'Onyx', team: 1, role: 'roamer', k: 7, d: 12 };
    state.stats['Ferro'] = { name: 'Ferro', team: 1, role: 'holder', k: 4, d: 10 };
    endMatch();
  }
  frames = 0;
}

// --- Main loop ---
let last = performance.now();
let acc = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dtMs = Math.min(100, now - last);
  last = now;
  acc += dtMs / 1000;
  let steps = 0;
  while (acc >= TICK && steps < 5) { simStep(TICK); acc -= TICK; steps++; }
  if (steps === 5) acc = 0;
  render();
  refreshHud(dtMs / 1000);
  frames++;
  if (frames === 90) window.__shotReady = true;
}
window.__game = {
  get phase() { return state.phase; },
  get score() { return [...state.score]; },
  get round() { return state.round; },
  get playerHp() { return Math.round(player.hp); },
  get playerAmmo() { return player.ammo; },
  get money() { return player.money; },
  get botsAlive() { return bots.filter((b) => b.alive).length; },
  get charge() { return state.charge.state; },
  get kills() { return player.kills; },
  get timer() { return Math.round(state.timer); },
  get enemiesVisible() { return bots.filter((b) => b.team === 1 && b.seen).length; },
  get playerPos() { return [Math.round(player.x * 10) / 10, Math.round(player.z * 10) / 10]; },
};
window.__shotReady = false;
startMatch();
if (SHOT) stageShot(SHOT);
if (TEST) { hud.el.start.style.display = 'none'; state.phase = 'live'; state.timer = 90; hud.closeBuy(); }
requestAnimationFrame(loop);
