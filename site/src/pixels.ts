// Pixel drawing for the world inside the screen: a 3x5 bitmap font and small ASCII sprites, drawn at
// whole-pixel positions on a low-resolution canvas that the stage scales up without smoothing.

const GLYPHS: Record<string, string> = Object.fromEntries(
  Object.entries({
    A: '.#. #.# ### #.# #.#', B: '##. #.# ##. #.# ##.', C: '.## #.. #.. #.. .##', D: '##. #.# #.# #.# ##.',
    E: '### #.. ##. #.. ###', F: '### #.. ##. #.. #..', G: '.## #.. #.# #.# .##', H: '#.# #.# ### #.# #.#',
    I: '### .#. .#. .#. ###', J: '..# ..# ..# #.# .#.', K: '#.# #.# ##. #.# #.#', L: '#.. #.. #.. #.. ###',
    M: '#.# ### ### #.# #.#', N: '##. #.# #.# #.# #.#', O: '.#. #.# #.# #.# .#.', P: '##. #.# ##. #.. #..',
    Q: '.#. #.# #.# ##. .##', R: '##. #.# ##. #.# #.#', S: '.## #.. .#. ..# ##.', T: '### .#. .#. .#. .#.',
    U: '#.# #.# #.# #.# ###', V: '#.# #.# #.# #.# .#.', W: '#.# #.# ### ### #.#', X: '#.# #.# .#. #.# #.#',
    Y: '#.# #.# .#. .#. .#.', Z: '### ..# .#. #.. ###', '0': '### #.# #.# #.# ###', '1': '.#. ##. .#. .#. ###',
    '2': '##. ..# .#. #.. ###', '3': '##. ..# .#. ..# ##.', '4': '#.# #.# ### ..# ..#', '5': '### #.. ##. ..# ##.',
    '6': '.## #.. ### #.# ###', '7': '### ..# .#. .#. .#.', '8': '### #.# ### #.# ###', '9': '### #.# ### ..# ##.',
    $: '.## ##. .#. .## ##.', '.': '... ... ... ... .#.', ',': '... ... ... .#. #..', '!': '.#. .#. .#. ... .#.',
    '?': '##. ..# .#. ... .#.', '-': '... ... ### ... ...', ':': '... .#. ... .#. ...', '/': '..# ..# .#. #.. #..',
    "'": '.#. .#. ... ... ...', '+': '... .#. ### .#. ...', '>': '#.. .#. ..# .#. #..', '(': '.#. #.. #.. #.. .#.',
    ')': '.#. ..# ..# ..# .#.', ' ': '... ... ... ... ...', '#': '#.# ### #.# ### #.#', '%': '#.. ..# .#. #.. ..#',
    '^': '... ..# ..# #.# .#.', '*': '... #.# .#. #.# ...',
  }).map(([k, v]) => [k, v.replace(/ /g, '')]),
);

export const GLYPH_W = 4; // advance: 3 pixels and a space

const atlases = new Map<string, HTMLCanvasElement>();
const ORDER = Object.keys(GLYPHS);

function atlas(color: string): HTMLCanvasElement {
  let c = atlases.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = ORDER.length * 3;
  c.height = 5;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  ORDER.forEach((ch, i) => {
    const bits = GLYPHS[ch]!;
    for (let k = 0; k < 15; k++) if (bits[k] === '#') g.fillRect(i * 3 + (k % 3), (k / 3) | 0, 1, 1);
  });
  atlases.set(color, c);
  return c;
}

export function textWidth(s: string): number {
  return s.length ? s.length * GLYPH_W - 1 : 0;
}

export function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, align: 'left' | 'center' | 'right' = 'left', k = 1) {
  const a = atlas(color);
  const w = textWidth(s) * k;
  let px = Math.round(align === 'center' ? x - w / 2 : align === 'right' ? x - w : x);
  const py = Math.round(y);
  for (const ch of s.toUpperCase()) {
    const i = ORDER.indexOf(ch);
    if (i >= 0) ctx.drawImage(a, i * 3, 0, 3, 5, px, py, 3 * k, 5 * k);
    px += GLYPH_W * k;
  }
}

