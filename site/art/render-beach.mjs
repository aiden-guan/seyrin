#!/usr/bin/env node
// Renders the landing page's beach diorama as isometric pixel art. A small ray tracer (signed distance
// fields, sun and sky light, soft shadows, ambient occlusion) works out how much light each pixel gets,
// then snaps it to a hand-picked colour ramp per material, the way a pixel artist shades.
// Writes to site/src/assets/:
//   beach-day.png, beach-dusk.png  colour; same geometry under two suns
//   beach-mask.png                 R distance to the waterline (128 = shore), G computer screen,
//                                  B loose edge pixel (the page draws those as particles)
//   beach.ts                       image size, the screen's corners in pixels, anchors for the page
// Run: node site/art/render-beach.mjs [--preview]   (--preview also writes 4x PNGs to look at)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG, preview } from './png.mjs';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/assets');
const PREVIEW = process.argv.includes('--preview');

// --- maths -------------------------------------------------------------------------------------------

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mix = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const norm = (x, y, z) => {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
};
const deg = (d) => (d * Math.PI) / 180;

function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x, y) {
  let s = 0, a = 0.5;
  for (let i = 0; i < 4; i++) {
    s += a * vnoise(x, y);
    x = x * 2.03 + 17.1;
    y = y * 2.03 + 9.2;
    a *= 0.5;
  }
  return s;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bayer = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];

function smin(a, b, k) {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return mix(b, a, h) - k * h * (1 - h);
}

// --- signed distance primitives ---------------------------------------------------------------------

function sdBox(px, py, pz, bx, by, bz) {
  const qx = Math.abs(px) - bx, qy = Math.abs(py) - by, qz = Math.abs(pz) - bz;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0);
}

const sdRoundBox = (px, py, pz, bx, by, bz, r) => sdBox(px, py, pz, bx - r, by - r, bz - r) - r;

function sdCapsule(px, py, pz, ax, ay, az, bx, by, bz, r) {
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}

const sdSphere = (px, py, pz, r) => Math.sqrt(px * px + py * py + pz * pz) - r;

function sdEllipsoid(px, py, pz, rx, ry, rz) {
  const k0 = Math.sqrt((px / rx) ** 2 + (py / ry) ** 2 + (pz / rz) ** 2);
  const k1 = Math.sqrt((px / (rx * rx)) ** 2 + (py / (ry * ry)) ** 2 + (pz / (rz * rz)) ** 2);
  return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}

function sdCylZ(px, py, pz, r, h) {
  const dx = Math.sqrt(px * px + py * py) - r, dz = Math.abs(pz) - h;
  return Math.min(Math.max(dx, dz), 0) + Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
}

// --- palette ------------------------------------------------------------------------------------------

const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const ramp = (...cols) => cols.map(hex);

const P = {
  sand: ramp('#8f6f4c', '#aa8a60', '#c3a274', '#d7bb8b', '#e7cfa3', '#f3e3c1'),
  wetSand: ramp('#755b3f', '#8c6f4f', '#a28362', '#b69777'),
  foam: ramp('#b9d8d6', '#dcefec', '#f6fbf9', '#ffffff'),
  water: ramp('#1d5a7c', '#256f90', '#3487a3', '#47a1b3', '#63bbc0', '#8dd5cd', '#b5e8dc'),
  shell: ramp('#c9a294', '#e6c3b4', '#f7e2d6'),
  plastic: ramp('#7c7464', '#968d7a', '#b0a791', '#c8c0a8', '#dcd5bf', '#ece6d3', '#f7f3e6'),
  bezel: ramp('#5b5446', '#71695a', '#878070', '#9d9684'),
  slot: ramp('#1c1b20', '#2a292f', '#3a3940'),
  screen: ramp('#120f2e', '#1b1745', '#26205c'),
  coral: ramp('#7e2a2a', '#a53b35', '#c9523f', '#e0704f', '#f08f68'),
  cream: ramp('#a59c88', '#c4baa2', '#ddd3bb', '#eee6d1', '#faf5e8'),
  navy: ramp('#1c2747', '#26365f', '#33497a', '#435d93', '#5874aa'),
  wood: ramp('#4f3523', '#69472e', '#84603d', '#a07a50', '#b8936a'),
  pole: ramp('#8f8a80', '#b3ada2', '#d4cfc4', '#efebe2'),
  skin: ramp('#6e4329', '#8a5536', '#a66a45', '#c08158', '#d59a6f', '#e6b48b'),
  shirt: ramp('#8a6312', '#ad811c', '#cfa22e', '#e6bd45', '#f3d66b'),
  shorts: ramp('#13484d', '#1b5f65', '#24797d', '#349496', '#4fb0ae'),
  hair: ramp('#1f1611', '#2e2119', '#3f2d22', '#523b2c'),
  glasses: ramp('#0d0d11', '#18181e', '#2a2a33', '#6e6e7c'),
  glass: ramp('#8fb3b8', '#b5d3d5', '#dcefee', '#ffffff'),
  juice: ramp('#a23c17', '#c95a21', '#e57b2e', '#f59e48'),
  red: ramp('#7f1f22', '#a52a2c', '#c8403a', '#e05a4b'),
  ballBlue: ramp('#1d3f86', '#2850a6', '#3866c4', '#5582dc'),
  ballYellow: ramp('#9a7413', '#c0951c', '#e2b72c', '#f4d04f'),
  white: ramp('#a9a69f', '#c9c6be', '#e3e0d8', '#f4f2ec', '#ffffff'),
  flipflop: ramp('#145e66', '#1c7a82', '#2a979c', '#45b2b2'),
};

