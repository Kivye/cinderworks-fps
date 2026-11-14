// Weapons: the five guns and the grenade, as data. Accuracy is the whole point
// of the game, so every gun carries its own spread curve: a still base, a moving
// penalty, a per-shot bloom that decays, and an ADS multiplier. Damage falls off
// with distance. The view model is built here too — simple dark-steel boxes
// with an ember sight line, one per weapon class, swapped when the player buys.
// A weapon is pure state plus its view model; combat.js owns the ray.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    name: 'P9 Sparrow', kind: 'pistol', price: 0, auto: false,
    damage: 34, headMult: 2.0, bodyMult: 1.0, legMult: 0.8,
    mag: 12, reserve: 48, fireGap: 0.16, reloadTime: 1.4,
    spreadStill: 0.004, spreadMove: 0.02, bloom: 0.006, bloomDecay: 3.2,
    adsMult: 0.55, falloffStart: 14, falloffEnd: 34, falloffMin: 0.55,
    kick: 0.011, range: 60,
  },
  smg: {
    name: 'VK-9 Repeater', kind: 'smg', price: 900, auto: true,
    damage: 26, headMult: 2.2, bodyMult: 1.0, legMult: 0.8,
    mag: 28, reserve: 112, fireGap: 0.085, reloadTime: 1.7,
    spreadStill: 0.006, spreadMove: 0.03, bloom: 0.005, bloomDecay: 3.6,
    adsMult: 0.6, falloffStart: 10, falloffEnd: 28, falloffMin: 0.5,
    kick: 0.008, range: 55,
  },
  rifle: {
    name: 'AR-77 Longshot', kind: 'rifle', price: 2700, auto: true,
    damage: 33, headMult: 4.0, bodyMult: 1.0, legMult: 0.75,
    mag: 25, reserve: 100, fireGap: 0.105, reloadTime: 2.0,
    spreadStill: 0.0016, spreadMove: 0.026, bloom: 0.007, bloomDecay: 2.6,
    adsMult: 0.45, falloffStart: 18, falloffEnd: 46, falloffMin: 0.65,
    kick: 0.013, range: 80,
  },
  shotgun: {
    name: 'M88 Breacher', kind: 'shotgun', price: 1100, auto: false,
    damage: 13, headMult: 1.6, bodyMult: 1.0, legMult: 0.8, pellets: 8,
    mag: 6, reserve: 24, fireGap: 0.8, reloadTime: 2.4,
    spreadStill: 0.02, spreadMove: 0.034, bloom: 0.012, bloomDecay: 2.4,
    adsMult: 0.7, falloffStart: 6, falloffEnd: 18, falloffMin: 0.35,
    kick: 0.035, range: 40,
  },
  marksman: {
    name: 'Lance-50', kind: 'marksman', price: 3200, auto: false,
    damage: 82, headMult: 2.4, bodyMult: 1.0, legMult: 0.75,
    mag: 5, reserve: 20, fireGap: 1.05, reloadTime: 2.6,
    spreadStill: 0.0006, spreadMove: 0.05, bloom: 0.02, bloomDecay: 1.8,
    adsMult: 0.35, falloffStart: 22, falloffEnd: 60, falloffMin: 0.7,
    kick: 0.042, range: 90,
  },
};

export const GRENADE = { name: 'Spark Grenade', price: 300, fuse: 1.7, radius: 7.5, maxDamage: 110 };
export const ARMOR = { name: 'Plated Vest', price: 650, absorb: 0.5 };

// Damage at a distance: full until falloffStart, then linear down to falloffMin.
export function damageAt(def, distance) {
  if (distance <= def.falloffStart) return def.damage;
  const t = Math.min(1, (distance - def.falloffStart) / (def.falloffEnd - def.falloffStart));
  return def.damage * (1 - t * (1 - def.falloffMin));
}

