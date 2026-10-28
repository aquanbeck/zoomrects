"use strict";

const assert = require("assert");
const Zoom = require("../zoomrects.js");

function geometry(rect) {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

const gtkLaunch = "app-Hyprland-gtk\\x2dlaunch-11111111.scope";
const terminal = "app-Hyprland-xdg\\x2dterminal\\x2dexec-22222222.scope";
const browser = "app-Hyprland-firefox-abc123.scope";
const watcher = "app-Hyprland-omarchy\\x2dhyprland\\x2dmonitor\\x2dwatch-33333333.scope";
const disks = "app-Hyprland-udiskie-44444444.scope";
const transient = "run-p100-i200.scope";

assert.strictEqual(Zoom.isUserLaunchUnit(gtkLaunch), true);
assert.strictEqual(Zoom.isUserLaunchUnit(terminal), true);
assert.strictEqual(Zoom.isUserLaunchUnit(browser), true);
assert.strictEqual(Zoom.isUserLaunchUnit(watcher), false);
assert.strictEqual(Zoom.isUserLaunchUnit(disks), false);
assert.strictEqual(Zoom.isUserLaunchUnit(transient), false);

const monitorLines = [
  "Monitoring bus message stream.",
  "‣ Type=signal  Endian=l  Flags=1  Version=1 Cookie=153",
  "  Sender=:1.3  Path=/org/freedesktop/systemd1  Interface=org.freedesktop.systemd1.Manager  Member=UnitNew",
  "  MESSAGE \"so\" {",
  `          STRING "${gtkLaunch}";`,
  "          OBJECT_PATH \"/org/freedesktop/systemd1/unit/ignored\";",
  "  };",
  "  Member=UnitNew",
  "  MESSAGE \"so\" {",
  `          STRING "${disks}";`,
  "  };",
  "  Member=UnitNew",
  "  MESSAGE \"so\" {",
  `          STRING "${transient}";`,
  "  };",
];

let parser = { expecting: false };
const seen = [];
for (const line of monitorLines) {
  const step = Zoom.readSystemdLine(parser, line);
  parser = step.state;
  if (step.unit) seen.push(step.unit);
}
assert.deepStrictEqual(seen, [gtkLaunch]);

assert.strictEqual(Zoom.shouldStartLaunch(1000, 900, true), false);
assert.strictEqual(Zoom.shouldStartLaunch(1000, 1000 - Zoom.launchBurstMs(), true), true);
assert.strictEqual(Zoom.shouldStartLaunch(1000, 0, false), true);

const slack = Zoom.scopeStartSlackUs();
assert.strictEqual(slack, 60000000);
assert.strictEqual(Zoom.scopeStartIsRecent(1000000, 0, slack), true);
assert.strictEqual(Zoom.scopeStartIsRecent(1000000, NaN, slack), true);
assert.strictEqual(Zoom.scopeStartIsRecent(NaN, 50, slack), true);
assert.strictEqual(Zoom.scopeStartIsRecent(1000000, 1000001, slack), true);
assert.strictEqual(Zoom.scopeStartIsRecent(200000000, 100000000, slack), false);
assert.strictEqual(Zoom.scopeStartIsRecent(1000 + slack, 1000, slack), true);
assert.strictEqual(Zoom.scopeStartIsRecent(1000 + slack + 1, 1000, slack), false);

const fresh = Zoom.parseScopeAge([
  "noise",
  "Unit=app-Hyprland-old.scope",
  "NowUs=1",
  "ActiveEnterTimestampMonotonic=1",
  "Unit=app-Hyprland-xdg-terminal-exec-1.scope",
  "NowUs=5000000",
  "ActiveEnterTimestampMonotonic=4900000",
  "ActiveState=active",
  "LoadState=loaded",
].join("\n"));
assert.strictEqual(fresh.unit, "app-Hyprland-xdg-terminal-exec-1.scope");
assert.strictEqual(fresh.enteredUs, 4900000);
assert.strictEqual(Zoom.scopeShouldPresent(fresh, slack), true);
assert.strictEqual(Zoom.scopeShouldPresent({
  unit: "app-Hyprland-xdg-terminal-exec-55555555.scope",
  nowUs: 200000000,
  enteredUs: 100000000,
  activeState: "active",
  loadState: "loaded",
}, slack), false);
assert.strictEqual(Zoom.scopeShouldPresent({
  unit: "app-Hyprland-gtk-launch-1.scope",
  nowUs: 100,
  enteredUs: 0,
  activeState: "activating",
  loadState: "loaded",
}, slack), true);
assert.strictEqual(Zoom.scopeShouldPresent({
  unit: "gone.scope",
  nowUs: 100,
  enteredUs: 0,
  activeState: "inactive",
  loadState: "not-found",
}, slack), false);
assert.strictEqual(Zoom.scopeShouldPresent({
  unit: "stopped.scope",
  nowUs: 100,
  enteredUs: 0,
  activeState: "inactive",
  loadState: "loaded",
}, slack), false);
assert.strictEqual(Zoom.scopeShouldPresent({
  unit: "app-Hyprland-gtk-launch-fast.scope",
  nowUs: 5000000,
  enteredUs: 4500000,
  activeState: "inactive",
  loadState: "loaded",
}, slack), true);
assert.strictEqual(Zoom.scopeShouldPresent(null, slack), false);
assert.ok(Zoom.scopeAgeScript().indexOf("ActiveEnterTimestampMonotonic") !== -1);
assert.ok(Zoom.scopeAgeScript().indexOf("/proc/uptime") !== -1);

const laptop = {
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  reserved: [0, 26, 0, 0],
  focused: true,
};
const side = {
  x: 1920,
  y: 0,
  width: 1280,
  height: 800,
  reserved: [0, 0, 0, 0],
  focused: true,
};
const gaps = { css: "10 10 10 10" };

const fromPointer = Zoom.launchPlan({
  unit: "app-Hyprland-gtk-launch-1.scope",
  cursor: { x: 400, y: 300 },
  monitor: laptop,
  gaps,
});
const otherScreen = Zoom.launchPlan({
  unit: "app-Hyprland-firefox-2.scope",
  cursor: { x: 2000, y: 100 },
  monitor: side,
  gaps,
});

assert.ok(fromPointer && otherScreen);
assert.deepStrictEqual(geometry(fromPointer.source), { x: 384, y: 284, width: 32, height: 32 });
assert.deepStrictEqual(geometry(fromPointer.destination), {
  x: 10,
  y: 36,
  width: 1920 - 20,
  height: 1080 - 26 - 20,
});
assert.notDeepStrictEqual(geometry(fromPointer.destination), geometry(otherScreen.destination));
assert.ok(fromPointer.source.width < fromPointer.destination.width);
assert.ok(fromPointer.source.height < fromPointer.destination.height);

const sequence = Zoom.zoomSequence(fromPointer.source, fromPointer.destination);
assert.strictEqual(sequence.frames[0].width, 32);
assert.strictEqual(sequence.frames[sequence.frames.length - 1].width, fromPointer.destination.width);
assert.ok(sequence.frames.length > 3);
for (let i = 1; i < sequence.frames.length; i++) {
  assert.ok(sequence.frames[i].width >= sequence.frames[i - 1].width);
  assert.ok(sequence.frames[i].height >= sequence.frames[i - 1].height);
  assert.strictEqual(sequence.frames[i].filled, false);
}

const parsed = Zoom.parseLaunchContext(
  [
    "CURSOR",
    JSON.stringify({ x: 400, y: 300 }),
    "MONITORS",
    JSON.stringify([
      { name: "off", x: 0, y: 0, width: 800, height: 600, reserved: [0, 0, 0, 0], focused: false },
      laptop,
    ]),
    "GAPS",
    JSON.stringify({ option: "general:gaps_out", css: "10 10 10 10" }),
    "",
  ].join("\n"),
);
assert.strictEqual(parsed.monitor.width, 1920);
assert.strictEqual(parsed.cursor.x, 400);

const started = Zoom.beginLaunch({ ...parsed, unit: seen[0] });
assert.strictEqual(started.phase, "zoom");
assert.strictEqual(started.showWatch, false);
assert.ok(started.outlines.length > 0);
assert.deepStrictEqual(geometry(started.destination), geometry(fromPointer.destination));

let cursor = started;
let guard = 0;
while (cursor.phase === "zoom") {
  cursor = Zoom.advanceLaunch();
  guard += 1;
  assert.ok(guard < 100);
}
assert.strictEqual(guard, Zoom.zoomAdvances());
assert.strictEqual(cursor.phase, "idle");
assert.strictEqual(cursor.showWatch, false);
assert.deepStrictEqual(cursor.outlines, []);
assert.strictEqual(Zoom.launchPanelOpen("open"), true);
assert.strictEqual(Zoom.launchPanelOpen(" open\n"), true);
assert.strictEqual(Zoom.launchPanelOpen("closed"), false);
assert.strictEqual(Zoom.launchPanelOpen(""), false);
assert.strictEqual(Zoom.shouldShowLaunchPanel(false), true);
assert.strictEqual(Zoom.shouldShowLaunchPanel(true), false);
assert.deepStrictEqual(Zoom.launchingPanelPayload(""), {
  icon: "󱓞",
  message: "Launching…",
  duration: 0,
});
assert.strictEqual(Zoom.launchingPanelPayload("GIMP").message, "Launching GIMP…");

const fast = Zoom.beginLaunch({
  unit: "app-Hyprland-gtk-launch-fast.scope",
  cursor: { x: 80, y: 80 },
  monitor: laptop,
  gaps,
});
assert.strictEqual(fast.phase, "zoom");
const during = Zoom.noteProgramArrived();
assert.strictEqual(during.phase, "zoom");
assert.strictEqual(during.showWatch, false);
let after = during;
guard = 0;
while (after.phase === "zoom") {
  after = Zoom.advanceLaunch();
  assert.ok(++guard < 100);
}
assert.strictEqual(after.phase, "idle");
assert.strictEqual(after.showWatch, false);

assert.strictEqual(Zoom.defaultDurationSec(), 0.1);
assert.strictEqual(Zoom.durationFromConfig(""), 0.1);
assert.strictEqual(Zoom.durationFromConfig("nope"), 0.1);
assert.strictEqual(Zoom.durationFromConfig("{}"), 0.1);
assert.strictEqual(Zoom.durationFromConfig('{"durationSec":0.05}'), 0.05);
assert.strictEqual(Zoom.durationFromConfig('{"durationSec":2}'), 0.5);
assert.strictEqual(Zoom.durationFromConfig('{"durationSec":0.001}'), 0.01);
assert.strictEqual(Zoom.tickIntervalMs(), 8);
assert.strictEqual(Zoom.tickIntervalFor(0.01), 1);
assert.strictEqual(Zoom.tickIntervalFor(0.5), 42);
assert.strictEqual(Zoom.tickIntervalMs() * Zoom.zoomAdvances(), 96);

console.log("pass zoom-launch");
console.log(JSON.stringify({
  launches: seen,
  pointer: geometry(fromPointer.source),
  workArea: geometry(fromPointer.destination),
  otherScreen: geometry(otherScreen.destination),
  watchAfterZoom: false,
}));
