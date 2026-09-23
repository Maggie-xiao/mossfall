export const VIBRATION_STORAGE_KEY = "moss-tilt-vibration-enabled";
export const VIBRATION_INTENSITY_STORAGE_KEY =
  "moss-tilt-vibration-intensity";

export const VIBRATION_PATTERNS = Object.freeze({
  catch: 35,
  drop: 180,
  record: Object.freeze([55, 70, 55])
});

export const DEFAULT_VIBRATION_INTENSITY = "light";

/* 时长倍率，不是 pattern —— pattern 是按事件定的。名字借 Apple 的
   UIImpactFeedbackStyle，玩家在手机上已经见过这套词。
   `medium` 正好是 1 是刻意的：上面那些 pattern 是对着真板子手调签收的，
   所以基准档必须原样发出去；这里写 0.95 会把每一条已签收的提示悄悄重调。 */
export const VIBRATION_INTENSITIES = Object.freeze({
  light: 0.6,
  medium: 1,
  heavy: 1.6
});

export const VIBRATION_INTENSITY_LEVELS = Object.freeze(
  Object.keys(VIBRATION_INTENSITIES)
);

function resolveStorage(storage) {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function resolveNavigator(navigatorObject) {
  if (navigatorObject !== undefined) return navigatorObject;
  try {
    return globalThis.navigator;
  } catch {
    return null;
  }
}

function scaleDuration(duration, multiplier) {
  return Math.max(1, Math.round(duration * multiplier));
}

export function scaleVibrationPattern(pattern, intensity) {
  const multiplier =
    VIBRATION_INTENSITIES[intensity] ??
    VIBRATION_INTENSITIES[DEFAULT_VIBRATION_INTENSITY];
  return Array.isArray(pattern)
    ? pattern.map((duration) => scaleDuration(duration, multiplier))
    : scaleDuration(pattern, multiplier);
}

export class BrowserVibration {
  constructor({
    storage,
    navigatorObject,
    authority = "GAME_INSTANCE",
    defaultEnabled = true,
    defaultIntensity = DEFAULT_VIBRATION_INTENSITY
  } = {}) {
    this.storage = resolveStorage(storage);
    this.navigatorObject = resolveNavigator(navigatorObject);
    this.authority = authority;
    this.enabled = this.readEnabled(defaultEnabled);
    this.intensity = this.readIntensity(defaultIntensity);
    this.lastEvent = null;
  }

  readEnabled(defaultEnabled) {
    try {
      const stored = this.storage?.getItem(VIBRATION_STORAGE_KEY);
      if (stored === "0") return false;
      if (stored === "1") return true;
    } catch {}
    return Boolean(defaultEnabled);
  }

  readIntensity(defaultIntensity) {
    try {
      const stored = this.storage?.getItem(VIBRATION_INTENSITY_STORAGE_KEY);
      if (stored && stored in VIBRATION_INTENSITIES) return stored;
    } catch {}
    return defaultIntensity in VIBRATION_INTENSITIES
      ? defaultIntensity
      : DEFAULT_VIBRATION_INTENSITY;
  }

  /* 读得到不等于改得了：封面上的开关和三档强度要能落盘，否则玩家改完
     一刷新就退回默认值。写失败（隐私模式、配额满）不能让点击炸掉，所以
     内存里的值先改，落盘失败就只是这一次会话有效。 */
  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    try {
      this.storage?.setItem(VIBRATION_STORAGE_KEY, this.enabled ? "1" : "0");
    } catch {}
    return this.enabled;
  }

  /* 认不出的档位原样退回当前值，不落盘 —— 免得一个拼错的 data 属性把
     玩家选好的强度冲掉。 */
  setIntensity(intensity) {
    if (!(intensity in VIBRATION_INTENSITIES)) return this.intensity;
    this.intensity = intensity;
    try {
      this.storage?.setItem(VIBRATION_INTENSITY_STORAGE_KEY, intensity);
    } catch {}
    return this.intensity;
  }

  get supported() {
    try {
      return typeof this.navigatorObject?.vibrate === "function";
    } catch {
      return false;
    }
  }

  play(type) {
    const pattern = VIBRATION_PATTERNS[type];
    if (
      pattern === undefined ||
      this.authority !== "GAME_INSTANCE" ||
      !this.enabled ||
      !this.supported
    ) {
      return false;
    }
    const scaled = scaleVibrationPattern(pattern, this.intensity);
    let delivered = false;
    try {
      delivered = this.navigatorObject.vibrate(scaled) !== false;
    } catch {
      delivered = false;
    }
    this.lastEvent = { type, pattern: scaled, delivered };
    return delivered;
  }

  snapshot() {
    return {
      enabled: this.enabled,
      intensity: this.intensity,
      authority: this.authority,
      supported: this.supported,
      lastEvent: this.lastEvent
    };
  }
}
