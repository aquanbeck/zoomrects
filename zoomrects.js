// Classic Mac OS launch feedback, as far as it fits on Omarchy.
// ZoomRects play when the user launches a program, from an icon-sized
// rectangle at the pointer to the work area that window will open on.
// When that window closes, the same outlines shrink back to the icon
// rectangle stored for the launch. A window with no stored icon does
// not play a close trail. After that load has finished, a later
// non-toolbar window of the same program can grow from the stored icon
// to its own rectangle and shrink back on close. The watch is not part
// of the zoom: the shell shows it only while Omarchy's Launching panel
// is open. This module has no Quickshell, Wayland, or filesystem access.

var ICON_SIZE = 32;
var FRAME_INTERVALS = 8;
var TRAIL = 4;
// Full zoom, from the first outline to the last.
var DEFAULT_DURATION_SEC = 0.1;
var MIN_DURATION_SEC = 0.01;
var MAX_DURATION_SEC = 0.5;
var MAX_LOOKUPS = 8;
var LAUNCH_BURST_MS = 800;
var WATCH_LIMIT_MS = 15000;

// uwsm session helpers that are not a program the user just invoked.
var SESSION_HELPERS = {
  "udiskie": true,
  "omarchy-hyprland-monitor-watch": true,
  "hyprsunset": true,
  "omarchy-shell": true,
  "xdg-desktop-portal": true,
  "xdg-desktop-portal-hyprland": true,
  "xdg-desktop-portal-gtk": true
};

var active = null;
// Icon rectangle for each window this plugin zoomed open, keyed by
// normalized address. The close trail ends on that icon.
var openSources = {};
var closing = null;
// Icon for each program that has already played its load trail, keyed by
// window class. A later window of that program can zoom from this icon.
var programs = {};
var opening = null;
// Later windows are on unless the config file says otherwise.
var DEFAULT_NEW_WINDOWS = true;

function zoomAdvances() {
  return FRAME_INTERVALS + TRAIL;
}

// Steps spent growing. The rest of zoomAdvances() is the trail draining.
// A later window is shown once the rectangles have reached it.
function zoomGrowSteps() {
  return FRAME_INTERVALS;
}

function defaultDurationSec() {
  return DEFAULT_DURATION_SEC;
}

function minDurationSec() {
  return MIN_DURATION_SEC;
}

function maxDurationSec() {
  return MAX_DURATION_SEC;
}

function clampDuration(seconds) {
  var n = Number(seconds);
  if (!isFinite(n)) return DEFAULT_DURATION_SEC;
  if (n < MIN_DURATION_SEC) return MIN_DURATION_SEC;
  if (n > MAX_DURATION_SEC) return MAX_DURATION_SEC;
  return n;
}

