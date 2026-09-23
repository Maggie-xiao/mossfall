export const BALANCE_BOARD_CONFIG = Object.freeze({
  pollIntervalMs: 20,
  maxDataAgeMs: 500,
  simulatorMapping: Object.freeze({
    halfWidthCm: 16,
    halfHeightCm: 9,
    invertX: false,
    invertY: true
  }),
  canonicalOrientation: Object.freeze({
    authority: "MOSS_TILT_APPROVED_DEVICE_INSTALLATION",
    rightSign: 1,
    forwardSign: 1
  }),
  response: Object.freeze({
    deadZone: 0.03,
    exponent: 1.1,
    horizontalGameplayGain: 1.2,
    verticalGameplaySensitivity: 2.4,
    displayResponsePerSecond: 10
  }),
  force: Object.freeze({
    minimumPresenceKg: 5,
    standingPresenceRatio: 0.22
  })
});
