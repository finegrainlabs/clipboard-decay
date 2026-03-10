// SPDX-License-Identifier: GPL-2.0-or-later
// Preload script — use via: node --import ./tests/register.mjs
//
// 1. Creates fresh mocks and attaches them to globalThis.__mocks
// 2. Sets globalThis.display (GJS 'global' object equivalent)
// 3. Registers ESM loader hooks to intercept gi:// and resource:// imports

import {register} from 'node:module';
import {createMocks} from './mocks.mjs';

const mocks = createMocks();

globalThis.__mocks = mocks;
globalThis.display = mocks.display;

register('./hooks.mjs', import.meta.url);