function readConfigObject(text) {
  var parsed;
  if (text == null || String(text).trim() === "") return null;
  try {
    parsed = JSON.parse(String(text));
  } catch (e) {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed;
}

function durationFromConfig(text) {
  var parsed = readConfigObject(text);
  if (!parsed || parsed.durationSec == null) return DEFAULT_DURATION_SEC;
  return clampDuration(parsed.durationSec);
}

function defaultNewWindows() {
  return DEFAULT_NEW_WINDOWS;
}

// Missing, unreadable, or non-boolean newWindows keeps the default.
// Only a JSON boolean false turns the later-window trails off.
function newWindowsFromConfig(text) {
  var parsed = readConfigObject(text);
  if (!parsed || typeof parsed.newWindows !== "boolean") return DEFAULT_NEW_WINDOWS;
  return parsed.newWindows;
}

function tickIntervalFor(durationSec) {
  var ms = Math.round(clampDuration(durationSec) * 1000 / zoomAdvances());
  if (!isFinite(ms) || ms < 1) return 1;
  return ms;
}

function tickIntervalMs() {
  return tickIntervalFor(DEFAULT_DURATION_SEC);
}

function iconSize() {
  return ICON_SIZE;
}

function maxLookupAttempts() {
  return MAX_LOOKUPS;
}

function launchBurstMs() {
  return LAUNCH_BURST_MS;
}

function watchLimitMs() {
  return WATCH_LIMIT_MS;
}

function launchPanelOpen(stateText) {
  return String(stateText == null ? "" : stateText).trim().toLowerCase() === "open";
}

function shouldShowLaunchPanel(windowAlreadyArrived) {
  return windowAlreadyArrived !== true;
}

function launchingPanelPayload(name) {
  var label = String(name || "").trim();
  return {
    icon: "󱓞",
    message: label ? "Launching " + label + "…" : "Launching…",
    duration: 0
  };
}

function rect(x, y, width, height) {
  return {
    x: x,
    y: y,
    width: width,
    height: height,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
    filled: false,
    stroke: true
  };
}

function cloneRect(source) {
  return rect(source.x, source.y, source.width, source.height);
}

function finiteNumber(value) {
  var n = Number(value);
  if (!isFinite(n)) return null;
  return n;
}

function asRect(value) {
  if (!value) return null;
  if (value.left != null && value.top != null && value.right != null && value.bottom != null) {
    return rect(Number(value.left), Number(value.top), Number(value.right) - Number(value.left), Number(value.bottom) - Number(value.top));
  }
  if (value.x != null && value.y != null && value.width != null && value.height != null) {
    return rect(Number(value.x), Number(value.y), Number(value.width), Number(value.height));
  }
  return null;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpRect(source, destination, t) {
  var left = lerp(source.left, destination.left, t);
  var top = lerp(source.top, destination.top, t);
  var right = lerp(source.right, destination.right, t);
  var bottom = lerp(source.bottom, destination.bottom, t);
  return rect(left, top, right - left, bottom - top);
}

function buildFrames(source, destination) {
  var frames = [];
  var steps = FRAME_INTERVALS;
  var i;
  for (i = 0; i <= steps; i++) {
    if (i === 0) frames.push(cloneRect(source));
    else if (i === steps) frames.push(cloneRect(destination));
    else frames.push(lerpRect(source, destination, i / steps));
  }
  return frames;
}

function visibleTrail(frames, index) {
  var start = index - TRAIL + 1;
  var visible = [];
  var j;
  if (start < 0) start = 0;
  for (j = start; j <= index; j++) visible.push(frames[j]);
  return visible;
}

function buildTicks(frames) {
  var ticks = [];
  var i;
  var draining;
  for (i = 0; i < frames.length; i++) ticks.push(visibleTrail(frames, i));
  draining = ticks[ticks.length - 1].slice();
  while (draining.length > 0) {
    draining = draining.slice(1);
    ticks.push(draining.slice());
  }
  return ticks;
}

function zoomSequence(source, destination) {
  var from = asRect(source);
  var to = asRect(destination);
  var frames;
  var ticks;
  if (!from || !to) return null;
  if (!(from.width > 0) || !(from.height > 0) || !(to.width > 0) || !(to.height > 0)) return null;
  frames = buildFrames(from, to);
  ticks = buildTicks(frames);
  return {
    source: from,
    destination: to,
    frames: frames,
    ticks: ticks
  };
}

function frameFromRecord(record) {
  var x;
  var y;
  var width;
  var height;
  if (!record) return null;
  if (record.at && record.size && record.at.length >= 2 && record.size.length >= 2) {
    x = finiteNumber(record.at[0]);
    y = finiteNumber(record.at[1]);
    width = finiteNumber(record.size[0]);
    height = finiteNumber(record.size[1]);
  } else if (record.x != null && record.y != null && record.width != null && record.height != null) {
    x = finiteNumber(record.x);
    y = finiteNumber(record.y);
    width = finiteNumber(record.width);
    height = finiteNumber(record.height);
  } else {
    return null;
  }
  if (x == null || y == null || width == null || height == null) return null;
  if (width <= 0 || height <= 0) return null;
  return rect(x, y, width, height);
}

function iconSource(destination) {
  var width = ICON_SIZE;
  var height = ICON_SIZE;
  var x;
  var y;
  if (width >= destination.width) width = destination.width / 2;
  if (height >= destination.height) height = destination.height / 2;
  if (!(width > 0) || !(height > 0)) return null;
  if (width >= destination.width || height >= destination.height) return null;
  x = destination.x + (destination.width - width) / 2;
  y = destination.y + (destination.height - height) / 2;
  return rect(x, y, width, height);
}

function createPlayback(source, destination, address) {
  var sequence = zoomSequence(source, destination);
  var index = 0;
  var playback;
  if (!sequence) return null;
  playback = {
    address: address || "",
    source: sequence.source,
    destination: sequence.destination,
    frames: sequence.frames,
    ticks: sequence.ticks,
    outlines: sequence.ticks[0].slice(),
    done: sequence.ticks[0].length === 0
  };
  playback.step = function () {
    if (playback.done) return playback;
    index += 1;
    if (index >= sequence.ticks.length) {
      playback.outlines = [];
      playback.done = true;
      return playback;
    }
    playback.outlines = sequence.ticks[index].slice();
    playback.done = playback.outlines.length === 0;
    return playback;
  };
  return playback;
}

function openWindow(record) {
  var destination = frameFromRecord(record);
  var source;
  var address;
  if (!destination) return null;
  source = iconSource(destination);
  if (!source) return null;
  address = record && record.address != null ? String(record.address) : "";
  return createPlayback(source, destination, address);
}

function snapshot(playback) {
  if (!playback) return null;
  return {
    address: playback.address || "",
    source: playback.source,
    destination: playback.destination,
    outlines: playback.outlines.slice(),
    done: playback.done
  };
}

function beginOpen(record) {
  active = openWindow(record);
  return snapshot(active);
}

function advanceOpen() {
  var shot;
  if (!active) return { address: "", source: null, destination: null, outlines: [], done: true };
  if (!active.done) active.step();
  shot = snapshot(active);
  if (active.done) active = null;
  return shot;
}

function parseOpenWindow(data) {
  var parts = String(data == null ? "" : data).split(",");
  return {
    address: parts.length > 0 ? String(parts[0]).trim() : "",
    workspace: parts.length > 1 ? parts[1] : "",
    className: parts.length > 2 ? parts[2] : "",
    title: parts.length > 3 ? parts.slice(3).join(",") : "",
    attempts: 0
  };
}

function normalizeAddress(value) {
  var text = String(value == null ? "" : value).trim().toLowerCase();
  if (text.indexOf("address:") === 0) text = text.slice("address:".length).trim();
  if (text.indexOf("0x") === 0) text = text.slice(2);
  return text;
}

function findClient(clients, address) {
  var want = normalizeAddress(address);
  var i;
  if (!want || !clients) return null;
  for (i = 0; i < clients.length; i++) {
    if (clients[i] && normalizeAddress(clients[i].address) === want) return clients[i];
  }
  return null;
}

function unescapeSystemd(value) {
  return String(value || "").replace(/\\x([0-9a-fA-F]{2})/g, function (_, hex) {
    return String.fromCharCode(parseInt(hex, 16));
  });
}

function isUserLaunchUnit(unitName) {
  var name = unescapeSystemd(unitName);
  var prefix = "app-Hyprland-";
  var body;
  var dash;
  var command;
  if (name.slice(-6) !== ".scope") return false;
  if (name.slice(0, prefix.length) !== prefix) return false;
  body = name.slice(prefix.length, name.length - 6);
  dash = body.lastIndexOf("-");
  if (dash <= 0) return false;
  command = body.slice(0, dash);
  if (!command || SESSION_HELPERS[command]) return false;
  return true;
}

function readSystemdLine(state, line) {
  var expecting = !!(state && state.expecting);
  var text = String(line || "");
  var quoted;
  var unit = "";
  if (text.indexOf("Member=UnitNew") !== -1) expecting = true;
  if (expecting) {
    quoted = /STRING "([^"]*)"/.exec(text);
    if (quoted) {
      expecting = false;
      // Keep systemd's escaped name. systemctl does not find xdg-terminal-exec
      // once the \x2d sequences have been turned into hyphens.
      if (isUserLaunchUnit(quoted[1])) unit = quoted[1];
    } else if (text.indexOf("};") !== -1) {
      expecting = false;
    }
  }
  return { state: { expecting: expecting }, unit: unit };
}