// ASCII sprites: each character is a palette key; '.' is transparent.
const SPRITES: Record<string, string[]> = {
  envelope: [
    'ooooooooooooo',
    'oVwwwwwwwwwVo',
    'owVwwwwwwwVwo',
    'owwVwwwwwVwwo',
    'owwwVwwwVwwwo',
    'owwwwVwVwwwwo',
    'owwwwwVwwwwwo',
    'owwwwwwwwwwwo',
    'ooooooooooooo',
  ],
  mini: ['ooooooo', 'oVwwwVo', 'owVwVwo', 'owwVwwo', 'ooooooo'],
  doc: ['oooo.', 'owwoo', 'owwwo', 'oLLwo', 'owwwo', 'oLLwo', 'ooooo'],
  bugIcon: ['o...o', '.ooo.', 'oRRRo', '.RRR.', 'oRRRo', '.o.o.'],
  tag: ['..ooo', '.oCCo', 'oCCCo', 'oCoCo', 'oCCo.', 'ooo..'],
  warn: ['..o..', '.oRo.', '.oRo.', 'oRwRo', 'oRRRo', 'ooooo'],
  bug: ['.o...o.', '..o.o..', '.RRRRR.', 'oRrRrRo', '.RRRRR.', 'oRrRrRo', '.o.o.o.'],
  bug2: ['..o.o..', '.o...o.', '.RRRRR.', 'oRrRrRo', '.RRRRR.', 'oRrRrRo', 'o..o..o'],
  cursor: ['o.....', 'oo....', 'owo...', 'owwo..', 'owwwo.', 'owwwwo', 'owwoo.', 'oo.wo.', 'o..oo.'],
  check: ['..ggggg..', '.gggggggg', 'gggggggwg', 'ggggggwgg', 'gwggwgggg', 'ggwwggggg', 'gggwggggg', '.ggggggg.', '..ggggg..'],
  cross: ['..rrrrr..', '.rrrrrrr.', 'rrwrrrwrr', 'rrrwrwrrr', 'rrrrwrrrr', 'rrrwrwrrr', 'rrwrrrwrr', '.rrrrrrr.', '..rrrrr..'],
  shield: [
    '.ooooooooooo.',
    'oLLLLLLLLLLLo',
    'oLLLLLLLLLLLo',
    'oLLLLLwLLLLLo',
    'oLLLLwwwLLLLo',
    'oLLLLLwLLLLLo',
    'oLLLLLLLLLLLo',
    '.oLLLLLLLLLo.',
    '.oLLLLLLLLLo.',
    '..oLLLLLLLo..',
    '...oLLLLLo...',
    '....oLLLo....',
    '.....ooo.....',
  ],
  seal: ['.ggg.', 'ggggw', 'wggwg', 'gwwgg', '.ggg.'],
  tray: ['o.............o', 'o.............o', 'o.............o', 'ooooo.....ooooo', 'owwwwoooooowwwo', 'owwwwwwwwwwwwwo', 'ooooooooooooooo'],
};

export const PAL: Record<string, string> = {
  o: '#0c0a20', w: '#f4f2ff', V: '#b9b3e6', L: '#8f86f0', R: '#ff6b57', r: '#7a1d1a', C: '#5fd6f0', g: '#3fd17e', G: '#17774b',
};

const spriteCache = new Map<string, HTMLCanvasElement>();

export function sprite(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, pal: Record<string, string> = {}, k = 1) {
  const key = name + JSON.stringify(pal);
  let c = spriteCache.get(key);
  if (!c) {
    const rows = SPRITES[name]!;
    c = document.createElement('canvas');
    c.width = rows[0]!.length;
    c.height = rows.length;
    const g = c.getContext('2d')!;
    rows.forEach((row, yy) => {
      for (let xx = 0; xx < row.length; xx++) {
        const k = row[xx]!;
        if (k === '.') continue;
        g.fillStyle = pal[k] || PAL[k] || '#ff00ff';
        g.fillRect(xx, yy, 1, 1);
      }
    });
    spriteCache.set(key, c);
  }
  ctx.drawImage(c, Math.round(x), Math.round(y), c.width * k, c.height * k);
  return c;
}

export function spriteSize(name: string): [number, number] {
  const rows = SPRITES[name]!;
  return [rows[0]!.length, rows.length];
}

export function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

export function frame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  x = Math.round(x);
  y = Math.round(y);
  w = Math.round(w);
  h = Math.round(h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillRect(x + w - 1, y, 1, h);
}

// Bresenham line, for streaks and trails.
export function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  ctx.fillStyle = color;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let i = 0; i < 2000; i++) {
    ctx.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
