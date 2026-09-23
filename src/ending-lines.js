/**
 * 签语 — the line the eight beetles leave the player with.
 *
 * Structure is dunesong's oracle (src/ui/oracle-lines.js there): a run is
 * classified into a shape, each shape owns a drawer of lines, one draw in
 * twelve comes from a rare drawer instead, and the draw is deterministic — the
 * same run always turns up the same line, so QA can pin it and a player can
 * tell a friend which one they got.
 *
 * A drawn card: a NAME for how this run was played, and a line under it.
 *
 * The name is the personality match made visible — THE HURRIED, THE REACHING
 * HAND, THE PATIENT. It is what makes the draw feel like a tarot card instead
 * of a status message, and it does the work the sentence used to have to do
 * alone: the player recognises themselves in one glance, so the line beneath
 * is free to be a line rather than a diagnosis.
 *
 * EVERY CARD IS TWO PARTS: what this run was (`saw`), and the line to keep
 * (`say`). The owner's own example — 「你太急了，我告诉你慢就是快」 — is exactly
 * this shape: name it, then hand over the maxim. The `say` half is set big on
 * the paper and the `saw` half small above it, because the maxim is the thing
 * worth carrying and the observation is only how it gets addressed to you.
 *
 * THE TEST FOR A `say`: it has to survive being quoted alone, with no game, no
 * card, no `saw`. "Slow is the faster way down" passes. "That is why you kept
 * everything" does not — it is a footnote, and a footnote is not a maxim. That
 * distinction is the whole reason an earlier draft got cut for its second
 * sentences while this one is built out of them.
 *
 * FOUR MORE RULES, each earned by a line that got cut:
 *
 * 1. The `saw` is short and flat. It is a diagnosis, not a joke and not a
 *    second maxim — two punchlines in a row and neither lands.
 *
 * 2. Say what HAPPENED, not what didn't. Negation as the payload reads as a
 *    scolding avoided rather than a thing observed.
 *    Cut: "Nothing was rushed. Nothing was lost." / "You outran no one."
 *
 * 3. Concrete subjects. Abstract nouns may not define each other.
 *    Cut: "Control is patience with a body."
 *    Hands, inches, money, roads, weight — things with edges. An abstract noun
 *    is allowed only when its verb is physical ("Hurry is the long way round").
 *
 * 4. It has to be about THE PLAYER, not the world. No scenery.
 *    Cut: "The moss is in no hurry either."
 *    An earlier whole draft died of this — laws of the forest, moss and canopy
 *    and branch. Pretty, atmospheric, impossible to repeat to anyone.
 *
 * And the standing one: this game is about exactly one thing — patience,
 * control, slow being the fast way down. Every line is a different angle on
 * that. Nothing else earns a slot.
 *
 * The registers are deliberately MIXED inside each drawer — a paradox, a
 * three-word verdict, a plain maxim, a line that says "you". Twenty runs in,
 * variety of voice is what keeps the draw feeling like a draw. Second person
 * is fine: the earlier ban came from a draft whose sentences were convoluted,
 * and the convolution was the problem, not the pronoun.
 *
 * It never scores anyone — the result board is one screen away and already
 * reports the numbers.
 */

/** 每个抽屉的称号 —— 这一局被归成哪一类人。 */
const TITLES = Object.freeze({
  flawless: "THE STEADY HAND",
  record: "THE UNHURRIED",
  hasty: "THE HURRIED",
  costly: "THE REACHING HAND",
  steady: "THE PATIENT",
  unfinished: "THE UNFINISHED",
  rare: "THE QUIET"
});

const card = (saw, say) => Object.freeze({ saw, say });

const LINES = Object.freeze({
  /* every leaf, nothing dropped — 克制 */
  flawless: Object.freeze([
    card("You never forced it.", "That is the whole skill."),
    card("You held it lightly.", "A light hand keeps everything."),
    card("You took your time.", "Perfect is only patience, repeated."),
    card("You stayed calm.", "Calm is the whole technique."),
    card("You never grabbed.", "The gentlest grip holds longest."),
    card("You were unhurried.", "Unhurried is the fastest anyone gets down.")
  ]),
  /* a new personal best — 找到了节奏 */
  record: Object.freeze([
    card("Your best run was your calmest.", "Slow is fast, in the end."),
    card("You won by slowing down.", "Patience is the faster gear."),
    card("You never sped up.", "The calm way down is the quick way down."),
    card("You set a record without rushing.", "Calm outruns hurry."),
    card("You went easy and went far.", "Ease travels further."),
    card("You beat yourself, not the clock.", "The clock was never the opponent.")
  ]),
  /* drops on a quick run — 急 */
  hasty: Object.freeze([
    card("You were in a hurry.", "Slow is the faster way down."),
    card("You rushed it.", "Hurry is the long way round."),
    card("You moved before it was time.", "Every rushed step is taken twice."),
    card("Fast hands today.", "Slow hands keep more."),
    card("You were early.", "Early is not the same as ready."),
    card("You pushed the pace.", "Impatience is expensive.")
  ]),
  /* drops on a slow one — 贪 */
  costly: Object.freeze([
    card("You reached too far.", "Hold less and you keep more."),
    card("You wanted one more.", "The last inch costs everything."),
    card("You leaned in.", "What is grasped is already falling."),
    card("You tightened your grip.", "The tighter the grip, the sooner it goes."),
    card("You asked for more.", "Less is what stays."),
    card("You held too hard.", "Holding lightly is still holding.")
  ]),
  /* got down, took its time — 稳 */
  steady: Object.freeze([
    card("You took your time.", "Slow is still arriving."),
    card("You never hurried.", "Steady beats sudden."),
    card("You moved small.", "Small moves make long journeys."),
    card("You kept the pace.", "A pace kept is a pace that arrives."),
    card("You waited.", "Waiting is a kind of speed."),
    card("You stayed steady.", "Steady hands finish whole.")
  ]),
  /* the clock ended this one — 没打完 */
  unfinished: Object.freeze([
    card("The clock won this one.", "Beginning again is not starting over."),
    card("You ran out of time.", "Stopping is also a direction."),
    card("You did not finish.", "Unfinished is just practice."),
    card("Time ended it, not you.", "The way down waits."),
    card("You stopped short.", "Not yet is not never."),
    card("You came up short.", "Coming back is the rest of it.")
  ]),
  /* any run, rarely — 被互相转述的那句 */
  rare: Object.freeze([
    card("Whatever you did, do it slower.", "Slow is fast. Calm is strong. Less is enough."),
    card("You hurried somewhere.", "Hurry is a debt with interest."),
    card("You will get it.", "The steady hand outlives the quick one."),
    card("You tried to force it.", "You cannot hurry a thing that is already falling."),
    card("You are not late.", "Whoever is not in a hurry is never late."),
    card("Take longer than that.", "Everything that lasts moves slowly.")
  ])
});