function shouldStartLaunch(now, lastStartMs, presentationActive) {
  if (!presentationActive) return true;
  if (lastStartMs == null || !isFinite(Number(lastStartMs))) return true;
  return Number(now) - Number(lastStartMs) >= LAUNCH_BURST_MS;
}

// daemon-reload sends UnitNew again for scopes that are already running.
// A start older than this is that echo. A missing or future timestamp stays
// recent so a scope that has not been stamped yet still plays.
var SCOPE_START_SLACK_US = 60 * 1000 * 1000;

function scopeStartSlackUs() {
  return SCOPE_START_SLACK_US;
}

function scopeStartIsRecent(nowUs, enteredUs, slackUs) {
  var now = Number(nowUs);
  var entered = Number(enteredUs);
  var slack = Number(slackUs);
  if (!isFinite(slack) || slack < 0) slack = SCOPE_START_SLACK_US;
  if (!isFinite(entered) || entered <= 0) return true;
  if (!isFinite(now) || now <= 0) return true;
  if (entered > now) return true;
  return now - entered <= slack;
}

function scopeAgeScript() {
  return "unit=$1\n"
    + "case $unit in\n"
    + "  *[!A-Za-z0-9._:+@\\\\-]*) printf 'Unit=%s\\nLoadState=not-found\\n' \"$unit\"; exit 0 ;;\n"
    + "  app-Hyprland-*.scope) ;;\n"
    + "  *) printf 'Unit=%s\\nLoadState=not-found\\n' \"$unit\"; exit 0 ;;\n"
    + "esac\n"
    + "now=$(awk '{printf \"%.0f\", $1 * 1000000}' /proc/uptime)\n"
    + "show=$(systemctl --user show \"$unit\" -p ActiveEnterTimestampMonotonic -p ActiveState -p LoadState --no-pager 2>/dev/null) || true\n"
    + "printf 'Unit=%s\\nNowUs=%s\\n%s\\n' \"$unit\" \"$now\" \"$show\"\n";
}

