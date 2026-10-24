// Seyrin landing page. The scroll position drives one timeline: a pixel-art beach, a dive into the
// computer's screen through a particle swarm, the story of what Seyrin does in there, and a pull back out
// to the same beach at dusk.
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/jersey-15/400.css';
import './style.css';
import { BEACH } from './assets/beach';
import dayUrl from './assets/beach-day.png';
import duskUrl from './assets/beach-dusk.png';
import maskUrl from './assets/beach-mask.png';
import { InnerWorld } from './inner';
import { Stage, type Particles, type StageFrame } from './stage';

// Timeline, in viewport heights of scrolling.
const SEGMENTS = [
  ['hero', 0.45],
  ['dive', 1.7],
  ['breach', 0.75],
  ['inbox', 1.0],
  ['work', 1.3],
  ['verify', 1.5],
  ['guard', 1.1],
  ['reply', 1.25],
  ['exit', 1.8],
  ['end', 0.7],
] as const;
type SegName = (typeof SEGMENTS)[number][0];
const TOTAL = SEGMENTS.reduce((n, [, len]) => n + len, 0);
const BEATS: SegName[] = ['inbox', 'work', 'verify', 'guard', 'reply'];

const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function locate(pos: number): { name: SegName; local: number; index: number } {
  let start = 0;
  for (let i = 0; i < SEGMENTS.length; i++) {
    const [name, len] = SEGMENTS[i]!;
    if (pos < start + len || i === SEGMENTS.length - 1) return { name, local: clamp((pos - start) / len), index: i };
    start += len;
  }
  return { name: 'end', local: 1, index: SEGMENTS.length - 1 };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function pixelsOf(img: HTMLImageElement): Uint8ClampedArray {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, c.width, c.height).data;
}

// --- screen geometry -------------------------------------------------------------------------------------

const [TL, TR, , BL] = BEACH.screen;
const E1 = [TR[0] - TL[0], TR[1] - TL[1]] as const;
const E2 = [BL[0] - TL[0], BL[1] - TL[1]] as const;
const EDET = E1[0] * E2[1] - E2[0] * E1[1];
const SCREEN_W = Math.hypot(E1[0], E1[1]);
const SCREEN_H = EDET / SCREEN_W;
const ASPECT = SCREEN_W / SCREEN_H;
const MID = [TL[0] + (E1[0] + E2[0]) / 2, TL[1] + (E1[1] + E2[1]) / 2] as const;
// Turns the slanted screen into an upright rectangle (column-major 2x2), for the end of the dive.
const UNSKEW = [(SCREEN_W * E2[1]) / EDET, (-SCREEN_H * E1[1]) / EDET, (-SCREEN_W * E2[0]) / EDET, (SCREEN_H * E1[0]) / EDET] as const;

// --- particles ---------------------------------------------------------------------------------------------

const BEACH_COLORS = ['#e7cfa3', '#d7bb8b', '#f3e3c1', '#63bbc0', '#8dd5cd', '#3487a3', '#ffffff', '#e0704f'];
const DIGITAL_COLORS = ['#c9c2ff', '#8b80ff', '#5b4fd0', '#5fd6f0', '#ffffff', '#c9c2ff', '#3fd17e', '#f4f2ff'];

function hexBytes(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

function buildParticles(day: Uint8ClampedArray, dusk: Uint8ClampedArray, mask: Uint8ClampedArray, swarmCount: number): Particles {
  const W = BEACH.width, H = BEACH.height;
  const p: number[] = [], c: number[] = [], c2: number[] = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < swarmCount; i++) {
    p.push(rand(), rand(), rand(), rand());
    const b = hexBytes(BEACH_COLORS[Math.floor(rand() * BEACH_COLORS.length)]!);
    const d = hexBytes(DIGITAL_COLORS[Math.floor(rand() * DIGITAL_COLORS.length)]!);
    c.push(b[0], b[1], b[2], 0);
    c2.push(d[0], d[1], d[2], 255);
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (day[i + 3]! < 128 || mask[i + 1]! > 128) continue;
      const loose = mask[i + 2]! > 128;
      // Breach pixels: everything around the screen that can be in view when the beach breaks apart.
      const near = Math.abs(x + 0.5 - MID[0]) < 70 && Math.abs(y + 0.5 - MID[1]) < 62;
      if (!loose && !near) continue;
      p.push(x, y, rand(), 0);
      c.push(day[i]!, day[i + 1]!, day[i + 2]!, loose ? 1 : 2);
      c2.push(dusk[i]!, dusk[i + 1]!, dusk[i + 2]!, 255);
    }
  }
  return { p: new Float32Array(p), c: new Uint8Array(c), c2: new Uint8Array(c2), count: p.length / 4 };
}

