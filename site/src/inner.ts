// The world inside the computer's screen, drawn as a function of story time s:
//   0..1  the Seyrin inbox on the screen, seen from the beach
//   1..2  your inbox is full of work           (four emails that each ask for something, and more keep coming)
//   2..3  agents do what each email asks       (a one-pager gets written, a bug squashed, a price changed)
//   3..4  Kane CLI checks it in a real browser (the bug fix fails once, the agent tries again, then it passes)
//   4..5  scams bounce off                     (a "wire $4,800 now" email hits the shield)
//   5..6  done, verified, reply drafted        (the work folds into replies in Drafts: inbox zero)
// One canvas pixel covers a few CSS pixels; the stage scales the canvas up with hard edges.
import { frame, line, rect, sprite, spriteSize, text, textWidth } from './pixels';

const C = {
  sky0: '#0a081d',
  sky1: '#100d29',
  sky2: '#161236',
  sky3: '#1f1949',
  glow: '#2c2573',
  horizon: '#4b41c4',
  haze: '#1c1748',
  floor: '#110e2c',
  floorDeep: '#0b0920',
  grid0: '#1f1a52',
  grid1: '#2b2474',
  grid2: '#3a31a0',
  star: '#6f67c4',
  shadow: '#251f5e',
  ink: '#0c0a20',
  paper: '#f4f2ff',
  paperDim: '#d9d5f5',
  line: '#a39cdf',
  lav: '#c9c2ff',
  violet: '#5b4fd0',
  violetHi: '#8b80ff',
  muted: '#7a74b8',
  chrome: '#2a2560',
  bar: '#433d86',
  cyan: '#5fd6f0',
  green: '#3fd17e',
  greenDark: '#17774b',
  red: '#ff5a52',
  redDark: '#9e2420',
  pink: '#ffd9d4',
  amber: '#ffc24a',
  white: '#ffffff',
};

const EMAILS = [
  { icon: 'doc', subject: 'ACME ONE-PAGER', short: 'ONE-PAGER', ask: 'WRITE A DOC', title: 'ONE-PAGER', chip: 'DOC', color: C.lav },
  { icon: 'bugIcon', subject: 'UPGRADE IS BROKEN', short: 'BUG REPORT', ask: 'FIX A BUG', title: 'UPGRADE BUG', chip: 'BUG', color: C.amber },
  { icon: 'tag', subject: 'PRO PRICE TO $15', short: 'PRO TO $15', ask: 'CHANGE SITE', title: 'PRO PRICE', chip: 'SITE', color: C.cyan },
  { icon: 'warn', subject: 'WIRE $4,800 NOW', short: 'WIRE $4,800', ask: 'WIRE $4,800', title: '', chip: '!', color: C.red },
];

// Envelope and shield sizes, in canvas pixels.
const EW = 21;
const EH = 14;
const SR = 9; // shield half-width
const SH = 22;

// When each agent works on its card, and when Kane checks it: [start, end] in story time.
// The first fix of the bug doesn't hold: Kane's click fails, the agent goes back, and the second check passes.
const AGENT: [number, number][][] = [[[2.08, 2.9]], [[2.13, 2.9], [3.36, 3.6]], [[2.18, 2.9]]];
const AGENT_CLICK = [[], [2.6, 3.52], [2.6]];
const KANE: [number, number][][] = [[[3.06, 3.3]], [[3.1, 3.34], [3.58, 3.84]], [[3.16, 3.44]]];
const KANE_CLICK = [[], [3.26, 3.75], [3.3]];
const PASS_AT = [3.3, 3.84, 3.44];
const FAIL: [number, number] = [3.34, 3.58];
const ZAPS = [2.6, 3.52];
const flyAt = (i: number): [number, number] => [5.2 + i * 0.1, 5.46 + i * 0.1];

const MINI_FAR = { w: '#3d3680', V: '#2f2a6a', o: '#1b1648' };
const MINI_NEAR = { w: '#8f88d6', V: '#6e67b8', o: '#2b2566' };
const ENVELOPE = {
  paper: { body: C.paper, flap: '#e2defa', line: '#9d95e8', edge: '#c7c2ee' },
  red: { body: C.pink, flap: '#ffbcb2', line: '#e0503f', edge: '#f09a8e' },
};

const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const seg = (s: number, a: number, b: number) => clamp((s - a) / (b - a));
// Fades in over a..b and out over c..d.
const span = (s: number, a: number, b: number, c: number, d: number) => seg(s, a, b) * (1 - seg(s, c, d));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const out = (t: number) => 1 - Math.pow(1 - t, 3);
const back = (t: number) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);
const rnd = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const rgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

interface Box { x: number; y: number; w: number; h: number }
type Point = [number, number];
interface Aim { agent: Point; kane: Point }

interface Layout {
  wide: boolean;
  cx: number;
  top: number; // the story area, clear of the header
  bottom: number; // and of the captions
  hz: number; // horizon of the floor
  mid: number; // vertical middle of the cards
  hub: Point; // Seyrin, the counter and the drafts tray all sit here
  cards: Box[];
  env: Point[]; // where the four envelopes wait
}

export class InnerWorld {
  readonly canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  private win: Point = [1, 1];
  private safe: Point = [0, 1];
  private L!: Layout;
  private bg = document.createElement('canvas');
  private pile: { x: number; y: number; near: boolean; at: number }[] = [];
  private base = 1; // alpha of the thing being drawn
  private later: (() => void)[] = []; // cursors, drawn over every card
  private textCache = new Map<string, HTMLCanvasElement>();

  constructor() {
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
  }