// --- camera: 2:1 isometric, orthographic, right-handed (+X runs to the lower left, +Y to the lower right)

const EL = Math.PI / 6; // 30° elevation gives exact 2:1 pixel lines
const SQ2 = Math.SQRT2;
const DX = -Math.cos(EL) / SQ2, DY = DX, DZ = -Math.sin(EL);
const RX = -1 / SQ2, RY = 1 / SQ2;
const UX = -Math.sin(EL) / SQ2, UY = UX, UZ = Math.cos(EL);
const PX = 1 / SQ2; // world units per pixel
const ZK = SQ2 * Math.cos(EL); // pixels per unit of height

const W = 300, H = 176;
const CX = 150, CY = 92; // pixel position of the world origin
const ZMAX = 60;

const project = (x, y, z) => [CX + (y - x), CY + (x + y) / 2 - ZK * z];

// --- scene ------------------------------------------------------------------------------------------

const ISLAND = 62;

function regionSD(x, y) {
  const n = 3.1;
  const r = Math.pow(Math.pow(Math.abs(x) / ISLAND, n) + Math.pow(Math.abs(y) / ISLAND, n), 1 / n);
  return (r - 1) * ISLAND + (fbm(x * 0.05 + 3.1, y * 0.05 - 7.3) - 0.47) * 18;
}

const shoreX = (y) => 27 + 5 * Math.sin(y * 0.055 + 0.6) + (fbm(y * 0.06 + 11, 2.5) - 0.47) * 9;

// Footprints from the water to the lounger: [x, y] of each print.
const FOOTPRINTS = [];
for (let i = 0; i < 7; i++) {
  const t = i / 6;
  const x = mix(31, 21.5, t), y = mix(14, 7.5, t) + (i % 2 ? 1.1 : -1.1);
  FOOTPRINTS.push([x, y]);
}

function groundMaterial(x, y) {
  const dx = x - shoreX(y);
  if (dx > 1.6) return { kind: 'water', depth: dx - 1.6, shore: dx };
  if (dx > -0.6) return { ramp: P.foam, bias: 0.9, jitter: (hash2(x * 2, y * 2) - 0.5) * 0.8, shore: dx };
  if (dx > -6 + vnoise(y * 0.4, 1) * 2) return { ramp: P.wetSand, bias: 0.4 + smoothstep(-6, -0.6, dx) * 0.6, jitter: (hash2(x * 1.6, y * 1.6) - 0.5) * 0.7, shore: dx };
  if (hash2(Math.floor(x * 0.9), Math.floor(y * 0.9)) > 0.9965) return { ramp: P.shell, bias: 0.5, jitter: 0, shore: dx };
  let b = 0;
  const ripple = Math.sin(x * 0.85 + y * 0.32 + fbm(x * 0.08, y * 0.08) * 7);
  if (ripple > 0.82) b += 0.45;
  else if (ripple < -0.9) b -= 0.25;
  for (const [fx, fy] of FOOTPRINTS) {
    const ex = (x - fx) / 1.1, ey = (y - fy) / 0.65;
    if (ex * ex + ey * ey < 1) b -= 0.9;
  }
  return { ramp: P.sand, bias: b, jitter: (hash2(Math.floor(x * 1.3), Math.floor(y * 1.3)) - 0.5) * 0.75, shore: dx };
}