// --- page --------------------------------------------------------------------------------------------------

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const spacer = document.querySelector('.scroll') as HTMLElement;
const heroEl = document.querySelector('.hero') as HTMLElement;
const cueEl = document.querySelector('.cue') as HTMLElement;
const endEl = document.querySelector('.end') as HTMLElement;
const beatEls = new Map<string, HTMLElement>([...document.querySelectorAll<HTMLElement>('[data-beat]')].map((el) => [el.dataset.beat!, el]));
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Layout {
  vw: number;
  vh: number;
  dpr: number;
  s0: number; // hero scale
  c0: [number, number]; // hero centre
  s1: number; // scale with the screen filling the view
  px: number; // CSS px per inner pixel
  win: [number, number];
  inner: [number, number];
  safe: [number, number]; // inner rows clear of the header and the captions
  end: { s: number; c: [number, number] }; // the island under the closing words
}

// The island's bounding box in the art. The camera fits it under the headline, and under the closing words at the end.
const ISLAND = { x0: 44, x1: 261, y0: 2, y1: 145 };
const bar = document.querySelector('.bar') as HTMLElement;
// The app's address, if it isn't the default from `npm start`: VITE_APP_URL=https://… npm run site:build
const appUrl = import.meta.env.VITE_APP_URL as string | undefined;
if (appUrl) (document.getElementById('open-app') as HTMLAnchorElement).href = appUrl;

// Fits the island in the space under a block of text: whole device pixels per art pixel, so the pixel art
// stays crisp, rounding up only when that barely overflows.
function frameIsland(vw: number, vh: number, dpr: number, textBottom: number): { s: number; c: [number, number] } {
  const top = textBottom + 12;
  const room = Math.max(vh * 0.3, vh - 56 - top);
  const fine = Math.min((vw * 0.96) / (ISLAND.x1 - ISLAND.x0), room / (ISLAND.y1 - ISLAND.y0)) * dpr;
  const s = Math.max(1, Math.round(fine) <= fine * 1.04 ? Math.round(fine) : Math.floor(fine)) / dpr;
  const y = top + room / 2;
  return { s, c: [(ISLAND.x0 + ISLAND.x1) / 2, (ISLAND.y0 + ISLAND.y1) / 2 - (y - vh / 2) / s] };
}

function measure(): Layout {
  const vw = window.innerWidth, vh = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const hero = frameIsland(vw, vh, dpr, heroEl.offsetTop + heroEl.offsetHeight);
  const end = frameIsland(vw, vh, dpr, endEl.offsetTop + endEl.offsetHeight);
  const px = clamp(Math.round(Math.min(vw / 240, vh / 150)), 3, 9);
  const ws = Math.min(0.86 * vw, 0.8 * vh * ASPECT);
  const winX = Math.round(ws / px), winY = Math.round(winX / ASPECT);
  const s1 = (winX * px) / SCREEN_W;
  let iw = Math.ceil(vw / px) + 4, ih = Math.ceil(vh / px) + 4;
  if ((iw - winX) % 2) iw++;
  if ((ih - winY) % 2) ih++;
  // The inner canvas is centred on the view at px CSS px per pixel once the dive is over.
  const toInner = (y: number) => ih / 2 + (y - vh / 2) / px;
  const captionTop = Math.min(vh, ...[...beatEls.values()].map((el) => el.offsetTop));
  const safe: [number, number] = [Math.ceil(toInner(bar.getBoundingClientRect().bottom)) + 3, Math.floor(toInner(captionTop)) - 3];
  return { vw, vh, dpr, s0: hero.s, c0: hero.c, end, s1, px, win: [winX, winY], inner: [iw, ih], safe };
}

