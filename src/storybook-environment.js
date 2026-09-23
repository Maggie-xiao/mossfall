import * as THREE from "three";

const BACKGROUNDS = [
  "./images/world-background-gold.png",
  "./images/world-background-green.png",
  "./images/world-background-blue.png",
  "./images/world-background-night.png"
];

const backgroundIndexForZone = (zone) =>
  Math.min(3, Math.max(0, Math.floor((zone | 0) / 2)));

export class StorybookEnvironment {
  constructor(scene) {
    this.scene = scene;
    this.previousBackground = scene.background;
    this.textures = BACKGROUNDS.map((url) => {
      const texture = new THREE.TextureLoader().load(url);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      return texture;
    });
    this.currentIndex = -1;
    this.setZone(0);
  }

  setZone(index) {
    const nextIndex = backgroundIndexForZone(index);
    if (nextIndex === this.currentIndex) return;
    this.currentIndex = nextIndex;
    this.scene.background = this.textures[nextIndex];
  }

  update() {}

  dispose() {
    if (this.scene.background === this.textures[this.currentIndex]) {
      this.scene.background = this.previousBackground;
    }
    for (const texture of this.textures) texture.dispose();
  }
}
