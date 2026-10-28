# Zoom Rects

An [Omarchy](https://omarchy.org/) shell plugin that explains a slow program launch the way classic Mac OS did.

On classic Mac OS, launching a program went in three steps: ZoomRects grew from the icon toward the window, the pointer became a watch while the machine was still working, and then the program could show its own startup status. This plugin plays that sequence when systemd starts an `app-Hyprland-….scope` for a program the user invoked. That includes the Omarchy menu (`gtk-launch`), a terminal (`xdg-terminal-exec`), a key binding that goes through `uwsm-app`, and `omarchy launch`.

1. **ZoomRects**, at the moment that launch starts, before Omarchy's Launching box. Unfilled outlines travel from a 32×32 rectangle centered on the pointer to the focused screen's work area, which is where a new tiled window opens. The work area is that monitor, inside its reserved insets and its outer gaps. When the pointer position is unavailable, the 32×32 rectangle is centered on the work area instead. If 32 pixels would not fit, the rectangle is made smaller so that it stays inside the work area. The default request is 0.1 seconds. On screen that is 96 milliseconds. It is the sign that the launch has started and the program is still loading.
2. **Watch**, only after this plugin has asked for the Launching box, and only while `omarchy-shell osd state` reports open. The watch is a small mark at the pointer. The zoom layer is already gone, so it does not sit across that box. The watch goes away when the box closes. It also goes away when the program's window opens after the trail, and after 15 seconds if the window never opens. Fifteen seconds is the same limit the Omarchy menu uses for its own Launching box.
3. **Launching box**, as soon as the rectangles finish, using Omarchy's own on-screen display (`omarchy-shell osd show`). The text from this plugin is `Launching…`. For a launch from the Omarchy menu, that is earlier than the menu's usual two-second wait. The box is not shown if the program's window opened during the trail. It closes when the window opens. If a menu launch is still waiting after that two-second wait, the menu replaces the text with its own Launching line, which includes the program name. Any other launch, including a terminal, a key binding, and `omarchy launch`, keeps this plugin's `Launching…` text. If the window never opens, this plugin clears the box after 15 seconds.

When that program's window closes, the rectangles play in reverse. They shrink from the window's latest rectangle to the 32×32 icon stored for the launch. The close uses the same 12 steps and the same duration. It does not show the watch or the Launching box. The outlines are the same fullscreen layer, and that layer is gone when the short trail ends. A window with no stored icon closes with no trail. When the window's own rectangle was never seen, the trail starts from the work area the launch grew into.

The first window of a launch is that load trail. A later window of the same program, after the load has finished, is kept invisible while its trail grows from the stored icon to that window's rectangle. The window appears when the rectangles reach it, then shrinks back to the icon when it closes. The icon is the one saved at launch, centered on the pointer from that moment. Toolbars, menus, tooltips, docks, splash screens, popups, and windows attached to another window do not play this trail. A window that maps while the load trail or the Launching box is still up stays with that one load trail. This second set is on unless the config file sets `newWindows` to false. The shell has to see the program launch once after it starts before a later window can zoom, because the icon is stored then.

Launches closer together than 0.8 seconds count as one launch. The outlines are a fullscreen layer with an empty input mask, and that layer is gone when the short zoom ends so it does not sit on top of the Launching box.

The plugin notices a launch when systemd starts an `app-Hyprland-….scope` unit. It ignores units outside that pattern. It also ignores these session helpers when they appear in that pattern: `udiskie`, `omarchy-hyprland-monitor-watch`, `hyprsunset`, `omarchy-shell`, `xdg-desktop-portal`, `xdg-desktop-portal-hyprland`, and `xdg-desktop-portal-gtk`. It does not edit Hyprland config, and it does not write files under the Omarchy install or in the home directory. The only configuration it reads is the optional file below.

The rectangle math lives in `zoomrects.js`. The shell entry is `Service.qml`. Tests import `zoomrects.js` directly and do not need Quickshell or Hyprland.

## Plugin record

`manifest.json` is the Omarchy plugin contract for this tree:

| Field | Value |
| --- | --- |
| `schemaVersion` | `1` |
| `id` | `zoomrects` |
| `name` | Zoom Rects |
| `version` | `0.0.1` |
| `license` | `MIT` |
| `kinds` | `service` |
| `keepLoaded` | `true` |
| `entryPoints.service` | `Service.qml` |

The id is outside the reserved `omarchy.` namespace. `keepLoaded` keeps the launch listener mounted across a plugin rescan. Because of that, a change to `Service.qml` or `zoomrects.js` is picked up with `omarchy restart shell`, not by the rescan alone. Check the manifest before publishing or installing:

```bash
omarchy plugin validate .
```

## Install

From this repository. The default branch has `manifest.json` at the repository root. Release 0.0.1 is private, so git has to be able to read that URL without an interactive prompt:

```bash
omarchy plugin add https://github.com/aquanbeck/zoomrects.git --enable
```

`omarchy plugin add` asks before it clones, then clones that repository into `~/.config/omarchy/plugins/zoomrects`. Plugins run unsandboxed inside the Omarchy shell. `--enable` turns the service on after the clone. Without `--enable`, the same command asks whether to enable it now. If that answer is no, the plugin stays installed and disabled until:

```bash
omarchy plugin enable zoomrects
```

To install a local checkout by hand, copy this directory to `~/.config/omarchy/plugins/zoomrects` (the copy must be a real directory, not a symlink) and enable it with the same `omarchy plugin enable` command. The shell notices a new plugin directory on its own. `omarchy plugin validate` refuses a plugin folder that contains a symlink.

## Update

For a git install:

```bash
omarchy plugin update zoomrects
omarchy restart shell
```

`omarchy plugin update` fast-forwards the checkout and asks the shell to rescan. This plugin is `keepLoaded`, so the running service keeps the code it was started with until `omarchy restart shell`. A hand-copied directory is not a git checkout, so `omarchy plugin update` does not apply to it. Copy the new files over the directory, then restart the shell the same way.

Saving `$XDG_CONFIG_HOME/zoomrects.json` does not need a restart. That file is read by the running service. See [Duration](#duration).

## Remove

```bash
omarchy plugin remove zoomrects
```

Removal disables the plugin if it was enabled. A git checkout is deleted. A hand-copied directory is moved aside, not deleted. The backup path is `~/.config/omarchy/plugins/.zoomrects.bak.` plus a UTC timestamp `YYYYMMDDHHMMSS`.

## Publishing

This is a third-party plugin. Do **not** open a pull request against [omacom/omarchy](https://github.com/omacom/omarchy). The shell already loads third-party plugins from git.

Release 0.0.1 is the default branch of the private repository [aquanbeck/zoomrects](https://github.com/aquanbeck/zoomrects). `manifest.json`, this README, and `LICENSE` are at the repository root.

A listing at [plugins.omarchy.org](https://plugins.omarchy.org) needs that repository to be public, then an issue on [omacom/omarchy-plugin-marketplace](https://github.com/omacom/omarchy-plugin-marketplace/issues/new?template=submit-plugin.yml). The draft title, category, tags, and body are in [SUBMISSION.md](SUBMISSION.md). That issue has not been filed. The marketplace checks the current commit before a maintainer approves the listing, and listing is not a security review. Marketplace ids are permanent, so search for `zoomrects` again before filing.

## Duration

The default request is 0.1 seconds, set in code. Later windows of a program that already loaded also zoom, unless `newWindows` is false. Both keys live in the manual page [man/zoomrects.5](man/zoomrects.5). From this tree:

```bash
man -l man/zoomrects.5
```

After install:

```bash
man -l ~/.config/omarchy/plugins/zoomrects/man/zoomrects.5
```

Create `$XDG_CONFIG_HOME/zoomrects.json`, or `~/.config/zoomrects.json` when `XDG_CONFIG_HOME` is unset. The plugin does not create this file.

```json
{ "durationSec": 0.05, "newWindows": false }
```

`durationSec` stays between 0.01 and 0.5 seconds. A smaller finite number is raised to 0.01. A larger finite number is lowered to 0.5. A missing file, an unreadable file, invalid JSON, or a file without a finite numeric `durationSec` keeps 0.1.

`newWindows` is a boolean. It is on when the file is missing, the key is absent, or the value is not a JSON boolean. Set it to false to keep only the load trail and its close. `true` leaves the later-window trails on. Saving the file applies on the next window. A trail that has already started finishes.

The open trail and the close trail are each 12 steps. Each step is rounded to the nearest millisecond, and a step below 1 millisecond becomes 1 millisecond. A trail lasts 12 times that step:

| Requested `durationSec` | Step | On screen |
| --- | --- | --- |
| 0.1 (default) | 8 ms | 96 ms |
| 0.05 (example) | 4 ms | 48 ms |
| 0.01 (minimum) | 1 ms | 12 ms |
| 0.5 (maximum) | 42 ms | 504 ms |

Saving the file updates the step length and the later-window switch in the running plugin. The shell does not need to be restarted. A trail that has already started keeps the outlines already drawn. Later steps use the new length.

## Dependencies

Runtime, already provided by an Omarchy desktop:

- Omarchy shell (Quickshell) and `omarchy-shell`
- Hyprland (`hyprctl`)
- a systemd user session (`busctl`)
- `bash`
- coreutils (`stdbuf`)

Tests need Node.js. The plugin does not download anything at runtime.

## Tests

```bash
node test/zoom-open.test.js
node test/zoom-open-window.test.js
node test/zoom-launch.test.js
node test/zoom-close.test.js
node test/zoom-new-window.test.js
node test/zoom-audit.test.js
```

`test/zoom-launch.test.js` locks the on-screen times above: the default step is 8 milliseconds, the minimum step is 1 millisecond, the maximum step is 42 milliseconds, and 8 × 12 is 96. `test/zoom-close.test.js` locks the reverse trail: the last rectangle is the stored icon, an unknown window plays nothing, and the step count stays 12. `test/zoom-new-window.test.js` locks the later-window trail and the `newWindows` switch. `test/zoom-audit.test.js` locks the default 0.1, the 0.01 floor, and the 0.5 ceiling.

## License

MIT. See [LICENSE](LICENSE).