function parseScopeAge(text) {
  var lines = String(text == null ? "" : text).split("\n");
  var start = -1;
  var i;
  var line;
  var eq;
  var key;
  var val;
  var out;
  for (i = 0; i < lines.length; i++) {
    if (lines[i].slice(0, 5) === "Unit=") start = i;
  }
  if (start < 0) return null;
  out = {
    unit: "",
    nowUs: NaN,
    enteredUs: NaN,
    activeState: "",
    loadState: ""
  };
  for (i = start; i < lines.length; i++) {
    line = lines[i];
    eq = line.indexOf("=");
    if (eq <= 0) continue;
    key = line.slice(0, eq);
    val = line.slice(eq + 1).replace(/\r$/, "");
    if (key === "Unit") out.unit = val;
    else if (key === "NowUs") out.nowUs = Number(val);
    else if (key === "ActiveEnterTimestampMonotonic") out.enteredUs = Number(val);
    else if (key === "ActiveState") out.activeState = val;
    else if (key === "LoadState") out.loadState = val;
  }
  return out;
}

function scopeShouldPresent(parsed, slackUs) {
  var state;
  var entered;
  if (!parsed) return false;
  if (parsed.loadState === "not-found" || parsed.loadState === "masked" || parsed.loadState === "error") return false;
  state = String(parsed.activeState || "");
  entered = Number(parsed.enteredUs);
  if ((state === "inactive" || state === "failed") && !(entered > 0)) return false;
  return scopeStartIsRecent(parsed.nowUs, parsed.enteredUs, slackUs);
}

function parseGaps(value) {
  var css;
  if (value && value.css == null && (value.top != null || value.left != null || value.right != null || value.bottom != null)) {
    return {
      top: Number(value.top) || 0,
      right: Number(value.right) || 0,
      bottom: Number(value.bottom) || 0,
      left: Number(value.left) || 0
    };
  }
  css = value && value.css != null ? String(value.css) : String(value == null ? "" : value);
  var parts = [];
  var i;
  var raw = css.trim().split(/\s+/);
  var n;
  for (i = 0; i < raw.length; i++) {
    n = Number(raw[i]);
    if (isFinite(n)) parts.push(n);
  }
  if (parts.length >= 4) return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] };
  n = parts.length ? parts[0] : 0;
  return { top: n, right: n, bottom: n, left: n };
}

function reservedOf(monitor) {
  var reserved = monitor && monitor.reserved;
  if (!reserved) return { left: 0, top: 0, right: 0, bottom: 0 };
  if (reserved.left != null || reserved.top != null) {
    return {
      left: Number(reserved.left) || 0,
      top: Number(reserved.top) || 0,
      right: Number(reserved.right) || 0,
      bottom: Number(reserved.bottom) || 0
    };
  }
  // Hyprland 0.56 JSON / text order. The top bar's height is the second field.
  return {
    left: Number(reserved[0]) || 0,
    top: Number(reserved[1]) || 0,
    right: Number(reserved[2]) || 0,
    bottom: Number(reserved[3]) || 0
  };
}

