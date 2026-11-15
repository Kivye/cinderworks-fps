// state.js — single source of truth: constants, weapons, roles, game state.
// Cinderworks v3: bright foundry-yard tactical FPS, 5v5, round-based, three.js 0.187.
export const TICK = 1 / 60;
export const ROUND_TIME = 100;
export const BUY_TIME = 12;
export const PLANT_TIME = 3.0;
export const DEFUSE_TIME = 5.0;
export const FUSE_TIME = 35;
export const MATCH_WIN = 5;
export const EYE = 1.62;
export const CROUCH_EYE = 1.12;

// Weapons: name, kind, price, damage (body, close), head x, mag, reserve, rate (s),
// reload (s), range falloff start/end, move spread, base spread, auto, recoil table.
// Recoil tables are deterministic per-shot offsets (yaw, pitch) in radians.
export const WEAPONS = {
  pistol: { name: 'P9 Sidearm', kind: 'pistol', price: 0, dmg: 34, head: 2.0, mag: 12, reserve: 48, rate: 0.16, reload: 1.1, fallStart: 12, fallEnd: 40, fallMin: 0.55, moveSpread: 0.020, spread: 0.006, auto: false,
    recoil: [[0, .011], [.004, .013], [-.005, .012], [.003, .014], [-.004, .012], [.005, .013], [0, .012], [-.003, .013]] },
  smg: { name: 'K9 Ripper SMG', kind: 'smg', price: 1500, dmg: 26, head: 1.8, mag: 32, reserve: 128, rate: 0.085, reload: 1.6, fallStart: 10, fallEnd: 32, fallMin: 0.5, moveSpread: 0.030, spread: 0.011, auto: true,
    recoil: [[0, .009], [.006, .010], [-.007, .011], [.008, .010], [-.006, .012], [.007, .011], [-.008, .012], [.006, .011], [0, .012], [-.005, .011]] },
  shotgun: { name: 'M12 Breacher', kind: 'shotgun', price: 1700, dmg: 13, head: 1.6, mag: 6, reserve: 30, rate: 0.85, reload: 2.2, fallStart: 6, fallEnd: 18, fallMin: 0.35, moveSpread: 0.035, spread: 0.030, auto: false, pellets: 7,
    recoil: [[0, .045], [.01, .05], [-.01, .048]] },
  rifle: { name: 'AR-77 Foundry', kind: 'rifle', price: 2700, dmg: 33, head: 2.0, mag: 30, reserve: 120, rate: 0.115, reload: 1.9, fallStart: 15, fallEnd: 55, fallMin: 0.6, moveSpread: 0.026, spread: 0.007, auto: true,
    recoil: [[0, .012], [.005, .014], [-.006, .015], [.007, .014], [-.005, .016], [.008, .015], [-.007, .016], [.006, .015], [0, .016], [-.004, .015], [.005, .016], [-.006, .015]] },
  marksman: { name: 'LR-90 Longshot', kind: 'marksman', price: 4000, dmg: 82, head: 2.4, mag: 5, reserve: 25, rate: 1.05, reload: 2.6, fallStart: 20, fallEnd: 90, fallMin: 0.8, moveSpread: 0.040, spread: 0.002, auto: false, zoom: 2.6,
    recoil: [[0, .055], [.008, .06], [-.008, .058]] },
};
export const GRENADE = {
  frag: { name: 'Frag Grenade', price: 300, radius: 7, dmg: 95 },
  smoke: { name: 'Smoke Grenade', price: 300, radius: 6, life: 14 },
};
export const ARMOUR_PRICE = 650;
export const WEAPON_ORDER = ['pistol', 'smg', 'shotgun', 'rifle', 'marksman'];

// Bot roles. pickBotLoadout(role, money) -> {weapon, armour, frag, smoke}
export function pickBotLoadout(role, money) {
  let w = 'pistol'; let armour = false; let frag = 0; let smoke = 0;
  if (role === 'carrier') { w = money >= 2700 ? 'rifle' : money >= 1500 ? 'smg' : 'pistol'; smoke = money >= 3000 ? 1 : 0; }
  else if (role === 'entry') { w = money >= 4000 ? 'marksman' : money >= 2700 ? 'rifle' : money >= 1700 ? 'shotgun' : 'pistol'; frag = money >= 3300 ? 1 : 0; }
  else if (role === 'support') { w = money >= 2700 ? 'rifle' : money >= 1500 ? 'smg' : 'pistol'; smoke = 1; frag = money >= 3300 ? 1 : 0; }
  else { w = money >= 4000 ? 'marksman' : money >= 2700 ? 'rifle' : money >= 1500 ? 'smg' : 'pistol'; }
  if (money - WEAPONS[w].price >= ARMOUR_PRICE) armour = true;
  return { weapon: w, armour, frag, smoke };
}

export const ALLY_NAMES = ['Vex', 'Koda', 'Mira', 'Juno'];
export const ENEMY_NAMES = ['Rook', 'Sable', 'Hale', 'Onyx', 'Ferro'];
export const ALLY_ROLES = ['carrier', 'entry', 'support', 'holder'];
export const ENEMY_ROLES = ['holder', 'holder', 'roamer', 'roamer', 'holder'];
export const COMMS = ['pushing B', 'contact at Furnace', 'holding Crane Dock', 'rotating mid', 'charge down!', 'planting now', 'need backup at A', 'smoke out mid', 'one down mid', 'watch the flank'];

export function makeState() {
  return {
    phase: 'buy', // buy | live | end | matchend
    round: 1, score: [0, 0], // [attackers (player team), defenders]
    timer: BUY_TIME, lossStreak: 0,
    money: 800, kills: 0, deaths: 0,
    charge: { state: 'carried', x: 0, z: 0, carrier: null, plantProgress: 0, defuseProgress: 0, fuse: FUSE_TIME, site: null, blink: 0 },
    smokes: [], // {x,z,r,t}
    frags: [], // flying grenades {x,y,z,vx,vy,vz,kind,team,t}
    killfeed: [], comms: [],
    banner: '', bannerT: 0, winner: null,
    stats: {}, // name -> {k,d,team}
    time: 0, seed: 7,
  };
}

// Deterministic RNG (mulberry32) so staged shots are reproducible.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
