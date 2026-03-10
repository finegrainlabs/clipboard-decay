#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const [inputPath, outputPath] = process.argv.slice(2);

if (!inputPath || !outputPath) {
    console.error('Usage: render-metadata.mjs <input> <output>');
    process.exit(1);
}

function git(args) {
    return execFileSync('git', ['-C', rootDir, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
}

function validateVersionName(versionName, sourceLabel) {
    const normalized = versionName
        .replace(/^v(?=\d)/, '')
        .replace(/[-_]+/g, ' ')
        .replace(/[^A-Za-z0-9 .]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!/^(?!^[. ]+$)[A-Za-z0-9 .]{1,16}$/.test(normalized)) {
        throw new Error(
            `${sourceLabel} resolved to an invalid version-name '${normalized || versionName}'. ` +
            'Use a short git tag like v1.0.0 or set VERSION_NAME explicitly.'
        );
    }

    return normalized;
}

function resolveVersionName() {
    if (process.env.VERSION_NAME?.trim())
        return validateVersionName(process.env.VERSION_NAME.trim(), 'VERSION_NAME');

    try {
        const exactTag = git(['describe', '--tags', '--exact-match', 'HEAD']);
        return validateVersionName(exactTag, 'git tag');
    } catch {
        // Fall through to a development build label.
    }

    try {
        return validateVersionName(`dev ${git(['rev-parse', '--short=7', 'HEAD'])}`, 'git commit');
    } catch {
        return 'development';
    }
}

const metadata = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
metadata['version-name'] = resolveVersionName();

fs.mkdirSync(path.dirname(outputPath), {recursive: true});
fs.writeFileSync(outputPath, `${JSON.stringify(metadata, null, 4)}\n`);
