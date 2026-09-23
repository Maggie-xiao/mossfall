const FIRST_NAMES = [
  "Mika",
  "Rui",
  "Sasha",
  "Tomo",
  "Alex",
  "Yuki",
  "Noor",
  "Ines",
  "Lars",
  "Priya",
  "Omar",
  "Clara",
  "Hugo",
  "Aiko",
  "Diego",
  "Elif",
  "Kenji",
  "Maya",
  "Ravi",
  "Lena"
];

const LAST_INITIALS = "ABCDEFGHJKLMNPRSTVWYZ".split("");
const AVATAR_COLORS = [
  "#7bf0ac",
  "#ff8fb8",
  "#c9a8f0",
  "#ffc169",
  "#8fd8ff",
  "#b6f0a0",
  "#ffa8c8",
  "#d0b0ff",
  "#9fe4d6",
  "#ffd0a0"
];

const normalizeScore = (value) =>
  Math.max(0, Math.round(Number(value) || 0));

function makeName(used, rand) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const first = FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)];
    const name =
      rand() < 0.5
        ? `${first} ${LAST_INITIALS[Math.floor(rand() * LAST_INITIALS.length)]}.`
        : first;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  return "Player";
}

/**
 * Builds deterministic-looking preview neighbors around a score.
 * This is demo data only until a real leaderboard supplies a roster.
 */
export function buildRoster(myScore, options = {}) {
  const rand = options.rand || Math.random;
  const size = Math.max(1, Math.floor(options.size ?? 4));
  const meIndex = Math.min(
    size - 1,
    Math.max(0, Math.floor(options.meIndex ?? Math.min(2, size - 1)))
  );
  const mine = normalizeScore(myScore);
  const step = () => 1 + Math.floor(rand() * 6);
  const used = new Set();
  const scores = new Array(size);

  scores[meIndex] = mine;
  for (let index = meIndex - 1; index >= 0; index -= 1) {
    scores[index] = scores[index + 1] + step();
  }
  for (let index = meIndex + 1; index < size; index += 1) {
    scores[index] = Math.max(0, scores[index - 1] - step());
  }

  return scores.map((score, index) => ({
    name: index === meIndex ? "You" : makeName(used, rand),
    score,
    color:
      index === meIndex
        ? "#ffd633"
        : AVATAR_COLORS[Math.floor(rand() * AVATAR_COLORS.length)],
    isMe: index === meIndex
  }));
}

export function pointsToPass(
  roster,
  meIndex = roster.findIndex((person) => person.isMe)
) {
  const me = roster[meIndex];
  const above = roster[meIndex - 1];
  if (!me || !above) return 0;
  return Math.max(1, above.score - me.score + 1);
}

export function standingHeadline(
  roster,
  meIndex = roster.findIndex((person) => person.isMe)
) {
  const above = roster[meIndex - 1];
  if (!above) return { text: "Nobody above you yet", gap: 0, target: null };
  const gap = pointsToPass(roster, meIndex);
  return {
    text: `point${gap === 1 ? "" : "s"} to pass ${above.name}`,
    gap,
    target: above.name
  };
}
