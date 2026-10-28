"use strict";

const assert = require("assert");
const Zoom = require("../zoomrects.js");

function geometry(rect) {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function runWindow(started) {
  let cursor = started;
  let guard = 0;
  while (cursor && cursor.phase === "zoom") {
    cursor = Zoom.advanceNewWindow();
    guard += 1;
    assert.ok(guard < 100, "new-window playback did not finish");
  }
  return { cursor, guard };
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
const evolution = "org.gnome.Evolution";

assert.strictEqual(Zoom.zoomGrowSteps(), 8);
assert.strictEqual(Zoom.zoomAdvances(), Zoom.zoomGrowSteps() + 4);
assert.strictEqual(Zoom.defaultNewWindows(), true);
assert.strictEqual(Zoom.newWindowsFromConfig(""), true);
assert.strictEqual(Zoom.newWindowsFromConfig("   "), true);
assert.strictEqual(Zoom.newWindowsFromConfig("{}"), true);
assert.strictEqual(Zoom.newWindowsFromConfig("nope"), true);
assert.strictEqual(Zoom.newWindowsFromConfig("null"), true);
assert.strictEqual(Zoom.newWindowsFromConfig("[]"), true);
assert.strictEqual(Zoom.newWindowsFromConfig('{"durationSec":0.05}'), true);
assert.strictEqual(Zoom.newWindowsFromConfig('{"newWindows":true}'), true);
assert.strictEqual(Zoom.newWindowsFromConfig('{"newWindows":false}'), false);
assert.strictEqual(Zoom.newWindowsFromConfig('{"newWindows":"true"}'), true);
assert.strictEqual(Zoom.newWindowsFromConfig('{"newWindows":0}'), true);
assert.strictEqual(Zoom.newWindowsFromConfig('{"newWindows":null}'), true);
assert.strictEqual(Zoom.durationFromConfig('{"newWindows":false}'), 0.1);
assert.strictEqual(Zoom.durationFromConfig('{"durationSec":0.05,"newWindows":true}'), 0.05);
assert.strictEqual(Zoom.durationFromConfig('{"durationSec":2,"newWindows":false}'), 0.5);
assert.strictEqual(Zoom.durationFromConfig(""), 0.1);

assert.strictEqual(Zoom.isToolbarWindow(null), false);
assert.strictEqual(Zoom.isToolbarWindow({}), false);
assert.strictEqual(Zoom.isToolbarWindow({ title: "Inbox (3 unread)", className: evolution }), false);
assert.strictEqual(Zoom.isToolbarWindow({ title: "Compose Message", className: evolution }), false);
assert.strictEqual(Zoom.isToolbarWindow({ attached: true, className: evolution, title: "Inbox" }), true);
assert.strictEqual(Zoom.isToolbarWindow({ parent: {}, className: evolution }), true);
assert.strictEqual(Zoom.isToolbarWindow({ xdgTag: "toolbar" }), true);
assert.strictEqual(Zoom.isToolbarWindow({ xdgTag: "TOOLBAR" }), true);
assert.strictEqual(Zoom.isToolbarWindow({ windowType: "utility" }), true);
assert.strictEqual(Zoom.isToolbarWindow({ windowType: "menu" }), true);
assert.strictEqual(Zoom.isToolbarWindow({ role: "tooltip" }), true);
assert.strictEqual(Zoom.isToolbarWindow({ type: "dock" }), true);
assert.strictEqual(Zoom.isToolbarWindow({ xdgTag: "splash" }), true);
assert.strictEqual(Zoom.isToolbarWindow({ xdgTag: "popup" }), true);
assert.strictEqual(Zoom.isToolbarWindow({ xdgTag: "combo" }), true);
assert.strictEqual(Zoom.isToolbarWindow({ xdgTag: "dropdown" }), true);
assert.strictEqual(Zoom.isToolbarWindow({ xdgTag: "notification" }), true);
assert.strictEqual(Zoom.isToolbarWindow({ xdgTag: "tool-bar" }), true);
assert.strictEqual(Zoom.isToolbarWindow({ className: "panel-toolbar" }), true);
assert.strictEqual(Zoom.isToolbarWindow({ className: "tip-tooltip" }), true);
assert.strictEqual(Zoom.isToolbarWindow({ title: "Toolbar" }), true);
assert.strictEqual(Zoom.isToolbarWindow({ title: "  Tooltip  " }), true);
assert.strictEqual(Zoom.isToolbarWindow({ title: "My Toolbar" }), false);
assert.strictEqual(Zoom.isToolbarWindow({ xdgDescription: "main toolbar" }), true);
assert.strictEqual(Zoom.isToolbarWindow({ tags: ["toolbar*"] }), true);
assert.strictEqual(Zoom.isToolbarWindow({ tags: ["tiled"] }), false);
assert.strictEqual(Zoom.isToolbarWindow({ windowType: "none", className: evolution }), false);

const bare = Zoom.launchPlan({
  unit: "app-Hyprland-gtk-launch-noclass.scope",
  cursor: { x: 400, y: 300 },
  monitor: laptop,
  gaps,
});
Zoom.beginLaunch({
  unit: bare.unit,
  cursor: { x: 400, y: 300 },
  monitor: laptop,
  gaps,
});
assert.ok(Zoom.bindLaunchWindow("0xNOCLASS"));
assert.strictEqual(Zoom.programHasIcon(evolution), false);
assert.strictEqual(Zoom.programHasIcon(""), false);

const plan = Zoom.launchPlan({
  unit: "app-Hyprland-gtk-launch-evolution.scope",
  cursor: { x: 400, y: 300 },
  monitor: laptop,
  gaps,
});
const icon = geometry(plan.source);
Zoom.beginLaunch({
  unit: plan.unit,
  cursor: { x: 400, y: 300 },
  monitor: laptop,
  gaps,
});
const bound = Zoom.bindLaunchWindow("0xLOAD", evolution);
assert.ok(bound);
assert.strictEqual(bound.className, evolution);
assert.deepStrictEqual(geometry(bound.source), icon);
assert.strictEqual(Zoom.programHasIcon(evolution), true);
assert.strictEqual(Zoom.programHasIcon("org.gnome.evolution"), false);
assert.strictEqual(Zoom.bindLaunchWindow("0xSECOND", evolution), null);

const composer = {
  address: "0xNEW",
  className: evolution,
  title: "Compose Message",
  at: [12, 38],
  size: [800, 600],
};

assert.strictEqual(Zoom.shouldZoomNewWindow(false, false, composer), false);
assert.strictEqual(Zoom.shouldZoomNewWindow(true, true, composer), false);
assert.strictEqual(Zoom.shouldZoomNewWindow(true, false, {
  address: "0xLOAD",
  className: evolution,
  at: [12, 38],
  size: [800, 600],
}), false);
assert.strictEqual(Zoom.shouldZoomNewWindow(true, false, {
  address: "0xOTHER",
  className: "no.such.App",
  at: [12, 38],
  size: [800, 600],
}), false);
assert.strictEqual(Zoom.shouldZoomNewWindow(true, false, {
  address: "0xBAR",
  className: evolution,
  title: "Toolbar",
  at: [12, 38],
  size: [800, 600],
}), false);
assert.strictEqual(Zoom.shouldZoomNewWindow(true, false, {
  address: "0xPARENT",
  className: evolution,
  title: "Inbox",
  attached: true,
  at: [12, 38],
  size: [800, 600],
}), false);
assert.strictEqual(Zoom.beginNewWindow({ address: "0xNF", className: evolution }), null);
assert.strictEqual(Zoom.hasOpenSource("0xNF"), false);
assert.strictEqual(Zoom.beginNewWindow({
  address: "0xBAR",
  className: evolution,
  title: "Toolbar",
  at: [1, 1],
  size: [200, 40],
}), null);

assert.strictEqual(Zoom.shouldZoomNewWindow(true, false, composer), true);
assert.strictEqual(Zoom.shouldZoomNewWindow(true, false, {
  address: "0xCLASS",
  class: evolution,
  title: "Inbox (3 unread)",
  at: [20, 30],
  size: [500, 400],
}), true);

const started = Zoom.beginNewWindow(composer);
assert.ok(started, "later window did not zoom");
assert.strictEqual(started.phase, "zoom");
assert.strictEqual(started.address, "new");
assert.deepStrictEqual(geometry(started.source), icon);
assert.deepStrictEqual(geometry(started.destination), { x: 12, y: 38, width: 800, height: 600 });
assert.ok(started.outlines.length > 0);
assert.strictEqual(started.outlines[0].filled, false);
assert.strictEqual(started.outlines[0].stroke, true);
assert.deepStrictEqual(geometry(started.outlines[0]), icon);
assert.strictEqual(Zoom.hasOpenSource("0xNEW"), true);

const sequence = Zoom.zoomSequence(started.source, started.destination);
assert.strictEqual(sequence.frames[0].width, icon.width);
assert.strictEqual(sequence.frames[0].height, icon.height);
assert.strictEqual(sequence.frames[sequence.frames.length - 1].width, 800);
assert.strictEqual(sequence.frames[sequence.frames.length - 1].height, 600);
for (let i = 1; i < sequence.frames.length; i++) {
  assert.ok(sequence.frames[i].width >= sequence.frames[i - 1].width, "width shrank while opening");
  assert.ok(sequence.frames[i].height >= sequence.frames[i - 1].height, "height shrank while opening");
  assert.strictEqual(sequence.frames[i].filled, false);
  assert.strictEqual(sequence.frames[i].stroke, true);
}

const beside = {
  address: "0xBESIDE",
  className: evolution,
  title: "Calendar",
  at: [40, 50],
  size: [640, 480],
};
const placed = Zoom.placeNewWindow(beside);
assert.ok(placed, "a window beside a trail was dropped");
assert.strictEqual(Zoom.hasOpenSource("0xBESIDE"), true);
assert.strictEqual(started.phase, "zoom");

const finished = runWindow(started);
assert.strictEqual(finished.guard, Zoom.zoomAdvances());
assert.strictEqual(finished.cursor.phase, "idle");
assert.strictEqual(finished.cursor.done, true);
assert.deepStrictEqual(finished.cursor.outlines, []);
assert.strictEqual(Zoom.hasOpenSource("0xNEW"), true);
assert.deepStrictEqual(Zoom.advanceNewWindow().outlines, []);

const closed = Zoom.beginClose("0xNEW", composer);
assert.ok(closed, "later window did not shrink back");
assert.strictEqual(closed.phase, "zoom");
assert.deepStrictEqual(geometry(closed.source), { x: 12, y: 38, width: 800, height: 600 });
assert.deepStrictEqual(geometry(closed.destination), icon);
assert.ok(closed.destination.width < closed.source.width);
assert.ok(closed.destination.height < closed.source.height);
const closedRun = runClose(closed);
assert.strictEqual(closedRun.guard, Zoom.zoomAdvances());
assert.strictEqual(Zoom.hasOpenSource("0xNEW"), false);

const again = Zoom.beginNewWindow(beside);
assert.strictEqual(again, null, "a placed window zoomed a second time");
const besideClose = Zoom.beginClose("0xBESIDE", beside);
assert.ok(besideClose);
assert.deepStrictEqual(geometry(besideClose.destination), icon);
runClose(besideClose);

Zoom.beginNewWindow({
  address: "0xCANCEL",
  className: evolution,
  title: "Tasks",
  at: [8, 8],
  size: [300, 200],
});
Zoom.cancelNewWindow();
assert.strictEqual(Zoom.advanceNewWindow().phase, "idle");
assert.strictEqual(Zoom.hasOpenSource("0xCANCEL"), true);
const afterCancel = Zoom.beginClose("0xCANCEL", {
  address: "0xCANCEL",
  at: [8, 8],
  size: [300, 200],
});
assert.ok(afterCancel);
runClose(afterCancel);

console.log("pass zoom-new-window");