function workArea(monitor, gaps) {
  var reserved;
  var inset;
  var x;
  var y;
  var width;
  var height;
  if (!monitor) return null;
  reserved = reservedOf(monitor);
  inset = parseGaps(gaps);
  x = Number(monitor.x) || 0;
  y = Number(monitor.y) || 0;
  width = Number(monitor.width) - reserved.left - reserved.right - inset.left - inset.right;
  height = Number(monitor.height) - reserved.top - reserved.bottom - inset.top - inset.bottom;
  if (!(width > 0) || !(height > 0)) return null;
  return rect(x + reserved.left + inset.left, y + reserved.top + inset.top, width, height);
}

function focusedMonitor(monitors) {
  var i;
  if (!monitors || !monitors.length) return null;
  for (i = 0; i < monitors.length; i++) {
    if (monitors[i] && monitors[i].focused) return monitors[i];
  }
  return monitors[0];
}

function parseLaunchContext(text) {
  var cursor = null;
  var monitors = null;
  var gaps = null;
  var section = "";
  var buf = [];
  var lines = String(text || "").split("\n");
  var i;
  function flush() {
    var raw = buf.join("\n").trim();
    var parsed;
    buf = [];
    if (!raw) return;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return;
    }
    if (section === "CURSOR") cursor = parsed;
    else if (section === "MONITORS") monitors = parsed;
    else if (section === "GAPS") gaps = parseGaps(parsed);
  }
  for (i = 0; i < lines.length; i++) {
    if (lines[i] === "CURSOR" || lines[i] === "MONITORS" || lines[i] === "GAPS") {
      flush();
      section = lines[i];
    } else {
      buf.push(lines[i]);
    }
  }
  flush();
  return { cursor: cursor, monitor: focusedMonitor(monitors), gaps: gaps || parseGaps(0) };
}

function launchPlan(context) {
  var destination;
  var source;
  var cursor;
  var size;
  if (!context) return null;
  destination = workArea(context.monitor, context.gaps);
  if (!destination) return null;
  cursor = context.cursor;
  size = ICON_SIZE;
  if (cursor && isFinite(Number(cursor.x)) && isFinite(Number(cursor.y))) {
    source = rect(Number(cursor.x) - size / 2, Number(cursor.y) - size / 2, size, size);
  } else {
    source = iconSource(destination);
  }
  if (!source || source.width >= destination.width || source.height >= destination.height) {
    source = iconSource(destination);
  }
  if (!source) return null;
  return {
    unit: context.unit || "",
    source: source,
    destination: destination
  };
}

var launch = null;

function launchSnapshot() {
  if (!launch) {
    return {
      unit: "",
      outlines: [],
      done: true,
      showWatch: false,
      phase: "idle",
      source: null,
      destination: null,
      windowArrived: false
    };
  }
  return {
    unit: launch.unit,
    outlines: launch.playback && !launch.playback.done ? launch.playback.outlines.slice() : [],
    done: launch.phase === "idle",
    showWatch: launch.phase === "watch",
    phase: launch.phase,
    source: launch.plan.source,
    destination: launch.plan.destination,
    windowArrived: launch.windowArrived
  };
}

function beginLaunch(context) {
  var plan = launchPlan(context);
  var playback;
  if (!plan) return null;
  playback = createPlayback(plan.source, plan.destination, plan.unit);
  if (!playback) return null;
  launch = {
    unit: plan.unit,
    plan: plan,
    playback: playback,
    phase: "zoom",
    windowArrived: false,
    bound: false,
    boundAddress: ""
  };
  return launchSnapshot();
}

function programKey(className) {
  return String(className == null ? "" : className).trim();
}

function noteProgramIcon(className, source) {
  var key = programKey(className);
  var icon = asRect(source);
  if (!key || !icon) return false;
  programs[key] = { source: icon };
  return true;
}

function programHasIcon(className) {
  var key = programKey(className);
  return !!(key && programs[key] && programs[key].source);
}