const objects = [];

// The computer: a giant beige all-in-one, tilted back and sunk into the sand, its screen facing us.
const PC = { x: -14, y: -37, z: -5, yaw: deg(30), tilt: deg(15), w: 38, d: 30, h: 48, sw: 26, sh: 19.5, sv: 23 };
{
  const cy = Math.cos(PC.yaw), sy = Math.sin(PC.yaw), ct = Math.cos(PC.tilt), st = Math.sin(PC.tilt);
  const F = [cy * ct, sy * ct, st]; // front normal
  const U = [-sy, cy, 0]; // screen right, as seen by someone facing it
  const V = [-cy * st, -sy * st, ct]; // up the screen
  PC.F = F; PC.U = U; PC.V = V;
  const local = (x, y, z) => {
    const dx = x - PC.x, dy = y - PC.y, dz = z - PC.z;
    return [dx * U[0] + dy * U[1] + dz * U[2], dx * F[0] + dy * F[1] + dz * F[2], dx * V[0] + dy * V[1] + dz * V[2]];
  };
  PC.toWorld = (u, w, v) => [PC.x + u * U[0] + w * F[0] + v * V[0], PC.y + u * U[1] + w * F[1] + v * V[1], PC.z + u * U[2] + w * F[2] + v * V[2]];
  const halfW = PC.w / 2, halfD = PC.d / 2, halfH = PC.h / 2;
  const sx = PC.sw / 2, svc = PC.sv + PC.sh / 2, shh = PC.sh / 2;
  objects.push({
    name: 'computer',
    box: [-50, -70, -12, 14, -4, 50],
    sdf(x, y, z) {
      const [u, w, v] = local(x, y, z);
      let d = sdRoundBox(u, w + halfD, v - halfH, halfW, halfD, halfH, 3.2);
      // Rear taper of a compact Mac.
      d = Math.max(d, (-(w + PC.d * 0.45) * 0.55 + (v - PC.h * 0.9) * 0.83));
      // Screen recess, chin groove and floppy slot.
      d = Math.max(d, -sdRoundBox(u, w - 1, v - svc, sx + 1.6, 2.4, shh + 1.6, 1.4));
      d = Math.max(d, -sdBox(u - 7.5, w, v - 9, 5.2, 0.9, 0.55));
      d = Math.max(d, -sdBox(u, w, v - 4, halfW + 1, 0.35, 0.22));
      return d;
    },
    mat(x, y, z) {
      const [u, w, v] = local(x, y, z);
      if (w < -1.05 && Math.abs(u) < sx + 0.3 && Math.abs(v - svc) < shh + 0.3) return { ramp: P.screen, bias: 0.3, jitter: 0, screen: 1 };
      if (Math.abs(u - 7.5) < 5.4 && Math.abs(v - 9) < 0.75 && w < 0.5) return { ramp: P.slot, bias: 0, jitter: 0 };
      if (w < -0.2 && Math.abs(u) < sx + 1.8 && Math.abs(v - svc) < shh + 1.8) return { ramp: P.bezel, bias: 0.2, jitter: 0 };
      return { ramp: P.plastic, bias: 0.15, jitter: (hash2(Math.floor(u * 3), Math.floor(v * 3)) - 0.5) * 0.25, dither: 1 };
    },
  });
}

// Sand heaped around the computer's base.
{
  const mx = PC.x - PC.F[0] * 13, my = PC.y - PC.F[1] * 13;
  const bump = (x, y) => 9 * Math.exp(-(((x - mx) / 21) ** 2) - ((y - my) / 21) ** 2) + 1.2 * fbm(x * 0.2, y * 0.2) * Math.exp(-(((x - mx) / 22) ** 2) - ((y - my) / 24) ** 2);
  objects.push({
    name: 'mound',
    ground: true,
    box: [mx - 45, my - 48, 0, mx + 45, my + 48, 8],
    sdf: (x, y, z) => (z - bump(x, y)) * 0.55,
    mat: (x, y) => groundMaterial(x, y),
  });
}

