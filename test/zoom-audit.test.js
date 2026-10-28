"use strict";

const assert = require("assert");
const Zoom = require("../zoomrects.js");

function geometry(rect) {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

assert.strictEqual(Zoom.defaultDurationSec(), 0.1);
assert.strictEqual(Zoom.minDurationSec(), 0.01);
assert.strictEqual(Zoom.maxDurationSec(), 0.5);

assert.strictEqual(Zoom.durationFromConfig(null), Zoom.defaultDurationSec());
assert.strictEqual(Zoom.durationFromConfig(""), Zoom.defaultDurationSec());
assert.strictEqual(Zoom.durationFromConfig("   "), Zoom.defaultDurationSec());
assert.strictEqual(Zoom.durationFromConfig("not json"), Zoom.defaultDurationSec());
assert.strictEqual(Zoom.durationFromConfig("null"), Zoom.defaultDurationSec());
assert.strictEqual(Zoom.durationFromConfig("[]"), Zoom.defaultDurationSec());
assert.strictEqual(Zoom.durationFromConfig("{}"), Zoom.defaultDurationSec());
assert.strictEqual(Zoom.durationFromConfig('{"durationSec":"fast"}'), Zoom.defaultDurationSec());

const inside = Zoom.durationFromConfig('{"durationSec":0.05}');
assert.strictEqual(inside, 0.05);
assert.ok(inside >= Zoom.minDurationSec() && inside <= Zoom.maxDurationSec());

assert.strictEqual(Zoom.durationFromConfig('{"durationSec":0.001}'), 0.01);
assert.strictEqual(Zoom.durationFromConfig('{"durationSec":0.001}'), Zoom.minDurationSec());
assert.strictEqual(Zoom.durationFromConfig('{"durationSec":9}'), 0.5);
assert.strictEqual(Zoom.durationFromConfig('{"durationSec":9}'), Zoom.maxDurationSec());
assert.strictEqual(Zoom.tickIntervalFor(Zoom.minDurationSec()) >= 1, true);
assert.strictEqual(Zoom.tickIntervalMs(), Zoom.tickIntervalFor(Zoom.defaultDurationSec()));

assert.strictEqual(Zoom.frameFromRecord(null), null);
assert.strictEqual(Zoom.frameFromRecord({}), null);
assert.strictEqual(Zoom.frameFromRecord({ address: "0x1", class: "gimp", title: "GNU Image Manipulation Program" }), null);
assert.strictEqual(Zoom.frameFromRecord({ at: [0, 0], size: [0, 10] }), null);
assert.strictEqual(Zoom.openWindow({ address: "0x1", workspace: "1", className: "gimp", title: "GIMP" }), null);
assert.strictEqual(Zoom.beginLaunch(null), null);
assert.strictEqual(Zoom.beginLaunch({}), null);
assert.strictEqual(Zoom.beginLaunch({ cursor: { x: 1, y: 1 }, unit: "app-Hyprland-gtk-launch-1.scope" }), null);

const waiting = Zoom.parseLaunchContext("not compositor output");
assert.strictEqual(waiting.monitor, null);
assert.strictEqual(Zoom.beginLaunch(waiting), null);

let requestedWhenArrived = null;
if (Zoom.shouldShowLaunchPanel(true)) requestedWhenArrived = Zoom.launchingPanelPayload("");
assert.strictEqual(requestedWhenArrived, null);
let requestedWhileWaiting = null;
if (Zoom.shouldShowLaunchPanel(false)) requestedWhileWaiting = Zoom.launchingPanelPayload("");
assert.ok(requestedWhileWaiting);
assert.strictEqual(requestedWhileWaiting.duration, 0);
assert.strictEqual(requestedWhileWaiting.message, "Launching…");

assert.deepStrictEqual(Zoom.readSystemdLine(null, null).state, { expecting: false });
assert.strictEqual(Zoom.readSystemdLine({ expecting: false }, "not an event").unit, "");

const record = { address: "0xabc", at: [8, 16], size: [640, 480], class: "gimp", title: "Untitled" };
const frame = Zoom.frameFromRecord(record);
assert.deepStrictEqual(geometry(frame), { x: 8, y: 16, width: 640, height: 480 });
const zoom = Zoom.openWindow(record);
assert.ok(zoom);
assert.strictEqual(zoom.frames[0].filled, false);
assert.ok(zoom.source.width < zoom.destination.width);
assert.ok(zoom.source.height < zoom.destination.height);

console.log("pass zoom-audit");
console.log(JSON.stringify({
  defaultDurationSec: Zoom.defaultDurationSec(),
  minDurationSec: Zoom.minDurationSec(),
  maxDurationSec: Zoom.maxDurationSec(),
  missingGeometry: Zoom.openWindow({ address: "0x1" }) === null,
  panelAfterTrailOnly: Zoom.shouldShowLaunchPanel(false) === true && Zoom.shouldShowLaunchPanel(true) === false,
}));
