// Cinderworks — boot and the one loop. A fixed 60 Hz simulation feeds a render
// at the display's rate; rendering never touches simulation state. The state
// object is the single place every module reads from: time, the world, the
// player, the bots, the match, the charge, and the event queue the loop drains
// once per step. ?shot=start|play|plant|end with &seed=N stages a deterministic
// frame for a capture, renders it twice, freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { createAudio } from './audio.js';
import { createWorld, MAP, siteAt } from './map.js';
import { makeMover, createBody, applyDamage, eyePosition, BODY } from './actors.js';
import { WEAPONS, createGun, createViewModel } from './weapons.js';
import { createBots } from './bots.js';
import { playerShoot, createEffects, stepEffects, throwGrenade, stepGrenades, addImpact } from './combat.js';
import { createMatch, startRound, buyItem, stepMatch, endRound, plantCharge, BUY_ITEMS, ECONOMY } from './rounds.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;
// Headless playtest hook (?test=1): start without pointer lock, so the game can
// be driven in a headless browser that grants no pointer lock. Desktop play is
// unchanged: without it the Play button requests pointer lock as usual.

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// ACES tone mapping with a real exposure lift: the foundry palette is dark
// browns and oranges, and the extra headroom keeps shadowed lanes readable
// at a glance instead of crushing them to black.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.38;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 30, 90);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const random = mulberry32(shot ? seed : (Date.now() % 2147483647));
const world = createWorld(scene);
const mover = makeMover(world.colliders);
const hud = createHud();
const audio = createAudio();
const effects = createEffects(scene);
const viewModel = createViewModel(camera);

// The planted charge as a scene prop: a squat ember-cored box that sits where
// rounds.js says the charge lies and blinks faster as the fuse burns down, so
// the objective reads in the world and not only in the HUD line. Purely
// visual — the match and the bots read charge state, never this mesh. Both
// materials are made once here; the hot loop only moves the group and sets
// the core's emissive intensity.
const chargeProp = new THREE.Group();
const chargeBase = new THREE.Mesh(
  new THREE.BoxGeometry(0.52, 0.2, 0.36),
  new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 }),
);
chargeBase.position.y = 0.1;
chargeBase.castShadow = true;
const chargeCore = new THREE.Mesh(
  new THREE.BoxGeometry(0.3, 0.08, 0.2),
  new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.danger),
    emissive: new THREE.Color(PALETTE.danger),
    emissiveIntensity: 0.4,
    roughness: 0.4,
  }),
);
chargeCore.position.y = 0.24;
chargeProp.add(chargeBase, chargeCore);
chargeProp.visible = false;
scene.add(chargeProp);

function syncChargeProp() {
  const charge = state.match.charge;
  if (charge.state !== 'planted') {
    chargeProp.visible = false;
    return;
  }
  chargeProp.visible = true;
  chargeProp.position.set(charge.pos.x, 0, charge.pos.z);
  // Two pulses a second while the fuse is long, four a second inside the
  // last ten seconds: the blink itself carries the urgency.
  const rate = charge.fuseLeft < 10 ? 4 : 2;
  const on = (state.time * rate) % 1 < 0.55;
  chargeCore.material.emissiveIntensity = on ? 2.6 : 0.25;
}
const raycaster = new THREE.Raycaster();
raycaster.far = 90;

const playerBody = createBody(0, 15.5, 0);
const player = {
  kind: 'player', team: 'cinder', name: 'You', body: playerBody,
  guns: { pistol: createGun(WEAPONS.pistol) },
  gunOrder: ['pistol'],
  currentGun: 'pistol',
  grenades: 1,
  keptArmor: 0,
  isCarrier: true,
};
const bots = createBots(scene, world, random);
const cinderBots = bots.list.filter((bot) => bot.team === 'cinder');
const slagBots = bots.list.filter((bot) => bot.team === 'slag');

const state = {
  time: 0, random, scene, camera, world, mover, raycaster,
  hud, input: null, audio, effects, grenades: [], events: [],
  player, bots, match: createMatch(),
  cinderActors: [player, ...cinderBots],
  slagActors: [...slagBots],
  allActors: [player, ...bots.list],
  enemiesOfCinder: [...slagBots],
  enemiesOfSlag: [player, ...cinderBots],
  makeGun(id) { return createGun(WEAPONS[id]); },
  equip(id) { equipGun(id); },
};