// Lounger and the man on it, in lounger space: a runs from the head end toward the water (+X), b across (+Y).
const LG = { x: -11, y: 1, len: 31, half: 4.7 };
{
  const L = (x, y) => [x - LG.x, y - LG.y];
  const fabric = (a, b, z) => {
    const back = sdCapsule(a, 0, z, 11, 0, 5.6, 1.2, 0, 15.6, 0.45);
    const seat = sdCapsule(a, 0, z, 11, 0, 5.6, 30.6, 0, 6.2, 0.45);
    return Math.max(Math.min(back, seat), Math.abs(b) - LG.half);
  };
  const frame = (a, b, z) => {
    const s = b < 0 ? -1 : 1, rb = Math.abs(b) - (LG.half + 0.35);
    let d = Math.min(sdCapsule(a, rb, z, 11, 0, 5.2, 1.0, 0, 15.3, 0.5), sdCapsule(a, rb, z, 11, 0, 5.2, 30.8, 0, 5.8, 0.5));
    d = Math.min(d, sdCapsule(a, rb, z, 12.2, 0, 5.2, 12.2, 0, 0, 0.45), sdCapsule(a, rb, z, 29.6, 0, 5.6, 29.6, 0, 0, 0.45));
    d = Math.min(d, sdCapsule(a, rb, z, 4, 0, 12.6, 7.4, 0, 0, 0.4));
    return d + 0 * s;
  };
  const parts = [
    // [kind, sdf]
    ['skin', (a, b, z) => sdSphere(a - 2.7, b, z - 18.6, 2.45)],
    ['skin', (a, b, z) => sdCapsule(a, b, z, 4.2, 0, 17.0, 5.3, 0, 16.0, 1.05)],
    ['shirt', (a, b, z) => smin(sdCapsule(a, b, z, 5.9, -1.2, 15.4, 11.2, -1.0, 9.6, 2.25), sdCapsule(a, b, z, 5.9, 1.2, 15.4, 11.2, 1.0, 9.6, 2.25), 1.2)],
    ['shorts', (a, b, z) => sdEllipsoid(a - 12.8, b, z - 8.7, 2.6, 2.9, 2.2)],
    ['shorts', (a, b, z) => sdCapsule(a, b, z, 13.0, 1.4, 8.6, 16.6, 1.55, 11.1, 1.5)],
    ['shorts', (a, b, z) => sdCapsule(a, b, z, 13.0, -1.4, 8.4, 17.0, -1.5, 8.0, 1.5)],
    ['skin', (a, b, z) => sdCapsule(a, b, z, 16.4, 1.55, 11.0, 19.4, 1.7, 13.0, 1.3)],
    ['skin', (a, b, z) => sdCapsule(a, b, z, 19.4, 1.7, 13.0, 24.3, 1.9, 7.8, 1.12)],
    ['skin', (a, b, z) => sdCapsule(a, b, z, 24.3, 1.9, 7.8, 26.0, 1.9, 8.6, 0.85)],
    ['skin', (a, b, z) => sdCapsule(a, b, z, 16.8, -1.5, 8.0, 27.2, -1.7, 7.3, 1.15)],
    ['skin', (a, b, z) => sdCapsule(a, b, z, 27.2, -1.7, 7.3, 27.8, -1.7, 9.3, 0.85)],
    ['skin', (a, b, z) => sdCapsule(a, b, z, 6.2, 3.3, 15.6, 3.0, 5.6, 19.9, 0.95)],
    ['skin', (a, b, z) => sdCapsule(a, b, z, 3.0, 5.6, 19.9, 1.1, 1.3, 19.6, 0.85)],
    ['skin', (a, b, z) => sdCapsule(a, b, z, 6.2, -3.3, 15.6, 3.0, -5.6, 19.9, 0.95)],
    ['skin', (a, b, z) => sdCapsule(a, b, z, 3.0, -5.6, 19.9, 1.1, -1.3, 19.6, 0.85)],
    ['shirt', (a, b, z) => sdCapsule(a, b, z, 6.2, 3.3, 15.6, 4.9, 4.3, 17.4, 1.15)],
    ['shirt', (a, b, z) => sdCapsule(a, b, z, 6.2, -3.3, 15.6, 4.9, -4.3, 17.4, 1.15)],
    ['glasses', (a, b, z) => sdEllipsoid(a - 4.55, b, z - 19.85, 0.55, 2.05, 0.7)],
  ];
  const FACE = norm(0.72, 0, 0.69);
  objects.push({
    name: 'lounger',
    box: [LG.x - 1, LG.y - LG.half - 2, 0, LG.x + LG.len + 1, LG.y + LG.half + 2, 8],
    sdf(x, y, z) {
      const [a, b] = L(x, y);
      return Math.min(fabric(a, b, z), frame(a, b, z));
    },
    mat(x, y, z) {
      const [a, b] = L(x, y);
      if (frame(a, b, z) < fabric(a, b, z)) return { ramp: P.wood, bias: 0.1, jitter: 0, dither: 1 };
      const stripe = Math.floor((b + LG.half) / ((LG.half * 2) / 5));
      return stripe % 2 ? { ramp: P.cream, bias: 0, jitter: 0, dither: 1 } : { ramp: P.navy, bias: 0.25, jitter: 0, dither: 1 };
    },
  });
  objects.push({
    name: 'man',
    box: [LG.x - 1, LG.y - 7.5, 4, LG.x + 29.5, LG.y + 7.5, 22.5],
    sdf(x, y, z) {
      const [a, b] = L(x, y);
      let d = 1e9;
      for (const p of parts) d = Math.min(d, p[1](a, b, z));
      return d;
    },
    mat(x, y, z) {
      const [a, b] = L(x, y);
      let best = 1e9, kind = 'skin';
      for (const p of parts) {
        const d = p[1](a, b, z);
        if (d < best) { best = d; kind = p[0]; }
      }
      if (kind === 'skin') {
        // Hair on the back and top of the head.
        const hx = a - 2.7, hz = z - 18.6, hl = Math.hypot(hx, b, hz);
        if (hl < 2.7 && (hx * FACE[0] + hz * FACE[2]) / hl < -0.05) return { ramp: P.hair, bias: 0.3, jitter: 0, dither: 1 };
        return { ramp: P.skin, bias: 0.25, jitter: 0, dither: 1 };
      }
      if (kind === 'shirt') {
        const dot = hash2(Math.floor(a * 0.9), Math.floor(b * 0.9 + 9)) > 0.72;
        return { ramp: P.shirt, bias: dot ? 0.9 : 0.1, jitter: 0, dither: 1 };
      }
      return { ramp: P[kind], bias: 0.2, jitter: 0, dither: 1 };
    },
  });
}

