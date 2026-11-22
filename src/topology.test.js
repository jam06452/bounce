import { test } from "node:test";
import assert from "node:assert/strict";
import { exitTarget, entryState, predictExit } from "./topology.js";
test("2 players: only the top edge passes, to the other seat", () => {
  assert.equal(exitTarget(2, 0, "top"), 1);
  assert.equal(exitTarget(2, 1, "top"), 0);
  for (const edge of ["left", "right", "bottom"]) assert.equal(exitTarget(2, 0, edge), null);
});
test("4 players: left \u2192 next, right \u2192 previous, top \u2192 across, bottom bounces", () => {
  for (let seat = 0; seat < 4; seat++) {
    assert.equal(exitTarget(4, seat, "left"), (seat + 1) % 4);
    assert.equal(exitTarget(4, seat, "right"), (seat + 3) % 4);
    assert.equal(exitTarget(4, seat, "top"), (seat + 2) % 4);
    assert.equal(exitTarget(4, seat, "bottom"), null);
  }
  assert.equal(exitTarget(4, 3, "left"), 0);
  assert.equal(exitTarget(4, 0, "right"), 3);
});
test("going left then coming back right returns to the same seat", () => {
  for (let seat = 0; seat < 4; seat++) assert.equal(exitTarget(4, exitTarget(4, seat, "left"), "right"), seat);
});
test("every pair of 4 seats is directly connected (so a full mesh is enough)", () => {
  for (let a = 0; a < 4; a++) for (const edge of ["left", "right", "top"]) {
    const b = exitTarget(4, a, edge);
    assert.notEqual(b, a);
  }
  const links =  new Set();
  for (let a = 0; a < 4; a++) for (const e of ["left", "right", "top"]) links.add([a, exitTarget(4, a, e)].sort().join("-"));
  assert.equal(links.size, 6);
});
test("arrival: top mirrors x and reverses momentum", () => {
  const s = entryState({ edge: "top", x: 0.125, y: 0, vx: 200, vy: -600 }, 800, 450, 18);
  assert.deepEqual(s, { x: 700, y: 18, vx: -200, vy: 600 });
});
test("arrival: side passes keep momentum and height, enter the opposite edge", () => {
  assert.deepEqual(entryState({ edge: "left", x: 0, y: 0.5, vx: -300, vy: 40 }, 800, 450, 18), { x: 781, y: 225, vx: -300, vy: 40 });
  assert.deepEqual(entryState({ edge: "right", x: 1, y: 0.5, vx: 300, vy: 40 }, 800, 450, 18), { x: 19, y: 225, vx: 300, vy: 40 });
});
test("predictExit matches a stepped simulation with gravity", () => {
  const W = 1280, H = 720, r = 18, g = 300, dt = 1 / 600;
  for (const [x, y, vx, vy] of [[640, 300, 120, -500], [200, 500, -80, -700], [900, 150, 0, -400], [100, 400, -400, 50]]) {
    const hit = predictExit({ x, y }, { x: vx, y: vy }, g, r, W, H, ["left", "right", "top"]);
    assert.ok(hit, "expected a hit");
    const b = { x, y }, v = { x: vx, y: vy };
    let t = 0, edge = null;
    while (!edge && t < 10) {
      v.y += g * dt;
      b.x += v.x * dt;
      b.y += v.y * dt;
      t += dt;
      if (b.x < r) edge = "left";
      else if (b.x > W - r) edge = "right";
      else if (b.y < r) edge = "top";
    }
    assert.equal(hit.edge, edge);
    assert.ok(Math.abs(hit.ms - t * 1e3) < 25, `ms ${hit.ms} vs ${t * 1e3}`);
  }
});
test("predictExit: no hit when gravity pulls back, edge not an exit, or too far out", () => {
  assert.equal(predictExit({ x: 600, y: 600 }, { x: 0, y: -100 }, 300, 18, 1280, 720, ["top"]), null);
  assert.equal(predictExit({ x: 600, y: 300 }, { x: 500, y: 0 }, 300, 18, 1280, 720, ["top"]), null);
  assert.equal(predictExit({ x: 600, y: 300 }, { x: 0, y: -500 }, 300, 18, 1280, 720, ["top"], 100), null);
});