  // win: canvas pixels seen through the screen before the breach. safe: the rows between the page header and
  // the captions, in canvas pixels.
  resize(w: number, h: number, win: Point, safe: Point = [4, h - 4]) {
    if (w !== this.W || h !== this.H) {
      this.canvas.width = this.W = w;
      this.canvas.height = this.H = h;
    }
    this.win = win;
    this.safe = [Math.round(clamp(safe[0], 2, h / 3)), Math.round(clamp(safe[1], (h * 2) / 3, h - 2))];
    this.ctx.imageSmoothingEnabled = false;
    this.L = this.layout();
    this.paintBackdrop();
    this.placePile();
  }

  draw(s: number, t: number) {
    this.ctx.globalAlpha = 1;
    this.ctx.drawImage(this.bg, 0, 0);
    this.grid(t);
    this.stars(t);
    if (s > 1.05 && s < 2.35) this.mail(s, t);
    if (s < 1.06) this.inbox(s, t);
    if (s >= 0.98) this.story(s, t);
  }

  private alpha(a = 1) {
    this.ctx.globalAlpha = this.base * a;
  }

  // --- layout ---------------------------------------------------------------------------------------

  private layout(): Layout {
    const { W, H } = this;
    const [top, bottom] = this.safe;
    const room = bottom - top;
    const cx = Math.round(W / 2);
    const wide = W >= 190 && W >= H * 1.15;
    const cards: Box[] = [];
    let y0: number;
    if (wide) {
      const avail = Math.min(W - 16, 276);
      const gap = avail < 220 ? 9 : 12;
      const cw = Math.min(86, Math.floor((avail - 2 * gap) / 3));
      const ch = Math.max(34, Math.min(Math.round(cw * 0.78), room - 32));
      y0 = top + Math.max(0, Math.floor((room - 26 - ch) / 2));
      const x0 = Math.round(cx - (3 * cw + 2 * gap) / 2);
      for (let i = 0; i < 3; i++) cards.push({ x: x0 + i * (cw + gap), y: y0 + 26, w: cw, h: ch });
    } else {
      const cw = Math.min(W - 16, 124);
      const gap = 13;
      const ch = Math.round(clamp(Math.floor((room - 30 - 2 * gap) / 3), 30, 52));
      y0 = top + Math.max(0, Math.floor((room - 26 - 3 * ch - 2 * gap) / 2));
      for (let i = 0; i < 3; i++) cards.push({ x: Math.round(cx - cw / 2), y: y0 + 26 + i * (ch + gap), w: cw, h: ch });
    }
    const c0 = cards[0]!, c1 = cards[1]!;
    const mid = Math.round(wide ? c0.y + c0.h / 2 : c1.y + c1.h / 2);
    const env: Point[] = [];
    if (wide) {
      const step = Math.round(clamp(Math.min(W - 20, 236) / 4, 46, 60));
      for (let i = 0; i < 4; i++) env.push([Math.round(cx + (i - 1.5) * step - EW / 2), Math.round(mid - EH / 2 - 4)]);
    } else {
      const sx = Math.round(clamp(W * 0.38, 46, 60)), sy = EH + 26;
      for (let i = 0; i < 4; i++) env.push([Math.round(cx + ((i % 2) - 0.5) * sx - EW / 2), Math.round(mid + (Math.floor(i / 2) - 0.5) * sy - EH / 2 - 4)]);
    }
    const hz = Math.round(lerp(top, bottom, wide ? 0.68 : 0.62));
    return { wide, cx, top, bottom, hz, mid, hub: [cx, y0 + 6], cards, env };
  }

  // --- the world: a dithered night sky over a grid floor that rolls toward you ----------------------