// Umbrella, leaning a little into the sun.
{
  const base = [-29, 19.5, 0], top = [-25.8, 17.4, 28.5];
  const R = 15.5, DROP = 5.6, K = DROP / R, KN = 1 / Math.sqrt(1 + K * K);
  const canopy = (x, y, z) => {
    const px = x - top[0], py = y - top[1], pz = z - top[2] - 0.6;
    const q = Math.hypot(px, py);
    const th = Math.atan2(py, px);
    const edge = R - 0.9 * Math.abs(Math.sin(th * 5));
    return Math.max(Math.abs(pz + q * K) * KN - 0.38, q - edge);
  };
  const pole = (x, y, z) => sdCapsule(x, y, z, base[0], base[1], base[2], top[0], top[1], top[2] + 1.2, 0.48);
  objects.push({
    name: 'umbrella',
    box: [top[0] - R - 1, top[1] - R - 1, 0, top[0] + R + 1, top[1] + R + 1, top[2] + 2.5],
    sdf: (x, y, z) => Math.min(canopy(x, y, z), pole(x, y, z), sdSphere(x - top[0], y - top[1], z - top[2] - 1.5, 0.75)),
    mat(x, y, z) {
      if (pole(x, y, z) < canopy(x, y, z) - 0.05 || z > top[2] + 0.8) return { ramp: P.pole, bias: 0.2, jitter: 0, dither: 1 };
      const th = Math.atan2(y - top[1], x - top[0]);
      const wedge = Math.floor(((th + Math.PI) / (Math.PI * 2)) * 10);
      return wedge % 2 ? { ramp: P.cream, bias: 0.1, jitter: 0, dither: 1 } : { ramp: P.coral, bias: 0.2, jitter: 0, dither: 1 };
    },
  });
}

