/**
 * MOSSFALL — post.
 *
 * One job: take the linear HDR frame the renderer produces and turn it into the
 * image the player actually sees — bloom, vignette, a zone-driven colour grade
 * and a whisper of chromatic warmth at the edges — in a single hand-rolled
 * chain, because `EffectComposer` lives in three's `examples/` and we ship only
 * the vendored core.
 *
 * The colour pipeline is the whole reason this file is careful. In r169 the
 * renderer forces `NoToneMapping` and a linear output space the moment you draw
 * into a WebGLRenderTarget (WebGLProgram parameters, `currentRenderTarget !==
 * null`). So the scene target holds raw linear radiance — exactly what a bloom
 * threshold needs — and the composite pass, which is the only pass that draws
 * to the default framebuffer, is the only place ACES and sRGB encoding may
 * happen. It does that with three's own `<tonemapping_fragment>` and
 * `<colorspace_fragment>` chunks so the result is bit-identical to the no-post
 * path in the parts of the image post does not touch.
 *
 * Everything here is guarded. A missing extension, a shader that will not link,
 * a driver that throws mid-frame: all of them end in `setEnabled(false)` and a
 * plain `renderer.render(scene, camera)`. The game may look flatter than it
 * should. It must never show a black screen.
 *
 * The whole chain is also allowed to come and go while the game runs. The tier
 * a machine boots at is a guess, and the two things that can revise it — the
 * governor giving up a level of detail, and the player picking one by hand —
 * both arrive as the same `quality` event on the bus. A tier without post is
 * not a tier where this object is inert; it is a tier where it has handed its
 * render targets back, and `enabled` reads false so the caller draws the scene
 * itself. Crossing that line in either direction is `setQuality`.
 */

import * as THREE from 'three';
import { clamp01, lerp, sstep, nowSeconds } from '../core/math.js';
import { ZONES, zoneFor } from '../data/palette.js';
import { resolveQuality } from '../core/settings.js';

/* ===================================================================== *
 * Shaders
 * ===================================================================== */

/**
 * Fullscreen triangle. One vertex more than a point, two fewer than a quad, and
 * no seam down the diagonal where the two halves of a quad meet.
 */
const VERT_FS = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Soft-knee bright pass: a hard threshold makes bloom crawl and flicker. */
const FRAG_BRIGHT = /* glsl */`
uniform sampler2D uTex;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;

void main() {
  // A single blown pixel would otherwise smear a 30-pixel disc of white.
  vec3 c = min(texture2D(uTex, vUv).rgb, vec3(24.0));
  float br = max(c.r, max(c.g, c.b));

  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float w = max(soft, br - uThreshold) / max(br, 1e-4);

  gl_FragColor = vec4(c * w, 1.0);
}
`;

/**
 * Five taps, linear-sampled — the standard trick of sitting each tap between
 * two texels so the hardware filter does two of the nine samples for free.
 */
const FRAG_BLUR = /* glsl */`
uniform sampler2D uTex;
uniform vec2 uStep;          // blur direction already scaled by 1/size
varying vec2 vUv;

void main() {
  vec2 o1 = uStep * 1.3846153846;
  vec2 o2 = uStep * 3.2307692308;
  vec3 c = texture2D(uTex, vUv).rgb * 0.2270270270;
  c += (texture2D(uTex, vUv + o1).rgb + texture2D(uTex, vUv - o1).rgb) * 0.3162162162;
  c += (texture2D(uTex, vUv + o2).rgb + texture2D(uTex, vUv - o2).rgb) * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}
`;

/** Four bilinear taps at the source's texel corners: a clean box halving. */
const FRAG_DOWN = /* glsl */`
uniform sampler2D uTex;
uniform vec2 uTexel;         // 1 / source size
varying vec2 vUv;

void main() {
  vec3 c = texture2D(uTex, vUv + uTexel * vec2(-0.5, -0.5)).rgb;
  c += texture2D(uTex, vUv + uTexel * vec2(0.5, -0.5)).rgb;
  c += texture2D(uTex, vUv + uTexel * vec2(-0.5, 0.5)).rgb;
  c += texture2D(uTex, vUv + uTexel * vec2(0.5, 0.5)).rgb;
  gl_FragColor = vec4(c * 0.25, 1.0);
}
`;