  private paintBackdrop() {
    const { W, H } = this;
    const { hz } = this.L;
    this.bg.width = W;
    this.bg.height = H;
    const g = this.bg.getContext('2d')!;
    const img = g.createImageData(W, H);
    const sky = [C.sky0, C.sky1, C.sky2, C.sky3].map(rgb);
    const ground = [C.haze, C.floor, C.floorDeep].map(rgb);
    for (let y = 0; y < H; y++) {
      const above = y < hz;
      const ramp = above ? sky : ground;
      const v = above ? Math.pow(y / hz, 1.4) : Math.pow((y - hz) / Math.max(1, H - hz), 0.7);
      const f = clamp(v) * (ramp.length - 1);
      const k = Math.min(Math.floor(f), ramp.length - 2);
      for (let x = 0; x < W; x++) {
        const c = f - k > (BAYER[(y % 4) * 4 + (x % 4)]! + 0.5) / 16 ? ramp[k + 1]! : ramp[k]!;
        const i = (y * W + x) * 4;
        img.data[i] = c[0];
        img.data[i + 1] = c[1];
        img.data[i + 2] = c[2];
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    rect(g, 0, hz - 1, W, 1, C.glow);
    rect(g, 0, hz, W, 1, C.horizon);
  }

  private grid(t: number) {
    const { ctx, W, H } = this;
    const { hz, cx } = this.L;
    const depth = H - hz;
    if (depth < 8) return;
    const phase = (t * 0.35) % 1;
    for (let k = 0; k < 40; k++) {
      const dy = (depth * 1.1) / (k + 1 - phase);
      if (dy < 2.5) break;
      const y = Math.round(hz + dy);
      if (y < H) rect(ctx, 0, y, W, 1, dy > depth * 0.55 ? C.grid2 : dy > depth * 0.22 ? C.grid1 : C.grid0);
    }
    const a = W / 7 / depth;
    const ym = hz + Math.round(depth * 0.3);
    for (let j = -9; j <= 9; j++) {
      const xm = cx + j * a * (ym - hz);
      line(ctx, cx + j * a * 3, hz + 3, xm, ym, C.grid0);
      line(ctx, xm, ym, cx + j * a * depth, H, C.grid1);
    }
  }

  private stars(t: number) {
    const { ctx, W } = this;
    const sky = this.L.hz - 3;
    for (let i = 0; i < 48; i++) {
      const x = Math.floor(rnd(i) * W), y = Math.floor(rnd(i + 99) * sky);
      const tw = Math.sin(t * (0.7 + rnd(i + 7) * 2) + i * 1.9);
      if (tw < -0.2) continue;
      const big = rnd(i + 3) > 0.86;
      rect(ctx, x, y, 1, 1, big || tw > 0.85 ? C.white : C.star);
      if (big && tw > 0.6) {
        rect(ctx, x - 1, y, 1, 1, C.star);
        rect(ctx, x + 1, y, 1, 1, C.star);
        rect(ctx, x, y - 1, 1, 1, C.star);
        rect(ctx, x, y + 1, 1, 1, C.star);
      }
    }
  }

  // --- 0..1: the inbox window on the screen ----------------------------------------------------------

  private inboxBox(): Box {
    const w = Math.min(this.win[0] - 10, 150), h = Math.min(this.win[1] - 10, 84);
    return { x: Math.round(this.W / 2 - w / 2), y: Math.round(this.H / 2 - h / 2), w, h };
  }

  private rowBox(i: number): Box {
    const b = this.inboxBox();
    const rh = Math.floor((b.h - 12) / 4);
    return { x: b.x + 2, y: b.y + 11 + i * rh, w: b.w - 4, h: rh };
  }

  private inbox(s: number, t: number) {
    const { ctx } = this;
    const b = this.inboxBox();
    this.alpha(1 - seg(s, 0.98, 1.06));
    rect(ctx, b.x + 3, b.y + 3, b.w, b.h, C.shadow);
    rect(ctx, b.x, b.y, b.w, b.h, C.paper);
    frame(ctx, b.x - 1, b.y - 1, b.w + 2, b.h + 2, C.ink);
    // A striped title bar, like an old desktop.
    for (let y = b.y + 2; y < b.y + 8; y += 2) rect(ctx, b.x + 2, y, b.w - 4, 1, C.ink);
    const title = 'SEYRIN INBOX';
    const tw = textWidth(title) + 8;
    rect(ctx, b.x + b.w / 2 - tw / 2, b.y + 1, tw, 8, C.paper);
    text(ctx, title, b.x + b.w / 2, b.y + 2, C.ink, 'center');
    rect(ctx, b.x + 4, b.y + 2, 5, 5, C.paper);
    frame(ctx, b.x + 4, b.y + 2, 5, 5, C.ink);
    rect(ctx, b.x, b.y + 9, b.w, 1, C.ink);
    const wide = b.w >= 130;
    EMAILS.forEach((m, i) => {
      const r = this.rowBox(i);
      if (i) rect(ctx, r.x + 1, r.y, r.w - 2, 1, C.paperDim);
      const my = r.y + Math.round((r.h - 5) / 2);
      if (Math.sin(t * 3 + i * 1.7) > -0.2) rect(ctx, r.x + 2, my + 2, 2, 2, C.violet);
      sprite(ctx, m.icon, r.x + 6, my - 1);
      text(ctx, wide ? m.subject : m.short, r.x + 14, my, C.ink);
      if (wide) {
        const cw = textWidth(m.chip) + 4;
        rect(ctx, r.x + r.w - cw - 2, my - 1, cw, 7, m.color);
        text(ctx, m.chip, r.x + r.w - cw, my, C.ink);
      }
    });
    // A spark already working its way down the list.
    const row = this.rowBox(Math.floor((t * 0.6) % 4));
    const sx = Math.round(row.x + row.w - (wide ? 30 : 8) + Math.sin(t * 5) * 2), sy = Math.round(row.y + row.h / 2);
    rect(ctx, sx - 1, sy, 3, 1, C.violetHi);
    rect(ctx, sx, sy - 1, 1, 3, C.violetHi);
    rect(ctx, sx, sy, 1, 1, C.white);
    this.alpha();
  }

  // --- 1..2: more mail keeps coming, and piles up on the floor ------------------------------------

  private placePile() {
    const { W } = this;
    const { hz, bottom } = this.L;
    const n = 44;
    this.pile = [];
    for (let j = 0; j < n; j++) {
      const d = Math.pow(rnd(j + 300), 0.8);
      this.pile.push({
        x: Math.round(rnd(j + 500) * (W - 9)) + 1,
        y: Math.round(hz + 2 + d * Math.max(4, bottom - hz - 8)),
        near: d > 0.5,
        at: 1.12 + 0.72 * (j / n) + rnd(j + 700) * 0.05,
      });
    }
    this.pile.sort((a, b) => a.y - b.y);
  }

  private mail(s: number, t: number) {
    const { ctx, W } = this;
    const { hz, bottom } = this.L;
    this.alpha(1 - seg(s, 2.0, 2.32));
    const n = Math.round(4 + seg(s, 1.08, 1.85) * 22);
    for (let i = 0; i < n; i++) {
      const d = rnd(i + 40);
      const fall = hz + 2 + d * (bottom - hz - 6) + 12;
      const y = ((rnd(i + 11) * fall + t * (10 + d * 16)) % fall) - 10;
      sprite(ctx, 'mini', Math.floor(rnd(i + 5) * (W - 7)), y, d > 0.55 ? MINI_NEAR : MINI_FAR);
    }
    for (const p of this.pile) {
      const k = seg(s, p.at, p.at + 0.05);
      if (k > 0) sprite(ctx, 'mini', p.x, p.y - Math.round((1 - out(k)) * 12), p.near ? MINI_NEAR : MINI_FAR);
    }
    this.alpha();
  }

  // --- the story ----------------------------------------------------------------------------------------

  private story(s: number, t: number) {
    const { L } = this;
    this.counter(s);
    const hubA = span(s, 1.95, 2.08, 5.0, 5.08);
    if (hubA > 0) this.hub(s, t, hubA);
    const trayA = span(s, 5.02, 5.14, 5.8, 5.92);
    if (trayA > 0) {
      const landed = [0, 1, 2].filter((i) => s >= flyAt(i)[1]).length;
      const bump = [0, 1, 2].some((i) => s >= flyAt(i)[1] && s < flyAt(i)[1] + 0.04) ? 1 : 0;
      this.tray(L.hub, landed, trayA, bump);
    }
    const dim = span(s, 4.0, 4.1, 4.86, 4.98);
    this.later = [];
    for (let i = 0; i < 3; i++) this.task(i, s, t, dim);
    for (const f of this.later) f();
    this.scam(s, t);
    const zero = seg(s, 5.62, 5.78);
    if (zero > 0) this.inboxZero(zero, t);
  }

  // Where envelope i is during 1..2: out of its inbox row to its waiting spot. The scam then slips away.
  private envelopeAt(i: number, s: number): Point {
    const r = this.rowBox(i);
    const to = this.L.env[i]!;
    const k = ease(seg(s, 1.0 + i * 0.03, 1.28 + i * 0.03));
    let x = lerp(r.x + 4, to[0], k), y = lerp(r.y + r.h / 2 - EH / 2, to[1], k);
    if (i === 3) {
      const a = ease(seg(s, 1.92, 2.18));
      x = lerp(x, -EW - 8, a);
      y = lerp(y, y - 10, a);
    }
    return [x, y];
  }

  private waiting(i: number, x: number, y: number, s: number, t: number) {
    const m = EMAILS[i]!;
    y += Math.round(Math.sin(t * 2 + i * 1.3) * seg(s, 1.3, 1.4));
    this.envelope(x, y, i === 3 ? 'red' : 'paper');
    const badge = seg(s, 1.18 + i * 0.05, 1.28 + i * 0.05);
    if (badge > 0) this.badge(x + EW - 6, y - 4 - Math.round((1 - back(badge)) * 3), i);
    const label = span(s, 1.28 + i * 0.05, 1.4 + i * 0.05, 1.92, 2.0);
    if (label > 0) {
      this.alpha(label);
      this.tag(m.ask, x + EW / 2, y + EH + 5, i === 3 ? C.pink : C.lav);
      this.alpha();
    }
  }

  private task(i: number, s: number, t: number, dim: number) {
    const card = this.L.cards[i]!;
    const fly = seg(s, ...flyAt(i));
    if (fly > 0) {
      this.reply(card, fly);
      return;
    }
    const [ex, ey] = this.envelopeAt(i, s);
    const open = out(seg(s, 2.0, 2.24));
    if (open <= 0) {
      this.waiting(i, ex, ey, s, t);
      return;
    }
    // The envelope opens into a card; at the end the card folds back into a sealed reply.
    const fold = out(seg(s, 5.04 + i * 0.06, 5.18 + i * 0.06));
    const ax = fold > 0 ? card.x + card.w / 2 - EW / 2 : ex, ay = fold > 0 ? card.y + card.h / 2 - EH / 2 : ey;
    const o = open * (1 - fold);
    const box: Box = { x: lerp(ax, card.x, o), y: lerp(ay, card.y, o), w: lerp(EW, card.w, o), h: lerp(EH, card.h, o) };
    if (o < 0.3) {
      this.envelope(box.x + (box.w - EW) / 2, box.y + (box.h - EH) / 2, 'paper', fold > 0);
      return;
    }
    this.base = 1 - dim * 0.9;
    this.card(i, box, s, t, o);
    this.base = 1;
  }

  // --- pieces ---------------------------------------------------------------------------------------------

  private envelope(x: number, y: number, kind: 'paper' | 'red' = 'paper', seal = false) {
    const { ctx } = this;
    const p = ENVELOPE[kind];
    x = Math.round(x);
    y = Math.round(y);
    rect(ctx, x + 2, y + 2, EW, EH, C.shadow);
    rect(ctx, x, y, EW, EH, p.body);
    rect(ctx, x, y + EH - 1, EW, 1, p.edge);
    rect(ctx, x + EW - 1, y, 1, EH, p.edge);
    // The flap: a filled V from the top corners to the middle.
    const half = (EW - 1) / 2, tip = 8;
    for (let r = 0; r < tip; r++) {
      const inset = Math.round((r * half) / tip);
      rect(ctx, x + inset, y + r, EW - 2 * inset, 1, p.flap);
    }
    line(ctx, x, y, x + half, y + tip, p.line);
    line(ctx, x + EW - 1, y, x + half, y + tip, p.line);
    if (seal) sprite(ctx, 'seal', x + half - 2, y + tip - 2);
  }

  // The email's kind, as a small badge on the envelope's corner.
  private badge(x: number, y: number, i: number) {
    const { ctx } = this;
    const m = EMAILS[i]!;
    x = Math.round(x);
    y = Math.round(y);
    rect(ctx, x + 1, y, 7, 9, C.ink);
    rect(ctx, x, y + 1, 9, 7, C.ink);
    rect(ctx, x + 1, y + 1, 7, 7, m.color);
    if (i === 3) {
      text(ctx, '!', x + 3, y + 2, C.white);
      return;
    }
    const [iw, ih] = spriteSize(m.icon);
    sprite(ctx, m.icon, x + Math.floor((9 - iw) / 2), y + Math.floor((9 - ih) / 2));
  }

  // A short label with a dark backing, so it reads over anything.
  private tag(label: string, cx: number, y: number, color: string) {
    const w = textWidth(label);
    rect(this.ctx, Math.round(cx - w / 2) - 2, Math.round(y) - 2, w + 4, 9, C.sky0);
    text(this.ctx, label, cx, y, color, 'center');
  }

  private textImage(s: string, color: string): HTMLCanvasElement {
    const key = s + color;
    let c = this.textCache.get(key);
    if (!c) {
      c = document.createElement('canvas');
      c.width = textWidth(s);
      c.height = 5;
      text(c.getContext('2d')!, s, 0, 0, color);
      this.textCache.set(key, c);
    }
    return c;
  }

  // Text at k times the size, squashed vertically by squash (for the price flip).
  private bigText(s: string, x: number, y: number, color: string, k: number, squash = 1) {
    const c = this.textImage(s, color);
    const h = Math.max(1, Math.round(5 * k * squash));
    this.ctx.drawImage(c, Math.round(x), Math.round(y + (5 * k - h) / 2), c.width * k, h);
  }

  private diamond(cx: number, cy: number, r: number, color: string) {
    const { ctx } = this;
    for (let k = 0; k < r; k++) {
      rect(ctx, cx + k, cy - r + k, 1, 1, color);
      rect(ctx, cx + r - k, cy + k, 1, 1, color);
      rect(ctx, cx - k, cy + r - k, 1, 1, color);
      rect(ctx, cx - r + k, cy - k, 1, 1, color);
    }
  }

  // A named pointer, like a collaborator's cursor: lavender for an agent, green for Kane.
  private cursor(x: number, y: number, who: 'agent' | 'kane', click = 0) {
    const { ctx } = this;
    x = Math.round(x);
    y = Math.round(y);
    const color = who === 'kane' ? C.green : C.lav;
    if (click > 0 && click < 1) {
      this.alpha(1 - click);
      this.diamond(x, y, 2 + Math.round(click * 5), C.white);
      this.alpha();
    }
    sprite(ctx, 'cursor', x, y, { w: color });
    const label = who === 'kane' ? 'KANE' : 'AGENT';
    rect(ctx, x + 5, y + 8, textWidth(label) + 4, 7, color);
    text(ctx, label, x + 7, y + 9, C.ink);
  }

  private logo(x: number, y: number) {
    const { ctx } = this;
    rect(ctx, x + 1, y, 7, 9, C.violet);
    rect(ctx, x, y + 1, 9, 7, C.violet);
    rect(ctx, x + 1, y, 7, 3, '#463cae');
    rect(ctx, x, y + 1, 1, 2, '#463cae');
    rect(ctx, x + 8, y + 1, 1, 2, '#463cae');
    text(ctx, 'S', x + 3, y + 2, C.white);
    rect(ctx, x + 7, y + 1, 1, 1, C.lav);
  }

  private hubDot(): Point {
    return [this.L.hub[0] - 13, this.L.hub[1]];
  }

  private hub(s: number, t: number, a: number) {
    const { ctx } = this;
    const [hx, hy] = this.L.hub;
    this.alpha(a);
    this.logo(hx - 17, hy - 4);
    text(ctx, 'SEYRIN', hx - 5, hy - 2, C.lav);
    const [dx, dy] = this.hubDot();
    for (const at of [2.08, 2.13, 2.18, 3.36]) {
      const p = seg(s, at, at + 0.12);
      if (p <= 0 || p >= 1) continue;
      this.alpha(a * (1 - p));
      this.diamond(dx, dy, 6 + Math.round(p * 8), C.violetHi);
    }
    // While agents are out working, a slow orbit around the mark.
    const busy = span(s, 2.1, 2.2, 3.82, 3.95);
    if (busy > 0) {
      this.alpha(a * busy);
      for (let k = 0; k < 3; k++) {
        const ang = t * 2.4 + (k * Math.PI * 2) / 3;
        rect(ctx, Math.round(dx + Math.cos(ang) * 8), Math.round(dy + Math.sin(ang) * 4), 1, 1, C.lav);
      }
    }
    this.alpha();
  }

  private counter(s: number) {
    const a = span(s, 1.04, 1.12, 1.92, 2.0);
    if (a <= 0) return;
    const { ctx } = this;
    const [cx, cy] = this.L.hub;
    const label = `INBOX ${4 + Math.round(seg(s, 1.1, 1.86) * 43)}`;
    const w = textWidth(label) + 8, x = Math.round(cx - w / 2);
    this.alpha(a);
    rect(ctx, x, cy - 4, w, 9, C.violet);
    frame(ctx, x, cy - 4, w, 9, C.violetHi);
    text(ctx, label, cx, cy - 2, C.white, 'center');
    this.alpha();
  }

  // --- a card: the work, then Kane's check in a browser -------------------------------------------------

  private verdict(i: number, s: number): 'pass' | 'fail' | '' {
    if (s >= PASS_AT[i]!) return 'pass';
    if (i === 1 && s >= FAIL[0] && s < FAIL[1]) return 'fail';
    return '';
  }

  private card(i: number, b: Box, s: number, t: number, o: number) {
    const { ctx } = this;
    const m = EMAILS[i]!;
    const x = Math.round(b.x), y = Math.round(b.y), w = Math.round(b.w), h = Math.round(b.h);
    const chrome = Math.round(span(s, 2.97, 3.06, 5.04 + i * 0.06, 5.1 + i * 0.06) * 8);
    const v = this.verdict(i, s);
    this.alpha();
    rect(ctx, x + 3, y - chrome + 3, w, h + chrome, C.shadow);
    frame(ctx, x - 1, y - chrome - 1, w + 2, h + chrome + 2, v === 'pass' ? C.green : v === 'fail' ? C.red : C.ink);
    if (chrome > 0) this.chrome(x, y - chrome, w, chrome);
    rect(ctx, x, y, w, h, C.paper);
    rect(ctx, x, y, w, 9, m.color);
    if (o < 0.85) return;
    text(ctx, m.title, x + 3, y + 2, C.ink);
    const [iw] = spriteSize(m.icon);
    if (textWidth(m.title) + iw + 9 <= w) sprite(ctx, m.icon, x + w - iw - 2, y + 1);
    const body: Box = { x: x + 4, y: y + 12, w: w - 8, h: h - 15 };
    const aim = i === 0 ? this.docWork(body, s, t) : i === 1 ? this.bugWork(body, s, t) : this.priceWork(body, s);
    this.kaneScan(i, { x, y, w, h }, s);
    this.verdictBadge(i, x, y - chrome, w, s);
    const base = this.base;
    this.later.push(() => {
      this.base = base;
      this.agent(i, aim.agent, s);
      this.kane(i, { x, y, w, h }, aim.kane, s, chrome);
      this.base = 1;
    });
  }

  private chrome(x: number, y: number, w: number, h: number) {
    const { ctx } = this;
    rect(ctx, x, y, w, h, C.chrome);
    if (h < 8) return;
    rect(ctx, x + 2, y + 3, 2, 2, C.red);
    rect(ctx, x + 5, y + 3, 2, 2, C.amber);
    rect(ctx, x + 8, y + 3, 2, 2, C.green);
    if (w < 30) return;
    rect(ctx, x + 12, y + 2, w - 15, 4, C.bar);
    rect(ctx, x + 14, y + 3, 1, 2, C.lav);
    rect(ctx, x + 17, y + 3, Math.min(w - 24, 22), 2, '#5c56a6');
  }

  private verdictBadge(i: number, x: number, y: number, w: number, s: number) {
    const v = this.verdict(i, s);
    if (!v) return;
    const { ctx } = this;
    const pop = seg(s, v === 'pass' ? PASS_AT[i]! : FAIL[0], (v === 'pass' ? PASS_AT[i]! : FAIL[0]) + 0.05);
    const label = v === 'pass' ? 'PASS' : 'FAIL';
    const bw = textWidth(label) + 11, bx = x + w - bw + 3, by = y - 5 - Math.round((1 - back(pop)) * 3);
    rect(ctx, bx, by, bw, 9, v === 'pass' ? C.green : C.red);
    frame(ctx, bx, by, bw, 9, C.ink);
    const mark: Point[] = v === 'pass' ? [[0, 1], [1, 2], [2, 1], [3, 0]] : [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]];
    for (const [dx, dy] of mark) rect(ctx, bx + 2 + dx, by + 3 + dy, 1, 1, C.ink);
    text(ctx, label, bx + 7, by + 2, C.ink);
  }

  private agent(i: number, aim: Point, s: number) {
    const { ctx } = this;
    const [hx, hy] = this.hubDot();
    for (const [a, z] of AGENT[i]!) {
      if (s < a || s >= z + 0.08) continue;
      const go = out(seg(s, a, a + 0.16));
      const x = lerp(hx, aim[0], go), y = lerp(hy, aim[1], go);
      if (go < 1) {
        // A dotted trail back to Seyrin.
        const n = Math.floor(Math.hypot(x - hx, y - hy) / 3);
        this.alpha(0.6);
        for (let k = 1; k < n; k++) rect(ctx, Math.round(lerp(hx, x, k / n)), Math.round(lerp(hy, y, k / n)), 1, 1, C.violetHi);
      }
      const click = AGENT_CLICK[i]!.map((c) => seg(s, c, c + 0.06)).find((p) => p > 0 && p < 1) ?? 0;
      this.alpha(1 - seg(s, z, z + 0.08));
      this.cursor(x, y, 'agent', click);
      this.alpha();
    }
  }

  // Kane's scan: a line sweeping the page, with everything it has passed tinted.
  private kaneScan(i: number, card: Box, s: number) {
    const { ctx } = this;
    for (const [a, z] of KANE[i]!) {
      if (s < a || s >= z) continue;
      const top = card.y + 9, h = card.h - 9;
      const sy = top + Math.round(seg(s, a, z) * (h - 1));
      this.alpha(0.16);
      rect(ctx, card.x, top, card.w, sy - top, C.green);
      this.alpha();
      rect(ctx, card.x, sy, card.w, 1, C.green);
    }
  }

  private kane(i: number, card: Box, aim: Point, s: number, chrome: number) {
    for (const [a, z] of KANE[i]!) {
      if (s < a - 0.05 || s >= z + 0.04) continue;
      // In from the address bar, then to whatever it is checking.
      const enter = out(seg(s, a - 0.05, a + 0.05));
      const x = lerp(card.x + 13, aim[0], enter), y = lerp(card.y - chrome + 2, aim[1], enter);
      const click = KANE_CLICK[i]!.map((c) => seg(s, c, c + 0.06)).find((p) => p > 0 && p < 1) ?? 0;
      this.alpha(1 - seg(s, z, z + 0.04));
      this.cursor(x, y, 'kane', click);
      this.alpha();
    }
  }

  // The one-pager writes itself, line by line; Kane ticks off each section as it checks it.
  private docWork(b: Box, s: number, t: number): Aim {
    const { ctx } = this;
    const rows: { y: number; w: number; head: boolean }[] = [];
    for (let y = b.y, k = 0; y + 2 <= b.y + b.h; k++) {
      const head = k % 4 === 0;
      rows.push({ y, w: head ? 0.5 : [0.94, 0.82, 0.62][(k % 4) - 1]!, head });
      y += head ? 4 : 3;
    }
    const shown = seg(s, 2.24, 2.86) * rows.length;
    let caret: Point = [b.x, b.y];
    rows.forEach((r, n) => {
      const fill = clamp(shown - n);
      if (fill <= 0) return;
      const len = Math.max(1, Math.round(b.w * r.w * fill));
      rect(ctx, b.x, r.y, len, r.head ? 2 : 1, r.head ? C.violet : C.line);
      if (fill < 1) caret = [b.x + len + 1, r.y];
    });
    if (shown > 0 && shown < rows.length && Math.sin(t * 12) > 0) rect(ctx, caret[0], caret[1] - 1, 1, 4, C.ink);
    const scan = seg(s, 3.06, 3.3);
    for (const r of rows) {
      if (!r.head || scan <= 0 || (r.y - b.y) / b.h > scan) continue;
      const tx = b.x + b.w - 4;
      for (const [dx, dy] of [[0, 1], [1, 2], [2, 1], [3, 0]] as Point[]) rect(ctx, tx + dx, r.y - 1 + dy, 1, 1, C.greenDark);
    }
    return { agent: [caret[0] + 1, caret[1] + 1], kane: [b.x + b.w * 0.6, b.y + scan * b.h] };
  }

  // Perch's pricing card. The bug sits on the upgrade button until an agent squashes it.
  private bugWork(b: Box, s: number, t: number): Aim {
    const { ctx } = this;
    text(ctx, 'PRO', b.x, b.y, C.ink);
    if (b.h >= 26) text(ctx, '$12/MO', b.x, b.y + 7, C.muted);
    const bw = b.w, bh = 11, bx = b.x, by = b.y + b.h - bh;
    const alive = s < ZAPS[0]! || (s >= KANE_CLICK[1]![0]! && s < ZAPS[1]!);
    const failing = s >= KANE_CLICK[1]![0]! && s < FAIL[1];
    rect(ctx, bx, by, bw, bh, alive ? C.paperDim : C.violet);
    frame(ctx, bx, by, bw, bh, failing ? C.red : alive ? C.muted : C.ink);
    text(ctx, bw >= 31 ? 'UPGRADE' : 'BUY', bx + bw / 2, by + 3, alive ? C.muted : C.white, 'center');
    const center: Point = [bx + bw / 2 - 3, by - 5];
    let bug: Point = center;
    if (alive) {
      // It wanders along the button, and stops in the middle just before it is squashed.
      const next = s < ZAPS[0]! ? ZAPS[0]! : ZAPS[1]!;
      const roam = (1 - seg(s, next - 0.1, next)) * (s >= KANE_CLICK[1]![0]! ? seg(s, KANE_CLICK[1]![0]!, KANE_CLICK[1]![0]! + 0.06) : 1);
      bug = [Math.round(center[0] + Math.sin(t * 2.4) * (bw / 2 - 6) * roam), center[1]];
      sprite(ctx, Math.sin(t * 12) > 0 ? 'bug' : 'bug2', bug[0], bug[1]);
    }
    for (const at of ZAPS) {
      const z = seg(s, at, at + 0.08);
      if (z <= 0 || z >= 1) continue;
      if (z < 0.35) rect(ctx, bx - 1, by - 1, bw + 2, bh + 2, C.white);
      for (let k = 0; k < 12; k++) {
        const ang = (k / 12) * Math.PI * 2 + k;
        const r = 2 + z * 11 * (0.5 + rnd(k));
        rect(ctx, Math.round(center[0] + 3 + Math.cos(ang) * r), Math.round(center[1] + 3 + Math.sin(ang) * r * 0.7), 1, 1, k % 2 ? C.red : C.amber);
      }
    }
    return { agent: alive ? [bug[0] + 3, bug[1] + 3] : [bx + bw / 2 + 2, by + 5], kane: [bx + bw / 2, by + 5] };
  }

  // The Pro plan's price flips from $12 to $15.
  private priceWork(b: Box, s: number): Aim {
    const { ctx } = this;
    text(ctx, 'PRO', b.x, b.y, C.ink);
    const k = b.h >= 24 && b.w >= 46 ? 3 : 2;
    const pw = textWidth('$15') * k;
    const px = b.x, py = b.y + 7 + Math.max(0, Math.floor((b.h - 7 - 5 * k) / 2));
    const flip = seg(s, 2.62, 2.76);
    if (flip < 0.5) this.bigText('$12', px, py, C.ink, k, 1 - flip * 2);
    else this.bigText('$15', px, py, C.violet, k, (flip - 0.5) * 2);
    if (flip > 0 && flip < 1) rect(ctx, px - 1, py + Math.round((5 * k) / 2), pw + 2, 1, C.violetHi);
    if (px + pw + 14 <= b.x + b.w) text(ctx, '/MO', px + pw + 3, py + 5 * k - 5, C.muted);
    return { agent: [px + pw - 3, py + 5 * k - 4], kane: [px + pw + 2, py + 2] };
  }

  // --- 4..5: the scam meets the shield -------------------------------------------------------------

  private scam(s: number, t: number) {
    const { ctx, L } = this;
    if (s < 2.2) {
      const [x, y] = this.envelopeAt(3, s);
      this.waiting(3, x, y, s, t);
      return;
    }
    if (s < 4.0 || s >= 5.0) return;
    const cx = L.cx, cy = L.mid;
    const hit = 4.4;
    const shieldA = span(s, 4.06, 4.18, 4.86, 4.98);
    if (shieldA > 0) {
      this.alpha(shieldA);
      const flash = s >= hit ? 1 - seg(s, hit, hit + 0.2) : 0;
      if (flash > 0) {
        this.alpha(shieldA * flash);
        this.diamond(cx, cy, 14 + Math.round((1 - flash) * 10), C.white);
        this.diamond(cx, cy, 10 + Math.round((1 - flash) * 6), C.violetHi);
      }
      this.alpha(shieldA);
      this.shield(cx, cy, flash);
      this.alpha();
    }
    const tx = cx - SR - EW - 2, ty = cy - EH / 2;
    if (s < hit) {
      // It swoops in from the left, straight at the shield.
      const p = out(seg(s, 4.08, hit));
      const x = lerp(-EW - 6, tx, p), y = lerp(ty - 18, ty, p) - Math.sin(p * Math.PI) * 6;
      this.envelope(x, y, 'red');
      this.badge(x + EW - 6, y - 4, 3);
      this.tag(EMAILS[3]!.ask, x + EW / 2, y + EH + 5, C.pink);
      return;
    }
    const burst = seg(s, hit, hit + 0.32);
    if (burst < 1) {
      this.alpha(1 - burst);
      for (let k = 0; k < 44; k++) {
        const fx = tx + (k % 11) * 2, fy = ty + Math.floor(k / 11) * 3;
        const x = fx - (10 + rnd(k) * 46) * burst, y = fy + (-10 + rnd(k + 50) * 26) * burst + 26 * burst * burst;
        rect(ctx, Math.round(x), Math.round(y), k % 4 ? 1 : 2, 1, k % 3 ? C.red : C.pink);
      }
      this.alpha();
    }
    const stamp = span(s, 4.46, 4.54, 4.86, 4.98);
    if (stamp > 0) {
      const label = 'REFUSED';
      const lw = textWidth(label) + 8, lx = Math.round(cx - lw / 2);
      const ly = Math.round(cy + SH / 2 + 5 - (1 - back(seg(s, 4.46, 4.52))) * 3);
      this.alpha(stamp);
      rect(ctx, lx, ly, lw, 9, C.redDark);
      frame(ctx, lx, ly, lw, 9, C.red);
      text(ctx, label, cx, ly + 2, C.white, 'center');
      this.alpha();
    }
  }

  private shield(cx: number, cy: number, flash: number) {
    const { ctx } = this;
    const top = Math.round(cy - SH / 2);
    const rows: number[] = [];
    for (let y = 0; y < SH; y++) {
      const v = y / (SH - 1);
      rows.push(y === 0 ? SR - 1 : v < 0.45 ? SR : Math.round(SR * Math.cos(((v - 0.45) / 0.55) * (Math.PI / 2))));
    }
    const light = flash > 0.5 ? C.white : C.violetHi, dark = flash > 0.5 ? C.lav : C.violet;
    rows.forEach((hw, y) => {
      rect(ctx, cx - hw, top + y, 2 * hw + 1, 1, C.ink);
      if (y === 0 || y === SH - 1 || hw < 2) return;
      rect(ctx, cx - hw + 1, top + y, hw, 1, light);
      rect(ctx, cx + 1, top + y, hw - 1, 1, dark);
    });
    // A bold tick in the middle.
    for (const [dx, dy] of [[-4, 0], [-3, 1], [-2, 2], [-1, 1], [0, 0], [1, -1], [2, -2], [3, -3]] as Point[]) {
      rect(ctx, cx + dx, cy - 1 + dy, 1, 2, C.white);
    }
  }

  // --- 5..6: replies go to Drafts ------------------------------------------------------------------

  private reply(card: Box, p: number) {
    const [hx, hy] = this.L.hub;
    const sx = card.x + card.w / 2 - EW / 2, sy = card.y + card.h / 2 - EH / 2;
    const e = ease(p);
    const x = lerp(sx, hx - 18 - EW / 2, e), y = lerp(sy, hy - EH / 2 - 3, e) - Math.sin(e * Math.PI) * 12;
    if (p >= 1) return;
    this.alpha(1 - seg(p, 0.8, 1));
    this.envelope(x, y, 'paper', true);
    this.alpha();
  }

  private tray(at: Point, n: number, a: number, bump: number) {
    const { ctx } = this;
    const x = Math.round(at[0] - 28), y = Math.round(at[1] - 4 - bump);
    this.alpha(a);
    // An open in-tray: back lip, sides, and a front panel with a notch.
    rect(ctx, x + 1, y, 19, 1, C.violetHi);
    rect(ctx, x, y + 1, 1, 3, C.violetHi);
    rect(ctx, x + 20, y + 1, 1, 3, C.violetHi);
    rect(ctx, x, y + 4, 21, 5, C.violet);
    frame(ctx, x, y + 4, 21, 5, C.lav);
    rect(ctx, x + 7, y + 4, 7, 2, C.chrome);
    text(ctx, `DRAFTS ${n}`, x + 25, y + 3, n ? C.white : C.lav);
    this.alpha();
  }

  private inboxZero(p: number, t: number) {
    const { ctx } = this;
    const cx = Math.round(this.W / 2), cy = Math.round(this.H / 2);
    const label = 'INBOX 0';
    const w = textWidth(label) * 2, total = w + 13;
    const x0 = Math.round(cx - total / 2), y0 = cy - 5 + Math.round((1 - out(p)) * 6);
    this.alpha(p);
    this.bigText(label, x0, y0, C.lav, 2);
    sprite(ctx, 'check', x0 + w + 4, y0);
    for (let k = 0; k < 10; k++) {
      const ang = (k / 10) * Math.PI * 2 + t * 0.6;
      const r = total / 2 + 9 + Math.sin(t * 2.5 + k) * 2;
      if (Math.sin(t * 4 + k * 2.1) > 0.1) rect(ctx, Math.round(cx + Math.cos(ang) * r), Math.round(cy + Math.sin(ang) * r * 0.45), 1, 1, k % 3 ? C.lav : C.white);
    }
    this.alpha();
  }
}