function cameraAt(L: Layout, d: number) {
  const z = easeInOut(clamp(d));
  const s = L.s0 * Math.pow(L.s1 / L.s0, z);
  const u = smooth(0.3, 1, d);
  const m = [lerp(1, UNSKEW[0], u), lerp(0, UNSKEW[1], u), lerp(0, UNSKEW[2], u), lerp(1, UNSKEW[3], u)] as [number, number, number, number];
  // Keep the screen's middle on a smooth path to the centre of the view while zooming.
  const q0 = [L.vw / 2 + L.s0 * (MID[0] - L.c0[0]), L.vh / 2 + L.s0 * (MID[1] - L.c0[1])];
  const qc = easeInOut(clamp(d * 1.12));
  const qx = lerp(q0[0]!, L.vw / 2, qc) - L.vw / 2, qy = lerp(q0[1]!, L.vh / 2, qc) - L.vh / 2;
  const fwd = [m[0] * s, m[1] * s, m[2] * s, m[3] * s] as [number, number, number, number];
  const det = fwd[0] * fwd[3] - fwd[2] * fwd[1];
  const ix = (fwd[3] * qx - fwd[2] * qy) / det, iy = (-fwd[1] * qx + fwd[0] * qy) / det;
  const center: [number, number] = [MID[0] - ix, MID[1] - iy];
  return { s, fwd, center };
}

