# Contributing

Thanks for contributing to `Clipboard Decay`.

## Before opening a pull request

- discuss significant behavior or UX changes in an issue first
- keep changes focused; avoid unrelated cleanup in the same PR
- run the local checks before pushing:

```bash
npm test
npm run check:release
./scripts/package.sh
```

## Development notes

- the extension runs inside GNOME Shell, so runtime mistakes can affect session stability
- Wayland source detection is best-effort; do not claim stronger guarantees than the platform provides
- keep `extension.js` and `prefs.js` separated by process/toolkit boundaries
- do not add npm runtime dependencies; Node is only used for tests and release tooling

## Pull request expectations

- explain the user-visible impact and why the change is needed
- mention any GNOME Shell versions tested
- include manual verification steps for behavior that mocks cannot prove

## Release notes

- packaged builds derive `version-name` from the exact git tag on `HEAD`
- use short tags like `v1.0.0`
