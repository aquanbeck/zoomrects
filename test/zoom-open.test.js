"use strict";

const assert = require("assert");
const Zoom = require("../zoomrects.js");

const source = { x: 8, y: 16, width: 32, height: 32 };
const destination = { x: 40, y: 48, width: 800, height: 600 };

function edge(rect, name) {
  if (name === "left") return rect.x;
  if (name === "top") return rect.y;
  if (name === "right") return rect.x + rect.width;
  if (name === "bottom") return rect.y + rect.height;
  throw new Error("unknown edge " + name);
}

function expectedEdge(name, index, steps) {
  const from = edge(source, name);
  const to = edge(destination, name);
  if (index === 0) return from;
  if (index === steps) return to;
  return from + (to - from) * (index / steps);
}

function distinctOutlines(outlines) {
  const seen = new Set();
  for (const outline of outlines) {
    seen.add([outline.left, outline.top, outline.right, outline.bottom].join(","));
  }
  return seen.size;
}

function dump(sequence) {
  return {
    frames: sequence.frames.map((frame) => ({
      left: frame.left,
      top: frame.top,
      right: frame.right,
      bottom: frame.bottom,
      width: frame.width,
      height: frame.height,
      filled: frame.filled,
      stroke: frame.stroke,
    })),
    tickSizes: sequence.ticks.map((tick) => tick.length),
  };
}

const sequence = Zoom.zoomSequence(source, destination);
const again = Zoom.zoomSequence(source, destination);

assert.ok(sequence, "zoomSequence returned a sequence");
assert.deepStrictEqual(dump(sequence), dump(again), "sequence is deterministic");

const frames = sequence.frames;
const steps = frames.length - 1;
assert.ok(frames.length > 3, "more than one frame strictly between the endpoints");

const edges = ["left", "top", "right", "bottom"];
for (let i = 0; i < frames.length; i++) {
  const frame = frames[i];
  assert.strictEqual(frame.filled, false, "outline " + i + " is filled");
  assert.strictEqual(frame.stroke, true, "outline " + i + " is not a stroke");
  for (const name of edges) {
    assert.strictEqual(frame[name], expectedEdge(name, i, steps), name + " at frame " + i);
  }
  assert.strictEqual(frame.width, frame.right - frame.left);
  assert.strictEqual(frame.height, frame.bottom - frame.top);
  if (i > 0) {
    assert.ok(frame.width >= frames[i - 1].width, "width decreased at frame " + i);
    assert.ok(frame.height >= frames[i - 1].height, "height decreased at frame " + i);
  }
}

assert.deepStrictEqual(
  [frames[0].left, frames[0].top, frames[0].right, frames[0].bottom],
  [source.x, source.y, source.x + source.width, source.y + source.height],
);
assert.deepStrictEqual(
  [frames[frames.length - 1].left, frames[frames.length - 1].top, frames[frames.length - 1].right, frames[frames.length - 1].bottom],
  [destination.x, destination.y, destination.x + destination.width, destination.y + destination.height],
);

const middle = sequence.ticks[Math.floor(sequence.ticks.length / 2)];
assert.ok(middle.length > 1, "middle tick shows a single outline");
assert.ok(distinctOutlines(middle) > 1, "middle tick outlines are not distinct");

const printed = dump(sequence);
console.log("pass zoom-open");
console.log(JSON.stringify(printed));