const FRAG_COMPOSITE = /* glsl */`
uniform sampler2D uScene;
uniform sampler2D uBloom0;
uniform sampler2D uBloom1;
uniform float uBloom;
uniform float uVignette;
uniform float uChroma;
uniform float uEdgeWarm;
uniform vec3 uShadow;        // multiplicative tint at the dark end
uniform vec3 uHigh;          // multiplicative tint at the bright end
varying vec2 vUv;

void main() {
  vec2 d = vUv - 0.5;
  float r2 = dot(d, d) * 4.0;   // ~1 at the edge midpoints, 2 at the corners

  #ifdef USE_CHROMA
    // Radial, quadratic, and tiny — this should register as "lens", never as
    // "effect". Red pushed out, blue pulled in, green left alone.
    vec2 ca = d * (uChroma * r2 * 0.0055);
    vec3 col = vec3(
      texture2D(uScene, vUv + ca).r,
      texture2D(uScene, vUv).g,
      texture2D(uScene, vUv - ca).b);
  #else
    vec3 col = texture2D(uScene, vUv).rgb;
  #endif

  #ifdef BLOOM2
    vec3 bloom = (texture2D(uBloom0, vUv).rgb + texture2D(uBloom1, vUv).rgb * 0.85) * 0.541;
  #else
    vec3 bloom = texture2D(uBloom0, vUv).rgb;
  #endif
  col += bloom * uBloom;

  // Split-tone the grade rather than tinting flat: the canopy stays warm in the
  // highlights while the fog under it goes cool, which is what sells depth.
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col *= mix(uShadow, uHigh, clamp(luma * 1.25, 0.0, 1.0));

  float v = smoothstep(1.45, 0.20, r2);
  v = mix(1.0, v, uVignette);
  col *= v;
  // The corners do not just darken, they warm — the light there has travelled
  // through more of the tree.
  col *= mix(vec3(1.0), vec3(1.045, 1.0, 0.945), (1.0 - v) * uEdgeWarm);

  gl_FragColor = vec4(col, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* ===================================================================== *
 * Zone grades — derived once from the palette
 * ===================================================================== */

const _gc = new THREE.Color();

/**
 * Turn a palette colour into a luminance-neutral multiplicative tint, so a
 * grade shifts hue without also shifting exposure.
 */
function tintOf(hex, strength) {
  _gc.setHex(hex);
  const l = Math.max(0.2126 * _gc.r + 0.7152 * _gc.g + 0.0722 * _gc.b, 1e-3);
  return new THREE.Vector3(
    lerp(1, _gc.r / l, strength),
    lerp(1, _gc.g / l, strength),
    lerp(1, _gc.b / l, strength),
  );
}

function buildGrades() {
  const out = [];
  for (let i = 0; i < ZONES.length; i++) {
    const z = ZONES[i];
    out.push({
      shadow: tintOf(z.fog, 0.30),
      high: tintOf(z.rim, 0.20),
      bloom: z.bloom,
      // The descent gets progressively more enclosed; the frame closes with it.
      vignette: 0.16 + i * 0.028,
    });
  }
  return out;
}

const GRADES = buildGrades();

/* ===================================================================== *
 * PostFX
 * ===================================================================== */

const _size = new THREE.Vector2();
const _white = new Uint8Array([255, 255, 255, 255]);
const _black = new Uint8Array([0, 0, 0, 255]);

/**
 * The longest frame we are still willing to call a frame. A quarter of a second
 * is already a horrible hitch, but it is time the player lived through and the
 * cross-fade has to account for it.
 */
const MAX_FRAME = 0.25;

/**
 * Past this nobody was watching: a hidden tab, a closed lid, a debugger paused
 * on a breakpoint. There is no fade to interpolate across a gap like that.
 */
const SLEEP_GAP = 2.0;

export class PostFX {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {object|string} quality a QUALITY tier, a tier name, or 'auto'
   * @param {object} [opts] { bloom, threshold, knee, vignette, chroma, events }
   */
  constructor(renderer, quality, opts) {
    const o = opts || {};
    this.renderer = renderer || null;
    this.quality = resolveQuality(quality);

    this._ok = false;          // is the chain built right now
    this._failed = false;      // did the pipeline ever fail at runtime
    this._on = false;          // is it built *and* wanted
    this._want = true;         // does the caller want post at all
    this._strength = 1;
    this._w = 0;
    this._h = 0;
    this._last = nowSeconds();

    this._baseBloom = o.bloom != null ? o.bloom : 0.85;
    this._threshold = o.threshold != null ? o.threshold : 0.80;
    this._knee = o.knee != null ? o.knee : 0.42;
    this._baseVignette = o.vignette != null ? o.vignette : 1.0;
    // Kept apart from `_chroma` because the two answer different questions: an
    // explicit option is the caller's word and survives a tier change, while an
    // absent one means "whatever this tier says", which a tier change revises.
    this._optChroma = o.chroma != null ? o.chroma : null;
    this._chroma = this._chromaFor(this.quality);

    // Zone cross-fade state. `_snap` is a pre-allocated snapshot so a zone
    // change mid-fade never has to allocate a new "from".
    this._snap = {
      shadow: new THREE.Vector3(1, 1, 1),
      high: new THREE.Vector3(1, 1, 1),
      bloom: GRADES[0].bloom,
      vignette: GRADES[0].vignette,
    };
    this._from = GRADES[0];
    this._to = GRADES[0];
    this._toIndex = 0;
    this._mix = 1;
    this._auto = false;
    this._fade = 0;
    this._fadeDur = 1.2;

    // The governor and the settings screen both announce a tier the same way, so
    // listening for it here is how this object learns that the machine it was
    // built for is not the machine it is running on any more. Without a bus
    // nobody can tell us, and the owner has to call `setQuality` by hand.
    const bus = (o.events && typeof o.events.on === 'function') ? o.events
      : (o.events && o.events.events && typeof o.events.events.on === 'function') ? o.events.events
        : null;
    this._offQuality = bus
      ? bus.on('quality', (p) => { if (p) this.setQuality(p.quality || p); })
      : null;

    this.setZone(0, 1);
    this._wake();
  }

  /** A tier's chroma, unless the caller named one, in which case theirs. */
  _chromaFor(q) {
    if (this._optChroma != null) return this._optChroma;
    return (q && q.chroma != null) ? q.chroma : 1;
  }

  /**
   * What the chain is physically made of at a tier: the MSAA sample count baked
   * into the scene target, how many bloom levels exist, and whether the
   * composite was compiled with the chromatic taps. Those are render target
   * allocations and shader defines, not uniforms, so when one of them changes
   * the chain cannot be re-pointed — it has to be built again.
   */
  _shape(q) {
    const steps = Math.max(1, Math.min(2, q.bloomSteps | 0 || 1));
    return `${Math.max(0, q.postSamples | 0)}|${steps}|${this._chromaFor(q) > 0 ? 1 : 0}`;
  }

  /**
   * Build the chain, or say why we are not going to. Safe to call on an object
   * that is already awake, on one that has never been built, and on one that
   * went to sleep three levels ago — the zone cross-fade lives on `this` and not
   * in the GL objects, so it survives the round trip and the pass comes back
   * grading the zone the player is actually in.
   */
  _wake() {
    if (this._ok) return this.enabled;
    // `_want` is in the guard so a tier that climbs back over the threshold does
    // not quietly re-allocate five render targets for a player who turned post
    // off; their next `setEnabled(true)` is what builds it.
    if (!this.renderer || !this._want || this._failed || this.quality.postfx === false) return false;

    try {
      this._build();
      this._ok = true;
      this._on = this._want;
      // Start the clock here, or the gap since the last frame we drew — which
      // may be the whole time we were asleep — arrives as one enormous dt.
      this._last = nowSeconds();
      this._advance(0);
      if (!this._probe()) {
        console.warn('[fx] post pass produced no output; falling back to direct render.');
        this._failed = true;
        this._sleep();
      }
    } catch (err) {
      console.error('[fx] post pass unavailable; rendering the scene directly:', err);
      this._failed = true;
      this._sleep();
    }
    return this.enabled;
  }

  /**
   * Hand the whole chain back. The scene target alone is a full-resolution
   * multi-sampled buffer with a depth attachment, so a machine that has just
   * told us it cannot afford post must not be left carrying one. `render()`
   * falls through to a direct draw the moment `_ok` goes false, which is the
   * same path the mid-frame failure guard already uses.
   */
  _sleep() {
    this._on = false;
    if (!this._ok && !this._sceneRT) return false;
    this._ok = false;
    this._teardown();
    return false;
  }

  /* ---------------------------------------------------------------- *
   * Construction
   * ---------------------------------------------------------------- */

  _build() {
    const r = this.renderer;
    const q = this.quality;

    // Half-float keeps the highlights the bright pass is looking for. Without a
    // renderable float format we fall back to bytes: bloom still works, it just
    // loses everything above 1.0, so the threshold drops with it.
    const ext = r.extensions;
    const canFloat = !!(ext && (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float')));
    this._type = canFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;
    if (!canFloat) this._threshold = Math.min(this._threshold, 0.62);

    const common = {
      type: this._type,
      format: THREE.RGBAFormat,
      colorSpace: THREE.LinearSRGBColorSpace,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: false,
      stencilBuffer: false,
    };

    // The canvas antialias setting does nothing once we draw through a target,
    // so the scene target carries the MSAA instead.
    this._sceneRT = new THREE.WebGLRenderTarget(2, 2, Object.assign({}, common, {
      depthBuffer: true,
      samples: Math.max(0, q.postSamples | 0),
    }));
    this._sceneRT.texture.name = 'fx.scene';

    this._rtA = new THREE.WebGLRenderTarget(2, 2, common);
    this._rtB = new THREE.WebGLRenderTarget(2, 2, common);
    this._steps = Math.max(1, Math.min(2, q.bloomSteps | 0 || 1));
    if (this._steps > 1) {
      this._rtC = new THREE.WebGLRenderTarget(2, 2, common);
      this._rtD = new THREE.WebGLRenderTarget(2, 2, common);
    } else {
      this._rtC = null;
      this._rtD = null;
    }
    const clampEdge = (rt) => {
      if (!rt) return;
      rt.texture.wrapS = THREE.ClampToEdgeWrapping;
      rt.texture.wrapT = THREE.ClampToEdgeWrapping;
    };
    clampEdge(this._sceneRT); clampEdge(this._rtA); clampEdge(this._rtB);
    clampEdge(this._rtC); clampEdge(this._rtD);

    // One triangle, reused by every pass; the material is swapped per draw.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 8);
    this._geo = geo;

    const fs = (frag, uniforms, defines) => new THREE.ShaderMaterial({
      uniforms,
      defines: defines || {},
      vertexShader: VERT_FS,
      fragmentShader: frag,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      toneMapped: false,
    });

    this._mBright = fs(FRAG_BRIGHT, {
      uTex: { value: null },
      uThreshold: { value: this._threshold },
      uKnee: { value: this._knee },
    });
    this._mBlur = fs(FRAG_BLUR, {
      uTex: { value: null },
      uStep: { value: new THREE.Vector2() },
    });
    this._mDown = fs(FRAG_DOWN, {
      uTex: { value: null },
      uTexel: { value: new THREE.Vector2() },
    });

    const defines = {};
    if (this._steps > 1) defines.BLOOM2 = '';
    if (this._chroma > 0) defines.USE_CHROMA = '';
    this._mComp = new THREE.ShaderMaterial({
      uniforms: {
        uScene: { value: null },
        uBloom0: { value: null },
        uBloom1: { value: null },
        uBloom: { value: 0.6 },
        uVignette: { value: 0.2 },
        uChroma: { value: this._chroma },
        uEdgeWarm: { value: 1 },
        uShadow: { value: new THREE.Vector3(1, 1, 1) },
        uHigh: { value: new THREE.Vector3(1, 1, 1) },
      },
      defines,
      vertexShader: VERT_FS,
      fragmentShader: FRAG_COMPOSITE,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      // true so the composite — the one pass that reaches the canvas — carries
      // the renderer's ACES curve and sRGB encoding.
      toneMapped: true,
    });

    this._quad = new THREE.Mesh(geo, this._mComp);
    this._quad.frustumCulled = false;
    this._fsScene = new THREE.Scene();
    this._fsScene.add(this._quad);
    this._fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    r.getDrawingBufferSize(_size);
    this._resize(_size.x, _size.y);
  }

  /**
   * Render the real composite material into a one-pixel target with a white
   * input. If a shader failed to link the driver silently draws nothing, which
   * on a full frame is a black screen and no exception — this is the only way
   * to find out before the player does.
   */
  _probe() {
    const r = this.renderer;
    let rt = null, texW = null, texB = null;
    const u = this._mComp.uniforms;
    const savedScene = u.uScene.value, saved0 = u.uBloom0.value, saved1 = u.uBloom1.value;
    const savedRT = r.getRenderTarget();
    try {
      texW = new THREE.DataTexture(_white, 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
      texW.colorSpace = THREE.LinearSRGBColorSpace;
      texW.needsUpdate = true;
      texB = new THREE.DataTexture(_black, 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
      texB.colorSpace = THREE.LinearSRGBColorSpace;
      texB.needsUpdate = true;
      rt = new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.UnsignedByteType,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      });

      u.uScene.value = texW;
      u.uBloom0.value = texB;
      u.uBloom1.value = texB;
      this._quad.material = this._mComp;
      r.setRenderTarget(rt);
      r.render(this._fsScene, this._fsCam);

      const px = new Uint8Array(4);
      r.readRenderTargetPixels(rt, 0, 0, 1, 1, px);
      return Math.max(px[0], px[1], px[2]) > 8;
    } catch (err) {
      // An unreadable probe is not a failed pipeline; the per-frame guard in
      // render() still covers us.
      console.warn('[fx] post self-check could not run:', err);
      return true;
    } finally {
      u.uScene.value = savedScene;
      u.uBloom0.value = saved0;
      u.uBloom1.value = saved1;
      try { r.setRenderTarget(savedRT); } catch (e) { /* nothing useful to do */ }
      if (rt) rt.dispose();
      if (texW) texW.dispose();
      if (texB) texB.dispose();
    }
  }

  /* ---------------------------------------------------------------- *
   * Public API
   * ---------------------------------------------------------------- */

  get enabled() { return this._on && this._ok && !this._failed; }
  get failed() { return this._failed; }

  /**
   * The player's switch. It is remembered separately from whether the chain
   * exists, because the tier can take post away and give it back underneath a
   * player who never touched this — and when it comes back it must come back in
   * the state they left it in.
   */
  setEnabled(on) {
    this._want = !!on;
    if (this._want && !this._ok) this._wake();
    this._on = this._want && this._ok && !this._failed;
    return this._on;
  }

  /**
   * Move to a new tier. Either direction may cross the line where post exists at
   * all, so this builds the chain from nothing and gives all of it back, and in
   * between it rebuilds when the new tier wants a differently *shaped* chain —
   * more MSAA samples, a second bloom level, chromatic taps that are compiled in
   * rather than dialled. Everything else about a tier is a uniform and needs no
   * more than the next frame.
   */
  setQuality(quality) {
    const q = resolveQuality(quality);
    if (!q || q === this.quality) return this.enabled;

    const shape = this._shape(this.quality);
    this.quality = q;
    this._chroma = this._chromaFor(q);

    if (q.postfx === false) this._sleep();
    else if (!this._ok) this._wake();
    else if (shape !== this._shape(q)) { this._sleep(); this._wake(); }

    return this.enabled;
  }

  /** Master 0..1 dial over bloom, vignette and chroma together. */
  setStrength(v) {
    this._strength = clamp01(v == null ? 1 : v);
  }

  /**
   * Grade toward a depth zone. Pass `t` (0..1) to drive the cross-fade by hand
   * during a descent; omit it and the fade runs itself over ~1.2 s.
   */
  setZone(zone, t) {
    const z = (zone && typeof zone === 'object') ? zone : zoneFor(zone);
    const i = Math.max(0, Math.min(GRADES.length - 1, z.id | 0));

    if (i !== this._toIndex) {
      // Snapshot wherever the fade currently is, so a mid-descent zone change
      // continues from the image on screen rather than snapping back.
      const m = this._mix;
      this._snap.shadow.lerpVectors(this._from.shadow, this._to.shadow, m);
      this._snap.high.lerpVectors(this._from.high, this._to.high, m);
      this._snap.bloom = lerp(this._from.bloom, this._to.bloom, m);
      this._snap.vignette = lerp(this._from.vignette, this._to.vignette, m);
      this._from = this._snap;
      this._to = GRADES[i];
      this._toIndex = i;
      this._mix = 0;
      this._fade = 0;
    }

    if (typeof t === 'number' && isFinite(t)) {
      this._mix = clamp01(t);
      this._auto = false;
    } else {
      this._auto = true;
    }
  }

  /**
   * Accepted for API symmetry, but the drawing-buffer size is the only size
   * that matters here and it is re-read every frame — so this only forces the
   * check to happen now.
   */
  resize(w, h) {
    if (!this._ok || !this.renderer) return;
    try {
      this.renderer.getDrawingBufferSize(_size);
      this._resize(_size.x, _size.y);
    } catch (err) {
      this._fail(err);
    }
  }

  _resize(w, h) {
    const W = Math.max(1, Math.floor(w));
    const H = Math.max(1, Math.floor(h));
    if (W === this._w && H === this._h) return;
    this._w = W;
    this._h = H;
    const hw = Math.max(1, Math.ceil(W / 2)), hh = Math.max(1, Math.ceil(H / 2));
    const qw = Math.max(1, Math.ceil(hw / 2)), qh = Math.max(1, Math.ceil(hh / 2));
    this._sceneRT.setSize(W, H);
    this._rtA.setSize(hw, hh);
    this._rtB.setSize(hw, hh);
    if (this._rtC) this._rtC.setSize(qw, qh);
    if (this._rtD) this._rtD.setSize(qw, qh);
    this._halfW = hw; this._halfH = hh;
    this._quartW = qw; this._quartH = qh;
  }

  /**
   * Draw one frame. Always draws something: if any part of the chain is
   * unavailable or throws, this degrades to the plain scene.
   */
  render(scene, camera) {
    const r = this.renderer;
    if (!r || !scene || !camera) return;

    // WebXR owns the render target and the framebuffer layout; post is off there.
    const xr = r.xr && r.xr.isPresenting;
    if (!this.enabled || xr) {
      try {
        r.setRenderTarget(null);
        r.render(scene, camera);
      } catch (err) { /* the renderer itself is gone; nothing left to try */ }
      return;
    }

    const now = nowSeconds();
    let dt = now - this._last;
    this._last = now;
    // A stutter is still time the player lived through, so a long frame is
    // clamped rather than dropped. Dropping it holds `_mix` at exactly zero on a
    // machine whose frames are *all* long, and then `_toIndex` walks down the
    // zones while the uniforms stay pinned to the canopy — the descent grade
    // going missing on precisely the machines with the least GPU to spare.
    // Past a couple of seconds it was not a slow frame at all but a tab nobody
    // was looking at, and there the honest answer is that the fade is over: the
    // zone it was heading for is the one about to be on screen.
    if (!(dt > 0)) dt = 0;
    else if (dt > SLEEP_GAP) dt = this._fadeDur;
    else if (dt > MAX_FRAME) dt = MAX_FRAME;

    try {
      r.getDrawingBufferSize(_size);
      this._resize(_size.x, _size.y);
      this._advance(dt);
      this._chain(scene, camera);
    } catch (err) {
      this._fail(err);
      try {
        r.setRenderTarget(null);
        r.render(scene, camera);
      } catch (e) { /* as above */ }
    }
  }

  /** Advance the zone cross-fade and push the resulting grade to the uniforms. */
  _advance(dt) {
    if (this._auto && this._mix < 1) {
      this._fade = Math.min(1, this._fade + dt / this._fadeDur);
      this._mix = sstep(0, 1, this._fade);
      if (this._fade >= 1) this._mix = 1;
    }
    const m = this._mix;
    const u = this._mComp.uniforms;
    u.uShadow.value.lerpVectors(this._from.shadow, this._to.shadow, m);
    u.uHigh.value.lerpVectors(this._from.high, this._to.high, m);

    const s = this._strength;
    const zoneBloom = lerp(this._from.bloom, this._to.bloom, m);
    const zoneVig = lerp(this._from.vignette, this._to.vignette, m);
    u.uBloom.value = this._baseBloom * zoneBloom * s;
    u.uVignette.value = this._baseVignette * zoneVig * s;
    u.uChroma.value = this._chroma * s;
    u.uEdgeWarm.value = s;
    this._mBright.uniforms.uThreshold.value = this._threshold;
    this._mBright.uniforms.uKnee.value = this._knee;
  }

  _chain(scene, camera) {
    const r = this.renderer;
    const savedAuto = r.autoClear;
    const savedRT = r.getRenderTarget();

    // `finally`, not a trailing restore: if a pass throws, render() falls back
    // to drawing the scene directly, and it must not inherit our autoClear —
    // every frame after the failure would ghost on top of the last good one.
    try {
      // Scene → linear HDR target. Tone mapping and sRGB encoding are suppressed
      // here by the renderer itself; the composite puts them back.
      r.autoClear = true;
      r.setRenderTarget(this._sceneRT);
      r.render(scene, camera);

      // Every post pass fully covers its target, so clearing is wasted bandwidth.
      r.autoClear = false;

      const bright = this._mBright;
      bright.uniforms.uTex.value = this._sceneRT.texture;
      this._pass(bright, this._rtA);

      this._blur(this._rtA, this._rtB, this._halfW, this._halfH);

      if (this._rtC) {
        const down = this._mDown;
        down.uniforms.uTex.value = this._rtA.texture;
        down.uniforms.uTexel.value.set(1 / this._halfW, 1 / this._halfH);
        this._pass(down, this._rtC);
        this._blur(this._rtC, this._rtD, this._quartW, this._quartH);
      }

      const comp = this._mComp;
      comp.uniforms.uScene.value = this._sceneRT.texture;
      comp.uniforms.uBloom0.value = this._rtA.texture;
      comp.uniforms.uBloom1.value = this._rtC ? this._rtC.texture : this._rtA.texture;
      this._pass(comp, null);
    } finally {
      r.autoClear = savedAuto;
      if (savedRT !== null) {
        try { r.setRenderTarget(savedRT); } catch (e) { /* nothing useful to do */ }
      }
    }
  }

  /** Separable blur, ping-ponging `src` → `tmp` → `src`. */
  _blur(src, tmp, w, h) {
    const m = this._mBlur;
    m.uniforms.uTex.value = src.texture;
    m.uniforms.uStep.value.set(1 / w, 0);
    this._pass(m, tmp);
    m.uniforms.uTex.value = tmp.texture;
    m.uniforms.uStep.value.set(0, 1 / h);
    this._pass(m, src);
  }

  _pass(material, target) {
    const r = this.renderer;
    this._quad.material = material;
    r.setRenderTarget(target);
    r.render(this._fsScene, this._fsCam);
  }

  _fail(err) {
    if (this._failed) return;
    this._failed = true;
    this._on = false;
    console.error('[fx] post pass failed mid-frame; the scene will render directly from now on:', err);
  }

  /* ---------------------------------------------------------------- *
   * Teardown
   * ---------------------------------------------------------------- */

  _teardown() {
    const kill = (x) => { if (x && x.dispose) { try { x.dispose(); } catch (e) { /* already gone */ } } };
    kill(this._sceneRT); kill(this._rtA); kill(this._rtB); kill(this._rtC); kill(this._rtD);
    kill(this._geo);
    kill(this._mBright); kill(this._mBlur); kill(this._mDown); kill(this._mComp);
    this._sceneRT = this._rtA = this._rtB = this._rtC = this._rtD = null;
    this._geo = this._mBright = this._mBlur = this._mDown = this._mComp = null;
    if (this._fsScene) this._fsScene.clear();
    this._quad = null;
    // `_resize` is a no-op when the size it is handed is the size it already
    // has, so a rebuild that inherited the old dimensions would leave every one
    // of its fresh targets at the 2×2 they are constructed with.
    this._w = this._h = 0;
  }

  dispose() {
    if (this._offQuality) { try { this._offQuality(); } catch (e) { /* bus already gone */ } }
    this._offQuality = null;
    this._on = false;
    this._want = false;
    this._ok = false;
    this._teardown();
  }
}

export default PostFX;