// A drink in the sand by his hand, a beach ball near the water, flip-flops by the lounger.
{
  const g = [4.5, -8.6];
  objects.push({
    name: 'drink',
    box: [g[0] - 1.6, g[1] - 1.6, 0, g[0] + 1.6, g[1] + 1.6, 5.4],
    sdf: (x, y, z) => Math.min(sdCylZ(x - g[0], y - g[1], z - 1.45, 0.95, 1.45), sdCapsule(x, y, z, g[0], g[1], 2.2, g[0] + 0.5, g[1] - 0.6, 4.6, 0.26)),
    mat(x, y, z) {
      if (z > 2.95 || Math.hypot(x - g[0], y - g[1]) < 0.6 && z > 2.7) return { ramp: P.red, bias: 0.3, jitter: 0 };
      if (z > 2.35) return { ramp: P.glass, bias: 0.4, jitter: 0 };
      return { ramp: P.juice, bias: 0.5, jitter: 0, dither: 1 };
    },
  });
  const ball = [18.5, 18.5, 2.75];
  objects.push({
    name: 'ball',
    box: [ball[0] - 3, ball[1] - 3, 0, ball[0] + 3, ball[1] + 3, 5.8],
    sdf: (x, y, z) => sdSphere(x - ball[0], y - ball[1], z - ball[2], 2.75),
    mat(x, y, z) {
      const dz = (z - ball[2]) / 2.75;
      if (dz > 0.82) return { ramp: P.white, bias: 0.2, jitter: 0, dither: 1 };
      const seg = Math.floor(((Math.atan2(y - ball[1], x - ball[0]) + Math.PI) / (Math.PI * 2)) * 6 + 0.3) % 6;
      const r = [P.red, P.white, P.ballBlue, P.white, P.ballYellow, P.white][seg];
      return { ramp: r, bias: 0.25, jitter: 0, dither: 1 };
    },
  });
  const ff = [[-14.5, 9.4, 0.2], [-12.4, 11.6, -0.25]];
  objects.push({
    name: 'flipflops',
    box: [-18, 6.5, 0, -9, 14.5, 0.7],
    sdf: (x, y, z) => Math.min(...ff.map(([fx, fy, r]) => {
      const c = Math.cos(r), s = Math.sin(r), lx = (x - fx) * c + (y - fy) * s, ly = -(x - fx) * s + (y - fy) * c;
      return sdEllipsoid(lx, ly, z - 0.05, 2.2, 0.95, 0.32);
    })),
    mat: () => ({ ramp: P.flipflop, bias: 0.3, jitter: 0, dither: 1 }),
  });
}

// --- tracer -------------------------------------------------------------------------------------------

function rayBox(ox, oy, oz, dx, dy, dz, b) {
  let t0 = -1e9, t1 = 1e9;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < b[i] || o[i] > b[i + 3]) return null;
      continue;
    }
    let a = (b[i] - o[i]) / d[i], c = (b[i + 3] - o[i]) / d[i];
    if (a > c) [a, c] = [c, a];
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
  }
  return t0 <= t1 ? [t0, t1] : null;
}

function march(ox, oy, oz, dx, dy, dz, cands, t0, t1) {
  let t = t0;
  for (let i = 0; i < 400 && t < t1; i++) {
    const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
    let d = 1e9, hit = null;
    for (const o of cands) {
      const v = o.sdf(x, y, z);
      if (v < d) { d = v; hit = o; }
    }
    if (d < 0.004) return { t, obj: hit };
    t += Math.max(d * 0.85, 0.004);
  }
  return null;
}

function normalAt(o, x, y, z) {
  const e = 0.04;
  return norm(
    o.sdf(x + e, y, z) - o.sdf(x - e, y, z),
    o.sdf(x, y + e, z) - o.sdf(x, y - e, z),
    o.sdf(x, y, z + e) - o.sdf(x, y, z - e),
  );
}

function softShadow(x, y, z, L) {
  const cands = [];
  for (const o of objects) {
    const r = rayBox(x, y, z, L[0], L[1], L[2], o.box);
    if (r && r[1] > 0) cands.push(o);
  }
  if (!cands.length) return 1;
  let res = 1, t = 0.08;
  for (let i = 0; i < 200 && t < 220; i++) {
    const px = x + L[0] * t, py = y + L[1] * t, pz = z + L[2] * t;
    if (pz > ZMAX) break;
    let h = 1e9;
    for (const o of cands) h = Math.min(h, o.sdf(px, py, pz));
    if (h < 0.002) return 0;
    res = Math.min(res, (10 * h) / t);
    t += clamp(h, 0.03, 3);
  }
  return clamp(res, 0, 1);
}

function sceneSDF(x, y, z) {
  let d = z;
  for (const o of objects) {
    const b = o.box;
    const ex = Math.max(b[0] - x, x - b[3], 0), ey = Math.max(b[1] - y, y - b[4], 0), ez = Math.max(b[2] - z, z - b[5], 0);
    if (ex + ey + ez > 6) continue;
    d = Math.min(d, o.sdf(x, y, z));
  }
  return d;
}

