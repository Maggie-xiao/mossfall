/* Local, bounded tutorial frame player. No game input or simulation ownership. */
;(function (g) {
  'use strict';
  const hosts = new WeakMap();
  const instances = new Set();
  const clock = () => g.performance?.now?.() ?? Date.now();
  const raf = (fn) => g.requestAnimationFrame(fn);
  const caf = (id) => { if (id != null) g.cancelAnimationFrame(id); };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  class Player {
    constructor(host, settings = {}) {
      if (!host) throw new Error('Teach-in host is required');
      this.host = host;
      this.settings = settings;
      this.canvas = host.tagName?.toLowerCase() === 'canvas' ? host : document.createElement('canvas');
      if (this.canvas !== host) host.appendChild(this.canvas);
      this.canvas.classList.add('kiwii-teachin-canvas');
      Object.assign(this.canvas.style, { width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: 'transparent' });
      this.context = this.canvas.getContext('2d', { alpha: true });
      if (!this.context) throw new Error('Canvas2D is unavailable');
      this.state = 'idle';
      this.currentFrame = -1;
      this.elapsed = 0;
      this.completed = false;
      this.started = false;
      this.skipped = false;
      this.paused = false;
      this.disposed = false;
      this._epoch = 0;
      this._slots = new Map();
      this._retryIds = new Set();
      this._onVisibility = () => {
        this._last = null;
        if (document.hidden) this._cancel(); else this._schedule();
      };
      document.addEventListener('visibilitychange', this._onVisibility);
      instances.add(this);
      hosts.set(host, this);
    }

    get canAdvance() { return this.skipped || (this.completed && this.elapsed + 1e-6 >= this.minDuration); }
    get failed() { return this.state === 'failed'; }
    get remaining() { return Math.max(0, this.minDuration - this.elapsed, this.completed ? 0 : (this.endFrame - Math.max(this.startFrame, this.currentFrame) + 1) / this.rate); }
    get decodedAtlases() { return [...this._slots.values()].filter(s => s.image).length; }

    _meta(action) {
      const meta = (this.settings.manifest || g.KiwiiTeachinAssets || {})[action];
      if (!meta) throw new Error('Unknown teach-in action: ' + action);
      return meta;
    }

    prepare(action) {
      const meta = this._meta(action);
      // Only prefetch compressed files. Images are decoded by the two-block window.
      for (const chunk of meta.atlases.slice(0, 2)) {
        const source = this._url(chunk.url);
        if (source.startsWith('data:') || source.startsWith('blob:')) continue;
        const link = document.createElement('link');
        link.rel = 'prefetch'; link.as = 'image'; link.href = source;
        document.head.appendChild(link);
      }
      return this;
    }

    play(action, options = {}) {
      if (this.disposed) return this;
      const meta = this._meta(action);
      const start = clamp(Math.floor(options.startFrame ?? 0), 0, meta.frameCount - 1);
      const end = clamp(Math.floor(options.endFrame ?? meta.frameCount - 1), start, meta.frameCount - 1);
      const mode = options.mode || options.endMode || 'once';
      const speed = options.speed ?? 1.25;
      const minimum = Math.max(0, options.minDuration ?? 0);
      const key = [action, start, end, mode, speed, minimum].join(':');
      if (key === this._key) return this;
      this.stop();
      this._key = key;
      this.actionId = action; this.meta = meta;
      this.startFrame = start; this.endFrame = end; this.mode = mode;
      this.rate = meta.fps * speed; this.minDuration = minimum;
      this.options = options;
      this.completed = false; this.started = false; this.skipped = false;
      this.elapsed = 0; this.currentFrame = start; this._accumulator = 0;
      this._completionSent = false; this._last = null; this._pendingDraw = false;
      this.canvas.setAttribute('role', 'img');
      this.canvas.setAttribute('aria-label', options.label || action.replace('_', ' '));
      this._state('loading');
      this._window(start);
      this._schedule();
      return this;
    }

    _url(path) {
      return this.settings.resolveAsset?.(path) || g.KiwiiTeachinEmbedded?.[path] || new URL(path, this.settings.assetBase || document.baseURI).href;
    }

    _window(frame) {
      const block = Math.floor(frame / this.meta.framesPerAtlas);
      const lastBlock = Math.floor(this.endFrame / this.meta.framesPerAtlas);
      const next = block < lastBlock ? block + 1 : (this.mode === 'loop' ? Math.floor(this.startFrame / this.meta.framesPerAtlas) : block);
      const desired = new Set([block, next]);
      for (const [id, slot] of this._slots) {
        if (!desired.has(id)) { slot.abort.abort(); slot.image?.close?.(); slot.cleanup?.(); this._slots.delete(id); }
      }
      for (const id of desired) this._load(id);
      return this._slots.get(block);
    }

    _load(id) {
      if (this._slots.has(id)) return;
      const epoch = this._epoch;
      const slot = { abort: new AbortController(), image: null, error: null };
      this._slots.set(id, slot);
      slot.promise = (async () => {
        const timeout = setTimeout(() => slot.abort.abort(new Error('Animation load timed out')), 8000);
        try {
          const response = await fetch(this._url(this.meta.atlases[id].url), { signal: slot.abort.signal, cache: this._retryIds.delete(id) ? 'reload' : 'force-cache' });
          if (!response.ok) throw new Error('Animation HTTP ' + response.status);
          const blob = await response.blob();
          let decoded;
          if (g.createImageBitmap) decoded = await g.createImageBitmap(blob);
          else {
            const url = URL.createObjectURL(blob);
            slot.cleanup = () => URL.revokeObjectURL(url);
            decoded = new Image(); decoded.src = url;
            await decoded.decode();
          }
          if (epoch !== this._epoch || this._slots.get(id) !== slot || slot.abort.signal.aborted) {
            decoded.close?.(); slot.cleanup?.(); return;
          }
          slot.image = decoded;
        } catch (error) {
          if (epoch === this._epoch && this._slots.get(id) === slot) slot.error = error;
        } finally { clearTimeout(timeout); }
      })();
    }

    _visible() {
      if (document.hidden || this.paused || !this.canvas.isConnected) return false;
      if (this.canvas.checkVisibility) return this.canvas.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, opacityProperty: true, visibilityProperty: true });
      if (!this.canvas.getClientRects().length) return false;
      for (let el = this.canvas; el?.nodeType === 1; el = el.parentElement) {
        const style = getComputedStyle(el);
        if (el.hidden || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      }
      return true;
    }

    _draw(frame, slot) {
      if (this.canvas.width !== this.meta.width) this.canvas.width = this.meta.width;
      if (this.canvas.height !== this.meta.height) this.canvas.height = this.meta.height;
      const local = frame % this.meta.framesPerAtlas;
      const x = (local % this.meta.columns) * this.meta.width;
      const y = Math.floor(local / this.meta.columns) * this.meta.height;
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.context.drawImage(slot.image, x, y, this.meta.width, this.meta.height, 0, 0, this.canvas.width, this.canvas.height);
      this.canvas.dataset.teachinFrame = String(frame);
      this.canvas.dataset.teachinMotion = this.actionId;
      this.canvas.dataset.teachinDecoded = String(this.decodedAtlases);
      this.canvas.dispatchEvent(new CustomEvent('teachin:frame', { detail: { actionId: this.actionId, frame } }));
    }

    _tick(time) {
      this._raf = null;
      if (!this._key || this.disposed || this.paused || this.state === 'failed') return;
      if (!this._visible()) {
        this._last = null;
        if (!document.hidden) this._visibleTimer = setTimeout(() => this._schedule(), 150);
        return;
      }
      const slot = this._window(this.currentFrame);
      if (slot?.error) { this._fail(slot.error); return; }
      if (!slot?.image) { this._last = null; this._schedule(); return; }
      if (!this.started) {
        this._draw(this.currentFrame, slot);
        this.started = true; this._last = time; this._state('playing');
        this._schedule(); return;
      }
      if (this._pendingDraw) {
        this._draw(this.currentFrame, slot);
        this._pendingDraw = false; this._accumulator = 0; this._last = time;
        this._schedule(); return;
      }
      const dt = this._last == null ? 0 : Math.min(0.1, Math.max(0, (time - this._last) / 1000));
      this._last = time;
      this.elapsed += dt;
      this._accumulator += dt;
      const interval = 1 / this.rate;
      if (this._accumulator + 1e-9 >= interval) {
        if (this.currentFrame === this.endFrame) {
          this.completed = true;
          if (!this._notifyCompletion()) return;
          if (this.mode === 'loop') this.currentFrame = this.startFrame;
          else this._state(this.mode === 'hold' ? 'holding' : 'completed');
        } else if (!this.completed || this.mode === 'loop') this.currentFrame++;
        this._pendingDraw = true;
        const frameSlot = this._window(this.currentFrame);
        if (frameSlot?.error) { this._fail(frameSlot.error); return; }
        if (!frameSlot?.image) {
          // Do not skip an undrawn frame, or count stalled time toward a complete cycle.
          this._pendingDraw = true;
          this.elapsed -= dt; this._last = null; this._schedule(); return;
        }
        this._draw(this.currentFrame, frameSlot);
        this._pendingDraw = false;
        this._accumulator = Math.min(interval, Math.max(0, this._accumulator - interval));
      }
      this.canvas.dataset.teachinComplete = String(this.canAdvance);
      if (!this._notifyCompletion()) return;
      if (this.mode === 'loop' || !this.canAdvance) this._schedule();
    }

    _notifyCompletion() {
      const epoch = this._epoch;
      if (this.canAdvance && !this._completionSent) {
        this._completionSent = true;
        this.options.onComplete?.(this);
        this.canvas.dispatchEvent(new CustomEvent('teachin:complete', { detail: { actionId: this.actionId, elapsed: this.elapsed } }));
      }
      return epoch === this._epoch && !!this._key;
    }

    _state(state) {
      if (this.state === state) return;
      this.state = state;
      this.canvas.dataset.teachinState = state;
      this.options?.onState?.(state, this);
    }
    _schedule() {
      if (this._raf == null && this._key && !this.paused && !this.disposed && !document.hidden && this.state !== 'failed') this._raf = raf(t => this._tick(t));
    }
    _cancel() { caf(this._raf); this._raf = null; clearTimeout(this._visibleTimer); }
    _fail(error) {
      this._cancel(); this._state('failed'); this._last = null;
      this.canvas.dataset.teachinError = String(error?.message || error);
      const parent = this.canvas.parentElement;
      if (parent && !this._errorUI) {
        const ui = document.createElement('div');
        ui.className = 'kiwii-teachin-recovery';
        ui.setAttribute('role', 'status');
        Object.assign(ui.style, { position: 'absolute', inset: 'auto 4px 4px', padding: '6px', background: 'rgba(20,28,38,.85)', color: '#fff', borderRadius: '8px', textAlign: 'center', font: '12px sans-serif', zIndex: '2', pointerEvents: 'auto' });
        const caption = document.createElement('span'); caption.textContent = document.documentElement.lang.startsWith('zh') ? '动画加载失败 ' : 'Animation unavailable ';
        ui.appendChild(caption);
        for (const [en, zh, fn] of [['Retry', '重试', () => this.retry()], ['Skip', '跳过', () => this.skip()]]) {
          const button = document.createElement('button'); button.type = 'button'; button.textContent = document.documentElement.lang.startsWith('zh') ? zh : en;
          button.addEventListener('click', fn); ui.appendChild(button);
        }
        parent.appendChild(ui); this._errorUI = ui;
      }
      this.options?.onError?.(error, this);
    }
    retry() {
      if (!this._key || this.disposed) return;
      this._errorUI?.remove(); this._errorUI = null;
      for (const [id, slot] of this._slots) if (slot.error) { this._retryIds.add(id); slot.abort.abort(); slot.image?.close?.(); slot.cleanup?.(); this._slots.delete(id); }
      this._last = null; this._state('loading'); this._window(this.currentFrame); this._schedule();
    }
    skip() {
      this.skipped = true; this._cancel(); this._state('skipped');
      this._errorUI?.remove(); this._errorUI = null;
      this.options?.onSkip?.(this);
    }
    pause() { this.setPaused(true); }
    resume() { this.setPaused(false); }
    setPaused(value) {
      if (this.paused === !!value) return this;
      this.paused = !!value; this._last = null;
      if (this.paused) this._cancel(); else this._schedule();
      return this;
    }
    stop() {
      this._epoch++; this._cancel(); this._key = null; this._last = null;
      for (const slot of this._slots.values()) { slot.abort.abort(); slot.image?.close?.(); slot.cleanup?.(); }
      this._slots.clear(); this._errorUI?.remove(); this._errorUI = null;
      this._retryIds.clear();
      this._state('idle'); this.completed = false; this.skipped = false; this.started = false;
      this.canvas.dataset.teachinComplete = 'false';
      return this;
    }
    dispose() {
      this.stop(); this.disposed = true;
      document.removeEventListener('visibilitychange', this._onVisibility);
      instances.delete(this); hosts.delete(this.host);
      if (this.canvas !== this.host) this.canvas.remove();
    }
  }

  g.KiwiiTeachin = {
    version: '2026-09-14.5', Player,
    mount(host, action, options = {}) {
      let player = hosts.get(host);
      if (!player || player.disposed) player = new Player(host, options);
      return action ? player.play(action, options) : player;
    },
    get(host) { return hosts.get(host); },
    pauseAll(paused = true) { for (const player of instances) player.setPaused(paused); },
    stopAll() { for (const player of instances) player.stop(); },
    stats() { return [...instances].map(p => ({ actionId: p.actionId, state: p.state, frame: p.currentFrame, elapsed: p.elapsed, completed: p.completed, skipped: p.skipped, decoded: p.decodedAtlases })); }
  };
})(globalThis);