/** One run in every twelve draws from `rare` instead of its own drawer. */
const RARE_CHANCE = 1 / 12;

/** Deterministic 0..1 — same run, same draw (before the no-repeat filter). */
function hash01(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Classify a finished run from what the result board already receives.
 *
 * Ordered widest-consequence first. Drops are the loud signal, but they do not
 * say *why*: beetles lost with time to spare are someone who tilted before the
 * leaf answered; beetles lost on a slow run are someone who kept leaning
 * further. Those need opposite advice, so they are separate shapes.
 */
export function runShape({
  cleared = 0,
  totalLevels = 8,
  drops = 0,
  timeRemaining = 0,
  startTime = 0,
  isRecord = false
} = {}) {
  const finished = cleared >= totalLevels;
  const spare = startTime > 0 ? timeRemaining / startTime : 0;
  if (drops >= 3) return spare >= 0.25 ? "hasty" : "costly";
  if (finished && drops === 0) return "flawless";
  if (isRecord) return "record";
  if (finished) return "steady";
  if (cleared <= 2) return "unfinished";
  return drops >= 2 ? "costly" : "steady";
}

/**
 * Anything drawn in the last MEMORY readings is skipped.
 *
 * This is the rule that separates an oracle from a status message, and it is
 * borrowed straight from dunesong. Without it, a player who keeps playing the
 * same way — which is most players — sees the same sentence forever, because a
 * deterministic hash of a similar run returns a similar answer. The whole point
 * of drawing is that the next draw might be different.
 *
 * Storage failing (private mode, no localStorage) is not an error: the picker
 * degrades to the plain deterministic draw, which is exactly the old behaviour.
 */
const MEMORY = 8;
const STORE = "mosstilt.ending.seen";

function recall() {
  try {
    const raw = globalThis.localStorage?.getItem(STORE);
    const seen = raw ? JSON.parse(raw) : [];
    return Array.isArray(seen) ? seen : [];
  } catch {
    return [];
  }
}

function remember(line) {
  try {
    const seen = recall();
    seen.push(line);
    while (seen.length > MEMORY) seen.shift();
    globalThis.localStorage?.setItem(STORE, JSON.stringify(seen));
  } catch {
    /* no storage — the picker still works, it just repeats sooner */
  }
}

/**
 * The line, plus the shape it came from (the ceremony shows neither, but the
 * QA snapshot does — a shape that never fires is a bug you cannot see).
 *
 * Three rules, in order:
 *   1. the run's shape picks the drawer, so the reading fits how it was played
 *   2. one run in twelve comes from `rare` instead
 *   3. anything seen in the last MEMORY readings is skipped
 *
 * @param {object} stats  what the result board already receives
 * @param {object} [opts] `{ record = true }` — pass false to peek without
 *   consuming the draw. Nothing passes it yet; it is here so a QA jump or a
 *   test can read the picker without moving the player's history.
 */
export function pickEndingLine(stats = {}, opts = {}) {
  const shape = runShape(stats);
  const seed = Math.abs((stats.totalPoints | 0) * 31 + (stats.drops | 0) * 7 + 1);
  const drawer = hash01(seed) < RARE_CHANCE ? "rare" : shape;
  const pool = LINES[drawer] || LINES.steady;
  const seen = recall();
  /* Only look back as far as this drawer can afford. A drawer holds six lines
     and the history holds eight, so filtering against the whole history would
     leave nothing fresh from the seventh reading on — and the picker would
     collapse to alternating between two lines, which is worse than what it
     replaced. Keeping at least two candidates alive is the point. */
  const window = Math.min(MEMORY, Math.max(1, pool.length - 2));
  const recent = seen.slice(-window);

  let use = pool.filter((c) => !recent.includes(c.say));
  /* Everything in this drawer is recent: at least do not repeat the last one. */
  if (!use.length) use = pool.filter((c) => c.say !== seen[seen.length - 1]);
  if (!use.length) use = pool;
  /* `seen.length` is in the hash on purpose. Without it, a player repeating the
     same run gets the same index into the shrinking candidate list every time,
     which walks a fixed rotation and starves one line forever. Determinism is
     already gone the moment history exists — spend it on coverage. */
  const drawn =
    use[Math.floor(hash01(seed * 1.7 + seen.length * 3.1) * use.length) % use.length];

  if (opts.record !== false) remember(drawn.say);
  return {
    line: drawn.say,
    saw: drawn.saw,
    title: TITLES[drawer] || TITLES.steady,
    shape,
    drawer
  };
}

export { LINES, TITLES };