// Toolbars, menus, tips, and windows attached to another window are chrome.
// A later document window, such as a second Evolution window, is not.
function isToolbarWindow(record) {
  var type;
  var cls;
  var title;
  var desc;
  var tags;
  var i;
  var tag;
  if (!record) return false;
  if (record.attached === true || record.parent) return true;
  type = String(record.windowType || record.type || record.role || record.xdgTag || "").trim().toLowerCase();
  if (/^(toolbar|tool-bar|tooltip|dock|splash|popup|combo|utility|menu|dropdown|notification)$/.test(type)) return true;
  cls = String(record.className || record["class"] || record.initialClass || "").toLowerCase();
  title = String(record.title || record.initialTitle || "").trim().toLowerCase();
  desc = String(record.xdgDescription || "").toLowerCase();
  if (cls.indexOf("toolbar") !== -1 || cls.indexOf("tooltip") !== -1) return true;
  if (title === "toolbar" || title === "tooltip") return true;
  if (desc.indexOf("toolbar") !== -1) return true;
  tags = record.tags || [];
  for (i = 0; i < tags.length; i++) {
    tag = String(tags[i] || "").toLowerCase().replace(/\*$/, "");
    if (tag === "toolbar" || tag === "tooltip" || tag.indexOf("toolbar") !== -1) return true;
  }
  return false;
}

// The first window that maps for this launch keeps the icon the trail
// started from. Later windows of that class use the same icon only when
// newWindows is on, and only after this load has finished.
function bindLaunchWindow(address, className) {
  var key = normalizeAddress(address);
  var source;
  var destination;
  if (!launch || !launch.plan || launch.bound) return null;
  if (!key) return null;
  source = asRect(launch.plan.source);
  destination = asRect(launch.plan.destination);
  if (!source) return null;
  openSources[key] = {
    source: source,
    destination: destination,
    frame: destination
  };
  noteProgramIcon(className, source);
  launch.bound = true;
  launch.boundAddress = key;
  return {
    address: key,
    className: programKey(className),
    source: cloneRect(source),
    destination: destination ? cloneRect(destination) : null
  };
}

function shouldZoomNewWindow(enabled, presentationActive, record) {
  var address;
  var key;
  if (enabled !== true) return false;
  if (presentationActive === true) return false;
  if (!record || isToolbarWindow(record)) return false;
  address = normalizeAddress(record.address);
  key = programKey(record.className || record["class"] || record.initialClass);
  if (!address || !key || !programHasIcon(key)) return false;
  if (hasOpenSource(address)) return false;
  return true;
}

function placeNewWindow(record) {
  var address;
  var key;
  var windowFrame;
  var icon;
  if (!shouldZoomNewWindow(true, false, record)) return null;
  windowFrame = frameFromRecord(record);
  if (!windowFrame) return null;
  address = normalizeAddress(record.address);
  key = programKey(record.className || record["class"] || record.initialClass);
  icon = closeIcon(programs[key].source, windowFrame);
  if (!icon) return null;
  openSources[address] = {
    source: cloneRect(icon),
    destination: cloneRect(windowFrame),
    frame: cloneRect(windowFrame)
  };
  return {
    address: address,
    className: key,
    source: cloneRect(icon),
    destination: cloneRect(windowFrame)
  };
}

function emptyWindowZoom() {
  return {
    address: "",
    outlines: [],
    done: true,
    phase: "idle",
    source: null,
    destination: null
  };
}

function windowSnapshot() {
  if (!opening || !opening.playback) return emptyWindowZoom();
  return {
    address: opening.address || "",
    outlines: opening.playback.done ? [] : opening.playback.outlines.slice(),
    done: opening.playback.done,
    phase: opening.phase,
    source: opening.playback.source,
    destination: opening.playback.destination
  };
}

function beginNewWindow(record) {
  var placed = placeNewWindow(record);
  var playback;
  if (!placed) return null;
  playback = createPlayback(placed.source, placed.destination, placed.address);
  if (!playback) {
    delete openSources[placed.address];
    return null;
  }
  opening = {
    address: placed.address,
    playback: playback,
    phase: "zoom"
  };
  return windowSnapshot();
}

function advanceNewWindow() {
  var shot;
  if (!opening || !opening.playback) return emptyWindowZoom();
  if (!opening.playback.done) opening.playback.step();
  if (opening.playback.done) opening.phase = "idle";
  shot = windowSnapshot();
  if (opening.playback.done) opening = null;
  return shot;
}

function cancelNewWindow() {
  opening = null;
}

function hasOpenSource(address) {
  var key = normalizeAddress(address);
  return !!(key && openSources[key] && openSources[key].source);
}

