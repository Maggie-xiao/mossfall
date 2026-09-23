export const EXTERNAL_GAME_PROFILE = Object.freeze({
  profileVersion: "kiwii.external-game.profile.v1",
  topology: "EXTERNAL_GAME_PRESENTATION",
  buttons: Object.freeze(["UP", "DOWN", "LEFT", "RIGHT", "A", "B", "X", "Y"]),
  viewportPolicy: Object.freeze({
    designWidth: 1920,
    designHeight: 1080,
    fit: "ADAPTIVE_SAFE_FRAME",
    orientation: "ANY"
  }),
  lifecycleCapabilities: Object.freeze({
    viewportAck: true,
    pauseAck: true,
    checkpoint: true,
    checkpointMaxBytes: 4096
  })
});

export const GAMEPAD_TILT_BUTTONS = Object.freeze(
  new Set(["UP", "DOWN", "LEFT", "RIGHT"])
);

export function gamepadTiltTarget(heldButtons) {
  const left = heldButtons.has("LEFT");
  const right = heldButtons.has("RIGHT");
  const up = heldButtons.has("UP");
  const down = heldButtons.has("DOWN");
  const x = Number(right) - Number(left);
  const y = Number(down) - Number(up);
  const length = Math.hypot(x, y);
  if (length <= 1 || length === 0) return { x, y };
  return { x: x / length, y: y / length };
}

export function resolveGamepadAction({
  state,
  buttonId,
  phase,
  resultCanContinue = false
}) {
  if (phase !== "PRESSED") return null;

  if (
    GAMEPAD_TILT_BUTTONS.has(buttonId) &&
    ["PAUSE_MENU", "CONFIRM_QUIT"].includes(state)
  ) {
    return ["UP", "LEFT"].includes(buttonId)
      ? "select-menu-previous"
      : "select-menu-next";
  }

  if (
    GAMEPAD_TILT_BUTTONS.has(buttonId) &&
    state === "GLOBAL_RANK" &&
    resultCanContinue
  ) {
    return ["UP", "LEFT"].includes(buttonId)
      ? "select-menu-previous"
      : "select-menu-next";
  }

  if (!GAMEPAD_TILT_BUTTONS.has(buttonId)) {
    switch (buttonId) {
      case "A":
        if (state === "MODE_SELECT") return "begin-setup";
        if (state === "HOW_TO_PLAY") return "close-how-to";
        if (["PAUSE_MENU", "CONFIRM_QUIT"].includes(state)) {
          return "activate-menu-selection";
        }
        if (state === "RESULT_CALC" && resultCanContinue) return "show-standing";
        if (state === "GLOBAL_RANK" && resultCanContinue) {
          return "activate-menu-selection";
        }
        return null;
      case "B":
        if (state === "GAMEPLAY") return "pause";
        if (
          [
            "PAUSE_MENU",
            "HOW_TO_PLAY",
            "CONFIRM_QUIT",
            "GLOBAL_RANK",
            "CONNECTION_REQUIRED"
          ].includes(state)
        ) {
          return "return-title";
        }
        return null;
      case "X":
        if (state === "PAUSE_MENU") return "restart-run";
        if (state === "RESULT_CALC" && resultCanContinue) return "show-standing";
        if (state === "GLOBAL_RANK" && resultCanContinue) return "restart-run";
        return null;
      case "Y":
        if (state === "MODE_SELECT") return "open-how-to";
        if (state === "PAUSE_MENU") return "open-how-to";
        if (state === "HOW_TO_PLAY") return "close-how-to";
        return null;
      default:
        return null;
    }
  }

  if (state === "MODE_SELECT") {
    if (buttonId === "LEFT") return "select-mode-beginner";
    if (buttonId === "RIGHT") return "select-mode-advanced";
  }

  return null;
}