function occlusion(x, y, z, n) {
  let occ = 0, sca = 1;
  for (let i = 1; i <= 5; i++) {
    const h = 0.45 * i * i * 0.5 + 0.3;
    const d = sceneSDF(x + n[0] * h, y + n[1] * h, z + n[2] * h);
    occ += (h - d) * sca;
    sca *= 0.7;
  }
  return clamp(1 - 0.32 * occ, 0, 1);
}

// --- pass 1: what each pixel sees -------------------------------------------------------------------

const gbuf = new Array(W * H).fill(null);
const T = 400;
const started = Date.now();
for (let py = 0; py < H; py++) {
  for (let px = 0; px < W; px++) {
    const a = (px + 0.5 - CX) * PX, b = -(py + 0.5 - CY) * PX;
    const ox = a * RX + b * UX - T * DX, oy = a * RY + b * UY - T * DY, oz = b * UZ - T * DZ;
    const tTop = (oz - ZMAX) / -DZ, tGround = oz / -DZ;
    const cands = [];
    let tMin = Infinity;
    for (const o of objects) {
      const r = rayBox(ox, oy, oz, DX, DY, DZ, o.box);
      if (r && r[1] > tTop && r[0] < tGround) {
        cands.push(o);
        tMin = Math.min(tMin, r[0]);
      }
    }
    let hit = cands.length ? march(ox, oy, oz, DX, DY, DZ, cands, Math.max(tTop, tMin - 0.01), tGround) : null;
    let x, y, z, n, t, mat, ground = false;
    if (hit) {
      t = hit.t;
      x = ox + DX * t; y = oy + DY * t; z = oz + DZ * t;
      n = normalAt(hit.obj, x, y, z);
      mat = hit.obj.mat(x, y, z, n);
      ground = !!hit.obj.ground;
    } else {
      t = tGround;
      x = ox + DX * t; y = oy + DY * t; z = 0;
      n = [0, 0, 1];
      ground = true;
      mat = null;
    }
    let loose = false;
    if (ground) {
      const sd = regionSD(x, y);
      if (sd > -4) {
        const keep = 0.6 * vnoise(x * 0.42 + 40, y * 0.42) + 0.4 * hash2(px * 7 + 1, py * 13 + 5);
        if (keep < smoothstep(-4, 11, sd) * 1.05) continue;
        loose = sd > 0.5;
      }
      if (!mat) mat = groundMaterial(x, y);
    }
    gbuf[py * W + px] = { x, y, z, n, t, mat, ground, loose, obj: hit ? hit.obj.name : 'ground' };
  }
}
console.log(`traced ${W}x${H} in ${((Date.now() - started) / 1000).toFixed(1)}s`);

// Ambient occlusion does not depend on the sun, so it is shared by both lightings.
for (const g of gbuf) if (g) g.ao = occlusion(g.x, g.y, g.z + (g.ground ? 0.02 : 0), g.n);

// --- pass 2: light and colour -------------------------------------------------------------------------

const LIGHTS = {
  day: { sun: norm(0.52, -0.36, 0.78), sunI: 0.74, skyI: 0.36, sunTint: [1, 1, 1], skyTint: [1, 1, 1] },
  dusk: { sun: norm(-0.22, 0.86, 0.32), sunI: 1.15, skyI: 0.22, sunTint: [1.28, 0.9, 0.6], skyTint: [0.56, 0.5, 0.84] },
};