function hasOpenSources() {
  var key;
  for (key in openSources) {
    if (Object.prototype.hasOwnProperty.call(openSources, key) && openSources[key]) return true;
  }
  return false;
}

function isLaunchWindow(address) {
  if (!launch || !launch.boundAddress) return false;
  return normalizeAddress(address) === launch.boundAddress;
}

// A window that maps after the launch request, and within this long, is
// the program that was just invoked. An older window is left alone.
var OPEN_BIND_SLACK_MS = 2000;

function openBindSlackMs() {
  return OPEN_BIND_SLACK_MS;
}

function recentLaunchWindow(openMs, requestMs, nowMs) {
  var openAt = Number(openMs);
  var requested = Number(requestMs);
  var now = Number(nowMs);
  if (!isFinite(openAt) || openAt < 0) return false;
  if (!isFinite(requested) || requested < 0) return false;
  if (!isFinite(now)) return false;
  if (openAt < requested) return false;
  return now - openAt <= OPEN_BIND_SLACK_MS;
}

function forgetOpenSource(address) {
  var key = normalizeAddress(address);
  if (!key || !openSources[key]) return false;
  delete openSources[key];
  return true;
}

function syncWindowFrames(clients) {
  var list = clients || [];
  var i;
  var key;
  var frame;
  var updated = 0;
  for (i = 0; i < list.length; i++) {
    if (!list[i]) continue;
    key = normalizeAddress(list[i].address);
    if (!key || !openSources[key]) continue;
    frame = frameFromRecord(list[i]);
    if (!frame) continue;
    openSources[key].frame = frame;
    updated += 1;
  }
  return updated;
}

// The close ends on the stored icon. When that icon is not smaller than
// the window, it is shrunk around the same center so the trail still
// collapses toward the place the program was opened.
function closeIcon(source, windowFrame) {
  var icon = asRect(source);
  var width;
  var height;
  var x;
  var y;
  if (!icon || !windowFrame) return null;
  if (icon.width < windowFrame.width && icon.height < windowFrame.height) return cloneRect(icon);
  width = icon.width;
  height = icon.height;
  if (width >= windowFrame.width) width = windowFrame.width / 2;
  if (height >= windowFrame.height) height = windowFrame.height / 2;
  if (!(width > 0) || !(height > 0)) return null;
  if (!(width < windowFrame.width) || !(height < windowFrame.height)) return null;
  x = icon.x + (icon.width - width) / 2;
  y = icon.y + (icon.height - height) / 2;
  return rect(x, y, width, height);
}

function emptyClose() {
  return {
    address: "",
    outlines: [],
    done: true,
    phase: "idle",
    source: null,
    destination: null
  };
}

function closeSnapshot() {
  if (!closing || !closing.playback) return emptyClose();
  return {
    address: closing.address || "",
    outlines: closing.playback.done ? [] : closing.playback.outlines.slice(),
    done: closing.playback.done,
    phase: closing.phase,
    source: closing.playback.source,
    destination: closing.playback.destination
  };
}

function parseCloseWindow(data) {
  var parts = String(data == null ? "" : data).split(",");
  return {
    address: parts.length > 0 ? String(parts[0]).trim() : ""
  };
}

function beginClose(address, record) {
  var key = normalizeAddress(address);
  var entry = key ? openSources[key] : null;
  var windowFrame;
  var icon;
  var playback;
  if (!entry || !entry.source) return null;
  windowFrame = frameFromRecord(record) || entry.frame || entry.destination;
  windowFrame = asRect(windowFrame);
  icon = closeIcon(entry.source, windowFrame);
  playback = windowFrame && icon ? createPlayback(windowFrame, icon, key) : null;
  delete openSources[key];
  if (!playback) return null;
  closing = {
    address: key,
    playback: playback,
    phase: "zoom"
  };
  return closeSnapshot();
}

function advanceClose() {
  var shot;
  if (!closing || !closing.playback) return emptyClose();
  if (!closing.playback.done) closing.playback.step();
  if (closing.playback.done) closing.phase = "idle";
  shot = closeSnapshot();
  if (closing.playback.done) closing = null;
  return shot;
}

function cancelClose() {
  closing = null;
}

function advanceLaunch() {
  if (!launch || launch.phase !== "zoom") return launchSnapshot();
  if (!launch.playback.done) launch.playback.step();
  if (launch.playback.done) launch.phase = "idle";
  return launchSnapshot();
}

