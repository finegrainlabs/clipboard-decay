# Clipboard Decay

Clipboard Decay is a GNOME Shell extension that can clear the clipboard after configurable timeouts.

Copies detected as coming from configured sensitive apps can use a shorter timeout. A separate general timer can be enabled for all other copies. On Wayland, source detection is best-effort and uses the focused application as a hint because GNOME Shell does not expose a fully reliable clipboard-origin API.

## Features

- Supports a shorter timeout for copies detected as coming from configured sensitive apps
- Can optionally clear all other clipboard copies after a separate general timeout
- Lets you disable sensitive app detection entirely
- Lets you add sensitive apps from installed applications first, with manual identifier entry as an advanced fallback
- Includes a one-click restore-defaults action in preferences
- Shows a temporary panel indicator while a decay timer is active

## Scope

- Monitors only the regular clipboard (`SELECTION_CLIPBOARD`), not the primary selection used for middle-click paste
- Designed and tested for GNOME Shell on Wayland; X11 behavior is currently undocumented and unverified

## Safety Model

- The extension runs inside GNOME Shell and never sends clipboard contents anywhere
- Clipboard clearing is implemented by writing an empty string because GNOME Shell does not expose a true clipboard-clear API
- After the timer fires, the clipboard therefore contains `""` rather than a true no-content state
- Sensitive-source detection is best-effort on Wayland and can be wrong if the focused app does not match the real clipboard owner
- Relay tools such as `wl-copy` and OSC-52 bridges are handled conservatively to avoid downgrading an active sensitive timer

## Settings

The default model is sensitive-only: copies detected as coming from configured sensitive apps use the shorter timeout, while all other clipboard copies stay untouched unless you explicitly enable the general timer.

- `General Timer`: optional fallback timer for copies that do not match a listed app
- `Sensitive Apps`: detection toggle, shorter timeout, selected apps, and add flow
- `Add Apps`: searchable installed-app picker as the primary way to add apps
- `Add App`: fallback flow for detecting the next focused window or entering an app ID manually
- `Restore Defaults`: restores the default toggles and timeouts, and clears the sensitive app list
- There is no built-in sensitive app list by default; add the apps you personally want Clipboard Decay to try to recognize as sensitive

## Local Installation

The local UUID is currently `clipboard-decay@finegrainlabs`, so the extension directory must match that name.

Replace `/path/to/clipboard-decay` with your local checkout path.

```bash
cd /path/to/clipboard-decay
mkdir -p ~/.local/share/gnome-shell/extensions
ln -s "$PWD" ~/.local/share/gnome-shell/extensions/clipboard-decay@finegrainlabs
glib-compile-schemas schemas/
gnome-extensions enable clipboard-decay@finegrainlabs
```

On Wayland, code changes usually require disabling/re-enabling the extension or logging out and back in if GNOME Shell refuses to hot-reload cleanly.

## Development

Contribution guidelines live in `CONTRIBUTING.md`.

Run tests:

```bash
node --import ./tests/register.mjs --test ./tests/extension.test.mjs
```

Run tests with coverage:

```bash
node --import ./tests/register.mjs --experimental-test-coverage --test ./tests/extension.test.mjs
```

Compile schemas:

```bash
glib-compile-schemas schemas/
```

## Manual QA Checklist

- native Wayland app copy does not decay unless the general timer is enabled
- a copy detected as coming from a selected sensitive app uses the sensitive timeout
- disabling `Sensitive App Detection` prevents selected apps from getting the shorter timeout
- enabling the general timer makes non-sensitive copies use the general timeout
- relay helpers such as `wl-copy` or OSC-52 do not downgrade an already-running sensitive timer
- enable, disable, lock, unlock, suspend, and resume leave no stale indicator or timer behind
- preferences stay in sync after external settings changes and the reset button restores defaults cleanly

## Packaging

To build a release zip for local installation or GNOME Extensions packaging:

```bash
./scripts/package.sh
```

Packaged builds automatically stamp `metadata.json` with a user-visible `version-name` derived from the exact git tag on `HEAD` (for example `v1.0.0` becomes `1.0.0`). If `HEAD` is not tagged, the package falls back to a development label based on the short commit hash.

To publish a GitHub Release automatically, create and push a tag like `v0.1.0`. The release workflow will run the tests, build a versioned asset such as `clipboard-decay@finegrainlabs-v0.1.0.zip`, generate a matching `.sha256` file, and attach both files to the generated GitHub Release.

## License

This project is licensed under `GPL-2.0-or-later`.

- `LICENSE` contains the canonical GPL v2 license text used for distribution and GitHub detection
- `NOTICE` explains the project-specific `GPL-2.0-or-later` licensing statement used by the source file SPDX headers
