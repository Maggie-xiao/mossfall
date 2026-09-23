/**
 * MOSSFALL — event bus.
 *
 * Systems never hold references to each other; they publish here. One rule:
 * emitters are allowed to reuse payload objects (so the hot paths do not
 * allocate), so a listener that keeps a payload must copy it first.
 */

export class EventBus {
  constructor() {
    this._map = new Map();
    this._depth = 0;
    this._pendingOff = null;
  }

  /** Returns an unsubscribe function, so callers can `const off = bus.on(...)`. */
  on(name, fn) {
    if (typeof fn !== 'function') return () => {};
    let list = this._map.get(name);
    if (!list) { list = []; this._map.set(name, list); }
    list.push(fn);
    return () => this.off(name, fn);
  }

  once(name, fn) {
    const wrap = (payload) => { this.off(name, wrap); fn(payload); };
    return this.on(name, wrap);
  }

  off(name, fn) {
    const list = this._map.get(name);
    if (!list) return;
    // Removing during a dispatch would shift the array under the loop; defer.
    if (this._depth > 0) {
      (this._pendingOff || (this._pendingOff = [])).push([name, fn]);
      return;
    }
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
    if (!list.length) this._map.delete(name);
  }

  emit(name, payload) {
    const list = this._map.get(name);
    if (!list || !list.length) return;
    this._depth++;
    // Iterate the live array but snapshot the length: handlers added during
    // dispatch run next time, which is what everyone expects.
    const n = list.length;
    for (let i = 0; i < n; i++) {
      const fn = list[i];
      if (!fn) continue;
      try {
        fn(payload);
      } catch (err) {
        console.error(`[events] handler for "${name}" threw:`, err);
      }
    }
    this._depth--;
    if (this._depth === 0 && this._pendingOff) {
      const p = this._pendingOff;
      this._pendingOff = null;
      for (let i = 0; i < p.length; i++) this.off(p[i][0], p[i][1]);
    }
  }

  clear(name) {
    if (name) this._map.delete(name);
    else this._map.clear();
  }
}
