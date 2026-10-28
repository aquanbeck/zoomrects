"use strict";

const assert = require("assert");
const Zoom = require("../zoomrects.js");

function geometry(rect) {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function runClose(started) {
  let cursor = started;
  let guard = 0;
  while (cursor && cursor.phase === "zoom") {
    cursor = Zoom.advanceClose();
    guard += 1;
    assert.ok(guard < 100, "close playback did not finish");
  }
  return { cursor, guard };
}

const laptop = {
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  reserved: [0, 26, 0, 0],
  focused: true,
};
const gaps = { css: "10 10 10 10" };

assert.strictEqual(Zoom.normalizeAddress("address:0xABC"), "abc");
assert.strictEqual(Zoom.normalizeAddress("0xABC"), "abc");
assert.strictEqual(Zoom.normalizeAddress("address:abc"), "abc");
assert.strictEqual(Zoom.beginClose("0xnone"), null);
assert.strictEqual(Zoom.beginClose(""), null);
assert.strictEqual(Zoom.parseCloseWindow("").address, "");
assert.strictEqual(Zoom.parseCloseWindow("0xabc,ignored").address, "0xabc");
assert.strictEqual(Zoom.parseCloseWindow(null).address, "");

assert.strictEqual(Zoom.openBindSlackMs(), 2000);
assert.strictEqual(Zoom.recentLaunchWindow(1000, 1000, 1000), true);
assert.strictEqual(Zoom.recentLaunchWindow(1000, 1000, 1000 + Zoom.openBindSlackMs()), true);
assert.strictEqual(Zoom.recentLaunchWindow(1000, 1000, 1000 + Zoom.openBindSlackMs() + 1), false);
assert.strictEqual(Zoom.recentLaunchWindow(999, 1000, 1000), false);
assert.strictEqual(Zoom.recentLaunchWindow(NaN, 1000, 1000), false);
assert.strictEqual(Zoom.recentLaunchWindow(1000, NaN, 1500), false);

const plan = Zoom.launchPlan({
  unit: "app-Hyprland-gtk-launch-1.scope",
  cursor: { x: 400, y: 300 },
  monitor: laptop,
  gaps,
});
assert.ok(plan);
const icon = geometry(plan.source);

const startedLaunch = Zoom.beginLaunch({
  unit: plan.unit,
  cursor: { x: 400, y: 300 },
  monitor: laptop,
  gaps,
});
assert.strictEqual(startedLaunch.phase, "zoom");
assert.strictEqual(Zoom.bindLaunchWindow(""), null);
const bound = Zoom.bindLaunchWindow("0xAAA");
assert.ok(bound);
assert.deepStrictEqual(geometry(bound.source), icon);
assert.strictEqual(Zoom.bindLaunchWindow("0xbbb"), null, "a second window took the icon");
assert.strictEqual(Zoom.hasOpenSource("0xbbb"), false);
assert.strictEqual(Zoom.hasOpenSource("0xaaa"), true);
assert.strictEqual(Zoom.hasOpenSources(), true);
assert.strictEqual(Zoom.isLaunchWindow("0xAAA"), true);
assert.strictEqual(Zoom.isLaunchWindow("0xbbb"), false);

const closed = Zoom.beginClose("0xAAA");
assert.ok(closed, "known icon did not close");
assert.strictEqual(closed.phase, "zoom");
assert.strictEqual(closed.address, "aaa");
assert.deepStrictEqual(geometry(closed.source), geometry(plan.destination));
assert.deepStrictEqual(geometry(closed.destination), icon);
assert.ok(closed.outlines.length > 0);
assert.strictEqual(closed.outlines[0].filled, false);
assert.strictEqual(closed.outlines[0].stroke, true);
assert.deepStrictEqual(geometry(closed.outlines[0]), geometry(plan.destination));
assert.ok(closed.destination.width < closed.source.width);
assert.ok(closed.destination.height < closed.source.height);
assert.strictEqual(Zoom.hasOpenSource("0xaaa"), false);
assert.strictEqual(Zoom.beginClose("0xaaa"), null, "a second close replayed the icon");

const sequence = Zoom.zoomSequence(closed.source, closed.destination);
assert.strictEqual(sequence.frames[0].width, plan.destination.width);
assert.strictEqual(sequence.frames[sequence.frames.length - 1].width, icon.width);
assert.strictEqual(sequence.frames[sequence.frames.length - 1].height, icon.height);
assert.deepStrictEqual(
  [sequence.frames[sequence.frames.length - 1].x, sequence.frames[sequence.frames.length - 1].y],
  [icon.x, icon.y],
);
for (let i = 1; i < sequence.frames.length; i++) {
  assert.ok(sequence.frames[i].width <= sequence.frames[i - 1].width, "width grew while closing");
  assert.ok(sequence.frames[i].height <= sequence.frames[i - 1].height, "height grew while closing");
  assert.strictEqual(sequence.frames[i].filled, false);
  assert.strictEqual(sequence.frames[i].stroke, true);
}

const finished = runClose(closed);
assert.strictEqual(finished.guard, Zoom.zoomAdvances());
assert.strictEqual(finished.cursor.phase, "idle");
assert.strictEqual(finished.cursor.done, true);
assert.deepStrictEqual(finished.cursor.outlines, []);
assert.deepStrictEqual(Zoom.advanceClose().outlines, []);

const other = Zoom.launchPlan({
  unit: "app-Hyprland-firefox-2.scope",
  cursor: { x: 80, y: 90 },
  monitor: laptop,
  gaps,
});
Zoom.beginLaunch({
  unit: other.unit,
  cursor: { x: 80, y: 90 },
  monitor: laptop,
  gaps,
});
assert.ok(Zoom.bindLaunchWindow("0x222"));
assert.strictEqual(Zoom.syncWindowFrames([
  { address: "0x222", at: [100, 200], size: [800, 500] },
  { address: "0x999", at: [1, 1], size: [10, 10] },
]), 1);
const moved = Zoom.beginClose("0x222", null);
assert.ok(moved);
assert.deepStrictEqual(geometry(moved.source), { x: 100, y: 200, width: 800, height: 500 });
assert.deepStrictEqual(geometry(moved.destination), geometry(other.source));
runClose(moved);

const narrowPlan = Zoom.launchPlan({
  unit: "app-Hyprland-imv-3.scope",
  cursor: { x: 116, y: 116 },
  monitor: laptop,
  gaps,
});
Zoom.beginLaunch({
  unit: narrowPlan.unit,
  cursor: { x: 116, y: 116 },
  monitor: laptop,
  gaps,
});
assert.deepStrictEqual(geometry(narrowPlan.source), { x: 100, y: 100, width: 32, height: 32 });
assert.ok(Zoom.bindLaunchWindow("0x333"));
const narrow = Zoom.beginClose("0x333", { address: "0x333", at: [0, 0], size: [20, 400] });
assert.ok(narrow, "narrow window was dropped");
assert.deepStrictEqual(geometry(narrow.source), { x: 0, y: 0, width: 20, height: 400 });
assert.ok(narrow.destination.width < narrow.source.width);
assert.ok(narrow.destination.height < narrow.source.height);
assert.strictEqual(narrow.destination.width, 10);
assert.strictEqual(narrow.destination.height, 32);
assert.strictEqual(narrow.destination.x, 111);
assert.strictEqual(narrow.destination.y, 100);
runClose(narrow);

Zoom.beginLaunch({
  unit: "app-Hyprland-foot-4.scope",
  cursor: { x: 400, y: 300 },
  monitor: laptop,
  gaps,
});
assert.ok(Zoom.bindLaunchWindow("0x444"));
assert.strictEqual(Zoom.forgetOpenSource("0x444"), true);
assert.strictEqual(Zoom.beginClose("0x444"), null);
assert.strictEqual(Zoom.hasOpenSources(), false);

Zoom.beginLaunch({
  unit: "app-Hyprland-foot-5.scope",
  cursor: { x: 400, y: 300 },
  monitor: laptop,
  gaps,
});
assert.ok(Zoom.bindLaunchWindow("0x555"));
const live = Zoom.beginLaunch({
  unit: "app-Hyprland-foot-6.scope",
  cursor: { x: 50, y: 60 },
  monitor: laptop,
  gaps,
});
assert.strictEqual(live.phase, "zoom");
assert.ok(Zoom.bindLaunchWindow("0x666"));
assert.strictEqual(Zoom.isLaunchWindow("0x555"), false);
assert.strictEqual(Zoom.isLaunchWindow("0x666"), true);
const earlier = Zoom.beginClose("0x555");
assert.ok(earlier);
assert.deepStrictEqual(geometry(earlier.destination), icon);
assert.strictEqual(Zoom.hasOpenSource("0x666"), true);
const during = Zoom.advanceLaunch();
assert.strictEqual(during.phase, "zoom");
Zoom.cancelClose();
assert.strictEqual(Zoom.advanceClose().phase, "idle");
assert.strictEqual(Zoom.hasOpenSource("0x666"), true);

console.log("pass zoom-close");
console.log(JSON.stringify({
  icon,
  closeToIcon: geometry(closed.destination),
  fromWindow: geometry(closed.source),
  steps: finished.guard,
}));