function light(name) {
  const Lt = LIGHTS[name];
  const L = Lt.sun;
  const top = Lt.sunI * Math.max(0, L[2]) + Lt.skyI;
  const out = new Uint8Array(W * H * 4);
  const idx = new Float32Array(W * H).fill(-1);
  const info = new Array(W * H).fill(null);
  for (let i = 0; i < W * H; i++) {
    const g = gbuf[i];
    if (!g) continue;
    const px = i % W, py = (i / W) | 0;
    const ndl = Math.max(0, g.n[0] * L[0] + g.n[1] * L[1] + g.n[2] * L[2]);
    const sh = ndl > 0 ? softShadow(g.x + g.n[0] * 0.05, g.y + g.n[1] * 0.05, g.z + g.n[2] * 0.05, L) : 0;
    const sun = Lt.sunI * ndl * sh;
    const sky = Lt.skyI * (0.55 + 0.45 * g.n[2]) * g.ao;
    const v = (sun + sky) / top;
    let mat = g.mat, k;
    if (mat.kind === 'water') {
      const depthLevel = 6 - g.mat.depth / 4.2;
      const ripple = hash2(Math.floor(g.x * 1.2), Math.floor(g.y * 0.8)) > 0.93 ? 1 : 0;
      k = depthLevel - (1 - sh) * 1.6 + ripple + (bayer(px, py) - 0.5) * 0.9;
      mat = { ramp: P.water };
    } else {
      const n = mat.ramp.length;
      k = v * (n - 1) * 0.92 + (mat.bias || 0) + (mat.jitter || 0) + (bayer(px, py) - 0.5) * (mat.dither ? 0.9 : 0.55);
    }
    idx[i] = k;
    const sunFrac = sun + sky > 0 ? sun / (sun + sky) : 0;
    info[i] = { ramp: mat.ramp, sunFrac };
  }
  // Darken silhouettes one step where an object stands in front of something far behind it.
  for (let i = 0; i < W * H; i++) {
    const g = gbuf[i];
    if (!g || g.ground) continue;
    const px = i % W, py = (i / W) | 0;
    let edge = false;
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const qx = px + ox, qy = py + oy;
      if (qx < 0 || qy < 0 || qx >= W || qy >= H) { edge = true; continue; }
      const q = gbuf[qy * W + qx];
      if (!q || q.t - g.t > 7) edge = true;
    }
    if (edge) idx[i] -= 0.85;
  }
  for (let i = 0; i < W * H; i++) {
    const inf = info[i];
    if (!inf) continue;
    const r = inf.ramp;
    const c = r[clamp(Math.round(idx[i]), 0, r.length - 1)];
    const tint = [0, 1, 2].map((j) => mix(Lt.skyTint[j], Lt.sunTint[j], inf.sunFrac));
    out[i * 4] = clamp(Math.round(c[0] * tint[0]), 0, 255);
    out[i * 4 + 1] = clamp(Math.round(c[1] * tint[1]), 0, 255);
    out[i * 4 + 2] = clamp(Math.round(c[2] * tint[2]), 0, 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}

const day = light('day');
const dusk = light('dusk');

const mask = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) {
  const g = gbuf[i];
  if (!g) continue;
  // Signed distance to the waterline, 4 steps per unit around 128, so the page can animate the swash.
  if (g.mat.shore !== undefined && Math.abs(g.mat.shore) < 31) mask[i * 4] = clamp(Math.round(128 + g.mat.shore * 4), 1, 255);
  if (g.mat.screen) mask[i * 4 + 1] = 255;
  if (g.loose) mask[i * 4 + 2] = 255;
  mask[i * 4 + 3] = 255;
}

// --- outputs ------------------------------------------------------------------------------------------

const corner = (u, v) => project(...PC.toWorld(u, -1.1, v)).map((n) => +n.toFixed(2));
const meta = {
  width: W,
  height: H,
  origin: [CX, CY],
  // Corners of the screen glass in image pixels: top-left, top-right, bottom-right, bottom-left.
  screen: [corner(-PC.sw / 2, PC.sv + PC.sh), corner(PC.sw / 2, PC.sv + PC.sh), corner(PC.sw / 2, PC.sv), corner(-PC.sw / 2, PC.sv)],
  anchors: {
    head: project(LG.x + 2.7, LG.y, 18.6).map((n) => +n.toFixed(1)),
    drink: project(4.5, -8.6, 3).map((n) => +n.toFixed(1)),
    sea: project(45, 10, 0).map((n) => +n.toFixed(1)),
  },
};

mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, 'beach-day.png'), encodePNG(W, H, day));
writeFileSync(resolve(OUT, 'beach-dusk.png'), encodePNG(W, H, dusk));
writeFileSync(resolve(OUT, 'beach-mask.png'), encodePNG(W, H, mask));
writeFileSync(resolve(OUT, 'beach.ts'), `// Generated by site/art/render-beach.mjs. Do not edit.\nexport const BEACH = ${JSON.stringify(meta, null, 2)} as const;\n`);
if (PREVIEW) {
  const dir = process.env.PREVIEW_DIR || OUT;
  writeFileSync(resolve(dir, 'preview-day.png'), preview(W, H, day, 4));
  writeFileSync(resolve(dir, 'preview-dusk.png'), preview(W, H, dusk, 4, [250, 226, 205]));
}
console.log(`wrote beach-*.png and beach.ts in ${((Date.now() - started) / 1000).toFixed(1)}s`, meta.screen);
