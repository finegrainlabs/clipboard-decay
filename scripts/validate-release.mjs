#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

let failed = false;

function ok(message) {
    console.log(`ok - ${message}`);
}

function fail(message) {
    console.error(`error - ${message}`);
    failed = true;
}

function readText(relativePath) {
    return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function readJson(relativePath) {
    return JSON.parse(readText(relativePath));
}

function ensure(condition, message) {
    if (condition)
        ok(message);
    else
        fail(message);
}

const metadata = readJson('metadata.json');
const requiredMetadataFields = [
    'name',
    'description',
    'uuid',
    'shell-version',
    'url',
    'settings-schema',
];

for (const field of requiredMetadataFields)
    ensure(field in metadata, `metadata.json includes '${field}'`);

ensure(!('version' in metadata), "metadata.json omits deprecated 'version' field");
ensure(!('session-modes' in metadata), "metadata.json omits 'session-modes' for normal user mode only");
ensure(/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$/.test(metadata.uuid ?? ''), 'metadata.json uuid uses a valid extension format');
ensure(Array.isArray(metadata['shell-version']) && metadata['shell-version'].length > 0, 'metadata.json declares at least one shell version');
if ('version-name' in metadata)
    ensure(/^(?!^[. ]+$)[A-Za-z0-9 .]{1,16}$/.test(metadata['version-name']), 'metadata.json version-name uses the allowed format');

if (Array.isArray(metadata['shell-version'])) {
    const versions = metadata['shell-version'];
    const devVersions = versions.filter(version => !/^\d+$/.test(version));
    ensure(versions.every(version => /^\d+(\.(alpha|beta|rc))?$/.test(version)), 'shell-version entries use supported stable/dev formats');
    ensure(new Set(versions).size === versions.length, 'shell-version entries are unique');
    ensure(devVersions.length <= 1, 'shell-version includes at most one development release');
}

const description = String(metadata.description ?? '').toLowerCase();
const mentionsClipboard = description.includes('clipboard');
const mentionsClipboardAction = ['read', 'write', 'clear', 'access'].some(word => description.includes(word));
ensure(mentionsClipboard && mentionsClipboardAction, 'description explicitly declares clipboard access');

const schemaFile = path.join(rootDir, 'schemas', `${metadata['settings-schema']}.gschema.xml`);
ensure(fs.existsSync(schemaFile), 'schema XML filename matches settings-schema id');

if (fs.existsSync(schemaFile)) {
    const schemaText = fs.readFileSync(schemaFile, 'utf8');
    const schemaMatch = schemaText.match(/<schema[^>]*id="([^"]+)"[^>]*path="([^"]+)"/);

    ensure(Boolean(schemaMatch), 'schema XML exposes id and path attributes');

    if (schemaMatch) {
        const [, schemaId, schemaPath] = schemaMatch;
        ensure(schemaId === metadata['settings-schema'], 'schema XML id matches settings-schema');
        ensure(schemaPath.startsWith('/org/gnome/shell/extensions/'), 'schema XML path uses org.gnome.shell.extensions base path');
    }
}

const extensionText = readText('extension.js');
const prefsText = readText('prefs.js');
const runtimeFiles = ['extension.js', 'prefs.js', 'utils.js'];

for (const bannedImport of ['gi://Gtk', 'gi://Gdk', 'gi://Adw'])
    ensure(!extensionText.includes(bannedImport), `extension.js does not import ${bannedImport}`);

for (const bannedImport of ['gi://Clutter', 'gi://Meta', 'gi://St', 'gi://Shell', 'resource:///org/gnome/shell/ui/'])
    ensure(!prefsText.includes(bannedImport), `prefs.js does not import ${bannedImport}`);

for (const file of runtimeFiles) {
    const text = readText(file);

    ensure(!/\b(ByteArray|Mainloop|Lang)\b/.test(text), `${file} does not use deprecated GJS modules`);
    ensure(!/console\.(log|debug)\s*\(/.test(text), `${file} avoids noisy console logging`);
}

if (failed)
    process.exit(1);
