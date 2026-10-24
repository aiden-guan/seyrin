// Minimal PNG encoder (8-bit RGBA, no interlace) so the art scripts need no dependencies.
import { deflateSync } from 'node:zlib';

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Nearest-neighbour upscale onto a solid background, for eyeballing renders.
export function preview(width, height, rgba, scale, bg = [245, 244, 240]) {
  const W = width * scale, H = height * scale;
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const s = (((y / scale) | 0) * width + ((x / scale) | 0)) * 4;
      const d = (y * W + x) * 4;
      const a = rgba[s + 3] / 255;
      out[d] = Math.round(rgba[s] * a + bg[0] * (1 - a));
      out[d + 1] = Math.round(rgba[s + 1] * a + bg[1] * (1 - a));
      out[d + 2] = Math.round(rgba[s + 2] * a + bg[2] * (1 - a));
      out[d + 3] = 255;
    }
  }
  return encodePNG(W, H, out);
}
