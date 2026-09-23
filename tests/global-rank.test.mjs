import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRoster,
  pointsToPass,
  standingHeadline
} from "../src/global-rank.js";

function sequence(values) {
  let index = 0;
  return () => values[index++ % values.length];
}

test("preview neighbors preserve scores above the old 139-point display cap", () => {
  const roster = buildRoster(179, {
    rand: sequence([0.2, 0.4, 0.6, 0.8]),
    size: 4,
    meIndex: 2
  });

  assert.equal(roster[2].score, 179);
  assert.ok(roster[0].score > 179);
  assert.equal(roster[2].name, "You");
});

test("preview neighbors support endless-mode scores without upper clamping", () => {
  const roster = buildRoster(350, {
    rand: sequence([0.1, 0.3, 0.5, 0.7]),
    size: 3,
    meIndex: 1
  });

  assert.equal(roster[1].score, 350);
  assert.ok(roster[0].score > 350);
});

test("standing gap uses strict pass semantics for ties and higher scores", () => {
  const tied = [
    { name: "Alex", score: 80 },
    { name: "You", score: 80, isMe: true }
  ];
  const behind = [
    { name: "Mika", score: 86 },
    { name: "You", score: 80, isMe: true }
  ];

  assert.equal(pointsToPass(tied), 1);
  assert.equal(pointsToPass(behind), 7);
  assert.deepEqual(standingHeadline(behind), {
    text: "points to pass Mika",
    gap: 7,
    target: "Mika"
  });
});

test("standing handles top, missing-self, and one-player rosters", () => {
  const top = [{ name: "You", score: 90, isMe: true }];
  assert.equal(pointsToPass(top), 0);
  assert.deepEqual(standingHeadline(top), {
    text: "Nobody above you yet",
    gap: 0,
    target: null
  });
  assert.equal(pointsToPass([{ name: "Mika", score: 90 }]), 0);
});