export function createViewModel(camera) {
  const steel = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2b2620'), roughness: 0.55, metalness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#171310'), roughness: 0.7, metalness: 0.2 });
  const ember = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) });
  const group = new THREE.Group();
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.1, 0.4), steel);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.34), dark);
  barrel.position.set(0, 0.028, -0.36);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.08), dark);
  grip.position.set(0, -0.1, 0.16);
  grip.rotation.x = 0.3;
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.075, 0.2), dark);
  stock.position.set(0, -0.015, 0.28);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.012), ember);
  sight.position.set(0, 0.068, -0.1);
  group.add(receiver, barrel, grip, stock, sight);
  group.position.set(0.24, -0.2, -0.42);
  camera.add(group);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.17, 0.17),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.17, -1.05);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  flashLight.position.set(0.24, -0.15, -0.6);
  camera.add(flashLight);

  const state = { kick: 0, flash: 0, reloadT: 0, reloadTotal: 1 };

  function setWeapon(kind) {
    // Longer barrel for the marksman, a wider body for the shotgun, a short
    // body for the pistol and SMG: the silhouette tells the gun at a glance.
    const scale = { pistol: [0.8, 0.7], smg: [0.9, 0.85], rifle: [1, 1], shotgun: [1.05, 1.15], marksman: [1.35, 1] };
    const [length, width] = scale[kind] || [1, 1];
    receiver.scale.set(width, 1, length);
    barrel.scale.set(1, 1, length);
    barrel.position.z = -0.36 * length;
    sight.visible = kind !== 'shotgun';
  }

  return {
    group,
    setWeapon,
    trigger() {
      state.kick = 0.06;
      state.flash = 0.06;
    },
    startReload(total) {
      state.reloadT = total;
      state.reloadTotal = total;
    },
    step(dt) {
      state.flash = Math.max(0, state.flash - dt);
      state.kick += (0 - state.kick) * Math.min(1, dt * 13);
      group.position.z = -0.42 + state.kick;
      group.rotation.x = state.kick * 2.0;
      if (state.reloadT > 0) {
        state.reloadT = Math.max(0, state.reloadT - dt);
        const progress = 1 - state.reloadT / state.reloadTotal;
        group.rotation.x = -0.5 * Math.sin(progress * Math.PI);
        group.position.y = -0.2 - 0.06 * Math.sin(progress * Math.PI);
      } else {
        group.position.y = -0.2;
      }
      flash.visible = state.flash > 0;
      flash.rotation.z = state.flash * 28;
      flashLight.intensity = state.flash > 0 ? 16 : 0;
    },
  };
}

// One owned gun: magazine, reserve, cooldown, reload timer and bloom.
export function createGun(def) {
  const state = {
    def, mag: def.mag, reserve: def.reserve,
    cooldown: 0, reloadLeft: 0, bloom: 0,
  };
  return {
    state,
    def,
    ready() {
      return state.mag > 0 && state.cooldown <= 0 && state.reloadLeft <= 0;
    },
    spread(speed, moving, ads) {
      const base = def.spreadStill + Math.min(1, speed / 5.2) * def.spreadMove + state.bloom;
      return ads ? base * def.adsMult : base;
    },
    fire() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      state.cooldown = def.fireGap;
      state.bloom = Math.min(0.05, state.bloom + def.bloom);
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === def.mag || state.reserve === 0) return false;
      state.reloadLeft = def.reloadTime;
      return true;
    },
    step(dt) {
      state.cooldown = Math.max(0, state.cooldown - dt);
      state.bloom = Math.max(0, state.bloom - def.bloomDecay * dt * 0.01);
      if (state.reloadLeft > 0) {
        state.reloadLeft = Math.max(0, state.reloadLeft - dt);
        if (state.reloadLeft === 0) {
          const need = def.mag - state.mag;
          const take = Math.min(need, state.reserve);
          state.mag += take;
          state.reserve -= take;
        }
      }
    },
    refill() {
      state.mag = def.mag;
      state.reserve = def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.bloom = 0;
    },
  };
}
