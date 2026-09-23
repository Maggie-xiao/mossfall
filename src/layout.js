const DESIGN_VIEWPORT = Object.freeze({ width: 1920, height: 1080 });

export function calculateMossTiltLayout({ mode, viewport }) {
  const width = Number(viewport?.width);
  const height = Number(viewport?.height);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new TypeError("viewport width and height must be positive");
  }
  const orientation = width >= height ? "LANDSCAPE" : "PORTRAIT";
  const safeAspect = 16 / 9;
  let safeWidth = width;
  let safeHeight = safeWidth / safeAspect;
  if (safeHeight > height) {
    safeHeight = height;
    safeWidth = safeHeight * safeAspect;
  }
  return {
    mode,
    orientation,
    scalingMode: "ADAPTIVE_SAFE_FRAME",
    designViewport: DESIGN_VIEWPORT,
    viewport: { x: 0, y: 0, width, height },
    contentFrame: { x: 0, y: 0, width, height },
    safeFrame: {
      x: (width - safeWidth) / 2,
      y: (height - safeHeight) / 2,
      width: safeWidth,
      height: safeHeight
    },
    contentScale: Math.min(width / DESIGN_VIEWPORT.width, height / DESIGN_VIEWPORT.height),
    safeFrameScale: safeWidth / DESIGN_VIEWPORT.width
  };
}

export function applyMossTiltLayout(layout, root = document.documentElement) {
  const { safeFrame } = layout;
  root.style.setProperty("--safe-x", `${safeFrame.x}px`);
  root.style.setProperty("--safe-y", `${safeFrame.y}px`);
  root.style.setProperty("--safe-width", `${safeFrame.width}px`);
  root.style.setProperty("--safe-height", `${safeFrame.height}px`);
  root.style.setProperty("--safe-scale", String(layout.safeFrameScale));
  root.dataset.presentationMode = layout.mode;
  root.dataset.presentationOrientation = layout.orientation;
  return layout;
}

export class MossTiltLayoutController {
  constructor({ mode, viewportSource = window, root = document.documentElement }) {
    this.mode = mode;
    this.viewportSource = viewportSource;
    this.root = root;
    this.current = null;
    this.connected = false;
    this.onResize = () => this.update();
  }

  viewport() {
    if (typeof this.viewportSource.current === "function") {
      return this.viewportSource.current();
    }
    return {
      width: this.viewportSource.innerWidth,
      height: this.viewportSource.innerHeight
    };
  }

  connect() {
    if (!this.connected) {
      this.connected = true;
      this.viewportSource.addEventListener?.("resize", this.onResize);
    }
    return this.update();
  }

  updateMode(mode) {
    this.mode = mode;
    return this.update();
  }

  update() {
    this.current = calculateMossTiltLayout({ mode: this.mode, viewport: this.viewport() });
    return applyMossTiltLayout(this.current, this.root);
  }

  close() {
    if (!this.connected) return;
    this.connected = false;
    this.viewportSource.removeEventListener?.("resize", this.onResize);
  }
}
