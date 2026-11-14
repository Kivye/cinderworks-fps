// Deterministic randomness: one small seeded generator, used everywhere the game
// needs a die roll (bot spread, spawn picks, screenshot staging). The live game
// seeds it from the clock; ?shot= modes seed it from the URL so a capture is
// reproducible frame for frame.
export function mulberry32(initial) {
  let a = initial | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}

export function range(random, low, high) {
  return low + random() * (high - low);
}
