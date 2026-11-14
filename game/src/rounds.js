// Rounds: the match state machine. A match is first to 5 round wins (max 9).
// Each round: a buy phase (18 s, shop open), a live phase (100 s), an optional
// planted phase (35 s fuse), then a short end banner and the next round.
// Cinder attacks: the player carries the charge; plant it at Furnace (A) or
// Crane Dock (B) by holding E in a site for 3.2 s. Slag wins the round on a
// timeout, a defuse, or a wipe; Cinder wins on a wipe or a detonation.
// Economy: $800 to start, +$300 a kill, +$300 a plant, +$3250 a round win,
// +$1900 a round loss. The shop sells the five guns, a grenade and armour.
import { WEAPONS, GRENADE, ARMOR } from './weapons.js';
import { MAP, siteAt } from './map.js';
import { BODY } from './actors.js';

export const ECONOMY = {
  startMoney: 800,
  killReward: 300,
  plantReward: 300,
  winReward: 3250,
  lossReward: 1900,
  winRounds: 5,
  maxRounds: 9,
  buySeconds: 18,
};

export const BUY_ITEMS = [
  { id: 'smg', name: WEAPONS.smg.name, price: WEAPONS.smg.price, kind: 'gun' },
  { id: 'shotgun', name: WEAPONS.shotgun.name, price: WEAPONS.shotgun.price, kind: 'gun' },
  { id: 'rifle', name: WEAPONS.rifle.name, price: WEAPONS.rifle.price, kind: 'gun' },
  { id: 'marksman', name: WEAPONS.marksman.name, price: WEAPONS.marksman.price, kind: 'gun' },
  { id: 'grenade', name: GRENADE.name, price: GRENADE.price, kind: 'grenade' },
  { id: 'armor', name: ARMOR.name, price: ARMOR.price, kind: 'armor' },
];

export function createMatch() {
  return {
    round: 1,
    score: { cinder: 0, slag: 0 },
    phase: 'buy',
    phaseTime: 0,
    roundTimeLeft: MAP.roundSeconds,
    money: ECONOMY.startMoney,
    kills: 0,
    deaths: 0,
    plants: 0,
    over: false,
    winner: null,
    charge: {
      state: 'carried', // carried | planted | detonated | defused
      site: null, siteNode: null,
      pos: { x: 0, z: 0 },
      plantProgress: 0,
      defuseProgress: 0,
      defuser: null,
      fuseLeft: 0,
    },
  };
}

export function startRound(state) {
  const match = state.match;
  match.phase = 'buy';
  match.phaseTime = 0;
  match.roundTimeLeft = MAP.roundSeconds;
  match.charge.state = 'carried';
  match.charge.site = null;
  match.charge.siteNode = null;
  match.charge.plantProgress = 0;
  match.charge.defuseProgress = 0;
  match.charge.defuser = null;
  match.charge.fuseLeft = 0;
  // Respawn everybody at their spawn, full health, fresh guns.
  state.player.body.health = BODY.maxHealth;
  state.player.body.alive = true;
  state.player.body.position.set(0, 0, 15.5);
  state.player.body.velocity.set(0, 0, 0);
  state.player.body.yaw = 0;
  state.player.body.pitch = 0;
  state.player.grenades = 1;
  for (const gun of Object.values(state.player.guns)) gun.refill();
  state.bots.reset(match.round);
  // The player carries the charge while alive; if they die, the nearest alive
  // ally bot picks it up (handled in stepMatch).
  state.player.isCarrier = true;
  state.hud.banner(`ROUND ${match.round}`, 'Buy phase — press B to shop, then push a site', 2600);
  state.hud.setRound(`ROUND ${match.round}`);
  state.hud.setScore(match.score.cinder, match.score.slag);
}

// Buy during the buy phase only. Returns a message for the HUD.
export function buyItem(state, itemId) {
  const match = state.match;
  if (match.phase !== 'buy') return 'Shop is closed — the round has started.';
  const item = BUY_ITEMS.find((entry) => entry.id === itemId);
  if (!item) return '';
  if (match.money < item.price) {
    state.audio.deny();
    return `Not enough money for ${item.name}.`;
  }
  const player = state.player;
  if (item.kind === 'gun') {
    if (player.guns[itemId]) return `${item.name} already owned.`;
    player.guns[itemId] = state.makeGun(itemId);
    player.gunOrder.push(itemId);
    state.equip(itemId);
  } else if (item.kind === 'grenade') {
    if (player.grenades >= 2) return 'Grenade pouch is full.';
    player.grenades += 1;
  } else if (item.kind === 'armor') {
    if (player.body.armor >= 100) return 'Vest already at full.';
    player.body.armor = 100;
  }
  match.money -= item.price;
  state.audio.buy();
  state.hud.setMoney(match.money);
  return `Bought ${item.name}.`;
}

