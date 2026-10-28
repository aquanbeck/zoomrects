"use strict";

const assert = require("assert");
const Zoom = require("../zoomrects.js");

function runToIdle(playback) {
  let guard = 0;
  while (playback && !playback.done) {
    playback.step();
    guard += 1;
    assert.ok(guard < 100, "playback did not finish");
  }
  return playback;
}

function geometry(rect) {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

const footEvent = Zoom.parseOpenWindow("0xaaa,2,foot,shell");
const browserEvent = Zoom.parseOpenWindow("0xbbb,3,chromium,docs, with comma");

assert.strictEqual(footEvent.address, "0xaaa");
assert.strictEqual(footEvent.workspace, "2");
assert.strictEqual(footEvent.className, "foot");
assert.strictEqual(footEvent.title, "shell");
assert.strictEqual(browserEvent.title, "docs, with comma");
assert.strictEqual(Object.hasOwn(footEvent, "width"), false);
assert.strictEqual(Object.hasOwn(footEvent, "height"), false);
assert.strictEqual(Zoom.openWindow(footEvent), null, "open payload without geometry invented a frame");

const clients = [
  {
    address: "0xAAA",
    at: [12, 38],
    size: [900, 700],
    class: "foot",
    title: "shell",
    workspace: { id: 2, name: "2" },
  },
  {
    address: "0xbbb",
    at: [420, 160],
    size: [640, 480],
    class: "chromium",
    title: "docs, with comma",
    workspace: { id: 3, name: "3" },
  },
];

const missing = Zoom.matchOpenedClients(clients, [Zoom.parseOpenWindow("0xccc,1,missing,nope")]);
assert.strictEqual(missing.ready.length, 0);
assert.strictEqual(missing.waiting.length, 1);
assert.strictEqual(missing.waiting[0].attempts, 1);

let stillMissing = [Zoom.parseOpenWindow("0xccc,1,missing,nope")];
for (let attempt = 0; attempt < Zoom.maxLookupAttempts(); attempt++) {
  stillMissing = Zoom.matchOpenedClients([], stillMissing).waiting;
}
assert.deepStrictEqual(stillMissing, [], "gave up by inventing a frame");

const matched = Zoom.matchOpenedClients(clients, [footEvent, browserEvent]);
assert.strictEqual(matched.waiting.length, 0);
assert.strictEqual(matched.ready.length, 2);

const foot = Zoom.openWindow(matched.ready[0]);
const browser = Zoom.openWindow(matched.ready[1]);
assert.ok(foot && browser, "open handler returned null for a window with geometry");

assert.deepStrictEqual(geometry(foot.destination), { x: 12, y: 38, width: 900, height: 700 });
assert.deepStrictEqual(geometry(browser.destination), { x: 420, y: 160, width: 640, height: 480 });
assert.notDeepStrictEqual(geometry(foot.destination), geometry(browser.destination));

for (const zoom of [foot, browser]) {
  assert.ok(zoom.source.width < zoom.destination.width, "source width is not smaller");
  assert.ok(zoom.source.height < zoom.destination.height, "source height is not smaller");
  assert.strictEqual(zoom.source.width, Zoom.iconSize());
  assert.strictEqual(zoom.source.height, Zoom.iconSize());
  assert.strictEqual(zoom.frames[0].filled, false);
  assert.strictEqual(zoom.frames[zoom.frames.length - 1].width, zoom.destination.width);
  assert.strictEqual(zoom.frames[zoom.frames.length - 1].height, zoom.destination.height);
}

// The classic sequence does not depend on which program was invoked.
// Same frame, three different classes: each plays, and the outlines match.
const shared = { at: [30, 40], size: [500, 360] };
const invoked = [
  Zoom.openWindow({ address: "0x101", class: "foot", title: "shell", ...shared }),
  Zoom.openWindow({ address: "0x102", class: "org.gnome.Nautilus", title: "Home", ...shared }),
  Zoom.openWindow({ address: "0x103", class: "some.other.Program", title: "Untitled", ...shared }),
];
assert.strictEqual(invoked.length, 3);
const invokedDump = Zoom.zoomSequence(
  { x: invoked[0].source.x, y: invoked[0].source.y, width: invoked[0].source.width, height: invoked[0].source.height },
  geometry(invoked[0].destination),
);
for (const zoom of invoked) {
  assert.deepStrictEqual(geometry(zoom.destination), { x: 30, y: 40, width: 500, height: 360 });
  assert.strictEqual(zoom.frames.length, invokedDump.frames.length);
  assert.deepStrictEqual(
    zoom.frames.map((frame) => [frame.left, frame.top, frame.right, frame.bottom, frame.filled]),
    invokedDump.frames.map((frame) => [frame.left, frame.top, frame.right, frame.bottom, frame.filled]),
  );
}

const narrow = Zoom.openWindow({ address: "0xddd", at: [0, 0], size: [20, 400], class: "imv" });
assert.ok(narrow, "narrow window was dropped");
assert.ok(narrow.source.width < narrow.destination.width);
assert.ok(narrow.source.height < narrow.destination.height);
assert.ok(narrow.source.width < Zoom.iconSize());
assert.strictEqual(narrow.source.height, Zoom.iconSize());

runToIdle(foot);
runToIdle(browser);
assert.deepStrictEqual(foot.outlines, []);
assert.deepStrictEqual(browser.outlines, []);
assert.strictEqual(foot.done, true);
assert.strictEqual(browser.done, true);

const played = Zoom.beginOpen(matched.ready[0]);
assert.deepStrictEqual(geometry(played.destination), { x: 12, y: 38, width: 900, height: 700 });
let guard = 0;
let cursor = played;
while (!cursor.done) {
  cursor = Zoom.advanceOpen();
  guard += 1;
  assert.ok(guard < 100, "service advance did not finish");
}
assert.deepStrictEqual(cursor.outlines, []);
assert.deepStrictEqual(Zoom.advanceOpen().outlines, []);

console.log("pass zoom-open-window");
console.log(JSON.stringify({
  foot: { destination: geometry(foot.destination), source: geometry(foot.source), idleOutlines: foot.outlines.length },
  browser: { destination: geometry(browser.destination), source: geometry(browser.source), idleOutlines: browser.outlines.length },
  payloadHasFrame: false,
}));