function equipGun(id) {
  if (!player.guns[id]) return;
  player.currentGun = id;
  viewModel.setWeapon(WEAPONS[id].kind);
  hud.setWeapon(WEAPONS[id].name);
}

const input = createInput(renderer.domElement, onLockChange);
state.input = input;

const testMode = params.get('test') === '1';
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let fov = 74;
let buyOpen = false;
// Whether the player has entered the game once (Play clicked / pointer
// locked). Read by the lock-change and Play handlers below; it must be
// declared — in a module's strict mode the bare assignment throws.
let started = false;

function currentGun() {
  return player.guns[player.currentGun];
}

function onLockChange(locked) {
  if (shot) return;
  audio.unlock();
  if (locked) {
    started = true;
    hud.hideOverlay();
    buyOpen = false;
    hud.hideBuy();
  } else if (state.match.phase !== 'matchover') {
    hud.showOverlay(started ? 'paused' : 'start');
  }
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (testMode) {
    started = true;
    hud.hideOverlay();
    input.setTestLocked(true);
    return;
  }
  if (state.match.phase === 'matchover') {
    state.match = createMatch();
    startRound(state);
  }
  input.requestLock();
});

function syncCamera() {
  if (player.body.alive) {
    camera.position.set(playerBody.position.x, playerBody.position.y + playerBody.eye, playerBody.position.z);
    camera.rotation.set(playerBody.pitch, playerBody.yaw, 0, 'YXZ');
  } else {
    // Down: spectate the nearest alive ally from their eyes.
    const ally = cinderBots.find((bot) => bot.body.alive);
    if (ally) {
      camera.position.set(ally.body.position.x, ally.body.position.y + ally.body.eye, ally.body.position.z);
      camera.rotation.set(ally.body.pitch, ally.body.yaw, 0, 'YXZ');
    }
  }
}

