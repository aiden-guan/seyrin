// WebGL2 compositor: the pixel-art beach, the world inside the computer's screen, and the particle swarm.
// main.ts works out the camera and effect levels from the scroll position; this file only draws them.

export interface Geometry {
  art: [number, number]; // beach image size
  screen: readonly (readonly [number, number])[]; // screen corners in art pixels: TL, TR, BR, BL
}

export interface StageFrame {
  time: number;
  center: [number, number]; // art pixel shown at the middle of the viewport
  fwd: [number, number, number, number]; // art offset -> CSS px offset (2x2, column-major)
  scale: number; // CSS px per art pixel, along the screen's width
  breach: number; // 0..1: the beach breaks apart into pixels, outward from the screen
  dusk: number;
  crt: number; // screen curvature and vignette
  ca: number; // chromatic aberration, CSS px
  glow: number;
  vignette: number; // darkens the view's corners while inside
  innerPx: number; // CSS px per pixel of the inner world
  innerWin: [number, number]; // inner pixels seen through the screen
  swarm: number; // edge swarm strength
  flow: number; // scroll-driven phase that streams the swarm outward
  speed: number; // scroll speed, for streaks
  palMix: number; // swarm colours: 0 beach, 1 digital
  additive: number; // 0 paints particles, 1 makes them glow
  lift: number; // the island's loose edge pixels float away
  visR: number; // art pixels from the screen's middle to a viewport corner
}

const QUAD_VS = `#version 300 es
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const HASH = `
float hash(vec2 p) {
  uvec2 q = uvec2(ivec2(floor(p)) + 8192);
  uint h = q.x * 1597334677u ^ q.y * 3812015801u;
  h ^= h >> 15; h *= 2246822519u; h ^= h >> 13; h *= 3266489917u; h ^= h >> 16;
  return float(h) / 4294967295.0;
}
// When a beach pixel breaks off during the breach. The particle shader uses the same rule, so each pixel
// leaves the picture exactly where its particle appears.
float releaseAt(vec2 ap, vec2 mid, float visR) {
  return 0.04 + 0.62 * length(ap + 0.5 - mid) / visR + 0.3 * hash(ap);
}`;

const SCENE_FS = `#version 300 es
precision highp float;
uniform sampler2D u_dayTex, u_duskTex, u_mask, u_inner;
uniform vec2 u_view, u_art, u_center, u_scrTL, u_scrMid, u_innerSize, u_innerWin;
uniform mat2 u_inv, u_scrInv;
uniform float u_dpr, u_time, u_breach, u_dusk, u_crt, u_ca, u_glow, u_vig, u_innerPx, u_visR;
out vec4 o;
${HASH}
const vec3 PAPER = vec3(0.961, 0.957, 0.941);
const vec3 VOID = vec3(0.075, 0.063, 0.18);

vec3 backdrop(vec2 v) {
  float y = v.y / u_view.y;
  vec3 dusk = mix(vec3(0.992, 0.86, 0.74), vec3(0.8, 0.74, 0.9), y);
  return mix(PAPER, dusk, u_dusk);
}

// The sea: swash running up the sand, crests rolling in, glints.
vec3 sea(vec3 c, vec2 ap, float r) {
  float dx = (r * 255.0 - 128.0) * 0.25;
  float t = u_time;
  vec3 foam = mix(vec3(0.96, 0.99, 0.98), vec3(1.0, 0.88, 0.78), u_dusk);
  vec3 sheet = mix(vec3(0.5, 0.79, 0.8), vec3(0.72, 0.64, 0.8), u_dusk);
  if (dx < 1.6) {
    float up = 1.6 - dx;
    float swash = 1.8 + 1.7 * sin(t * 0.75 + ap.y * 0.03 - ap.x * 0.012);
    if (up < swash - 0.9) return mix(c, sheet, 0.5);
    if (up < swash + 0.1) return foam;
    return c;
  }
  float n = hash(floor(ap / 5.0));
  float crest = sin(dx * 0.5 + t * 1.5 + n * 1.4 + sin(ap.y * 0.06 + t * 0.3) * 1.2);
  if (crest > 0.94 && dx > 3.0) c = mix(c, foam, 0.42);
  if (hash(ap + floor(t * 2.5) * 13.0) > 0.995) c = mix(c, foam, 0.75);
  return c;
}

vec3 inner(vec2 ic) {
  vec2 uv = ic / u_innerSize;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return VOID;
  vec3 c = texture(u_inner, uv).rgb;
  vec3 g = textureLod(u_inner, uv, 2.5).rgb * 0.6 + textureLod(u_inner, uv, 4.5).rgb * 0.4;
  c += max(g - 0.3, 0.0) * u_glow;
  float s = smoothstep(2.5, 4.5, u_innerPx);
  return c * (1.0 - s * 0.16 * step(0.72, fract(ic.y)));
}