function noteProgramArrived() {
  if (!launch || launch.phase === "idle") {
    return {
      unit: "",
      outlines: [],
      done: false,
      showWatch: false,
      phase: "idle",
      source: null,
      destination: null,
      windowArrived: false,
      pending: true
    };
  }
  launch.windowArrived = true;
  if (launch.phase === "watch") launch.phase = "idle";
  return launchSnapshot();
}

function matchOpenedClients(clients, waiting) {
  var ready = [];
  var still = [];
  var list = clients || [];
  var pending = waiting || [];
  var i;
  for (i = 0; i < pending.length; i++) {
    var item = pending[i];
    var client = findClient(list, item.address);
    var frame = client ? frameFromRecord(client) : null;
    var attempts;
    if (frame) {
      ready.push({
        address: String((client && client.address) || item.address || ""),
        workspace: item.workspace || "",
        className: item.className || String((client && client["class"]) || ""),
        title: item.title || String((client && client.title) || ""),
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
        at: [frame.x, frame.y],
        size: [frame.width, frame.height]
      });
    } else {
      attempts = (item.attempts || 0) + 1;
      if (attempts < MAX_LOOKUPS) {
        still.push({
          address: item.address,
          workspace: item.workspace || "",
          className: item.className || "",
          title: item.title || "",
          attempts: attempts
        });
      }
    }
  }
  return { ready: ready, waiting: still };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    tickIntervalMs: tickIntervalMs,
    tickIntervalFor: tickIntervalFor,
    durationFromConfig: durationFromConfig,
    defaultNewWindows: defaultNewWindows,
    newWindowsFromConfig: newWindowsFromConfig,
    isToolbarWindow: isToolbarWindow,
    programHasIcon: programHasIcon,
    shouldZoomNewWindow: shouldZoomNewWindow,
    placeNewWindow: placeNewWindow,
    beginNewWindow: beginNewWindow,
    advanceNewWindow: advanceNewWindow,
    cancelNewWindow: cancelNewWindow,
    defaultDurationSec: defaultDurationSec,
    minDurationSec: minDurationSec,
    maxDurationSec: maxDurationSec,
    zoomAdvances: zoomAdvances,
    zoomGrowSteps: zoomGrowSteps,
    iconSize: iconSize,
    maxLookupAttempts: maxLookupAttempts,
    zoomSequence: zoomSequence,
    frameFromRecord: frameFromRecord,
    openWindow: openWindow,
    beginOpen: beginOpen,
    advanceOpen: advanceOpen,
    parseOpenWindow: parseOpenWindow,
    normalizeAddress: normalizeAddress,
    matchOpenedClients: matchOpenedClients,
    unescapeSystemd: unescapeSystemd,
    isUserLaunchUnit: isUserLaunchUnit,
    readSystemdLine: readSystemdLine,
    shouldStartLaunch: shouldStartLaunch,
    scopeStartSlackUs: scopeStartSlackUs,
    scopeStartIsRecent: scopeStartIsRecent,
    scopeAgeScript: scopeAgeScript,
    parseScopeAge: parseScopeAge,
    scopeShouldPresent: scopeShouldPresent,
    parseGaps: parseGaps,
    workArea: workArea,
    parseLaunchContext: parseLaunchContext,
    launchPlan: launchPlan,
    beginLaunch: beginLaunch,
    advanceLaunch: advanceLaunch,
    bindLaunchWindow: bindLaunchWindow,
    hasOpenSource: hasOpenSource,
    hasOpenSources: hasOpenSources,
    isLaunchWindow: isLaunchWindow,
    openBindSlackMs: openBindSlackMs,
    recentLaunchWindow: recentLaunchWindow,
    forgetOpenSource: forgetOpenSource,
    syncWindowFrames: syncWindowFrames,
    parseCloseWindow: parseCloseWindow,
    beginClose: beginClose,
    advanceClose: advanceClose,
    cancelClose: cancelClose,
    noteProgramArrived: noteProgramArrived,
    launchBurstMs: launchBurstMs,
    watchLimitMs: watchLimitMs,
    launchPanelOpen: launchPanelOpen,
    shouldShowLaunchPanel: shouldShowLaunchPanel,
    launchingPanelPayload: launchingPanelPayload
  };
}