function formatTime(seconds) {
  const total = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function drainEvents() {
  for (const event of state.events) {
    if (event.type === 'kill') {
      const { victim, killer, part } = event;
      const killerName = killer.kind === 'player' ? 'You' : killer.name;
      const victimName = victim.kind === 'player' ? 'You' : victim.name;
      const weapon = part === 'blast' ? '💥' : part === 'head' ? '◎' : '▸';
      hud.feed(`${killerName} ${weapon} ${victimName}`, killer.team === 'cinder');
      if (killer === player) {
        state.match.money += ECONOMY.killReward;
        state.match.kills += 1;
        state.hud.setMoney(state.match.money);
        state.audio.kill();
      }
      if (victim === player) {
        state.match.deaths += 1;
        state.hud.damageFlash();
        state.audio.hurt();
        if (document.pointerLockElement) document.exitPointerLock();
        hud.setHint('You are down — your crew fights on. Next round you respawn.');
      }
    } else if (event.type === 'hit') {
      const lost = applyDamage(event.victim.body, event.damage);
      void lost;
      if (event.victim === player) {
        state.hud.damageFlash();
        state.audio.hurt();
      }
      if (!event.victim.body.alive) {
        state.events.push({ type: 'kill', victim: event.victim, killer: event.killer, part: event.part });
      }
    } else if (event.type === 'shot') {
      bots.hearShot(event.pos, event.team, state.time);
    } else if (event.type === 'planted') {
      const site = siteAt(event.by.body.position.x, event.by.body.position.z) || 'A';
      plantCharge(state, site, event.by);
      event.by.state = 'hold';
    } else if (event.type === 'defused') {
      state.match.charge.state = 'defused';
      endRound(state, 'slag', 'The charge was defused.');
    } else if (event.type === 'detonated') {
      state.audio.explosion();
      addImpact(state, new THREE.Vector3(state.match.charge.pos.x, 1.2, state.match.charge.pos.z));
    }
  }
  state.events.length = 0;
}

function step(dt) {
  state.time += dt;
  stepMatch(state, dt);
  drainEvents();

  // --- Player ---
  const keys = input.state.keys;
  if (player.body.alive && state.match.phase !== 'matchover') {
    const look = input.takeLook();
    const sens = input.state.aiming ? 0.0013 : 0.0022;
    playerBody.yaw -= look.x * sens;
    playerBody.pitch = Math.max(-1.45, Math.min(1.45, playerBody.pitch - look.y * sens));

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const wish = mover.wishFromYaw(playerBody.yaw, forward, strafe);
    const aiming = input.state.aiming && currentGun().def.kind !== 'shotgun';
    let speed = BODY.walkSpeed;
    if (keys.has('ShiftLeft') || keys.has('ShiftRight')) speed = 2.6;
    if (playerBody.crouching) speed = BODY.crouchSpeed;
    if (aiming) speed = Math.min(speed, 3.1);
    mover.setCrouch(playerBody, keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC'));
    mover.stepBody(playerBody, dt, wish.x, wish.z, speed, keys.has('Space'));

    const gun = currentGun();
    gun.step(dt);
    if (input.state.firing && gun.ready()) {
      if (gun.fire()) {
        playerShoot(state, gun);
        viewModel.trigger();
        playerBody.pitch = Math.min(1.45, playerBody.pitch + gun.def.kick * (aiming ? 0.7 : 1));
        playerBody.yaw += (random() * 2 - 1) * gun.def.kick * 0.4;
      }
    } else if (input.state.firing && gun.state.mag === 0 && gun.state.reloadLeft <= 0) {
      audio.dryFire();
      gun.reload();
      viewModel.startReload(gun.def.reloadTime);
    }
    if (input.takePressed('KeyR')) {
      if (gun.reload()) {
        audio.reload();
        viewModel.startReload(gun.def.reloadTime);
      }
    }
    if (input.takePressed('KeyG') && player.grenades > 0 && (state.match.phase === 'live' || state.match.phase === 'planted')) {
      player.grenades -= 1;
      throwGrenade(state, player);
    }
    // Weapon switching (digits) and the buy menu (B + digits in buy phase).
    if (input.takePressed('KeyB') && state.match.phase === 'buy') {
      buyOpen = !buyOpen;
      if (buyOpen) refreshBuy();
      else hud.hideBuy();
    }
    const digitIds = ['pistol', 'smg', 'shotgun', 'rifle', 'marksman'];
    for (let i = 0; i < 5; i += 1) {
      if (input.takePressed(`Digit${i + 1}`)) {
        if (buyOpen && state.match.phase === 'buy') {
          const message = buyItem(state, BUY_ITEMS[i].id);
          if (message) hud.setHint(message);
          refreshBuy();
        } else if (player.guns[digitIds[i]]) {
          equipGun(digitIds[i]);
        }
      }
    }
    if (input.takePressed('Digit6') && buyOpen && state.match.phase === 'buy') {
      const message = buyItem(state, BUY_ITEMS[5].id);
      if (message) hud.setHint(message);
      refreshBuy();
    }
    if (input.takePressed('KeyQ')) {
      const order = player.gunOrder;
      const next = order[(order.indexOf(player.currentGun) + 1) % order.length];
      equipGun(next);
    }
    viewModel.step(dt);
    const targetFov = aiming ? 55 : 74;
    fov += (targetFov - fov) * Math.min(1, dt * 10);
    camera.fov = fov;
    camera.updateProjectionMatrix();
  } else {
    input.consumePressed();
  }

  // --- Bots, grenades, effects ---
  bots.step(state, dt);
  stepGrenades(state, dt);
  stepEffects(state, dt);
  drainEvents();
  syncHud();
  syncChargeProp();
}

function refreshBuy() {
  const items = BUY_ITEMS.map((item) => ({
    name: item.name,
    price: item.price,
    owned: item.kind === 'gun' ? !!player.guns[item.id] : item.kind === 'armor' ? player.body.armor >= 100 : false,
    affordable: state.match.money >= item.price,
  }));
  hud.showBuy(items, state.match.money);
}

function syncHud() {
  const gun = currentGun();
  hud.setAmmo(gun.state.mag, gun.state.reserve);
  hud.setHealth(Math.ceil(player.body.health), Math.ceil(player.body.armor));
  hud.setMoney(state.match.money);
  if (state.match.phase === 'buy') {
    hud.setTimer(`BUY ${Math.ceil(ECONOMY.buySeconds - state.match.phaseTime)}`, false);
  } else if (state.match.phase === 'planted') {
    hud.setTimer(formatTime(state.match.charge.fuseLeft), true);
  } else if (state.match.phase === 'live') {
    hud.setTimer(formatTime(state.match.roundTimeLeft), state.match.roundTimeLeft < 15);
  } else {
    hud.setTimer('—', false);
  }
  const charge = state.match.charge;
  if (charge.state === 'planted') {
    hud.setBomb(`CHARGE PLANTED · SITE ${charge.site} · ${formatTime(charge.fuseLeft)}`);
  } else if (charge.state === 'carried' && player.isCarrier && player.body.alive) {
    hud.setBomb('YOU CARRY THE CHARGE — REACH A SITE, HOLD E');
  } else if (charge.state === 'carried') {
    hud.setBomb('CHARGE WITH YOUR CREW — ESCORT THE CARRIER');
  } else {
    hud.setBomb('');
  }
  // Context hint: plant progress, buy prompt, or nothing.
  if (charge.state === 'carried' && player.isCarrier && player.body.alive) {
    const site = siteAt(playerBody.position.x, playerBody.position.z);
    if (site) {
      const pct = Math.floor((charge.plantProgress / MAP.plantSeconds) * 100);
      hud.setHint(charge.plantProgress > 0 ? `PLANTING… ${pct}% — hold E` : `Hold <b>E</b> to plant at site ${site}`);
    } else if (state.match.phase === 'buy') {
      hud.setHint('Buy phase — press <b>B</b> to shop');
    } else {
      hud.setHint('');
    }
  } else if (state.match.phase === 'buy') {
    hud.setHint('Buy phase — press <b>B</b> to shop');
  } else if (!player.body.alive) {
    // Death hint is set once by the kill event; keep it.
  } else {
    hud.setHint('');
  }
  const spread = currentGun().spread(mover.groundSpeed(playerBody), true, input.state.aiming);
  hud.setCrosshairGap(5 + spread * 900);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function aimAtPoint(x, y, z) {
  const dx = x - playerBody.position.x;
  const dy = y - (playerBody.position.y + playerBody.eye);
  const dz = z - playerBody.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  playerBody.yaw = Math.atan2(-dx, -dz);
  playerBody.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

// Deterministic captures. Each stages a real game state, runs the simulation,
// then freezes the frame: the screenshots are renders of the game's own code.
function runShot(name) {
  hud.hideOverlay();
  if (name === 'start') {
    startRound(state);
    // Stand off to the east side of spawn: from dead centre a teammate's
    // model fills the frame, while the angled view shows the yard, the
    // crates and the lane toward site A behind the buy panel.
    playerBody.position.set(3.5, 0, 15.5);
    playerBody.yaw = 0;
    playerBody.pitch = 0;
    buyOpen = true;
    refreshBuy();
    settle(30);
    aimAtPoint(-8, 1.6, -13);
  } else if (name === 'play') {
    // Round 2, rifle bought, open fight down Long lane: two Slag push the
    // lane toward site A with the furnace glow behind them, a teammate
    // advances on the right, and the player's shot is already away — tracer,
    // muzzle flash and recoil all in the frame.
    state.match.money = 4500;
    buyItem(state, 'rifle');
    state.match.round = 2;
    startRound(state);
    state.match.phase = 'live';
    state.match.phaseTime = 20;
    playerBody.position.set(-12.8, 0, -6.8);
    playerBody.yaw = 0;
    playerBody.pitch = 0.01;
    settle(40);
    hud.hideBanner();
    // Stage the fight AFTER the settle: bots walk their holds during it, so
    // positions set before would have drifted by the time the shot fires.
    // The fight is staged inside site A itself — the one open stage where
    // the furnace glow backlights both Slag, a Cinder teammate already
    // holds the furnace side, and no wall mass eats the frame.
    const enemy = slagBots[0];
    enemy.body.position.set(-16.8, 0, -10.5);
    enemy.body.yaw = Math.PI;
    enemy.body.velocity.set(0, 0, 0);
    const enemy2 = slagBots[1];
    enemy2.body.position.set(-18.5, 0, -6);
    enemy2.body.yaw = Math.PI * 0.85;
    enemy2.body.velocity.set(0, 0, 0);
    const ally = cinderBots[0];
    ally.body.position.set(-15.8, 0, -13.8);
    ally.body.yaw = 0;
    ally.body.velocity.set(0, 0, 0);
    // The capture stages a healthy player mid-fight, whatever the bots did
    // during the settle.
    playerBody.health = 100;
    aimAtPoint(-16.8, 1.2, -10.5);
    const gun = currentGun();
    if (gun.fire()) playerShoot(state, gun);
    viewModel.trigger();
    // Four steps on: the muzzle flash (a flat quad) has burned off, the
    // tracer is down to a thread, and the impact sparks are still alive —
    // the frame keeps the shot's evidence without the flash quad's slab.
    settle(4);
  } else if (name === 'plant') {
    // Round 2, the charge is down at Furnace (A): planted through the real
    // plantCharge path, then the player falls back inside the site and
    // covers the blinking charge while two Slag converge from Long lane to
    // defuse it. The HUD carries the planted line and the fuse timer.
    state.match.money = 4500;
    buyItem(state, 'rifle');
    state.match.round = 2;
    startRound(state);
    state.match.phase = 'live';
    playerBody.position.set(-14.6, 0, -10.6);
    plantCharge(state, 'A', player);
    settle(6);
    // Stage the defence AFTER the settle, like the play shot: the plant
    // makes every defender converge, so positions are set once they react.
    playerBody.position.set(-11.2, 0, -11.4);
    playerBody.velocity.set(0, 0, 0);
    const pusher = slagBots[0];
    pusher.body.position.set(-17.6, 0, -8.2);
    pusher.body.yaw = Math.PI;
    pusher.body.velocity.set(0, 0, 0);
    const second = slagBots[1];
    second.body.position.set(-19.5, 0, -5.5);
    second.body.yaw = Math.PI;
    second.body.velocity.set(0, 0, 0);
    playerBody.health = 100;
    aimAtPoint(-17.6, 1.15, -8.2);
    settle(1);
  } else {
    // Round won at site A: charge detonated, two Slag down, banner up. The
    // player stands west of the site with both fallen bots in view.
    state.match.money = 4500;
    state.match.score.cinder = 1;
    startRound(state);
    state.match.phase = 'over';
    state.match.phaseTime = 0.5;
    state.match.score.cinder = 1;
    playerBody.position.set(-18, 0, -3.5);
    playerBody.yaw = 0;
    playerBody.pitch = 0.02;
    slagBots[0].body.position.set(-14.5, 0, -11);
    slagBots[0].body.alive = false;
    slagBots[0].mesh.group.position.set(-14.5, 0, -11);
    slagBots[0].mesh.group.rotation.x = -Math.PI / 2;
    slagBots[1].body.position.set(-15.5, 0, -13.5);
    slagBots[1].body.alive = false;
    slagBots[1].mesh.group.position.set(-15.5, 0, -13.5);
    slagBots[1].mesh.group.rotation.x = -Math.PI / 2;
    hud.banner('ROUND WON', 'Slag crew wiped  ·  1 — 0', 60000);
    settle(20);
    aimAtPoint(-15, 1.1, -12);
  }
  // The tail paints the HUD the way a live frame does — syncHud reads the
  // staged state (timer, bomb line, hint, crosshair) instead of the capture
  // restating it by hand.
  syncHud();
  hud.setScore(state.match.score.cinder, state.match.score.slag);
  hud.setRound(`ROUND ${state.match.round}`);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Debug hook for the maker's own playtests (headless Chrome): live numbers,
// never a cheat — it only reads.
window.__game = {
  get phase() { return state.match.phase; },
  get round() { return state.match.round; },
  get score() { return { ...state.match.score }; },
  get money() { return state.match.money; },
  get playerHp() { return player.body.health; },
  get playerAlive() { return player.body.alive; },
  get playerAmmo() { return { mag: currentGun().state.mag, reserve: currentGun().state.reserve }; },
  get playerPos() { return [playerBody.position.x, playerBody.position.z]; },
  get botsAlive() { return bots.list.filter((bot) => bot.body.alive).length; },
  get slagAlive() { return slagBots.filter((bot) => bot.body.alive).length; },
  get slagHp() { return slagBots.map((bot) => Math.ceil(bot.body.health)); },
  get cinderHp() { return cinderBots.map((bot) => Math.ceil(bot.body.health)); },
  get cinderAlive() { return cinderBots.filter((bot) => bot.body.alive).length + (player.body.alive ? 1 : 0); },
  get charge() { return state.match.charge.state; },
  get timeLeft() { return state.match.roundTimeLeft; },
  get lastShot() { return state.lastShot || null; },
  get playerYaw() { return playerBody.yaw; },
  get playerPitch() { return playerBody.pitch; },
};

syncCamera();
equipGun('pistol');
startRound(state);
if (shot) runShot(shot);
else requestAnimationFrame(frame);
