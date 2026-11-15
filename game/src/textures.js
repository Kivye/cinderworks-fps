// textures.js — procedural canvas textures, all art made in-code (no assets).
import * as THREE from 'three';

function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function speckle(ctx, w, h, n, colors, r0, r1, rnd) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
    ctx.globalAlpha = 0.12 + rnd() * 0.25;
    const r = r0 + rnd() * (r1 - r0);
    ctx.beginPath(); ctx.arc(rnd() * w, rnd() * h, r, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Warm red-orange brick, bright enough to read at a glance.
export function brickTexture() {
  return canvas(256, 256, (ctx, w, h) => {
    const rnd = mulberry(11);
    ctx.fillStyle = '#b56a4a'; ctx.fillRect(0, 0, w, h);
    const bh = 32, bw = 64;
    for (let y = 0; y < h; y += bh) {
      for (let x = -bw; x < w + bw; x += bw) {
        const off = (y / bh) % 2 ? bw / 2 : 0;
        const shade = 150 + Math.floor(rnd() * 60);
        ctx.fillStyle = `rgb(${shade},${Math.floor(shade * 0.55)},${Math.floor(shade * 0.36)})`;
        ctx.fillRect(x + off + 2, y + 2, bw - 4, bh - 4);
      }
    }
    ctx.fillStyle = '#e8ddc8';
    for (let y = 0; y < h; y += bh) ctx.fillRect(0, y, w, 2);
    speckle(ctx, w, h, 500, ['#7a3a22', '#d98a5f', '#8a4a30'], 1, 4, rnd);
  });
}
export function concreteTexture() {
  return canvas(256, 256, (ctx, w, h) => {
    const rnd = mulberry(23);
    ctx.fillStyle = '#c9c2b2'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 1400, ['#a89f8a', '#ddd6c4', '#8f8672', '#b5ac96'], 1, 5, rnd);
    ctx.strokeStyle = 'rgba(90,82,66,0.5)'; ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath(); ctx.moveTo(rnd() * w, 0); ctx.lineTo(rnd() * w, h); ctx.stroke();
    }
  });
}
export function metalTexture() {
  return canvas(256, 256, (ctx, w, h) => {
    const rnd = mulberry(37);
    ctx.fillStyle = '#7d8894'; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) {
      ctx.fillStyle = y % 32 ? 'rgba(255,255,255,0.10)' : 'rgba(20,26,34,0.16)';
      ctx.fillRect(0, y, w, 16);
    }
    ctx.fillStyle = 'rgba(200,90,40,0.55)';
    for (let i = 0; i < 5; i++) ctx.fillRect(rnd() * w, rnd() * h, 20 + rnd() * 40, 3);
    speckle(ctx, w, h, 400, ['#5a646e', '#9aa4ae'], 1, 3, rnd);
  });
}
export function floorTexture() {
  return canvas(256, 256, (ctx, w, h) => {
    const rnd = mulberry(51);
    ctx.fillStyle = '#b0a88f'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(70,64,48,0.55)'; ctx.lineWidth = 3;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * 64, 0); ctx.lineTo(i * 64, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * 64); ctx.lineTo(w, i * 64); ctx.stroke();
    }
    speckle(ctx, w, h, 900, ['#978e74', '#c4bba2', '#8a8064'], 1, 4, rnd);
  });
}
// Yellow-black hazard strip.
export function hazardTexture() {
  return canvas(256, 64, (ctx, w, h) => {
    ctx.fillStyle = '#f2c200'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1a1a1a';
    for (let x = -h; x < w + h; x += 32) {
      ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + 16, 0); ctx.lineTo(x + 32, 0); ctx.lineTo(x + 16, h); ctx.fill();
    }
  });
}
// Big site letter decal, e.g. "A" / "B", painted on the ground.
export function siteTexture(letter, color) {
  return canvas(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = color;
    ctx.font = 'bold 190px Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(letter, w / 2, h / 2 + 8);
    ctx.strokeStyle = 'rgba(20,20,20,0.85)'; ctx.lineWidth = 10;
    ctx.strokeText(letter, w / 2, h / 2 + 8);
  });
}
// Bot name tag sprite.
export function nameTexture(name, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(10,10,14,0.62)';
  ctx.fillRect(28, 8, 200, 40);
  ctx.fillStyle = color;
  ctx.font = 'bold 28px Arial, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(name, 128, 30);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