export function endRound(state, winner, reason) {
  const match = state.match;
  if (match.phase === 'over' || match.over) return;
  match.phase = 'over';
  match.phaseTime = 0;
  match.over = false;
  match.score[winner] += 1;
  const playerWon = winner === 'cinder';
  match.money += playerWon ? ECONOMY.winReward : ECONOMY.lossReward;
  state.hud.setMoney(match.money);
  state.hud.setScore(match.score.cinder, match.score.slag);
  state.hud.banner(
    playerWon ? 'ROUND WON' : 'ROUND LOST',
    `${reason}  ·  ${match.score.cinder} — ${match.score.slag}`,
    3000,
  );
  if (playerWon) state.audio.roundWin();
  else state.audio.roundLose();
  if (match.score.cinder >= ECONOMY.winRounds || match.score.slag >= ECONOMY.winRounds || match.round >= ECONOMY.maxRounds) {
    match.over = true;
    match.winner = match.score.cinder > match.score.slag ? 'cinder' : 'slag';
  }
}

function aliveCount(actors) {
  return actors.filter((actor) => actor.body.alive).length;
}

export function stepMatch(state, dt) {
  const match = state.match;
  match.phaseTime += dt;
  if (match.phase === 'buy') {
    if (match.phaseTime >= ECONOMY.buySeconds) {
      match.phase = 'live';
      match.phaseTime = 0;
      state.hud.hideBuy();
      state.hud.banner('GO — PLANT THE CHARGE', 'Furnace (A) or Crane Dock (B)', 2000);
    }
    return;
  }
  if (match.phase === 'over') {
    if (match.phaseTime >= 3.5) {
      if (match.over) {
        match.phase = 'matchover';
        const won = match.winner === 'cinder';
        state.hud.showOverlay('matchEnd', won
          ? `Cinder takes the foundry ${match.score.cinder} — ${match.score.slag}. The charge did its work.`
          : `Slag holds the foundry ${match.score.slag} — ${match.score.cinder}. The charge never went off.`);
        if (document.pointerLockElement) document.exitPointerLock();
      } else {
        match.round += 1;
        startRound(state);
      }
    }
    return;
  }
  if (match.phase === 'matchover') return;

  // Live and planted phases share the clock and the wipe checks.
  if (match.phase === 'live') {
    match.roundTimeLeft -= dt;
    if (match.roundTimeLeft <= 0) {
      endRound(state, 'slag', 'Time expired — the charge never went off.');
      return;
    }
  } else if (match.phase === 'planted') {
    match.charge.fuseLeft -= dt;
    if (match.charge.fuseLeft <= 0) {
      match.charge.state = 'detonated';
      state.events.push({ type: 'detonated' });
      endRound(state, 'cinder', 'The charge detonated.');
      return;
    }
  }

  const cinderAlive = aliveCount(state.cinderActors);
  const slagAlive = aliveCount(state.slagActors);
  if (slagAlive === 0) {
    endRound(state, 'cinder', match.phase === 'planted' ? 'Site cleared — the charge goes off.' : 'Slag crew wiped.');
    return;
  }
  if (cinderAlive === 0) {
    endRound(state, 'slag', 'Cinder crew wiped.');
    return;
  }

  // The charge follows its carrier; if the player dies, the nearest alive ally
  // bot picks it up and becomes the carrier.
  if (match.charge.state === 'carried') {
    if (state.player.body.alive && state.player.isCarrier) {
      match.charge.pos.x = state.player.body.position.x;
      match.charge.pos.z = state.player.body.position.z;
    } else {
      state.player.isCarrier = false;
      let carrier = null;
      let bestDist = Infinity;
      for (const bot of state.bots.list) {
        if (bot.team !== 'cinder' || !bot.body.alive) continue;
        const dx = bot.body.position.x - match.charge.pos.x;
        const dz = bot.body.position.z - match.charge.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < bestDist) {
          bestDist = dist;
          carrier = bot;
        }
      }
      if (carrier) {
        carrier.isCarrier = true;
        match.charge.pos.x = carrier.body.position.x;
        match.charge.pos.z = carrier.body.position.z;
      }
    }
  }

  // Player planting: hold E inside a site while the charge is carried.
  if (match.charge.state === 'carried' && state.player.isCarrier && state.player.body.alive) {
    const site = siteAt(state.player.body.position.x, state.player.body.position.z);
    if (site && state.input.state.keys.has('KeyE')) {
      match.charge.plantProgress += dt;
      if (Math.floor(match.charge.plantProgress * 4) !== Math.floor((match.charge.plantProgress - dt) * 4)) {
        state.audio.plantBeep();
      }
      if (match.charge.plantProgress >= MAP.plantSeconds) {
        plantCharge(state, site, state.player);
      }
    } else {
      match.charge.plantProgress = Math.max(0, match.charge.plantProgress - dt * 2);
    }
  }
}

export function plantCharge(state, site, by) {
  const match = state.match;
  match.charge.state = 'planted';
  match.charge.site = site;
  match.charge.siteNode = site === 'A' ? 'siteA' : 'siteB';
  match.charge.pos.x = by.body.position.x;
  match.charge.pos.z = by.body.position.z;
  match.charge.fuseLeft = MAP.fuseSeconds;
  match.charge.defuseProgress = 0;
  match.charge.defuser = null;
  match.phase = 'planted';
  match.phaseTime = 0;
  match.money += ECONOMY.plantReward;
  match.plants += 1;
  state.audio.plantDone();
  state.hud.setMoney(match.money);
  state.hud.banner('CHARGE PLANTED', `Defend site ${site} — ${MAP.fuseSeconds}s to detonation`, 2600);
  state.hud.feed(`Charge planted at ${site === 'A' ? 'Furnace' : 'Crane Dock'} (+$${ECONOMY.plantReward})`, true);
}
