import { BALANCE_BOARD_CONFIG } from "../src/balance-board-config.js";
import { mapCanonicalCopToGame } from "../src/kiwii-cop-sdk.js";

export const copSemanticsProbe = {
  sdk: {
    rightSign: BALANCE_BOARD_CONFIG.canonicalOrientation.rightSign,
    forwardSign: BALANCE_BOARD_CONFIG.canonicalOrientation.forwardSign,
    map(payload) {
      const mapped = mapCanonicalCopToGame(
        payload,
        BALANCE_BOARD_CONFIG.canonicalOrientation
      );
      return {
        right: mapped.x,
        forward: -mapped.y
      };
    }
  }
};