vec3 scene(vec2 v) {
  vec2 a = u_center + u_inv * (v - u_view * 0.5);
  vec2 ap = floor(a);
  vec2 uvS = u_scrInv * (a - u_scrTL);
  vec2 k = uvS - 0.5;
  vec2 uvB = uvS + k * dot(k, k) * u_crt;
  vec2 ic = (u_innerSize - u_innerWin) * 0.5 + uvB * u_innerWin;
  if (u_breach > releaseAt(ap, u_scrMid, u_visR)) return inner(ic);

  bool onArt = all(greaterThanEqual(ap, vec2(0.0))) && all(lessThan(ap, u_art));
  if (!onArt) return backdrop(v);
  ivec2 ip = ivec2(ap);
  vec4 m = texelFetch(u_mask, ip, 0);
  if (m.g > 0.5) {
    // The screen: a curved CRT over the inner world.
    vec3 s = inner(ic);
    float vig = clamp(u_crt * 5.0, 0.0, 1.0);
    float e = min(min(uvB.x, 1.0 - uvB.x), min(uvB.y, 1.0 - uvB.y));
    s *= mix(1.0, 0.3 + 0.7 * smoothstep(0.0, 0.09, e), vig);
    s += vig * 0.07 * smoothstep(0.35, 0.0, length(uvS - vec2(0.24, 0.2)));
    return s;
  }
  vec4 h = mix(texelFetch(u_dayTex, ip, 0), texelFetch(u_duskTex, ip, 0), u_dusk);
  if (m.b > 0.5 || h.a < 0.5) return backdrop(v);
  return m.r > 0.0 ? sea(h.rgb, ap, m.r) : h.rgb;
}

void main() {
  vec2 v = vec2(gl_FragCoord.x, u_view.y * u_dpr - gl_FragCoord.y) / u_dpr;
  vec3 c;
  if (u_ca > 0.05) {
    vec2 d = normalize(v - u_view * 0.5 + 0.001) * u_ca;
    c = vec3(scene(v + d).r, scene(v).g, scene(v - d).b);
  } else {
    c = scene(v);
  }
  vec2 q = v / u_view - 0.5;
  c *= 1.0 - u_vig * dot(q, q);
  c += (hash(gl_FragCoord.xy + fract(u_time) * 911.0) - 0.5) * 0.018;
  o = vec4(c, 1.0);
}`;

const SWARM_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 a_p;
layout(location = 1) in vec4 a_c;
layout(location = 2) in vec4 a_c2;
uniform vec2 u_view, u_center, u_scrMid;
uniform mat2 u_fwd;
uniform float u_time, u_scale, u_breach, u_swarm, u_flow, u_speed, u_palMix, u_add, u_lift, u_dusk, u_visR;
out vec4 v_c;
out vec2 v_q;
out float v_halo;
out float v_len;
${HASH}
void main() {
  int corner = gl_VertexID % 6;
  vec2 q = vec2(corner == 1 || corner == 2 || corner == 4 ? 1.0 : -1.0, corner == 2 || corner == 4 || corner == 5 ? 1.0 : -1.0);
  vec2 half_ = u_view * 0.5;
  vec2 pos;
  vec2 along = vec2(0.0);
  float size, alpha;
  vec3 col;
  float kind = a_c.a * 255.0;
  if (kind < 0.5) {
    // Edge swarm: a ring of pixels that hugs the viewport's edges, swirls and streams outward.
    float spin = (a_p.w > 0.5 ? 1.0 : -0.7);
    float ang = a_p.x * 6.2832 + u_time * (0.04 + a_p.z * 0.1) * spin + u_flow * 0.55 * spin;
    float life = fract(a_p.y + u_time * (0.025 + a_p.z * 0.05) + u_flow * (0.35 + a_p.w * 0.5));
    vec2 dir = vec2(cos(ang), sin(ang));
    float rim = min(half_.x / max(abs(dir.x), 1e-3), half_.y / max(abs(dir.y), 1e-3));
    float r = mix(0.58, 1.12, life);
    pos = half_ + dir * rim * r;
    pos += vec2(sin(u_time * 0.9 + a_p.y * 41.0), cos(u_time * 0.8 + a_p.x * 53.0)) * (6.0 + 14.0 * a_p.z);
    size = mix(1.5, 5.5, life * life) * (0.75 + a_p.w * 0.5);
    alpha = u_swarm * smoothstep(0.58, 0.8, r) * (1.0 - smoothstep(0.98, 1.12, r)) * (0.55 + 0.45 * a_p.z);
    along = dir * (u_speed * life * 60.0);
    col = mix(a_c.rgb, a_c2.rgb, u_palMix);
  } else {
    vec2 art = a_p.xy + 0.5;
    vec2 at = half_ + u_fwd * (art - u_center);
    vec2 out_ = normalize(at - half_ + 0.001);
    vec2 side = vec2(-out_.y, out_.x);
    col = mix(a_c.rgb, a_c2.rgb, u_dusk);
    if (kind < 1.5) {
      // Loose pixels at the island's edge: they hover, then fly off as the dive starts.
      float s = a_p.z;
      at += vec2(sin(u_time * 0.8 + s * 30.0), cos(u_time * 0.7 + s * 20.0)) * 0.3 * u_scale;
      float l = smoothstep(s * 0.35, s * 0.35 + 0.55, u_lift);
      pos = at + out_ * l * l * length(u_view) * (0.5 + s) + side * sin(l * 4.0 + s * 9.0) * l * 50.0;
      size = min(u_scale, 9.0 + s * 9.0) * 0.5;
      alpha = 1.0 - smoothstep(0.75, 1.0, l);
    } else {
      // The beach and the computer break apart into pixels during the breach.
      float rel = releaseAt(a_p.xy, u_scrMid, u_visR);
      float tau = clamp((u_breach - rel) / 0.4, 0.0, 1.0);
      alpha = (u_breach > rel && tau < 1.0) ? 1.0 - tau * tau : 0.0;
      pos = at + out_ * tau * tau * length(u_view) * (0.45 + a_p.z * 0.5) + side * sin(tau * 3.0 + a_p.z * 7.0) * tau * 70.0;
      size = min(u_scale, 26.0) * 0.5 * (1.0 - 0.55 * tau);
    }
    along = out_ * (u_speed * 25.0);
  }
  float halo = u_add * (kind < 0.5 ? 1.0 : 0.4);
  float grow = 1.0 + 2.0 * halo;
  // Stretch the square along its motion into a streak.
  float len = length(along);
  vec2 ax = len > 0.5 ? along / len : vec2(1.0, 0.0);
  vec2 ay = vec2(-ax.y, ax.x);
  vec2 offset = ax * q.x * (size * grow + len * 0.5) + ay * q.y * size * grow;
  vec2 p = pos + offset;
  gl_Position = vec4(p / u_view * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
  v_c = vec4(col, alpha);
  v_len = len * 0.5 / max(size, 0.25);
  v_q = vec2(q.x * (grow + v_len), q.y * grow);
  v_halo = halo;
}`;