async function start() {
  const [day, dusk, mask] = await Promise.all([loadImage(dayUrl), loadImage(duskUrl), loadImage(maskUrl)]);
  let L = measure();
  const inner = new InnerWorld();
  let stage: Stage;
  try {
    if (reduced) throw new Error('reduced motion');
    stage = new Stage(canvas, { day, dusk, mask }, { art: [BEACH.width, BEACH.height], screen: BEACH.screen });
  } catch (error) {
    if (!reduced) console.warn('Seyrin: showing the still version.', error);
    staticPage(day, dusk, inner);
    return;
  }
  const swarmCount = L.vw < 700 ? 1400 : 2600;
  stage.setParticles(buildParticles(pixelsOf(day), pixelsOf(dusk), pixelsOf(mask), swarmCount));

  const resize = () => {
    L = measure();
    stage.resize(L.vw, L.vh, L.dpr);
    inner.resize(L.inner[0], L.inner[1], L.win, L.safe);
    spacer.style.height = `${(TOTAL + 1) * L.vh}px`;
  };
  resize();
  window.addEventListener('resize', resize);
  // Caption heights depend on the pixel font, so measure again once it has loaded.
  document.fonts?.ready.then(resize);

  let pos = window.scrollY / L.vh;
  let last = performance.now();
  let flow = 0, speed = 0, prevLogS = Math.log(L.s0), ca = 0;
  document.body.classList.add('is-live');

  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    const target = window.scrollY / L.vh;
    const prev = pos;
    pos += (target - pos) * (1 - Math.exp(-dt * 7));
    if (Math.abs(target - pos) < 1e-4) pos = target;
    const vel = (pos - prev) / Math.max(dt, 1e-3);
    speed = lerp(speed, clamp(Math.abs(vel) * 0.9, 0, 1.6), 1 - Math.exp(-dt * 6));
    flow += dt * (0.04 + Math.abs(vel) * 0.35);

    const at = locate(pos);
    const i = at.index;
    const idx = (n: SegName) => SEGMENTS.findIndex(([k]) => k === n);
    const exiting = i >= idx('exit');
    let d: number, b: number;
    if (i < idx('dive')) [d, b] = [0, 0];
    else if (at.name === 'dive') [d, b] = [at.local, 0];
    else if (at.name === 'breach') [d, b] = [1, at.local];
    else if (!exiting) [d, b] = [1, 1];
    else if (at.name === 'exit') [d, b] = [1 - smooth(0.32, 1, at.local), 1 - smooth(0, 0.42, at.local)];
    else [d, b] = [0, 0];

    // Story time inside the screen.
    let s = 0;
    if (at.name === 'breach') s = at.local * 0.9;
    else if (BEATS.includes(at.name)) s = 1 + BEATS.indexOf(at.name) + at.local;
    else if (exiting) s = 6;

    // On the way out, the camera settles on the island under the closing words instead of the headline.
    const cam = cameraAt(exiting ? { ...L, s0: L.end.s, c0: L.end.c } : L, d);
    const logS = Math.log(cam.s);
    const zoomRate = Math.abs(logS - prevLogS) / Math.max(dt, 1e-3);
    prevLogS = logS;
    ca = lerp(ca, clamp(zoomRate * 1.6, 0, 3.2) + Math.sin(b * Math.PI) * 2.2, 1 - Math.exp(-dt * 10));

    const inside = smooth(0.25, 0.75, b);
    const swarm = clamp(smooth(0.08, 0.5, d) * (1 - 0.55 * smooth(0.85, 1, d)) * (1 - b) + Math.sin(b * Math.PI) * 0.9 + inside * (0.12 + speed * 0.16));
    const corner = Math.hypot(L.vw, L.vh) / 2;
    const f: StageFrame = {
      time: t,
      center: cam.center,
      fwd: cam.fwd,
      scale: cam.s,
      breach: b,
      dusk: exiting ? 1 : 0,
      crt: 0.24 * (1 - smooth(0.5, 1, d)),
      ca: reduced ? 0 : ca,
      glow: lerp(0.65, 1.0, inside),
      vignette: 0.3 * inside,
      innerPx: (cam.s * SCREEN_W) / L.win[0],
      innerWin: L.win,
      swarm,
      flow,
      speed,
      palMix: Math.max(smooth(0.15, 0.85, d), inside),
      additive: inside,
      lift: smooth(0.0, 0.7, d),
      visR: corner / cam.s,
    };
    inner.draw(s, t);
    stage.updateInner(inner.canvas);
    stage.render(f);

    // Words over the canvas.
    const heroOut = smooth(0, 0.3, d) + (i > idx('dive') && !exiting ? 1 : 0);
    heroEl.style.opacity = String(exiting ? 0 : 1 - clamp(heroOut));
    heroEl.style.transform = `translate3d(0, ${-clamp(heroOut) * 60}px, 0)`;
    cueEl.style.opacity = String(1 - smooth(0.02, 0.2, pos));
    for (const [name, el] of beatEls) {
      const on = at.name === name ? smooth(0, 0.12, at.local) * (1 - smooth(0.88, 1, at.local)) : 0;
      el.style.opacity = String(on);
      el.style.transform = `translate3d(0, ${(1 - on) * 14}px, 0)`;
    }
    const endOn = at.name === 'end' ? 1 : at.name === 'exit' ? smooth(0.8, 1, at.local) : 0;
    endEl.style.opacity = String(endOn);
    endEl.classList.toggle('is-on', endOn > 0.5);
    document.body.classList.toggle('is-dark', inside > 0.5);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// Reduced motion, or no WebGL2: the same story as still frames in a normal page.
function staticPage(day: HTMLImageElement, dusk: HTMLImageElement, inner: InnerWorld) {
  document.body.classList.add('is-static');
  spacer.remove();
  canvas.remove();
  const hero = document.createElement('img');
  hero.src = day.src;
  hero.alt = 'A man relaxes on a beach lounger beside a giant retro computer half buried in the sand.';
  hero.className = 'still still-hero';
  heroEl.after(hero);
  const story = [1.86, 2.8, 3.95, 4.62, 5.95];
  BEATS.forEach((name, k) => {
    const el = beatEls.get(name);
    if (!el) return;
    inner.resize(240, 150, [170, 126]);
    inner.draw(story[k]!, 1.2);
    const c = document.createElement('canvas');
    c.width = 240;
    c.height = 150;
    c.getContext('2d')!.drawImage(inner.canvas, 0, 0);
    c.className = 'still';
    el.after(c);
  });
  const end = document.createElement('img');
  end.src = dusk.src;
  end.alt = 'The same beach at dusk.';
  end.className = 'still still-hero';
  endEl.before(end);
}

start();
