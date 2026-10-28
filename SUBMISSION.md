# Submission draft

Release 0.0.1 is the public repository https://github.com/aquanbeck/zoomrects. The marketplace issue has not been filed. Do not file it until the owner says to submit.

## Not done

- The marketplace issue was **not** filed.
- No pull request was opened against `omacom/omarchy`. Do not open one. Zoom Rects is a third-party shell plugin.

## Before filing

1. The repository https://github.com/aquanbeck/zoomrects is public. The default branch has `manifest.json`, `README.md`, and `LICENSE` at the repository root.
2. Search [plugins.omarchy.org](https://plugins.omarchy.org) for the id `zoomrects`. Marketplace ids are permanent. As of 23 September 2026 that id was not in the catalog. Search again on the day you file.
3. The issue body below uses the repository root URL. No trailing slash, and no `/tree/main` suffix. `https://github.com/aquanbeck/zoomrects.git` is the `omarchy plugin add` URL. The issue body wants the root URL.
4. Ask the owner to confirm every checklist line, especially ownership. Check all five boxes only after that confirmation. The marketplace rejects a body whose headings, order, or checklist text differ from the template.
5. File with GitHub CLI, authenticated as the owner. Do not file from this draft while any box is still open.

Install and remove:

```bash
omarchy plugin add https://github.com/aquanbeck/zoomrects.git --enable
omarchy plugin remove zoomrects
```

The plugin id is `zoomrects`. It is not in the reserved `omarchy.` namespace. `omarchy plugin validate .` passes against the schema in `omarchy-plugin-validate`: schema version 1, required fields, relative entry point `Service.qml`, kind `service` paired with `entryPoints.service`, and no symlinks.

## Issue to file

Title:

```text
[Plugin]: Zoom Rects
```

Body:

```markdown
### Repository URL

https://github.com/aquanbeck/zoomrects

### Category

Desktop

### Tags

launcher, hyprland, quickshell

### Suggest a missing tag

_No response_

### Maintainer notes

Zoom Rects is a keepLoaded service. It listens for app-Hyprland scope launches and draws the classic zoom-rectangle trail, then shows Omarchy's Launching box through `omarchy-shell osd`. When that window closes, the trail shrinks back to the icon stored for the launch. The optional duration file is `$XDG_CONFIG_HOME/zoomrects.json` (default `~/.config/zoomrects.json`). The plugin only reads that file. It does not create it, and it does not edit Hyprland or Omarchy config. Runtime tools already on an Omarchy desktop: `omarchy-shell`, `hyprctl`, `busctl`, `bash`, and `stdbuf`. Nothing is downloaded at runtime. License is MIT.

### Submission checklist

- [ ] The repository is public and contains installation and removal instructions.
- [ ] I have documented the plugin license and any external dependencies.
- [ ] I confirm that I own or have permission to submit this plugin and its preview assets.
- [ ] The plugin does not overwrite user configuration without explicit consent.
- [ ] I understand that approval is for listing and is not a security review.
```

Create it only after the URL is real and the owner has confirmed the checklist:

```bash
gh issue create \
  --repo omacom/omarchy-plugin-marketplace \
  --title "[Plugin]: Zoom Rects" \
  --body-file /tmp/omarchy-plugin-submission.md
```

## Why these listing fields

Category `Desktop` is one of the marketplace categories. Tags must be one to three values from the marketplace list. `animation`, `launch`, and `classic-mac` are not in that list and would be rejected. The three tags that match the plugin are:

- `launcher` — it responds to menu, terminal, and `uwsm-app` launches
- `hyprland` — it reads `hyprctl` cursor, monitors, and gaps, and it listens for Hyprland `openwindow` and `closewindow`
- `quickshell` — `Service.qml` is a Quickshell service entry

There is no preview image. A root `preview.png`, `preview.jpg`, `preview.jpeg`, `preview.webp`, or `preview.avif` is optional.

## What a reviewer should check

- `manifest.json` matches the table in `README.md`: schema version 1, id `zoomrects`, version `0.0.1`, license `MIT`, kind `service`, `keepLoaded` true, `entryPoints.service` `Service.qml`.
- `man/zoomrects.5` and the Duration section of `README.md` agree with `zoomrects.js` and the tests: default `0.1`, floor `0.01`, ceiling `0.5`, 12 steps, on-screen times 96 ms, 48 ms, 12 ms, and 504 ms.
- A missing, unreadable, empty, or invalid duration file, or a non-finite `durationSec`, keeps `0.1`. Finite numbers outside the range are clamped. `newWindows` defaults to true. Only a JSON boolean `false` turns off trails for later non-toolbar windows of a program that already loaded. A missing key or a non-boolean keeps that default. The load trail is still only the first window.
- The Launching text this plugin sends is `Launching…`. The box is skipped when the window opens during the trail. When that window closes, the rectangles shrink back to the stored 32×32 icon in the same 12 steps. A window with no stored icon does not play a close trail. After the load has finished, a later non-toolbar window of that program zooms from the same stored icon to its own rectangle and back on close, unless `newWindows` is false. Toolbars, menus, and windows attached to another window do not. The watch follows `omarchy-shell osd state` reporting `open` after the plugin has asked for the box. Both the watch and this plugin's box are cleared after 15 seconds, the same limit as the Omarchy menu's launch timeout. A menu launch that is still waiting at 2 seconds gets the menu's own named Launching line. Other launches, including a terminal, a key binding, and `omarchy launch`, keep `Launching…`. A second launch inside 0.8 seconds does not start another trail.
- Runtime dependencies are Omarchy's shell, Hyprland (`hyprctl`), a systemd user session (`busctl`), `bash`, coreutils (`stdbuf`), and `omarchy-shell`. Tests need Node.js. Nothing is downloaded at runtime.
- License: MIT (`LICENSE`).
- Because `keepLoaded` is true, `omarchy plugin update zoomrects` still needs `omarchy restart shell` before new service code runs. The duration file does not need that restart.