const SWARM_FS = `#version 300 es
precision highp float;
uniform float u_add;
in vec4 v_c;
in vec2 v_q;
in float v_halo;
in float v_len;
out vec4 o;
void main() {
  // v_q is in units of the particle's half-size; the core is a square stretched by v_len into a streak.
  float dx = max(abs(v_q.x) - v_len, 0.0);
  float core = step(dx, 1.0) * step(abs(v_q.y), 1.0);
  float halo = exp(-(dx * dx + v_q.y * v_q.y) * 0.5) * 0.4 * v_halo;
  float a = max(core, halo) * v_c.a;
  if (a < 0.004) discard;
  o = vec4(v_c.rgb * a, a * (1.0 - u_add));
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const prog = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || 'shader error');
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link error');
  return prog;
}

function uniforms(gl: WebGL2RenderingContext, prog: WebGLProgram) {
  const cache = new Map<string, WebGLUniformLocation | null>();
  return (name: string) => {
    if (!cache.has(name)) cache.set(name, gl.getUniformLocation(prog, name));
    return cache.get(name)!;
  };
}

function imageTexture(gl: WebGL2RenderingContext, img: TexImageSource): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export interface Particles {
  p: Float32Array; // 4 per particle
  c: Uint8Array; // rgba per particle; alpha carries the kind (0 swarm, 1 loose pixel, 2 breach pixel)
  c2: Uint8Array;
  count: number;
}

export class Stage {
  readonly gl: WebGL2RenderingContext;
  private scene: WebGLProgram;
  private swarm: WebGLProgram;
  private su: (n: string) => WebGLUniformLocation | null;
  private pu: (n: string) => WebGLUniformLocation | null;
  private tex: { day: WebGLTexture; dusk: WebGLTexture; mask: WebGLTexture; inner: WebGLTexture };
  private vao: WebGLVertexArrayObject;
  private count = 0;
  private view: [number, number] = [1, 1];
  private dpr = 1;
  private innerSize: [number, number] = [1, 1];

  constructor(
    private canvas: HTMLCanvasElement,
    images: { day: TexImageSource; dusk: TexImageSource; mask: TexImageSource },
    private geo: Geometry,
  ) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.scene = compile(gl, QUAD_VS, SCENE_FS);
    this.swarm = compile(gl, SWARM_VS, SWARM_FS);
    this.su = uniforms(gl, this.scene);
    this.pu = uniforms(gl, this.swarm);
    const inner = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, inner);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.tex = { day: imageTexture(gl, images.day), dusk: imageTexture(gl, images.dusk), mask: imageTexture(gl, images.mask), inner };
    this.vao = gl.createVertexArray()!;
  }

  setParticles(parts: Particles) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    const buf = (data: ArrayBufferView, loc: number, size: number, type: number, normalized: boolean) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, type, normalized, 0, 0);
      gl.vertexAttribDivisor(loc, 1);
    };
    buf(parts.p, 0, 4, gl.FLOAT, false);
    buf(parts.c, 1, 4, gl.UNSIGNED_BYTE, true);
    buf(parts.c2, 2, 4, gl.UNSIGNED_BYTE, true);
    gl.bindVertexArray(null);
    this.count = parts.count;
  }

  resize(width: number, height: number, dpr: number) {
    this.view = [width, height];
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
  }

  updateInner(src: HTMLCanvasElement) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex.inner);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.innerSize = [src.width, src.height];
  }

  render(f: StageFrame) {
    const gl = this.gl;
    const [tl, tr, , bl] = this.geo.screen as [readonly [number, number], readonly [number, number], unknown, readonly [number, number]];
    const e1 = [tr[0] - tl[0], tr[1] - tl[1]], e2 = [bl[0] - tl[0], bl[1] - tl[1]];
    const det = e1[0]! * e2[1]! - e2[0]! * e1[1]!;
    const scrInv = [e2[1]! / det, -e1[1]! / det, -e2[0]! / det, e1[0]! / det];
    const mid = [tl[0] + (e1[0]! + e2[0]!) / 2, tl[1] + (e1[1]! + e2[1]!) / 2];
    const [a, b, c, d] = f.fwd;
    const fdet = a * d - c * b;
    const inv = [d / fdet, -b / fdet, -c / fdet, a / fdet];

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(this.scene);
    const su = this.su;
    const bind = (unit: number, tex: WebGLTexture, name: string) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(su(name), unit);
    };
    bind(0, this.tex.day, 'u_dayTex');
    bind(1, this.tex.dusk, 'u_duskTex');
    bind(2, this.tex.mask, 'u_mask');
    bind(3, this.tex.inner, 'u_inner');
    gl.uniform2f(su('u_view'), this.view[0], this.view[1]);
    gl.uniform1f(su('u_dpr'), this.dpr);
    gl.uniform2f(su('u_art'), this.geo.art[0], this.geo.art[1]);
    gl.uniform2f(su('u_center'), f.center[0], f.center[1]);
    gl.uniformMatrix2fv(su('u_inv'), false, inv);
    gl.uniform2f(su('u_scrTL'), tl[0], tl[1]);
    gl.uniformMatrix2fv(su('u_scrInv'), false, scrInv);
    gl.uniform2f(su('u_scrMid'), mid[0]!, mid[1]!);
    gl.uniform2f(su('u_innerSize'), this.innerSize[0], this.innerSize[1]);
    gl.uniform2f(su('u_innerWin'), f.innerWin[0], f.innerWin[1]);
    gl.uniform1f(su('u_time'), f.time);
    gl.uniform1f(su('u_breach'), f.breach);
    gl.uniform1f(su('u_dusk'), f.dusk);
    gl.uniform1f(su('u_crt'), f.crt);
    gl.uniform1f(su('u_ca'), f.ca);
    gl.uniform1f(su('u_glow'), f.glow);
    gl.uniform1f(su('u_vig'), f.vignette);
    gl.uniform1f(su('u_innerPx'), f.innerPx);
    gl.uniform1f(su('u_visR'), f.visR);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (!this.count) return;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.swarm);
    const pu = this.pu;
    gl.uniform2f(pu('u_view'), this.view[0], this.view[1]);
    gl.uniform2f(pu('u_center'), f.center[0], f.center[1]);
    gl.uniform2f(pu('u_scrMid'), mid[0]!, mid[1]!);
    gl.uniformMatrix2fv(pu('u_fwd'), false, f.fwd);
    gl.uniform1f(pu('u_time'), f.time);
    gl.uniform1f(pu('u_scale'), f.scale);
    gl.uniform1f(pu('u_breach'), f.breach);
    gl.uniform1f(pu('u_swarm'), f.swarm);
    gl.uniform1f(pu('u_flow'), f.flow);
    gl.uniform1f(pu('u_speed'), f.speed);
    gl.uniform1f(pu('u_palMix'), f.palMix);
    gl.uniform1f(pu('u_add'), f.additive);
    gl.uniform1f(pu('u_lift'), f.lift);
    gl.uniform1f(pu('u_dusk'), f.dusk);
    gl.uniform1f(pu('u_visR'), f.visR);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
    gl.bindVertexArray(null);
  }
}
