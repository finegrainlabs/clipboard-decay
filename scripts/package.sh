#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$ROOT_DIR/.build/package"
UUID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["uuid"])' "$ROOT_DIR/metadata.json")"
ZIP_PATH="$ROOT_DIR/${UUID}.zip"

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/$UUID/schemas"

node "$ROOT_DIR/scripts/render-metadata.mjs" "$ROOT_DIR/metadata.json" "$BUILD_DIR/$UUID/metadata.json"
cp "$ROOT_DIR/extension.js" "$BUILD_DIR/$UUID/"
cp "$ROOT_DIR/prefs.js" "$BUILD_DIR/$UUID/"
cp "$ROOT_DIR/utils.js" "$BUILD_DIR/$UUID/"
cp "$ROOT_DIR/LICENSE" "$BUILD_DIR/$UUID/"
cp "$ROOT_DIR/NOTICE" "$BUILD_DIR/$UUID/"
cp "$ROOT_DIR/README.md" "$BUILD_DIR/$UUID/"
cp "$ROOT_DIR/schemas/org.gnome.shell.extensions.clipboard-decay.gschema.xml" "$BUILD_DIR/$UUID/schemas/"

glib-compile-schemas "$BUILD_DIR/$UUID/schemas"

rm -f "$ZIP_PATH"
python3 - <<'PY' "$BUILD_DIR" "$UUID" "$ZIP_PATH"
import os
import sys
import zipfile

build_dir, uuid_dir, zip_path = sys.argv[1:4]
root = os.path.join(build_dir, uuid_dir)

with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
    for dirpath, _, filenames in os.walk(root):
        for filename in filenames:
            path = os.path.join(dirpath, filename)
            arcname = os.path.relpath(path, root)
            zf.write(path, arcname)
PY

printf 'Wrote %s\n' "$ZIP_PATH"
