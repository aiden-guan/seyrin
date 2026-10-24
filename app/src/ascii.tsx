// A field of ASCII dots drawn on a canvas: calm drift for empty states, a scanning band while Kane
// works, and a one-shot ripple when a result is verified. Colour comes from the element's CSS `color`.
// Pauses off screen and in background tabs; holds one frame for people who prefer reduced motion.
import { useEffect, useRef } from 'react';

type Mode = 'drift' | 'scan' | 'ripple';

const RAMP = ' .·:+*•';
const CELL_W = 9;
const CELL_H = 13;
const FPS = 24;

function field(mode: Mode, x: number, y: number, cols: number, rows: number, t: number): number {
  const nx = x / cols;
  const ny = y / rows;
  if (mode === 'ripple') {
    // A ring of characters leaving the seal (top left of the card) and fading as it travels.
    const d = Math.hypot(x * CELL_W - 26, y * CELL_H - 28);
    const front = t * 360;
    const ring = Math.exp(-((d - front) ** 2) / 900);
    const wake = d < front ? 0.35 * Math.exp(-(front - d) / 60) : 0;
    return (ring + wake) * Math.max(0, 1 - t / 1.8);
  }
  const wave = Math.sin(nx * 7 + t * 0.6) * Math.cos(ny * 5 - t * 0.4) + Math.sin((nx + ny) * 9 - t * 0.8) * 0.5;
  let v = (wave + 1.5) / 3;
  if (mode === 'scan') {
    // Kane reading a page: a soft band sweeping left to right.
    const pos = (t * 0.28) % 1.4 - 0.2;
    const band = Math.exp(-((nx - pos) ** 2) / 0.006);
    v = v * 0.45 + band * 0.9;
  } else {
    v *= 0.55;
  }
  return v;
}

export function AsciiField({ mode = 'drift', className, once = false }: { mode?: Mode; className?: string; once?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let cols = 0;
    let rows = 0;
    let color = '#fff';
    let raf = 0;
    let visible = true;
    let last = 0;
    const start = performance.now();

    const size = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `11px 'Geist Mono Variable', ui-monospace, monospace`;
      ctx.textBaseline = 'top';
      cols = Math.ceil(rect.width / CELL_W);
      rows = Math.ceil(rect.height / CELL_H);
      color = getComputedStyle(canvas).color || color;
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = color;
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < cols; x += 1) {
          const v = Math.min(1, Math.max(0, field(mode, x, y, cols, rows, t)));
          const i = Math.floor(v * (RAMP.length - 1) + 0.0001);
          if (i <= 0) continue;
          ctx.globalAlpha = 0.18 + v * 0.82;
          ctx.fillText(RAMP[i]!, x * CELL_W, y * CELL_H);
        }
      }
      ctx.globalAlpha = 1;
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (!visible || document.hidden || now - last < 1000 / FPS) return;
      last = now;
      const t = (now - start) / 1000;
      draw(t);
      if (once && t > 2) {
        cancelAnimationFrame(raf);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };

    size();
    if (still) {
      if (mode !== 'ripple') draw(1.2);
    }
    else raf = requestAnimationFrame(tick);

    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      size();
      if (still && mode !== 'ripple') draw(1.2);
    });
    ro?.observe(canvas);
    const io = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
    });
    io?.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      io?.disconnect();
    };
  }, [mode, once]);

  return <canvas ref={ref} className={`ascii${className ? ` ${className}` : ''}`} aria-hidden="true" />;
}
