import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import Quickshell.Wayland
import "zoomrects.js" as Zoom

// Classic Mac launch order, fitted to Omarchy:
// zoom rects at the moment the user launches a program. The watch is drawn
// only while Omarchy's Launching box is open, and the zoom layer is unmapped
// before that box appears so it is not covered. When the launched window
// closes, the rectangles shrink back to the icon stored for that launch.
// A later non-toolbar window of that program uses the same icon once the
// load has finished, when newWindows is on. The overlay takes no keyboard
// focus and its input mask is empty.
Item {
  id: root

  property var systemdState: ({ expecting: false })
  property bool presentationActive: false
  property double lastLaunchMs: -1
  property string pendingUnit: ""
  property var outlines: []
  property int zoomSteps: 0
  property int tickMs: Zoom.tickIntervalMs()
  property bool zooming: false
  property string zoomMode: ""
  property string pendingOpenAddress: ""
  property string pendingOpenClass: ""
  property double launchRequestedMs: -1
  property string recentOpenAddress: ""
  property string recentOpenClass: ""
  property bool newWindows: Zoom.defaultNewWindows()
  property var newWindowQueue: []
  property string concealedAddress: ""
  property string concealedOpacity: "1"
  property string revealAddress: ""
  property var classOpacity: ({})
  property double recentOpenMs: -1
  property bool trailStarted: false
  property bool showWatch: false
  property bool watchArmed: false
  property bool sawLaunchPanel: false
  property bool earlyArrival: false
  property bool preTrailArrival: false
  property real watchX: 0
  property real watchY: 0
  property var ageQueue: []
  property string ageBuffer: ""
  property bool ageGotText: false
  property bool ageExited: false

  readonly property string launchContextScript:
    "printf 'CURSOR\\n'; hyprctl cursorpos -j; printf '\\nMONITORS\\n'; hyprctl monitors -j; printf '\\nGAPS\\n'; hyprctl getoption general:gaps_out -j; printf '\\n'"

  function onUserLaunch(unit) {
    var now = Date.now()
    if (!unit) return
    if (!Zoom.shouldStartLaunch(now, root.lastLaunchMs, root.presentationActive)) return
    root.launchRequestedMs = now
    root.enqueueScope(unit)
    root.pumpScopeCheck()
  }

  function copyScopeQueue() {
    var q = root.ageQueue
    var out = []
    var i
    if (!q || q.length == null) return out
    for (i = 0; i < q.length; i++) out.push(q[i])
    return out
  }

  function enqueueScope(unit) {
    var q = root.copyScopeQueue()
    var i
    if (!unit) return
    if (ageProc.zoomUnit === unit) return
    for (i = 0; i < q.length; i++) {
      if (q[i] === unit) return
    }
    if (q.length >= 32) q.shift()
    q.push(unit)
    root.ageQueue = q
  }

  function pumpScopeCheck() {
    var q
    var unit
    q = root.copyScopeQueue()
    if (q.length === 0) return
    if (ageProc.running) {
      ageContinue.restart()
      return
    }
    unit = q.shift()
    root.ageQueue = q
    root.ageBuffer = ""
    root.ageGotText = false
    root.ageExited = false
    ageProc.zoomUnit = unit
    ageProc.command = ["bash", "-c", Zoom.scopeAgeScript(), "zoomrects-scope-age", unit]
    ageProc.running = true
  }

  function beginPresentation(unit) {
    var now = Date.now()
    if (!unit) return
    if (!Zoom.shouldStartLaunch(now, root.lastLaunchMs, root.presentationActive)) return
    console.log("zoomrects: launch", Zoom.unescapeSystemd(unit))
    root.lastLaunchMs = now
    root.presentationActive = true
    root.pendingUnit = unit
    root.showWatch = false
    root.ageQueue = []
    root.trailStarted = false
    root.earlyArrival = false
    root.preTrailArrival = false
    root.pendingOpenAddress = ""
    root.pendingOpenClass = ""
    root.cancelCloseZoom()
    root.cancelWindowZoom()
    newWindowTimer.stop()
    root.queryLaunchContext()
  }

  function applyScopeAge(unit, text) {
    var parsed
    var present
    if (!unit) return
    try {
      parsed = Zoom.parseScopeAge(text)
      if (parsed && parsed.unit && parsed.unit !== unit) present = false
      else present = Zoom.scopeShouldPresent(parsed, Zoom.scopeStartSlackUs())
    } catch (e) {
      present = false
    }
    if (present) root.beginPresentation(unit)
  }

  function finishScopeAge() {
    var unit
    var text
    if (!root.ageGotText || !root.ageExited) return
    unit = ageProc.zoomUnit
    text = root.ageBuffer
    ageProc.zoomUnit = ""
    root.ageBuffer = ""
    root.ageGotText = false
    root.ageExited = false
    root.applyScopeAge(unit, text)
    root.pumpScopeCheck()
    if (!root.presentationActive) root.pumpNewWindows()
  }

  function queryLaunchContext() {
    if (contextProc.running) {
      root.contextRerun = true
      return
    }
    contextProc.running = true
  }

  property bool contextRerun: false

  function ingestContext(text) {
    var context
    var started
    if (!root.pendingUnit) return
    try {
      context = Zoom.parseLaunchContext(text)
      if (!context) context = {}
      context.unit = root.pendingUnit
      started = Zoom.beginLaunch(context)
    } catch (e) {
      started = null
    }
    if (!started) {
      if (!root.zooming) root.finishPresentation()
      return
    }
    root.bindPendingWindow()
    root.refreshKnownFrames()
    // The window mapped while the trail was still being planned. Keep the
    // icon for the close and skip outlines that would start after it is up.
    if (root.preTrailArrival) {
      Zoom.noteProgramArrived()
      root.preTrailArrival = false
      root.earlyArrival = false
      root.finishPresentation()
      return
    }
    if (root.earlyArrival) Zoom.noteProgramArrived()
    root.trailStarted = true
    root.zoomMode = "open"
    root.zoomSteps = 0
    root.zooming = true
    root.outlines = started.outlines
    root.showWatch = false
    root.disarmWatch()
    tickTimer.start()
  }

  function applyLaunchStep(step) {
    var count = step.outlines ? step.outlines.length : 0
    root.zoomSteps = root.zoomSteps + 1
    // Always show the growing outlines for the full trail. A window opening
    // or a bad phase value must not erase them early.
    if (step.phase === "zoom" || root.zoomSteps < Zoom.zoomAdvances()) {
      root.zooming = true
      if (count > 0) root.outlines = step.outlines
      root.showWatch = false
      return
    }
    root.outlines = []
    root.zooming = false
    root.zoomMode = ""
    tickTimer.stop()
    if (!Zoom.shouldShowLaunchPanel(root.earlyArrival)) {
      root.earlyArrival = false
      root.finishPresentation()
      return
    }
    root.showLaunchingPanel()
    root.armWatch()
  }

  property bool launchPanelShown: false

  function showLaunchingPanel() {
    var payload
    var encoded
    if (launchPanelShow.running) return
    try {
      payload = Zoom.launchingPanelPayload("")
      encoded = JSON.stringify(payload)
    } catch (e) {
      return
    }
    if (!encoded) return
    launchPanelShow.command = ["omarchy-shell", "osd", "show", encoded]
    launchPanelShow.running = true
    root.launchPanelShown = true
  }

  function hideLaunchingPanel() {
    if (!root.launchPanelShown) return
    root.launchPanelShown = false
    if (launchPanelClose.running) return
    launchPanelClose.running = true
  }

  function armWatch() {
    root.watchArmed = true
    root.sawLaunchPanel = false
    root.showWatch = false
    panelPollTimer.start()
    if (!watchLimit.running) watchLimit.start()
  }

  function applyPanelState(text) {
    var open
    if (!root.watchArmed) return
    open = Zoom.launchPanelOpen(text)
    if (open) {
      root.sawLaunchPanel = true
      root.showWatch = true
      if (!cursorTimer.running) cursorTimer.start()
      root.queryCursor()
      return
    }
    root.showWatch = false
    cursorTimer.stop()
    if (root.sawLaunchPanel) root.disarmWatch()
  }

  function disarmWatch() {
    root.watchArmed = false
    root.sawLaunchPanel = false
    root.showWatch = false
    panelPollTimer.stop()
    cursorTimer.stop()
    watchLimit.stop()
  }

  function finishPresentation() {
    var trailOnScreen = (root.zoomMode === "close" || root.zoomMode === "window") && root.zooming
    root.hideLaunchingPanel()
    root.presentationActive = false
    root.pendingUnit = ""
    root.pendingOpenAddress = ""
    root.pendingOpenClass = ""
    root.earlyArrival = false
    root.preTrailArrival = false
    root.trailStarted = false
    root.showWatch = false
    root.disarmWatch()
    if (trailOnScreen) return
    root.zoomSteps = 0
    root.zooming = false
    root.outlines = []
    root.zoomMode = ""
    tickTimer.stop()
    root.pumpNewWindows()
  }

  function cancelCloseZoom() {
    Zoom.cancelClose()
    if (root.zoomMode !== "close") return
    root.zoomMode = ""
    root.zoomSteps = 0
    root.zooming = false
    root.outlines = []
    tickTimer.stop()
  }

  function cancelWindowZoom() {
    Zoom.cancelNewWindow()
    root.revealConcealed()
    if (root.zoomMode !== "window") return
    root.zoomMode = ""
    root.zoomSteps = 0
    root.zooming = false
    root.outlines = []
    tickTimer.stop()
  }

  function eventText(event) {
    var parts
    var i
    var text
    if (!event) return ""
    if (event.data != null && String(event.data) !== "") return String(event.data)
    try {
      if (event.parse) {
        parts = event.parse(4)
        if (parts && parts.length != null) {
          text = []
          for (i = 0; i < parts.length && i < 4; i++) text.push(parts[i] != null ? String(parts[i]) : "")
          return text.join(",")
        }
      }
    } catch (e) {
    }
    return ""
  }

  function rememberWindow(address, className) {
    if (!address) return false
    if (!Zoom.bindLaunchWindow(address, className || "")) return false
    console.log("zoomrects: icon", address, className || "")
    root.noteClassOpacity(className, address)
    return true
  }

  function hyprSelector(address) {
    var key = Zoom.normalizeAddress(address)
    if (!key) return ""
    return "address:0x" + key
  }

  function dispatchProp(address, prop, value) {
    var sel = root.hyprSelector(address)
    if (!sel || !prop) return
    try {
      Hyprland.dispatch('hl.dsp.window.set_prop({ prop = "' + prop + '", value = "' + value + '", window = "' + sel + '" })')
    } catch (e) {
    }
  }

  function opacityTextForClass(className) {
    var key = String(className || "").trim()
    var saved = key && root.classOpacity ? root.classOpacity[key] : ""
    if (saved && /^[0-9.]+$/.test(saved)) return saved
    return "1"
  }

  function noteClassOpacity(className, address) {
    var key = String(className || "").trim()
    if (!key || !address) return
    if (root.classOpacity && root.classOpacity[key]) return
    if (opacityProc.running) return
    opacityProc.zoomClass = key
    opacityProc.command = ["hyprctl", "getprop", root.hyprSelector(address), "opacity"]
    opacityProc.running = true
  }

  function storeClassOpacity(className, text) {
    var key = String(className || "").trim()
    var value = String(text || "").trim()
    var n
    var next = {}
    var name
    var map
    if (!key) return
    n = Number(value)
    if (!isFinite(n) || n <= 0 || n > 1) return
    map = root.classOpacity || {}
    for (name in map) {
      if (Object.prototype.hasOwnProperty.call(map, name)) next[name] = map[name]
    }
    next[key] = value
    root.classOpacity = next
  }

  // The open event arrives after Hyprland has already mapped the window.
  // Hide it before the rectangles move, and show it once they arrive.
  function concealWindow(address, className) {
    var same = root.concealedAddress && Zoom.normalizeAddress(root.concealedAddress) === Zoom.normalizeAddress(address)
    if (!address) return
    if (!same && root.concealedAddress) root.revealConcealed()
    if (same) return
    root.concealedAddress = address
    root.concealedOpacity = root.opacityTextForClass(className)
    root.dispatchProp(address, "no_anim", "true")
    root.dispatchProp(address, "opacity", "0 override")
  }

  function revealConcealed() {
    var address = root.concealedAddress
    var opacity = root.concealedOpacity || "1"
    if (!address) return
    root.concealedAddress = ""
    root.revealAddress = address
    root.dispatchProp(address, "opacity", opacity)
    revealAnimTimer.restart()
  }

  function revealIfConcealed(address) {
    if (!address || !root.concealedAddress) return
    if (Zoom.normalizeAddress(address) !== Zoom.normalizeAddress(root.concealedAddress)) return
    root.revealConcealed()
  }

  function bindPendingWindow() {
    var address = root.pendingOpenAddress
    var className = root.pendingOpenClass
    var fromRecent = false
    if (!address && Zoom.recentLaunchWindow(root.recentOpenMs, root.launchRequestedMs, Date.now())) {
      address = root.recentOpenAddress
      className = root.recentOpenClass
      fromRecent = true
    }
    if (!address) return
    if (!root.rememberWindow(address, className)) return
    root.pendingOpenAddress = ""
    root.pendingOpenClass = ""
    if (fromRecent) root.earlyArrival = true
  }

  function noteOpenedWindow(event) {
    var parsed = null
    var address = ""
    try {
      parsed = Zoom.parseOpenWindow(root.eventText(event))
    } catch (e) {
      parsed = null
    }
    if (parsed && parsed.address) address = parsed.address
    if (address) {
      root.recentOpenAddress = address
      root.recentOpenClass = parsed && parsed.className ? parsed.className : ""
      root.recentOpenMs = Date.now()
    }
    if (address && (root.presentationActive || root.pendingUnit)) {
      if (root.rememberWindow(address, parsed.className)) {
        root.pendingOpenAddress = ""
        root.pendingOpenClass = ""
      } else {
        root.pendingOpenAddress = address
        root.pendingOpenClass = parsed.className || ""
      }
    }
    root.refreshKnownFrames()
    if (!root.presentationActive) {
      root.considerNewWindow(parsed)
      return
    }
    // The window arriving must not cut a trail short. Remember it, and
    // skip the watch once the outlines have finished growing.
    if (root.zooming && root.zoomMode === "open") {
      root.earlyArrival = true
      Zoom.noteProgramArrived()
      return
    }
    // The icon is not known until the launch plan exists. Finishing here
    // would drop the address before that plan can store it.
    if (!root.trailStarted) {
      root.preTrailArrival = true
      root.earlyArrival = true
      return
    }
    root.hideLaunchingPanel()
    root.disarmWatch()
    root.finishPresentation()
  }

  function noteClosedWindow(event) {
    var parsed = null
    var address = ""
    try {
      parsed = Zoom.parseCloseWindow(root.eventText(event))
    } catch (e) {
      return
    }
    if (parsed && parsed.address) address = parsed.address
    if (!address || !Zoom.hasOpenSource(address)) {
      // A launch that just played should still know its icon. Log the miss
      // while that launch is fresh so a close with no trail can be traced.
      if (address && root.launchRequestedMs > 0 && (Date.now() - root.launchRequestedMs) < 15000 && !Zoom.hasOpenSource(address)) {
        console.log("zoomrects: close", address, "no icon")
      }
      return
    }
    root.refreshKnownFrames()
    // A trail is already on screen. Forget this icon rather than cutting
    // that trail off. The window is already gone.
    if (root.zooming) {
      Zoom.forgetOpenSource(address)
      return
    }
    if (Zoom.isLaunchWindow(address) && root.presentationActive) root.finishPresentation()
    root.startClose(address)
  }

  function startClose(address) {
    var record = root.toplevelRecord(address)
    var started = null
    try {
      started = Zoom.beginClose(address, record)
    } catch (e) {
      started = null
    }
    if (!started) return
    console.log("zoomrects: close", address)
    root.zoomMode = "close"
    root.zoomSteps = 0
    root.zooming = true
    root.outlines = started.outlines
    tickTimer.start()
  }

  function copyNewWindowQueue() {
    var q = root.newWindowQueue
    var out = []
    var i
    if (!q || q.length == null) return out
    for (i = 0; i < q.length; i++) out.push(q[i])
    return out
  }

  function scopeCheckBusy() {
    return ageProc.running || (root.ageQueue && root.ageQueue.length > 0)
  }

  function ipcText(ipc, key) {
    var value
    if (!ipc) return ""
    try {
      value = ipc[key]
    } catch (e) {
      return ""
    }
    if (value == null) return ""
    return String(value)
  }

  function ipcTags(ipc) {
    var tags
    if (!ipc) return []
    try {
      tags = ipc.tags
    } catch (e) {
      return []
    }
    if (!tags || tags.length == null) return []
    return tags
  }

  function toplevelAttached(toplevel) {
    try {
      return !!(toplevel && toplevel.wayland && toplevel.wayland.parent)
    } catch (e) {
      return false
    }
  }

  function recordFromToplevel(toplevel) {
    var ipc = toplevel && toplevel.lastIpcObject ? toplevel.lastIpcObject : null
    var address = ""
    var content = ""
    if (ipc && ipc.address != null) address = String(ipc.address)
    else if (toplevel && toplevel.address != null) address = String(toplevel.address)
    if (!ipc) return { address: address, attached: root.toplevelAttached(toplevel) }
    content = root.ipcText(ipc, "contentType")
    return {
      address: address,
      at: ipc.at,
      size: ipc.size,
      x: ipc.x,
      y: ipc.y,
      width: ipc.width,
      height: ipc.height,
      className: root.ipcText(ipc, "class"),
      initialClass: root.ipcText(ipc, "initialClass"),
      title: root.ipcText(ipc, "title"),
      initialTitle: root.ipcText(ipc, "initialTitle"),
      xdgTag: root.ipcText(ipc, "xdgTag"),
      xdgDescription: root.ipcText(ipc, "xdgDescription"),
      tags: root.ipcTags(ipc),
      windowType: content && content !== "none" ? content : "",
      attached: root.toplevelAttached(toplevel)
    }
  }

  function mergeWindow(parsed, record) {
    var client = {
      address: parsed && parsed.address ? String(parsed.address) : "",
      className: parsed && parsed.className ? String(parsed.className) : "",
      title: parsed && parsed.title ? String(parsed.title) : "",
      attached: false
    }
    if (!record) return client
    if (record.address) client.address = String(record.address)
    if (!client.className && record.className) client.className = String(record.className)
    if (!client.className && record.initialClass) client.className = String(record.initialClass)
    if (record.className) client["class"] = record.className
    if (record.initialClass) client.initialClass = record.initialClass
    if (record.title) client.title = String(record.title)
    if (record.initialTitle) client.initialTitle = record.initialTitle
    if (record.xdgTag) client.xdgTag = record.xdgTag
    if (record.xdgDescription) client.xdgDescription = record.xdgDescription
    if (record.tags) client.tags = record.tags
    if (record.windowType) client.windowType = record.windowType
    client.attached = record.attached === true
    if (record.parent) client.parent = record.parent
    if (record.at) client.at = record.at
    if (record.size) client.size = record.size
    if (record.x != null) client.x = record.x
    if (record.y != null) client.y = record.y
    if (record.width != null) client.width = record.width
    if (record.height != null) client.height = record.height
    return client
  }

  // The load trail already covered the first window. A later window of a
  // program whose icon is known grows from that icon, unless it is chrome
  // or the config file turned this set off.
  function considerNewWindow(parsed) {
    var record
    var client
    if (!parsed || !parsed.address) return
    if (root.newWindows !== true) return
    if (root.presentationActive || root.pendingUnit) return
    record = root.toplevelRecord(parsed.address)
    client = root.mergeWindow(parsed, record)
    if (!Zoom.frameFromRecord(record)) {
      try {
        Hyprland.refreshToplevels()
      } catch (e) {
      }
      record = root.toplevelRecord(parsed.address)
      client = root.mergeWindow(parsed, record)
    }
    if (Zoom.isToolbarWindow(client)) return
    if (Zoom.hasOpenSource(parsed.address)) return
    if (client.className && !Zoom.programHasIcon(client.className)) return
    if (!client.className || !Zoom.frameFromRecord(client) || root.scopeCheckBusy()) {
      if (!root.scopeCheckBusy() && client.className) root.concealWindow(client.address, client.className)
      root.enqueueNewWindow(client)
      return
    }
    root.playOrRemember(client)
  }

  function enqueueNewWindow(parsed) {
    var q = root.copyNewWindowQueue()
    var i
    var address = parsed && parsed.address ? String(parsed.address) : ""
    if (!address) return
    for (i = 0; i < q.length; i++) {
      if (Zoom.normalizeAddress(q[i].address) === Zoom.normalizeAddress(address)) return
    }
    if (q.length >= 32) q.shift()
    q.push({
      address: address,
      className: parsed.className || "",
      title: parsed.title || "",
      attempts: 0
    })
    root.newWindowQueue = q
    if (!newWindowTimer.running) newWindowTimer.start()
  }

  function pumpNewWindows() {
    var q
    var still = []
    var i
    var item
    var record
    var client
    var attempts
    if (root.newWindows !== true) {
      root.newWindowQueue = []
      newWindowTimer.stop()
      root.revealConcealed()
      return
    }
    if (root.presentationActive || root.pendingUnit || root.scopeCheckBusy()) return
    q = root.copyNewWindowQueue()
    for (i = 0; i < q.length; i++) {
      item = q[i]
      record = root.toplevelRecord(item.address)
      client = root.mergeWindow(item, record)
      if (Zoom.isToolbarWindow(client) || Zoom.hasOpenSource(item.address)) {
        root.revealIfConcealed(item.address)
        continue
      }
      if (client.className && !Zoom.programHasIcon(client.className)) {
        root.revealIfConcealed(item.address)
        continue
      }
      if (client.className && Zoom.frameFromRecord(client)) {
        root.playOrRemember(client)
        continue
      }
      attempts = (item.attempts || 0) + 1
      if (attempts >= Zoom.maxLookupAttempts()) {
        root.revealIfConcealed(item.address)
        continue
      }
      still.push({
        address: item.address,
        className: client.className || item.className || "",
        title: client.title || item.title || "",
        attempts: attempts
      })
    }
    root.newWindowQueue = still
    if (still.length === 0) newWindowTimer.stop()
    else if (!newWindowTimer.running) newWindowTimer.start()
  }

  function playOrRemember(client) {
    var started = null
    if (!client) return
    if (root.zooming) {
      try {
        Zoom.placeNewWindow(client)
      } catch (e) {
      }
      root.revealIfConcealed(client.address)
      return
    }
    root.concealWindow(client.address, client.className)
    try {
      started = Zoom.beginNewWindow(client)
    } catch (e) {
      started = null
    }
    if (!started) {
      root.revealConcealed()
      return
    }
    console.log("zoomrects: window", started.address || client.address || "", client.className || "")
    root.zoomMode = "window"
    root.zoomSteps = 0
    root.zooming = true
    root.outlines = started.outlines
    tickTimer.start()
  }

  function applyWindowStep(step) {
    var count = step && step.outlines ? step.outlines.length : 0
    root.zoomSteps = root.zoomSteps + 1
    if (root.concealedAddress && root.zoomSteps >= Zoom.zoomGrowSteps()) root.revealConcealed()
    if ((step && step.phase === "zoom") || root.zoomSteps < Zoom.zoomAdvances()) {
      root.zooming = true
      if (count > 0) root.outlines = step.outlines
      return
    }
    root.outlines = []
    root.zooming = false
    root.zoomMode = ""
    root.zoomSteps = 0
    tickTimer.stop()
    root.revealConcealed()
    root.pumpNewWindows()
  }

  function toplevelRecord(address) {
    var list
    var want
    var i
    var ipc
    var found
    try {
      list = Hyprland.toplevels ? Hyprland.toplevels.values : []
    } catch (e) {
      return null
    }
    if (!list) return null
    want = Zoom.normalizeAddress(address)
    for (i = 0; i < list.length; i++) {
      ipc = list[i] && list[i].lastIpcObject ? list[i].lastIpcObject : null
      found = ""
      if (ipc && ipc.address != null) found = String(ipc.address)
      else if (list[i] && list[i].address != null) found = String(list[i].address)
      if (!want || Zoom.normalizeAddress(found) !== want) continue
      return root.recordFromToplevel(list[i])
    }
    return null
  }

  function refreshKnownFrames() {
    var list
    var records = []
    var i
    var ipc
    var address
    if (!Zoom.hasOpenSources()) return
    try {
      list = Hyprland.toplevels ? Hyprland.toplevels.values : []
    } catch (e) {
      return
    }
    if (!list) return
    for (i = 0; i < list.length; i++) {
      ipc = list[i] && list[i].lastIpcObject ? list[i].lastIpcObject : null
      address = ""
      if (ipc && ipc.address != null) address = String(ipc.address)
      else if (list[i] && list[i].address != null) address = String(list[i].address)
      if (!address) continue
      records.push(root.recordFromToplevel(list[i]))
    }
    try {
      Zoom.syncWindowFrames(records)
    } catch (e) {
    }
  }

  function applyCloseStep(step) {
    var count = step && step.outlines ? step.outlines.length : 0
    root.zoomSteps = root.zoomSteps + 1
    if ((step && step.phase === "zoom") || root.zoomSteps < Zoom.zoomAdvances()) {
      root.zooming = true
      if (count > 0) root.outlines = step.outlines
      return
    }
    root.outlines = []
    root.zooming = false
    root.zoomMode = ""
    root.zoomSteps = 0
    tickTimer.stop()
    root.pumpNewWindows()
  }

  function queryCursor() {
    if (cursorProc.running) return
    cursorProc.running = true
  }

  function configPath() {
    var dir = Quickshell.env("XDG_CONFIG_HOME")
    if (!dir) dir = Quickshell.env("HOME") + "/.config"
    return dir + "/zoomrects.json"
  }

  function applyDurationText(text) {
    var ms
    var enabled
    try {
      ms = Zoom.tickIntervalFor(Zoom.durationFromConfig(text))
    } catch (e) {
      ms = Zoom.tickIntervalMs()
    }
    if (!isFinite(ms) || ms < 1) ms = Zoom.tickIntervalMs()
    root.tickMs = ms
    tickTimer.interval = root.tickMs
    try {
      enabled = Zoom.newWindowsFromConfig(text)
    } catch (e) {
      enabled = Zoom.defaultNewWindows()
    }
    root.newWindows = enabled === true
    if (root.newWindows !== true) {
      root.newWindowQueue = []
      newWindowTimer.stop()
      root.revealConcealed()
    }
    console.log("zoomrects: new windows", root.newWindows ? "on" : "off")
  }

  FileView {
    id: durationConfig
    path: root.configPath()
    watchChanges: true
    printErrors: false
    onLoaded: root.applyDurationText(text())
    onFileChanged: root.applyDurationText(text())
    onLoadFailed: root.applyDurationText("")
  }

  Component.onCompleted: console.log("zoomrects: listening, duration", Zoom.defaultDurationSec())

  Process {
    id: launchMonitor
    // stdbuf flushes each line. busctl block-buffers when its output is a pipe,
    // which holds the launch signal until long after the window is up.
    command: ["stdbuf", "-oL", "busctl", "--user", "monitor", "--match", "type='signal',interface='org.freedesktop.systemd1.Manager',member='UnitNew'"]
    running: true
    stdout: SplitParser {
      onRead: function(line) {
        var step
        try {
          step = Zoom.readSystemdLine(root.systemdState, line)
        } catch (e) {
          return
        }
        if (!step || !step.state) return
        root.systemdState = step.state
        if (step.unit) root.onUserLaunch(step.unit)
      }
    }
    onExited: function() {
      if (!monitorRestart.running) monitorRestart.start()
    }
  }

  Timer {
    id: monitorRestart
    interval: 1000
    repeat: false
    onTriggered: launchMonitor.running = true
  }

  // UnitNew on reload names scopes that have been active for hours.
  // Ask systemd how recently this one entered active before drawing anything.
  Process {
    id: ageProc
    property string zoomUnit: ""
    stdout: StdioCollector {
      id: ageOut
      waitForEnd: true
      onStreamFinished: {
        root.ageBuffer = ageOut.text
        root.ageGotText = true
        root.finishScopeAge()
      }
    }
    onExited: function() {
      root.ageExited = true
      root.finishScopeAge()
    }
  }

  Timer {
    id: ageContinue
    interval: 1
    repeat: false
    onTriggered: root.pumpScopeCheck()
  }

  Process {
    id: contextProc
    command: ["bash", "-c", root.launchContextScript]
    stdout: StdioCollector {
      id: contextOut
      waitForEnd: true
      onStreamFinished: root.ingestContext(contextOut.text)
    }
    onExited: function() {
      if (!root.contextRerun) return
      root.contextRerun = false
      root.queryLaunchContext()
    }
  }

  Process {
    id: launchPanelShow
  }

  Process {
    id: launchPanelClose
    command: ["omarchy-shell", "osd", "close"]
  }

  Process {
    id: panelProbe
    command: ["omarchy-shell", "osd", "state"]
    stdout: StdioCollector {
      id: panelOut
      waitForEnd: true
      onStreamFinished: root.applyPanelState(panelOut.text)
    }
  }

  Timer {
    id: panelPollTimer
    interval: 100
    repeat: true
    running: false
    onTriggered: if (!panelProbe.running) panelProbe.running = true
  }

  Process {
    id: cursorProc
    command: ["hyprctl", "cursorpos", "-j"]
    stdout: StdioCollector {
      id: cursorOut
      waitForEnd: true
      onStreamFinished: {
        var pos
        if (!root.showWatch) return
        try {
          pos = JSON.parse(cursorOut.text || "")
        } catch (e) {
          return
        }
        if (!pos || !isFinite(Number(pos.x)) || !isFinite(Number(pos.y))) return
        root.watchX = Number(pos.x)
        root.watchY = Number(pos.y)
      }
    }
  }

  Connections {
    target: Hyprland
    function onRawEvent(event) {
      var name = event ? String(event.name) : ""
      // A mapped window during a load is that program arriving. A later
      // non-toolbar window of a program that already loaded can zoom too.
      if (name === "openwindow") {
        root.noteOpenedWindow(event)
        return
      }
      if (name === "closewindow") {
        root.noteClosedWindow(event)
        return
      }
      // Keep the close trail's start rectangle on the window as it moves.
      if (Zoom.hasOpenSources()) root.refreshKnownFrames()
    }
  }

  Timer {
    id: tickTimer
    interval: root.tickMs
    repeat: true
    running: false
    onTriggered: {
      if (root.zoomMode === "close") root.applyCloseStep(Zoom.advanceClose())
      else if (root.zoomMode === "window") root.applyWindowStep(Zoom.advanceNewWindow())
      else root.applyLaunchStep(Zoom.advanceLaunch())
    }
  }

  Timer {
    id: newWindowTimer
    interval: 16
    repeat: true
    running: false
    onTriggered: root.pumpNewWindows()
  }

  Timer {
    id: revealAnimTimer
    interval: 50
    repeat: false
    running: false
    onTriggered: {
      var address = root.revealAddress
      root.revealAddress = ""
      if (address) root.dispatchProp(address, "no_anim", "unset")
    }
  }

  Process {
    id: opacityProc
    property string zoomClass: ""
    stdout: StdioCollector {
      id: opacityOut
      waitForEnd: true
      onStreamFinished: root.storeClassOpacity(opacityProc.zoomClass, opacityOut.text)
    }
  }

  Timer {
    id: cursorTimer
    interval: 50
    repeat: true
    running: false
    onTriggered: if (root.showWatch) root.queryCursor()
  }

  Timer {
    id: watchLimit
    interval: Zoom.watchLimitMs()
    repeat: false
    onTriggered: {
      root.disarmWatch()
      if (!root.zooming) root.finishPresentation()
    }
  }

  Variants {
    model: Quickshell.screens

    PanelWindow {
      id: panel
      required property var modelData

      screen: modelData
      visible: root.zooming
      color: "transparent"
      focusable: false

      anchors {
        top: true
        bottom: true
        left: true
        right: true
      }

      WlrLayershell.namespace: "zoomrects"
      WlrLayershell.layer: WlrLayer.Overlay
      WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
      exclusionMode: ExclusionMode.Ignore
      mask: Region {}

      onVisibleChanged: if (visible) outlineCanvas.requestPaint()

      Connections {
        target: root
        function onOutlinesChanged() { outlineCanvas.requestPaint() }
      }

      Canvas {
        id: outlineCanvas
        anchors.fill: parent
        antialiasing: false
        renderStrategy: Canvas.Immediate

        function strokeOutline(ctx, outline, originX, originY) {
          var x
          var y
          var w
          var h
          if (!outline || outline.filled || outline.stroke === false) return
          x = Math.round(outline.x - originX)
          y = Math.round(outline.y - originY)
          w = Math.round(outline.width)
          h = Math.round(outline.height)
          if (w <= 0 || h <= 0) return
          ctx.strokeStyle = "#111111"
          ctx.strokeRect(x, y, w, h)
          if (w > 2 && h > 2) {
            ctx.strokeStyle = "#f4f4f4"
            ctx.strokeRect(x + 1, y + 1, w - 2, h - 2)
          }
        }

        onPaint: {
          var ctx = getContext("2d")
          var originX = panel.modelData ? panel.modelData.x : 0
          var originY = panel.modelData ? panel.modelData.y : 0
          var list = root.outlines || []
          var i
          ctx.clearRect(0, 0, width, height)
          ctx.lineJoin = "miter"
          ctx.lineWidth = 4
          for (i = 0; i < list.length; i++) strokeOutline(ctx, list[i], originX, originY)
        }
      }
    }
  }

  Variants {
    model: Quickshell.screens

    PanelWindow {
      id: watchWindow
      required property var modelData

      readonly property bool onThisScreen: modelData
        && root.watchX >= modelData.x && root.watchX < modelData.x + modelData.width
        && root.watchY >= modelData.y && root.watchY < modelData.y + modelData.height

      screen: modelData
      visible: root.showWatch && onThisScreen
      color: "transparent"
      focusable: false
      implicitWidth: 32
      implicitHeight: 40

      anchors {
        top: true
        left: true
      }
      margins.top: Math.max(0, Math.round(root.watchY - modelData.y - 20))
      margins.left: Math.max(0, Math.round(root.watchX - modelData.x - 16))

      WlrLayershell.namespace: "zoomrects-watch"
      WlrLayershell.layer: WlrLayer.Overlay
      WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
      exclusionMode: ExclusionMode.Ignore
      mask: Region {}

      onVisibleChanged: if (visible) watchCanvas.requestPaint()

      Connections {
        target: root
        function onWatchXChanged() { watchCanvas.requestPaint() }
        function onWatchYChanged() { watchCanvas.requestPaint() }
        function onShowWatchChanged() { watchCanvas.requestPaint() }
      }

      Canvas {
        id: watchCanvas
        anchors.fill: parent
        antialiasing: false
        renderStrategy: Canvas.Immediate
        onPaint: {
          var ctx = getContext("2d")
          ctx.clearRect(0, 0, width, height)
          if (!root.showWatch) return
          ctx.lineWidth = 2
          ctx.strokeStyle = "#111111"
          ctx.fillStyle = "#f4f4f4"
          ctx.beginPath()
          ctx.arc(16, 22, 9, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
          ctx.beginPath()
          ctx.moveTo(16, 22)
          ctx.lineTo(16, 16)
          ctx.moveTo(16, 22)
          ctx.lineTo(21, 24)
          ctx.stroke()
          ctx.strokeRect(14, 10, 4, 3)
        }
      }
    }
  }
}
