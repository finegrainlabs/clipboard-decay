// SPDX-License-Identifier: GPL-2.0-or-later
// Unit tests for ClipboardDecay extension.
// Run: node --import ./tests/register.mjs --test ./tests/extension.test.mjs
// Coverage: node --import ./tests/register.mjs --experimental-test-coverage --test ./tests/extension.test.mjs

import {describe, it, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createMocks} from './mocks.mjs';
import {
    DETECT_WINDOW_MODE_KEY,
    DETECTED_WINDOW_ID_KEY,
    DEFAULT_GENERAL_TIMEOUT_ENABLED,
    DEFAULT_GENERAL_TIMEOUT,
    DEFAULT_SENSITIVE_SOURCES,
    DEFAULT_SENSITIVE_SOURCES_ENABLED,
    DEFAULT_SENSITIVE_TIMEOUT,
    ENABLE_GENERAL_TIMEOUT_KEY,
    ENABLE_SENSITIVE_SOURCES_KEY,
    SENSITIVE_SOURCES_KEY,
    generalTimeoutEnabled,
    getSensitiveSources,
    normalizeId,
    normalizeIdList,
    sensitiveSourcesEnabled,
} from '../utils.js';

// The extension module is imported AFTER hooks are registered (via register.mjs).
// ClipboardDecay extends our mock ExtensionBase.
let ClipboardDecay;
let ClipboardDecayPreferences;

// Fresh mocks for each test
let mocks;

// Helper: swap globalThis.__mocks with fresh instances before importing ext.
function resetMocks(settingsDefaults) {
    mocks = createMocks(settingsDefaults);
    globalThis.__mocks = mocks;
    globalThis.display = mocks.display;
}

// Import extension (once — class definition is reusable; mocks are swapped per-test)
const mod = await import('../extension.js');
ClipboardDecay = mod.default;
const prefsMod = await import('../prefs.js');
ClipboardDecayPreferences = prefsMod.default;

// Constant for clipboard selection type (matches Mutter enum: PRIMARY=0, CLIPBOARD=1)
const CLIPBOARD = 1;
const PRIMARY = 0;

// ─── Helpers ───────────────────────────────────────────────────────────

/** Create an extension instance, call enable(), return it. */
function makeExt() {
    const ext = new ClipboardDecay();
    ext.enable();
    return ext;
}

/** Simulate a clipboard copy from a non-PM window. */
function simulateCopy(ext) {
    mocks.selection.emitOwnerChanged(CLIPBOARD, {});
}

/** Simulate a clipboard copy from a PM-matched window (by WM_CLASS). */
function simulatePMCopy(ext, wmClass = 'keepassxc') {
    mocks.display.focus_window = {
        get_wm_class: () => wmClass,
    };
    mocks.windowTracker._app = null;
    mocks.selection.emitOwnerChanged(CLIPBOARD, {});
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('ClipboardDecay', () => {
    beforeEach(() => {
        resetMocks();
    });

    afterEach(() => {
        // Ensure no leaks
    });

    // ── normalizeId ──

    describe('normalizeId()', () => {
        it('returns trimmed lowercase string', () => {
            assert.equal(normalizeId('  KeePassXC  '), 'keepassxc');
        });

        it('strips single .desktop suffix', () => {
            assert.equal(normalizeId('org.keepassxc.KeePassXC.desktop'), 'org.keepassxc.keepassxc');
        });

        it('strips double .desktop suffix (Bitwarden Flatpak)', () => {
            assert.equal(normalizeId('com.bitwarden.desktop.desktop'), 'com.bitwarden');
        });

        it('handles empty string', () => {
            assert.equal(normalizeId(''), '');
        });

        it('handles string that is just .desktop', () => {
            assert.equal(normalizeId('.desktop'), '');
        });

        it('returns empty string for non-string input', () => {
            assert.equal(normalizeId(null), '');
            assert.equal(normalizeId(undefined), '');
            assert.equal(normalizeId(42), '');
        });
    });

    describe('normalizeIdList()', () => {
        it('normalizes, deduplicates, and filters entries', () => {
            assert.deepEqual(normalizeIdList([
                ' KeePassXC ',
                'keepassxc.desktop',
                '',
                '.desktop',
                null,
            ]), ['keepassxc']);
        });

        it('returns empty list for non-arrays', () => {
            assert.deepEqual(normalizeIdList(null), []);
            assert.deepEqual(normalizeIdList('keepassxc'), []);
        });
    });

    describe('generalTimeoutEnabled()', () => {
        it('returns the default when unset', () => {
            assert.equal(generalTimeoutEnabled(mocks.settings), DEFAULT_GENERAL_TIMEOUT_ENABLED);
        });

        it('returns true when the setting is enabled', () => {
            mocks.settings.set_boolean(ENABLE_GENERAL_TIMEOUT_KEY, true);
            assert.equal(generalTimeoutEnabled(mocks.settings), true);
        });

        it('falls back to the default when get_boolean is unavailable', () => {
            assert.equal(generalTimeoutEnabled({}), DEFAULT_GENERAL_TIMEOUT_ENABLED);
        });
    });

    describe('sensitiveSourcesEnabled()', () => {
        it('returns true by default', () => {
            assert.equal(sensitiveSourcesEnabled(mocks.settings), DEFAULT_SENSITIVE_SOURCES_ENABLED);
        });

        it('returns false when the setting is disabled', () => {
            mocks.settings.set_boolean(ENABLE_SENSITIVE_SOURCES_KEY, false);
            assert.equal(sensitiveSourcesEnabled(mocks.settings), false);
        });

        it('falls back to true when get_boolean is unavailable', () => {
            assert.equal(sensitiveSourcesEnabled({}), DEFAULT_SENSITIVE_SOURCES_ENABLED);
        });
    });

    describe('getSensitiveSources()', () => {
        it('returns normalized sources from the new key', () => {
            mocks.settings.seedUserValue(SENSITIVE_SOURCES_KEY, [' KeePassXC ', 'keepassxc.desktop']);
            assert.deepEqual(getSensitiveSources(mocks.settings), ['keepassxc']);
        });

        it('falls back to empty array when get_strv is unavailable', () => {
            assert.deepEqual(getSensitiveSources({}), []);
        });
    });

    // ── _loadDecaySettings ──

    describe('_loadDecaySettings()', () => {
        it('loads general and sensitive settings from defaults', () => {
            const ext = makeExt();
            assert.equal(ext._generalTimeoutEnabled, false);
            assert.equal(ext._sensitiveSourcesEnabled, true);
            assert.equal(ext._sensitiveSources.size, 0);
            ext.disable();
        });

        it('reloads general-timeout enabled state when toggle changes', () => {
            const ext = makeExt();
            mocks.settings.set_boolean(ENABLE_GENERAL_TIMEOUT_KEY, true);
            assert.equal(ext._generalTimeoutEnabled, true);
            ext.disable();
        });

        it('reloads when settings change', () => {
            const ext = makeExt();
            mocks.settings.set(SENSITIVE_SOURCES_KEY, ['NewPM']);
            assert.ok(ext._sensitiveSources.has('newpm'));
            assert.equal(ext._sensitiveSources.size, 1);
            ext.disable();
        });

        it('filters out empty normalized entries', () => {
            resetMocks({'sensitive-sources': ['keepassxc', '', '.desktop', '  ']});
            const ext = makeExt();
            assert.ok(ext._sensitiveSources.has('keepassxc'));
            assert.ok(!ext._sensitiveSources.has(''));
            assert.equal(ext._sensitiveSources.size, 1);
            ext.disable();
        });

        it('reloads enabled state when toggle changes', () => {
            const ext = makeExt();
            mocks.settings.set_boolean(ENABLE_SENSITIVE_SOURCES_KEY, false);
            assert.equal(ext._sensitiveSourcesEnabled, false);
            ext.disable();
        });
    });

    describe('_clearArmedDecay()', () => {
        it('cancels the running timer and hides the indicator', () => {
            resetMocks({'enable-general-timeout': true});
            const ext = makeExt();
            simulateCopy(ext);

            ext._clearArmedDecay();

            assert.equal(ext._timerId, null);
            assert.equal(mocks.GLib._timers.size, 0);
            assert.equal(ext._indicator.visible, false);
            ext.disable();
        });
    });

    describe('_getFocusedSourceInfo()', () => {
        it('returns empty source info when there is no focused window', () => {
            const ext = makeExt();
            mocks.display.focus_window = null;
            assert.deepEqual(ext._getFocusedSourceInfo(), {
                hasWindow: false,
                wmClass: '',
                appId: '',
            });
            ext.disable();
        });

        it('returns normalized wmClass and appId', () => {
            const ext = makeExt();
            mocks.display.focus_window = {get_wm_class: () => ' KeePassXC '};
            mocks.windowTracker._app = {get_id: () => 'org.keepassxc.KeePassXC.desktop'};

            assert.deepEqual(ext._getFocusedSourceInfo(), {
                hasWindow: true,
                wmClass: 'keepassxc',
                appId: 'org.keepassxc.keepassxc',
            });
            ext.disable();
        });
    });

    describe('_getDetectableWindowId()', () => {
        it('prefers app-id over wmClass when both exist', () => {
            const ext = makeExt();
            mocks.display.focus_window = {get_wm_class: () => 'firefox'};
            mocks.windowTracker._app = {get_id: () => 'org.mozilla.firefox.desktop'};

            assert.equal(ext._getDetectableWindowId(), 'org.mozilla.firefox');
            ext.disable();
        });

        it('falls back to wmClass when app-id is unavailable', () => {
            const ext = makeExt();
            mocks.display.focus_window = {get_wm_class: () => 'KeePassXC'};
            mocks.windowTracker._app = null;

            assert.equal(ext._getDetectableWindowId(), 'keepassxc');
            ext.disable();
        });

        it('returns empty string when no focused window is available', () => {
            const ext = makeExt();
            mocks.display.focus_window = null;

            assert.equal(ext._getDetectableWindowId(), '');
            ext.disable();
        });
    });

    describe('focused-window detection mode', () => {
        it('starts watching the next focus change when detect mode is enabled', () => {
            const ext = makeExt();

            mocks.settings.set_boolean(DETECT_WINDOW_MODE_KEY, true);

            assert.notEqual(ext._focusCaptureSignalId, null);
            assert.notEqual(ext._focusCaptureTimeoutId, null);
            ext.disable();
        });

        it('captures the next focused window identifier and exits detect mode', () => {
            const ext = makeExt();

            mocks.settings.set_boolean(DETECT_WINDOW_MODE_KEY, true);
            mocks.display.focus_window = {get_wm_class: () => 'KeePassXC'};
            mocks.windowTracker._app = {get_id: () => 'org.keepassxc.KeePassXC.desktop'};
            mocks.display.emitFocusWindowChanged();

            assert.equal(mocks.settings.get_string(DETECTED_WINDOW_ID_KEY), 'org.keepassxc.keepassxc');
            assert.equal(mocks.settings.get_boolean(DETECT_WINDOW_MODE_KEY), false);
            assert.equal(ext._focusCaptureSignalId, null);
            assert.equal(ext._focusCaptureTimeoutId, null);
            ext.disable();
        });

        it('keeps waiting when the newly focused window does not expose a detectable identifier', () => {
            const ext = makeExt();

            mocks.settings.set_boolean(DETECT_WINDOW_MODE_KEY, true);
            mocks.display.focus_window = {get_wm_class: () => null};
            mocks.windowTracker._app = null;
            mocks.display.emitFocusWindowChanged();

            assert.equal(mocks.settings.get_string(DETECTED_WINDOW_ID_KEY), '');
            assert.equal(mocks.settings.get_boolean(DETECT_WINDOW_MODE_KEY), true);
            assert.notEqual(ext._focusCaptureSignalId, null);
            assert.notEqual(ext._focusCaptureTimeoutId, null);
            ext.disable();
        });

        it('ignores the window that was focused when detection started', () => {
            const ext = makeExt();
            const prefsWindow = {get_wm_class: () => 'org.gnome.extensions'};
            mocks.display.focus_window = prefsWindow;

            mocks.settings.set_boolean(DETECT_WINDOW_MODE_KEY, true);
            mocks.display.emitFocusWindowChanged();

            assert.equal(mocks.settings.get_string(DETECTED_WINDOW_ID_KEY), '');
            assert.equal(mocks.settings.get_boolean(DETECT_WINDOW_MODE_KEY), true);
            ext.disable();
        });

        it('stops watching when detect mode is cancelled', () => {
            const ext = makeExt();

            mocks.settings.set_boolean(DETECT_WINDOW_MODE_KEY, true);
            const firstSignalId = ext._focusCaptureSignalId;
            ext._syncFocusCaptureMode();

            assert.equal(ext._focusCaptureSignalId, firstSignalId);
            assert.equal(mocks.settings.get_boolean(DETECT_WINDOW_MODE_KEY), true);
            mocks.settings.set_boolean(DETECT_WINDOW_MODE_KEY, false);

            assert.equal(ext._focusCaptureSignalId, null);
            assert.equal(ext._focusCaptureTimeoutId, null);
            ext.disable();
        });

        it('returns early from _syncFocusCaptureMode when global.display is null', () => {
            const ext = makeExt();
            const saved = globalThis.display;
            try {
                globalThis.display = null;
                mocks.settings.set_boolean(DETECT_WINDOW_MODE_KEY, true);
                ext._syncFocusCaptureMode();
                assert.equal(ext._focusCaptureSignalId, null);
            } finally {
                globalThis.display = saved;
            }
            ext.disable();
        });

        it('times out and exits detect mode if no usable window is focused', () => {
            const ext = makeExt();

            mocks.settings.set_boolean(DETECT_WINDOW_MODE_KEY, true);
            mocks.GLib.fireAll();

            assert.equal(mocks.settings.get_boolean(DETECT_WINDOW_MODE_KEY), false);
            assert.equal(ext._focusCaptureSignalId, null);
            assert.equal(ext._focusCaptureTimeoutId, null);
            ext.disable();
        });

        it('returns false when capture is attempted without a detectable identifier', () => {
            const ext = makeExt();
            mocks.display.focus_window = null;

            assert.equal(ext._captureFocusedWindowId(), false);
            ext.disable();
        });

        it('tolerates missing string/boolean setters while capturing the focused window id', () => {
            const ext = new ClipboardDecay();
            ext._tracker = mocks.windowTracker;
            mocks.display.focus_window = {get_wm_class: () => 'firefox'};
            mocks.windowTracker._app = null;

            const settings = {
                get_boolean: key => key === DETECT_WINDOW_MODE_KEY,
            };
            ext._settings = settings;

            assert.equal(ext._captureFocusedWindowId(), true);
        });
    });

    describe('_matchesSensitiveSource()', () => {
        it('returns false for null info', () => {
            const ext = makeExt();
            assert.equal(ext._matchesSensitiveSource(null), false);
            ext.disable();
        });

        it('matches by wmClass', () => {
            resetMocks({'sensitive-sources': ['keepassxc']});
            const ext = makeExt();
            assert.equal(ext._matchesSensitiveSource({wmClass: 'keepassxc', appId: ''}), true);
            ext.disable();
        });

        it('matches by appId', () => {
            resetMocks({'sensitive-sources': ['org.keepassxc.keepassxc']});
            const ext = makeExt();
            assert.equal(ext._matchesSensitiveSource({wmClass: '', appId: 'org.keepassxc.keepassxc'}), true);
            ext.disable();
        });

        it('returns false when neither identifier matches', () => {
            const ext = makeExt();
            assert.equal(ext._matchesSensitiveSource({wmClass: 'firefox', appId: 'org.mozilla.firefox'}), false);
            ext.disable();
        });

        it('returns false when sensitive detection is disabled', () => {
            resetMocks({'sensitive-sources': ['keepassxc']});
            const ext = makeExt();
            mocks.settings.set_boolean(ENABLE_SENSITIVE_SOURCES_KEY, false);
            assert.equal(ext._matchesSensitiveSource({wmClass: 'keepassxc', appId: ''}), false);
            ext.disable();
        });
    });

    describe('_shouldIgnoreRelayEvent()', () => {
        it('returns false when sensitive detection is disabled', () => {
            const ext = makeExt();
            ext._timerId = 1;
            mocks.settings.set_boolean(ENABLE_SENSITIVE_SOURCES_KEY, false);
            assert.equal(ext._shouldIgnoreRelayEvent(), false);
            ext.disable();
        });

        it('returns false when no timer is running', () => {
            const ext = makeExt();
            mocks.display.focus_window = {get_wm_class: () => null};
            assert.equal(ext._shouldIgnoreRelayEvent(), false);
            ext.disable();
        });

        it('returns true for unidentifiable relay window', () => {
            const ext = makeExt();
            ext._timerId = 1;
            mocks.display.focus_window = {get_wm_class: () => null};
            mocks.windowTracker._app = {get_id: () => 'window:2'};
            assert.equal(ext._shouldIgnoreRelayEvent(), true);
            ext.disable();
        });

        it('returns false for identified non-relay window', () => {
            const ext = makeExt();
            ext._timerId = 1;
            mocks.display.focus_window = {get_wm_class: () => null};
            mocks.windowTracker._app = {get_id: () => 'org.keepassxc.KeePassXC.desktop'};
            assert.equal(ext._shouldIgnoreRelayEvent(), false);
            ext.disable();
        });
    });

    // ── _isSensitive ──

    describe('_isSensitive()', () => {
        it('returns false when no window is focused', () => {
            const ext = makeExt();
            mocks.display.focus_window = null;
            assert.equal(ext._isSensitive(), false);
            ext.disable();
        });

        it('returns true when WM_CLASS matches a PM', () => {
            resetMocks({'sensitive-sources': ['keepassxc']});
            const ext = makeExt();
            mocks.display.focus_window = {
                get_wm_class: () => 'KeePassXC',
            };
            mocks.windowTracker._app = null;
            assert.equal(ext._isSensitive(), true);
            ext.disable();
        });

        it('returns true when app-id matches a PM', () => {
            resetMocks({'sensitive-sources': ['org.keepassxc.keepassxc']});
            const ext = makeExt();
            mocks.display.focus_window = {
                get_wm_class: () => 'something-else',
            };
            mocks.windowTracker._app = {
                get_id: () => 'org.keepassxc.KeePassXC.desktop',
            };
            assert.equal(ext._isSensitive(), true);
            ext.disable();
        });

        it('returns false when neither WM_CLASS nor app-id matches', () => {
            const ext = makeExt();
            mocks.display.focus_window = {
                get_wm_class: () => 'firefox',
            };
            mocks.windowTracker._app = {
                get_id: () => 'org.mozilla.firefox.desktop',
            };
            assert.equal(ext._isSensitive(), false);
            ext.disable();
        });

        it('returns false when app is null', () => {
            const ext = makeExt();
            mocks.display.focus_window = {
                get_wm_class: () => 'firefox',
            };
            mocks.windowTracker._app = null;
            assert.equal(ext._isSensitive(), false);
            ext.disable();
        });

        it('returns false when get_wm_class returns null', () => {
            const ext = makeExt();
            mocks.display.focus_window = {
                get_wm_class: () => null,
            };
            mocks.windowTracker._app = null;
            assert.equal(ext._isSensitive(), false);
            ext.disable();
        });

        it('returns false when an error is thrown', () => {
            const ext = makeExt();
            mocks.display.focus_window = {
                get_wm_class: () => { throw new Error('crash'); },
            };
            assert.equal(ext._isSensitive(), false);
            ext.disable();
        });

        it('returns false when app.get_id() returns null', () => {
            const ext = makeExt();
            mocks.display.focus_window = {
                get_wm_class: () => 'firefox',
            };
            mocks.windowTracker._app = {
                get_id: () => null,
            };
            assert.equal(ext._isSensitive(), false);
            ext.disable();
        });

        it('returns false when sensitive detection is disabled', () => {
            resetMocks({'sensitive-sources': ['keepassxc']});
            const ext = makeExt();
            mocks.settings.set_boolean(ENABLE_SENSITIVE_SOURCES_KEY, false);
            mocks.display.focus_window = {
                get_wm_class: () => 'KeePassXC',
            };
            assert.equal(ext._isSensitive(), false);
            ext.disable();
        });
    });

    describe('_getDecayPlan()', () => {
        it('returns the sensitive timeout plan for sensitive copies', () => {
            resetMocks({'sensitive-sources': ['keepassxc']});
            const ext = makeExt();
            mocks.display.focus_window = {get_wm_class: () => 'KeePassXC'};

            assert.deepEqual(ext._getDecayPlan(), {
                seconds: 20,
                iconName: 'dialog-password-symbolic',
            });
            ext.disable();
        });

        it('returns the general timeout plan for non-sensitive copies when enabled', () => {
            resetMocks({'enable-general-timeout': true, 'general-timeout': 120});
            const ext = makeExt();
            mocks.display.focus_window = {get_wm_class: () => 'firefox'};

            assert.deepEqual(ext._getDecayPlan(), {
                seconds: 120,
                iconName: 'preferences-system-time-symbolic',
            });
            ext.disable();
        });

        it('returns null for non-sensitive copies when general timeout is disabled', () => {
            const ext = makeExt();
            mocks.display.focus_window = {get_wm_class: () => 'firefox'};

            assert.equal(ext._getDecayPlan(), null);
            ext.disable();
        });
    });

    // ── _onOwnerChanged ──

    describe('_onOwnerChanged()', () => {
        it('ignores non-clipboard selection types', () => {
            const ext = makeExt();
            mocks.selection.emitOwnerChanged(PRIMARY, {});
            assert.equal(mocks.GLib._timers.size, 0);
            ext.disable();
        });

        it('starts a timer on clipboard copy', () => {
            resetMocks({'enable-general-timeout': true});
            const ext = makeExt();
            simulateCopy(ext);
            assert.equal(mocks.GLib._timers.size, 1);
            assert.equal(ext._indicator.visible, true);
            ext.disable();
        });

        it('uses general-timeout for non-sensitive copy', () => {
            resetMocks({'enable-general-timeout': true, 'general-timeout': 120, 'sensitive-timeout': 15});
            const ext = makeExt();
            mocks.display.focus_window = {
                get_wm_class: () => 'firefox',
            };
            mocks.windowTracker._app = null;
            simulateCopy(ext);
            const timer = [...mocks.GLib._timers.values()][0];
            assert.equal(timer.seconds, 120);
            ext.disable();
        });

        it('uses sensitive-timeout for PM copy', () => {
            resetMocks({'general-timeout': 120, 'sensitive-timeout': 15, 'sensitive-sources': ['keepassxc']});
            const ext = makeExt();
            simulatePMCopy(ext);
            const timer = [...mocks.GLib._timers.values()][0];
            assert.equal(timer.seconds, 15);
            ext.disable();
        });

        it('uses general-timeout for PM copy when sensitive detection is disabled and general timeout is enabled', () => {
            resetMocks({'enable-general-timeout': true, 'general-timeout': 120, 'sensitive-timeout': 15});
            const ext = makeExt();
            mocks.settings.set_boolean(ENABLE_SENSITIVE_SOURCES_KEY, false);
            simulatePMCopy(ext);
            const timer = [...mocks.GLib._timers.values()][0];
            assert.equal(timer.seconds, 120);
            assert.equal(ext._icon.icon_name, 'preferences-system-time-symbolic');
            ext.disable();
        });

        it('does not arm a timer for non-sensitive copy when general timeout is disabled', () => {
            const ext = makeExt();
            mocks.display.focus_window = {
                get_wm_class: () => 'firefox',
            };
            mocks.windowTracker._app = null;

            simulateCopy(ext);

            assert.equal(mocks.GLib._timers.size, 0);
            assert.equal(ext._timerId, null);
            assert.equal(ext._indicator.visible, false);
            ext.disable();
        });

        it('does not arm a timer for PM copy when both timeout modes are disabled', () => {
            resetMocks({'enable-sensitive-sources': false});
            const ext = makeExt();

            simulatePMCopy(ext);

            assert.equal(mocks.GLib._timers.size, 0);
            assert.equal(ext._timerId, null);
            assert.equal(ext._indicator.visible, false);
            ext.disable();
        });

        it('shows password icon for PM copy', () => {
            resetMocks({'sensitive-sources': ['keepassxc']});
            const ext = makeExt();
            simulatePMCopy(ext);
            assert.equal(ext._icon.icon_name, 'dialog-password-symbolic');
            ext.disable();
        });

        it('shows clock icon for normal copy', () => {
            resetMocks({'enable-general-timeout': true});
            const ext = makeExt();
            mocks.display.focus_window = {
                get_wm_class: () => 'firefox',
            };
            mocks.windowTracker._app = null;
            simulateCopy(ext);
            assert.equal(ext._icon.icon_name, 'preferences-system-time-symbolic');
            ext.disable();
        });

        it('cancels existing timer on new copy', () => {
            resetMocks({'enable-general-timeout': true});
            const ext = makeExt();
            simulateCopy(ext);
            const firstTimerId = ext._timerId;
            simulateCopy(ext);
            assert.notEqual(ext._timerId, firstTimerId);
            assert.equal(mocks.GLib._timers.size, 1);
            ext.disable();
        });

        it('skips when self-clear flag is set', () => {
            const ext = makeExt();
            ext._isSelfClear = true;
            simulateCopy(ext);
            // No timer should be armed (cancelTimer runs, then returns)
            assert.equal(mocks.GLib._timers.size, 0);
            assert.equal(ext._indicator.visible, false);
            ext._isSelfClear = false;
            ext.disable();
        });

        it('bails when _enabled is false (queued signal after disable)', () => {
            resetMocks({'enable-general-timeout': true});
            const ext = makeExt();
            ext._enabled = false;
            simulateCopy(ext);
            assert.equal(mocks.GLib._timers.size, 0);
            ext._enabled = true;  // restore for disable()
            ext.disable();
        });

        it('bails when settings is null (mid-teardown)', () => {
            const ext = makeExt();
            ext._settings = null;
            // Should not throw
            simulateCopy(ext);
            assert.equal(mocks.GLib._timers.size, 0);
            ext._settings = mocks.settings;  // restore for disable()
            ext.disable();
        });

        it('bails when indicator is null (mid-teardown)', () => {
            const ext = makeExt();
            const savedIndicator = ext._indicator;
            ext._indicator = null;
            simulateCopy(ext);
            assert.equal(mocks.GLib._timers.size, 0);
            ext._indicator = savedIndicator;  // restore for disable()
            ext.disable();
        });

        it('enforces minimum 1-second timeout', () => {
            resetMocks({'enable-general-timeout': true, 'general-timeout': 0, 'sensitive-timeout': -5});
            const ext = makeExt();
            mocks.display.focus_window = {
                get_wm_class: () => 'firefox',
            };
            mocks.windowTracker._app = null;
            simulateCopy(ext);
            const timer = [...mocks.GLib._timers.values()][0];
            assert.equal(timer.seconds, 1);
            ext.disable();
        });

        it('skips relay event (null WM_CLASS) when timer is running', () => {
            resetMocks({'enable-general-timeout': true, 'general-timeout': 120, 'sensitive-timeout': 15, 'sensitive-sources': ['keepassxc']});
            const ext = makeExt();

            // First event: PM copy arms sensitive timer
            simulatePMCopy(ext, 'keepassxc');
            const sensitiveTimerId = ext._timerId;
            const sensitiveTimer = mocks.GLib._timers.get(sensitiveTimerId);
            assert.equal(sensitiveTimer.seconds, 15);
            assert.equal(ext._icon.icon_name, 'dialog-password-symbolic');

            // Second event: relay tool (null WM_CLASS) — should be skipped
            mocks.display.focus_window = {
                get_wm_class: () => null,
            };
            mocks.windowTracker._app = {get_id: () => 'window:2'};
            mocks.selection.emitOwnerChanged(CLIPBOARD, {});

            // Timer should be UNCHANGED — still the sensitive one
            assert.equal(ext._timerId, sensitiveTimerId);
            assert.equal(ext._icon.icon_name, 'dialog-password-symbolic');
            assert.ok(mocks.GLib._timers.has(sensitiveTimerId));
            ext.disable();
        });

        it('does NOT skip null-WM_CLASS event when no timer is running', () => {
            resetMocks({'enable-general-timeout': true});
            const ext = makeExt();

            // No prior copy — timer is null
            assert.equal(ext._timerId, null);

            // Event from null-WM_CLASS window — should arm timer normally
            mocks.display.focus_window = {
                get_wm_class: () => null,
            };
            mocks.windowTracker._app = null;
            mocks.selection.emitOwnerChanged(CLIPBOARD, {});

            assert.notEqual(ext._timerId, null);
            assert.equal(ext._indicator.visible, true);
            ext.disable();
        });

        it('does NOT skip identified window even when timer is running', () => {
            resetMocks({'enable-general-timeout': true, 'general-timeout': 120, 'sensitive-timeout': 15});
            const ext = makeExt();

            // First event: PM copy
            simulatePMCopy(ext, 'keepassxc');
            const firstTimerId = ext._timerId;

            // Second event: copy from identified non-PM window (has WM_CLASS)
            mocks.display.focus_window = {
                get_wm_class: () => 'firefox',
            };
            mocks.windowTracker._app = null;
            mocks.selection.emitOwnerChanged(CLIPBOARD, {});

            // Timer should be REPLACED with general timeout
            assert.notEqual(ext._timerId, firstTimerId);
            const newTimer = [...mocks.GLib._timers.values()][0];
            assert.equal(newTimer.seconds, 120);
            assert.equal(ext._icon.icon_name, 'preferences-system-time-symbolic');
            ext.disable();
        });

        it('does NOT skip null-WM_CLASS PM window when timer is running', () => {
            resetMocks({'enable-general-timeout': true, 'general-timeout': 120, 'sensitive-timeout': 15, 'sensitive-sources': ['org.keepassxc.keepassxc']});
            const ext = makeExt();

            // First event: general copy arms general timer
            mocks.display.focus_window = {get_wm_class: () => 'firefox'};
            mocks.windowTracker._app = null;
            simulateCopy(ext);
            const generalTimerId = ext._timerId;
            const generalTimer = mocks.GLib._timers.get(generalTimerId);
            assert.equal(generalTimer.seconds, 120);

            // Second event: PM window with no WM_CLASS but identifiable by app-id
            mocks.display.focus_window = {get_wm_class: () => null};
            mocks.windowTracker._app = {
                get_id: () => 'org.keepassxc.KeePassXC.desktop',
            };
            mocks.selection.emitOwnerChanged(CLIPBOARD, {});

            // Timer should be REPLACED with sensitive timeout (PM detected by app-id)
            assert.notEqual(ext._timerId, generalTimerId);
            const newTimer = [...mocks.GLib._timers.values()][0];
            assert.equal(newTimer.seconds, 15);
            assert.equal(ext._icon.icon_name, 'dialog-password-symbolic');
            ext.disable();
        });

        it('relay guard handles stale window gracefully', () => {
            resetMocks({'enable-general-timeout': true});
            const ext = makeExt();

            // First event: normal copy arms timer
            simulateCopy(ext);
            const firstTimerId = ext._timerId;

            // Second event: stale window throws on get_wm_class()
            mocks.display.focus_window = {
                get_wm_class: () => { throw new Error('stale window'); },
            };
            mocks.selection.emitOwnerChanged(CLIPBOARD, {});

            // Timer should be PRESERVED — relay guard caught the exception
            assert.equal(ext._timerId, firstTimerId);
            ext.disable();
        });
    });

    // ── _clearClipboard ──

    describe('_clearClipboard()', () => {
        it('sets clipboard to empty string', () => {
            const ext = makeExt();
            ext._clearClipboard();
            assert.equal(mocks.clipboard.calls.length, 1);
            assert.equal(mocks.clipboard.calls[0].text, '');
            ext.disable();
        });

        it('hides indicator after clearing', () => {
            const ext = makeExt();
            ext._indicator.visible = true;
            ext._clearClipboard();
            assert.equal(ext._indicator.visible, false);
            ext.disable();
        });

        it('resets self-clear flag even if set_text throws', () => {
            const ext = makeExt();
            mocks.clipboard._shouldThrow = true;
            ext._clearClipboard();
            assert.equal(ext._isSelfClear, false);
            mocks.clipboard._shouldThrow = false;
            ext.disable();
        });

        it('handles null indicator gracefully', () => {
            const ext = makeExt();
            ext._indicator = null;
            // Should not throw
            ext._clearClipboard();
            assert.equal(mocks.clipboard.calls.length, 1);
            ext.disable();
        });
    });

    // ── _cancelTimer ──

    describe('_cancelTimer()', () => {
        it('removes active timer', () => {
            resetMocks({'enable-general-timeout': true});
            const ext = makeExt();
            simulateCopy(ext);
            assert.notEqual(ext._timerId, null);
            ext._cancelTimer();
            assert.equal(ext._timerId, null);
            assert.equal(mocks.GLib._timers.size, 0);
            ext.disable();
        });

        it('is a no-op when timer is null', () => {
            const ext = makeExt();
            assert.equal(ext._timerId, null);
            ext._cancelTimer();  // should not throw
            assert.equal(ext._timerId, null);
            ext.disable();
        });

        it('clears unexpected non-number timer ids', () => {
            const ext = makeExt();
            ext._timerId = 'stale';
            ext._cancelTimer();
            assert.equal(ext._timerId, null);
            ext.disable();
        });
    });

    // ── enable ──

    describe('enable()', () => {
        it('initializes all state', () => {
            const ext = makeExt();
            assert.ok(ext._settings);
            assert.ok(ext._clipboard);
            assert.ok(ext._selection);
            assert.ok(ext._tracker);
            assert.ok(ext._sensitiveSources);
            assert.ok(ext._indicator);
            assert.ok(ext._icon);
            assert.equal(ext._timerId, null);
            assert.equal(ext._isSelfClear, false);
            assert.ok(ext._selSignalId);
            assert.equal(ext._settingsSignalIds.length, 4);
            assert.equal(ext._generalTimeoutEnabled, false);
            assert.equal(ext._sensitiveSourcesEnabled, true);
            assert.equal(ext._indicator.visible, false);
            ext.disable();
        });

        it('cleans up partial state when selection connect fails', () => {
            mocks.selection._shouldThrowOnConnect = true;
            const ext = new ClipboardDecay();
            ext.enable();
            assert.equal(ext._selSignalId, null);
            assert.equal(ext._settingsSignalIds, null);
            assert.equal(ext._indicator, null);
            assert.equal(ext._settings, null);
            assert.equal(ext._selection, null);
            assert.equal(ext._tracker, null);
        });
    });

    // ── disable ──

    describe('disable()', () => {
        it('cleans up all state', () => {
            const ext = makeExt();
            simulateCopy(ext);  // arm a timer and show indicator
            ext.disable();

            assert.equal(ext._timerId, null);
            assert.equal(ext._isSelfClear, false);
            assert.equal(ext._selSignalId, null);
            assert.equal(ext._settingsSignalIds, null);
            assert.equal(ext._indicator, null);
            assert.equal(ext._icon, null);
            assert.equal(ext._selection, null);
            assert.equal(ext._clipboard, null);
            assert.equal(ext._settings, null);
            assert.equal(ext._sensitiveSources, null);
            assert.equal(ext._tracker, null);
        });

        it('handles disable when selSignalId is null', () => {
            mocks.selection._shouldThrowOnConnect = true;
            const ext = new ClipboardDecay();
            ext.enable();
            assert.equal(ext._selSignalId, null);
            ext.disable();  // should not throw
        });

        it('disconnects source signal ids when present', () => {
            const ext = makeExt();
            assert.equal(ext._settingsSignalIds.length, 4);
            ext.disable();
            assert.equal(ext._settingsSignalIds, null);
        });
    });

    // ── Integration scenarios ──

    describe('integration', () => {
        it('copy → timer fires → clipboard cleared', () => {
            resetMocks({'enable-general-timeout': true});
            const ext = makeExt();
            simulateCopy(ext);
            const timerId = ext._timerId;
            assert.notEqual(timerId, null);

            // Fire the timer
            mocks.GLib.fireTimer(timerId);
            assert.equal(ext._timerId, null);
            assert.equal(mocks.clipboard.calls.length, 1);
            assert.equal(mocks.clipboard.calls[0].text, '');
            assert.equal(ext._indicator.visible, false);
            ext.disable();
        });

        it('copy → second copy resets timer', () => {
            resetMocks({'enable-general-timeout': true});
            const ext = makeExt();
            simulateCopy(ext);
            const firstId = ext._timerId;

            simulateCopy(ext);
            const secondId = ext._timerId;

            assert.notEqual(firstId, secondId);
            assert.ok(!mocks.GLib._timers.has(firstId));
            assert.ok(mocks.GLib._timers.has(secondId));
            ext.disable();
        });

        it('copy → disable cancels timer', () => {
            resetMocks({'enable-general-timeout': true});
            const ext = makeExt();
            simulateCopy(ext);
            assert.notEqual(ext._timerId, null);
            ext.disable();
            assert.equal(mocks.GLib._timers.size, 0);
        });

        it('fireAll clears every pending timer', () => {
            resetMocks({'enable-general-timeout': true});
            const ext = makeExt();
            simulateCopy(ext);
            assert.equal(mocks.GLib._timers.size, 1);

            mocks.GLib.fireAll();

            assert.equal(mocks.GLib._timers.size, 0);
            assert.equal(mocks.clipboard.calls.length, 1);
            ext.disable();
        });

        it('enable → disable → enable works (instance reuse)', () => {
            const ext = new ClipboardDecay();

            // First cycle
            ext.enable();
            ext._settings.set_boolean(ENABLE_GENERAL_TIMEOUT_KEY, true);
            simulateCopy(ext);
            ext.disable();

            // Second cycle — fresh mocks to simulate new session
            resetMocks();
            ext.enable();
            assert.equal(ext._timerId, null);
            assert.equal(ext._isSelfClear, false);
            assert.ok(ext._settings);

            ext._settings.set_boolean(ENABLE_GENERAL_TIMEOUT_KEY, true);
            simulateCopy(ext);
            assert.notEqual(ext._timerId, null);
            ext.disable();
        });

        it('self-clear does not re-arm timer (synchronous flag)', () => {
            resetMocks({'enable-general-timeout': true});
            const ext = makeExt();

            // Set up: clipboard.set_text triggers owner-changed synchronously
            mocks.clipboard.onSetText = () => {
                mocks.selection.emitOwnerChanged(CLIPBOARD, {});
            };

            // Simulate a normal copy first
            simulateCopy(ext);
            const timerId = ext._timerId;

            // Fire timer → _clearClipboard → set_text → owner-changed
            // The handler should see _isSelfClear=true and skip
            mocks.GLib.fireTimer(timerId);

            // After clear: no new timer should be armed
            assert.equal(ext._timerId, null);
            assert.equal(ext._indicator.visible, false);
            // Only one set_text call (the clear itself)
            assert.equal(mocks.clipboard.calls.length, 1);

            mocks.clipboard.onSetText = null;
            ext.disable();
        });

        it('PM copy with app-id detection via WindowTracker', () => {
            resetMocks({'sensitive-sources': ['org.keepassxc.keepassxc']});
            const ext = makeExt();
            mocks.display.focus_window = {
                get_wm_class: () => 'something-unknown',
            };
            mocks.windowTracker._app = {
                get_id: () => 'org.keepassxc.KeePassXC.desktop',
            };
            simulateCopy(ext);

            const timer = [...mocks.GLib._timers.values()][0];
            assert.equal(timer.seconds, 20);
            assert.equal(ext._icon.icon_name, 'dialog-password-symbolic');
            ext.disable();
        });
    });

    describe('prefs.js', () => {
        function buildPrefs(settingsDefaults, configureMocks) {
            resetMocks(settingsDefaults);
            configureMocks?.(mocks);
            const prefs = new ClipboardDecayPreferences();
            const window = new mocks.PrefsWindow();
            prefs.fillPreferencesWindow(window);
            return {prefs, window, page: window.children[0], mocks};
        }

        function getGeneralGroup(page) {
            return page.children[0];
        }

        function getSourcesGroup(page) {
            return page.children[1];
        }

        function getResetGroup(page) {
            return page.children[2];
        }

        function getDetectionRow(page) {
            return getSourcesGroup(page).children[0];
        }

        function getSensitiveTimeoutRow(page) {
            return getSourcesGroup(page).children[1];
        }

        function getGeneralEnableRow(page) {
            return getGeneralGroup(page).children[0];
        }

        function getGeneralTimeoutRow(page) {
            return getGeneralGroup(page).children[1];
        }

        function getEmptyRow(group) {
            return group.children.find(child => child.title === 'No apps added yet. Add apps you want Clipboard Decay to try to recognize as sensitive.');
        }

        function getInfoRow(group) {
            return group.children.find(child =>
                child.title === 'Sensitive app detection is turned off. The shorter timeout will not be used.');
        }

        function getInstalledBrowseRow(group) {
            return group.children.find(child => child.title === 'Add Apps');
        }

        function getInstalledBrowseButton(group) {
            return getInstalledBrowseRow(group).suffixes[0];
        }

        function getInstalledDialog(group) {
            return group._pickerDialog;
        }

        function getNavigationView(group) {
            return getInstalledDialog(group).child;
        }

        function getInstalledSearchRow(group) {
            return getNavigationView(group).pages[0].child.content.children[0];
        }

        function getInstalledListGroup(group) {
            return getNavigationView(group).pages[0].child.content.children[1].child;
        }

        function getFallbackNavRow(group) {
            return group._pickerFallbackNavRow;
        }

        function getFallbackPage(group) {
            return getInstalledDialog(group)._pickerFallbackPage ?? group._pickerFallbackPage;
        }

        function getInstalledHelperRow(group) {
            return getInstalledListGroup(group).children[0];
        }

        function getAvailableAppRows(group) {
            return getInstalledListGroup(group).children.filter(child =>
                child !== getInstalledHelperRow(group) && child.visible !== false);
        }

        function getPickerAddedIcon(row) {
            return row.suffixes.find(child => child.icon_name === 'object-select-symbolic');
        }

        function getDetectRow(group) {
            return getFallbackPage(group).child.content.children[0];
        }

        function getDetectedRow(group) {
            return getFallbackPage(group).child.content.children[1];
        }

        function getAdvancedAddRow(group) {
            return getFallbackPage(group).child.content.children[2];
        }

        function getDetectButton(group) {
            return getDetectRow(group).suffixes[0];
        }

        function getUseDetectedButton(group) {
            return getDetectedRow(group).suffixes[0];
        }

        function getAdvancedHintRow(group) {
            return getFallbackPage(group).child.content.children[3];
        }

        function getResetRow(page) {
            return getResetGroup(page).children.find(child => child.title === 'Restore Defaults');
        }

        function getResetButton(page) {
            return getResetRow(page).suffixes[0];
        }

        function getAboutRow(page) {
            return getResetGroup(page).children.find(child => child.title === 'About Clipboard Decay');
        }

        function getAboutChevron(page) {
            return getAboutRow(page).suffixes[0];
        }

        function getFeedbackRow(group) {
            return getFallbackPage(group).child.content.children[4];
        }

        function getSourceRows(group) {
            return group.children.filter(child =>
                child.suffixes?.[0]?.icon_name === 'edit-delete-symbolic');
        }

        it('builds the app-centric preference groups', () => {
            const {window, page} = buildPrefs();
            assert.equal(window.default_width, 520);
            assert.equal(window.default_height, 580);
            assert.equal(page.children.length, 3);
            assert.equal(page.children[0].title, 'General Timer');
            assert.equal(page.children[1].title, 'Sensitive Apps');
            assert.equal(getInstalledBrowseRow(getSourcesGroup(page)).title, 'Add Apps');
            assert.equal(getInstalledDialog(getSourcesGroup(page)).title, 'Add Apps');
            assert.equal(getFallbackNavRow(getSourcesGroup(page)).title, 'Can\'t find your app?');
            assert.equal(getGeneralEnableRow(page).title, 'Enable');
            assert.equal(getGeneralTimeoutRow(page).title, 'General Timeout');
            assert.equal(getDetectionRow(page).title, 'Enable Detection');
            assert.equal(getSensitiveTimeoutRow(page).title, 'Sensitive Timeout');
            assert.equal(getFallbackPage(getSourcesGroup(page)).title, 'Add App');
            assert.equal(getDetectRow(getSourcesGroup(page)).title, 'Find the app you\'re using');
            assert.equal(getAdvancedHintRow(getSourcesGroup(page)).title, 'For terminal-based workflows, use the terminal app itself rather than the command running inside it.');
            assert.equal(getResetRow(page).title, 'Restore Defaults');
            assert.equal(getAboutRow(page).subtitle, 'Version, website, and release information');
            assert.equal(getAboutChevron(page).icon_name, 'go-next-symbolic');
        });

        it('opens the about dialog from the about row', () => {
            const {page, mocks} = buildPrefs();

            getAboutRow(page).activate();

            assert.equal(mocks.presentedAboutDialogs.length, 1);
            assert.equal(mocks.presentedAboutDialogs[0].application_name, 'Clipboard Decay');
            assert.equal(mocks.presentedAboutDialogs[0].version, 'Development build');
            assert.equal(mocks.presentedAboutDialogs[0].website, 'https://github.com/finegrainlabs/clipboard-decay');
            assert.equal(mocks.presentedAboutDialogs[0].issue_url, 'https://github.com/finegrainlabs/clipboard-decay/issues');
            assert.equal(mocks.presentedAboutDialogs[0].comments, mocks.metadata.description);
            assert.equal(mocks.presentedAboutDialogs[0].copyright, '© 2026 Finegrain Labs');
            assert.equal(mocks.presentedAboutDialogs[0].license_type, 'GPL_2_0');
        });

        it('shows metadata version-name in the about dialog when available', () => {
            const {page, mocks} = buildPrefs(undefined, currentMocks => {
                currentMocks.metadata['version-name'] = '1.2.3';
            });

            getAboutRow(page).activate();
            assert.equal(mocks.presentedAboutDialogs[0].version, '1.2.3');
        });

        it('binds timeout rows to settings', () => {
            const {page} = buildPrefs();
            const sensitiveRow = getSensitiveTimeoutRow(page);
            const generalRow = getGeneralTimeoutRow(page);

            assert.equal(sensitiveRow.value, 20);
            assert.equal(generalRow.value, 300);

            mocks.settings.set('sensitive-timeout', 45);
            mocks.settings.set('general-timeout', 600);

            assert.equal(sensitiveRow.value, 45);
            assert.equal(generalRow.value, 600);
        });

        it('binds the general timeout switch to settings', () => {
            const {page} = buildPrefs();
            const generalEnableRow = getGeneralEnableRow(page);

            assert.equal(generalEnableRow.active, false);
            mocks.settings.set_boolean(ENABLE_GENERAL_TIMEOUT_KEY, true);
            assert.equal(generalEnableRow.active, true);
        });

        it('binds best-effort detection switch to settings', () => {
            const {page} = buildPrefs();
            const detectionRow = getDetectionRow(page);

            assert.equal(detectionRow.active, true);
            mocks.settings.set_boolean(ENABLE_SENSITIVE_SOURCES_KEY, false);
            assert.equal(detectionRow.active, false);
        });

        it('shows the empty selected-app state when nothing is configured', () => {
            const {page} = buildPrefs({'sensitive-sources': []});
            const group = getSourcesGroup(page);

            assert.equal(getEmptyRow(group).visible, true);
            assert.equal(getInfoRow(group).visible, false);
            assert.equal(getSourceRows(group).length, 0);
        });

        it('shows the updated info message when sensitive detection is disabled', () => {
            const {page} = buildPrefs({'sensitive-sources': ['keepassxc']});
            const group = getSourcesGroup(page);

            mocks.settings.set_boolean(ENABLE_SENSITIVE_SOURCES_KEY, false);

            assert.equal(
                getInfoRow(group).title,
                'Sensitive app detection is turned off. The shorter timeout will not be used.'
            );
        });

        it('renders friendly rows for resolved apps from settings', () => {
            const {page} = buildPrefs({'sensitive-sources': ['KeePassXC', 'bitwarden.desktop']});
            const rows = getSourceRows(getSourcesGroup(page));

            assert.deepEqual(rows.map(row => row.title), ['KeePassXC', 'Bitwarden', 'KeePassXC', 'Bitwarden']);
            assert.deepEqual(rows.map(row => row.subtitle), [
                'keepassxc',
                'bitwarden',
                'org.keepassxc.keepassxc',
                'com.bitwarden',
            ]);
            assert.equal(rows[0].prefixes[0].gicon.name, 'keepassxc-icon');
            assert.equal(rows[1].prefixes[0].gicon.name, 'bitwarden-icon');
        });

        it('renders unresolved identifiers as manual entries', () => {
            const {page} = buildPrefs({'sensitive-sources': ['custom-tool']});
            const row = getSourceRows(getSourcesGroup(page))[0];

            assert.equal(row.title, 'custom-tool');
            assert.equal(row.subtitle, 'Unverified manual identifier');
            assert.equal(row.prefixes[0].icon_name, 'application-x-executable-symbolic');
        });

        it('opens the installed-app picker dialog from the browse button', () => {
            const {window, page} = buildPrefs();
            const installedGroup = getSourcesGroup(page);

            getInstalledBrowseButton(installedGroup).click();

            assert.deepEqual(getInstalledDialog(installedGroup).present_calls, [window]);
        });

        it('navigates to the fallback page from the picker', () => {
            const {page} = buildPrefs();
            const group = getSourcesGroup(page);
            const navigationView = getNavigationView(group);

            getFallbackNavRow(group).activate();

            assert.equal(navigationView.visiblePage.title, 'Add App');
        });

        it('closes the installed-app picker dialog when Escape is pressed in search', () => {
            const {page} = buildPrefs();
            const installedGroup = getSourcesGroup(page);
            const dialog = getInstalledDialog(installedGroup);
            const searchRow = getInstalledSearchRow(installedGroup);
            const controller = searchRow.controllers[0];

            const result = controller.emitKeyPressed(mocks.Gdk.KEY_Escape);

            assert.equal(dialog.close_calls, 1);
            assert.equal(result, mocks.Gdk.EVENT_STOP);
        });

        it('pops the navigation view when Escape is pressed on the fallback page', () => {
            const {page} = buildPrefs();
            const group = getSourcesGroup(page);
            const navigationView = getNavigationView(group);
            const dialog = getInstalledDialog(group);
            const searchRow = getInstalledSearchRow(group);
            const controller = searchRow.controllers[0];
            const fallbackPage = getFallbackPage(group);

            getFallbackNavRow(group).activate();
            assert.equal(navigationView.visiblePage, fallbackPage);

            const result = controller.emitKeyPressed(mocks.Gdk.KEY_Escape);

            assert.notEqual(navigationView.visiblePage, fallbackPage);
            assert.equal(dialog.close_calls, 0);
            assert.equal(result, mocks.Gdk.EVENT_STOP);
        });

        it('does not close the installed-app picker dialog on other keys', () => {
            const {page} = buildPrefs();
            const installedGroup = getSourcesGroup(page);
            const dialog = getInstalledDialog(installedGroup);
            const searchRow = getInstalledSearchRow(installedGroup);
            const controller = searchRow.controllers[0];

            const result = controller.emitKeyPressed('Enter');

            assert.equal(dialog.close_calls, 0);
            assert.equal(result, mocks.Gdk.EVENT_PROPAGATE);
        });

        it('shows installed apps by default in the picker dialog', () => {
            const {page} = buildPrefs();
            const installedGroup = getSourcesGroup(page);
            const searchRow = getInstalledSearchRow(installedGroup);
            const dialog = getInstalledDialog(installedGroup);
            const rows = getAvailableAppRows(installedGroup);

            assert.equal(dialog.content_width, 360);
            assert.equal(dialog.content_height, 480);
            assert.equal(searchRow.placeholder_text, 'Search apps...');
            assert.deepEqual(
                rows.map(row => row.title),
                ['Bitwarden', 'Brave Web Browser', 'Firefox', 'KeePassXC']
            );
            assert.ok(rows.every(row => !row.subtitle));
            assert.equal(getInstalledHelperRow(installedGroup).visible, false);
        });

        it('filters installed apps by name and adds them by activating the row', () => {
            const {page} = buildPrefs({'sensitive-sources': ['keepassxc', 'org.keepassxc.keepassxc']});
            const installedGroup = getSourcesGroup(page);
            const selectedGroup = getSourcesGroup(page);
            const searchRow = getInstalledSearchRow(installedGroup);

            searchRow.set_text('bit');

            const availableRows = getAvailableAppRows(installedGroup);
            assert.deepEqual(availableRows.map(row => row.title), ['Bitwarden']);
            assert.equal(getInstalledHelperRow(installedGroup).visible, false);

            availableRows[0].activate();

            assert.deepEqual(mocks.settings.get_strv(SENSITIVE_SOURCES_KEY), [
                'keepassxc',
                'org.keepassxc.keepassxc',
                'com.bitwarden',
                'bitwarden',
            ]);
            assert.equal(searchRow.text, 'bit');
            assert.deepEqual(
                getSourceRows(selectedGroup).map(row => row.title),
                ['KeePassXC', 'KeePassXC', 'Bitwarden', 'Bitwarden']
            );
            assert.equal(getPickerAddedIcon(availableRows[0]).visible, true);
        });

        it('matches installed apps by normalized identifier queries', () => {
            const {page} = buildPrefs();
            const installedGroup = getSourcesGroup(page);
            const searchRow = getInstalledSearchRow(installedGroup);

            searchRow.set_text('org.mozilla.firefox.desktop');

            assert.deepEqual(getAvailableAppRows(installedGroup).map(row => row.title), ['Firefox']);
        });

        it('shows already selected apps as added instead of hiding them', () => {
            const {page} = buildPrefs({'sensitive-sources': ['bitwarden']});
            const installedGroup = getSourcesGroup(page);
            const searchRow = getInstalledSearchRow(installedGroup);

            searchRow.set_text('bit');

            const availableRows = getAvailableAppRows(installedGroup);
            assert.equal(availableRows.length, 1);
            assert.equal(availableRows[0].title, 'Bitwarden');
            assert.equal(availableRows[0].activatable, false);
            assert.equal(getPickerAddedIcon(availableRows[0]).visible, true);
        });

        it('does not rewrite settings when activating an already-added picker row', () => {
            const {page} = buildPrefs({'sensitive-sources': ['bitwarden', 'com.bitwarden']});
            const installedGroup = getSourcesGroup(page);
            const searchRow = getInstalledSearchRow(installedGroup);

            searchRow.set_text('bit');
            const row = getAvailableAppRows(installedGroup)[0];
            row.activate();

            assert.deepEqual(mocks.settings.get_strv(SENSITIVE_SOURCES_KEY), ['bitwarden', 'com.bitwarden']);
        });

        it('shows all matching installed apps instead of truncating to eight rows', () => {
            const {page} = buildPrefs(undefined, currentMocks => {
                for (let i = 0; i < 10; i++) {
                    currentMocks.appInfos.push(new currentMocks.MockAppInfo({
                        displayName: `Alpha ${i}`,
                        id: `org.example.alpha${i}.desktop`,
                        startupWmClass: `Alpha${i}`,
                    }));
                }
            });
            const installedGroup = getSourcesGroup(page);
            const searchRow = getInstalledSearchRow(installedGroup);

            searchRow.set_text('alpha');

            assert.equal(getAvailableAppRows(installedGroup).length, 10);
        });

        it('preserves the installed-app filter row instance while filtering', () => {
            const {page} = buildPrefs();
            const installedGroup = getSourcesGroup(page);
            const searchRow = getInstalledSearchRow(installedGroup);
            const helperRow = getInstalledHelperRow(installedGroup);

            searchRow.set_text('bit');

            assert.equal(getInstalledSearchRow(installedGroup), searchRow);
            assert.equal(getInstalledHelperRow(installedGroup), helperRow);
            assert.deepEqual(getAvailableAppRows(installedGroup).map(row => row.title), ['Bitwarden']);

            searchRow.set_text('fire');

            assert.equal(getInstalledSearchRow(installedGroup), searchRow);
            assert.equal(getInstalledHelperRow(installedGroup), helperRow);
            assert.deepEqual(getAvailableAppRows(installedGroup).map(row => row.title), ['Firefox']);
        });

        it('does not mutate installed-app picker rows while filtering', () => {
            const {page} = buildPrefs();
            const installedGroup = getSourcesGroup(page);
            const listGroup = getInstalledListGroup(installedGroup);
            const searchRow = getInstalledSearchRow(installedGroup);
            const initialChildren = [...listGroup.children];

            let addCalls = 0;
            let removeCalls = 0;
            const originalAdd = listGroup.add.bind(listGroup);
            const originalRemove = listGroup.remove.bind(listGroup);

            listGroup.add = child => {
                addCalls++;
                originalAdd(child);
            };
            listGroup.remove = child => {
                removeCalls++;
                originalRemove(child);
            };

            searchRow.set_text('bit');
            searchRow.set_text('fire');
            searchRow.set_text('');

            assert.equal(addCalls, 0);
            assert.equal(removeCalls, 0);
            assert.deepEqual(listGroup.children, initialChildren);
        });

        it('reuses installed-app row objects while filtering', () => {
            const {page} = buildPrefs();
            const installedGroup = getSourcesGroup(page);
            const listGroup = getInstalledListGroup(installedGroup);
            const searchRow = getInstalledSearchRow(installedGroup);
            const initialRows = [...listGroup._appRows];

            searchRow.set_text('bit');
            const bitRows = listGroup._appRows;

            searchRow.set_text('fire');
            const fireRows = listGroup._appRows;

            assert.deepEqual(bitRows, initialRows);
            assert.deepEqual(fireRows, initialRows);
        });

        it('shows feedback for blank advanced identifiers', () => {
            const {page} = buildPrefs();
            const group = getSourcesGroup(page);
            getFallbackNavRow(group).activate();
            const addRow = getAdvancedAddRow(group);
            const feedbackRow = getFeedbackRow(group);

            addRow.set_text('   ');
            addRow.apply();

            assert.equal(feedbackRow.visible, true);
            assert.equal(feedbackRow.title, 'Enter an application ID.');
        });

        it('starts focused-window detection from the picker and lets the user cancel it', () => {
            const {page} = buildPrefs();
            const group = getSourcesGroup(page);
            const detectRow = getDetectRow(group);
            const detectButton = getDetectButton(group);
            const addRow = getAdvancedAddRow(group);
            const feedbackRow = getFeedbackRow(group);

            getFallbackNavRow(group).activate();
            addRow.set_text('stale-value');
            feedbackRow.title = 'stale-feedback';
            feedbackRow.visible = true;

            detectButton.click();
            assert.equal(mocks.settings.get_boolean(DETECT_WINDOW_MODE_KEY), true);
            assert.equal(detectButton.label, 'Cancel');
            assert.equal(detectRow.subtitle, 'Bring the app you want to add into focus.');
            assert.equal(addRow.text, '');
            assert.equal(feedbackRow.visible, false);

            detectButton.click();
            assert.equal(mocks.settings.get_boolean(DETECT_WINDOW_MODE_KEY), false);
            assert.equal(detectButton.label, 'Detect');
        });

        it('shows a detected identifier for confirmation when capture completes', () => {
            const {page} = buildPrefs();
            const group = getSourcesGroup(page);
            const addRow = getAdvancedAddRow(group);
            const detectedRow = getDetectedRow(group);
            const useDetectedButton = getUseDetectedButton(group);

            mocks.settings.set_string(DETECTED_WINDOW_ID_KEY, 'org.mozilla.firefox');

            assert.equal(getNavigationView(group).visiblePage.title, 'Add App');
            assert.equal(detectedRow.visible, true);
            assert.equal(detectedRow.title, 'We found this app');
            assert.equal(detectedRow.subtitle, 'org.mozilla.firefox');
            assert.equal(useDetectedButton.sensitive, true);
            assert.equal(addRow.text, 'org.mozilla.firefox');
        });

        it('adds the detected identifier only after explicit confirmation', () => {
            const {page} = buildPrefs();
            const group = getSourcesGroup(page);

            mocks.settings.set_string(DETECTED_WINDOW_ID_KEY, 'bitwarden');
            getUseDetectedButton(group).click();

            assert.deepEqual(mocks.settings.get_strv(SENSITIVE_SOURCES_KEY), ['bitwarden', 'com.bitwarden']);
        });

        it('applies empty string when _detectedIdentifier is undefined', () => {
            const {page} = buildPrefs();
            const group = getSourcesGroup(page);
            const detectedRow = getDetectedRow(group);
            const feedbackRow = getFeedbackRow(group);

            getFallbackNavRow(group).activate();
            detectedRow._detectedIdentifier = undefined;
            getUseDetectedButton(group).click();

            assert.notEqual(feedbackRow.title, '');
        });

        it('rejects unknown manual identifiers that do not match installed apps', () => {
            const {page} = buildPrefs();
            const group = getSourcesGroup(page);
            getFallbackNavRow(group).activate();
            const addRow = getAdvancedAddRow(group);
            const feedbackRow = getFeedbackRow(group);

            addRow.set_text('opencode');
            addRow.apply();

            assert.equal(feedbackRow.visible, true);
            assert.equal(
                feedbackRow.title,
                'This value is not known to any installed app. Clipboard Decay only matches the focused window\'s WM_CLASS or application ID.'
            );
            assert.deepEqual(mocks.settings.get_strv(SENSITIVE_SOURCES_KEY), []);
        });

        it('shows feedback for duplicate advanced identifiers', () => {
            const {page} = buildPrefs({'sensitive-sources': ['keepassxc']});
            const group = getSourcesGroup(page);
            getFallbackNavRow(group).activate();
            const addRow = getAdvancedAddRow(group);
            const feedbackRow = getFeedbackRow(group);

            addRow.set_text('KeePassXC');
            addRow.apply();

            assert.equal(feedbackRow.visible, true);
            assert.equal(feedbackRow.title, 'That app is already in the list.');
        });

        it('adds normalized advanced identifiers and clears feedback', () => {
            const {page} = buildPrefs({'sensitive-sources': ['keepassxc']});
            const group = getSourcesGroup(page);
            getFallbackNavRow(group).activate();
            const addRow = getAdvancedAddRow(group);
            const feedbackRow = getFeedbackRow(group);
            const dialog = getInstalledDialog(group);
            const navigationView = getNavigationView(group);

            addRow.set_text(' Bitwarden.desktop ');
            addRow.apply();

            assert.deepEqual(mocks.settings.get_strv(SENSITIVE_SOURCES_KEY), [
                'keepassxc',
                'org.keepassxc.keepassxc',
                'bitwarden',
                'com.bitwarden',
            ]);
            assert.equal(addRow.text, '');
            assert.equal(feedbackRow.visible, false);
            assert.equal(navigationView.visiblePage.title, 'Add Apps');
            assert.equal(dialog.close_calls, 1);
        });

        it('clears advanced feedback while typing', () => {
            const {page} = buildPrefs();
            const group = getSourcesGroup(page);
            getFallbackNavRow(group).activate();
            const addRow = getAdvancedAddRow(group);
            const feedbackRow = getFeedbackRow(group);

            addRow.apply();
            assert.equal(feedbackRow.visible, true);

            addRow.set_text('keepassxc');
            assert.equal(feedbackRow.visible, false);
        });

        it('removes source entry from settings when delete is clicked', () => {
            const {page} = buildPrefs({'sensitive-sources': ['keepassxc', 'bitwarden']});
            const group = getSourcesGroup(page);
            const row = getSourceRows(group)[0];
            const removeButton = row.suffixes[0];

            removeButton.click();

            assert.deepEqual(mocks.settings.get_strv(SENSITIVE_SOURCES_KEY), ['bitwarden', 'com.bitwarden']);
            assert.deepEqual(getSourceRows(group).map(sourceRow => sourceRow.title), ['Bitwarden', 'Bitwarden']);
        });

        it('removes unresolved manual identifiers without touching resolved aliases', () => {
            const {page} = buildPrefs({'sensitive-sources': ['custom', 'bitwarden']});
            const group = getSourcesGroup(page);
            const manualRow = getSourceRows(group)[0];

            assert.equal(manualRow.title, 'custom');
            manualRow.suffixes[0].click();

            assert.deepEqual(mocks.settings.get_strv(SENSITIVE_SOURCES_KEY), ['bitwarden', 'com.bitwarden']);
            assert.deepEqual(getSourceRows(group).map(sourceRow => sourceRow.title), ['Bitwarden', 'Bitwarden']);
        });

        it('syncs rows when settings change externally', () => {
            const {page} = buildPrefs({'sensitive-sources': ['keepassxc']});
            const group = getSourcesGroup(page);

            mocks.settings.set(SENSITIVE_SOURCES_KEY, ['bitwarden']);

            assert.deepEqual(getSourceRows(group).map(row => row.title), ['Bitwarden', 'Bitwarden']);
        });

        it('disables sensitive-source controls when best-effort detection is off', () => {
            const {page} = buildPrefs({'sensitive-sources': ['keepassxc']});
            const selectedGroup = getSourcesGroup(page);
            const installedGroup = getSourcesGroup(page);
            const advancedGroup = getSourcesGroup(page);
            getFallbackNavRow(advancedGroup).activate();
            const sensitiveRow = getSensitiveTimeoutRow(page);
            const browseRow = getInstalledBrowseRow(installedGroup);
            const detectRow = getDetectRow(advancedGroup);
            const detectButton = getDetectButton(advancedGroup);
            const searchRow = getInstalledSearchRow(installedGroup);
            const helperRow = getInstalledHelperRow(installedGroup);
            const advancedAddRow = getAdvancedAddRow(advancedGroup);
            const feedbackRow = getFeedbackRow(advancedGroup);
            const infoRow = getInfoRow(selectedGroup);

            searchRow.set_text('bit');

            mocks.settings.set_boolean(ENABLE_SENSITIVE_SOURCES_KEY, false);

            assert.equal(sensitiveRow.sensitive, false);
            assert.equal(sensitiveRow.visible, false);
            assert.equal(browseRow.visible, false);
            assert.equal(detectRow.sensitive, false);
            assert.equal(detectButton.sensitive, false);
            assert.equal(searchRow.sensitive, false);
            assert.equal(helperRow.sensitive, false);
            assert.equal(getAvailableAppRows(installedGroup)[0].sensitive, false);
            assert.equal(advancedAddRow.sensitive, false);
            assert.equal(feedbackRow.sensitive, false);
            assert.equal(getSourceRows(selectedGroup)[0].sensitive, false);
            assert.equal(getSourceRows(selectedGroup)[0].visible, false);
            assert.equal(infoRow.visible, true);
        });

        it('disables the general timeout row when the general timer is off', () => {
            const {page} = buildPrefs();
            const generalRow = getGeneralTimeoutRow(page);

            assert.equal(generalRow.sensitive, false);

            mocks.settings.set_boolean(ENABLE_GENERAL_TIMEOUT_KEY, true);

            assert.equal(generalRow.sensitive, true);
        });

        it('re-enables sensitive-source controls when best-effort detection turns back on', () => {
            const {page} = buildPrefs({
                'enable-sensitive-sources': false,
                'sensitive-sources': ['keepassxc'],
            });
            const selectedGroup = getSourcesGroup(page);
            const installedGroup = getSourcesGroup(page);
            const advancedGroup = getSourcesGroup(page);
            getFallbackNavRow(advancedGroup).activate();
            const sensitiveRow = getSensitiveTimeoutRow(page);
            const browseRow = getInstalledBrowseRow(installedGroup);
            const detectRow = getDetectRow(advancedGroup);
            const detectButton = getDetectButton(advancedGroup);
            const searchRow = getInstalledSearchRow(installedGroup);
            const advancedAddRow = getAdvancedAddRow(advancedGroup);
            const infoRow = getInfoRow(selectedGroup);

            searchRow.set_text('bit');

            mocks.settings.set_boolean(ENABLE_SENSITIVE_SOURCES_KEY, true);

            assert.equal(sensitiveRow.sensitive, true);
            assert.equal(sensitiveRow.visible, true);
            assert.equal(browseRow.visible, true);
            assert.equal(detectRow.sensitive, true);
            assert.equal(detectButton.sensitive, true);
            assert.equal(searchRow.sensitive, true);
            assert.equal(advancedAddRow.sensitive, true);
            assert.equal(getSourceRows(selectedGroup)[0].sensitive, true);
            assert.equal(getSourceRows(selectedGroup)[0].visible, true);
            assert.equal(getAvailableAppRows(installedGroup)[0].sensitive, true);
            assert.equal(infoRow.visible, false);
        });

        it('handles detection sync when source rows are temporarily missing', () => {
            const {page} = buildPrefs();
            const group = getSourcesGroup(page);
            const infoRow = getInfoRow(group);

            group._sourceRows = null;
            mocks.settings.set_boolean(ENABLE_SENSITIVE_SOURCES_KEY, false);

            assert.equal(infoRow.visible, true);
        });

        it('handles _applyDetectedWindowId when get_string is unavailable', () => {
            const {prefs, page} = buildPrefs();
            const group = getSourcesGroup(page);
            const detectedRow = getDetectedRow(group);

            prefs._applyDetectedWindowId(
                {},
                {
                    navigationView: getNavigationView(group),
                    fallbackPage: getFallbackPage(group),
                    detectedRow,
                    useDetectedButton: getUseDetectedButton(group),
                    addRow: getAdvancedAddRow(group),
                    feedbackRow: getFeedbackRow(group),
                },
                text => text
            );

            assert.equal(detectedRow.visible, false);
        });

        it('disconnects prefs signals when window is destroyed', () => {
            const {window} = buildPrefs();
            const before = mocks.settings._handlers.size;
            assert.ok(before >= 5);

            window.destroy();

            assert.equal(mocks.settings._handlers.size, before - 5);
        });

        it('sets tooltip and accessible label on the remove button', () => {
            const {page} = buildPrefs({'sensitive-sources': ['keepassxc']});
            const sourceRow = getSourceRows(getSourcesGroup(page))[0];
            const removeButton = sourceRow.suffixes[0];

            assert.equal(removeButton.tooltip_text, 'Remove sensitive app');
            assert.equal(removeButton.accessible_label, 'Remove sensitive app');
            assert.equal(sourceRow.prefixes[0].gicon.name, 'keepassxc-icon');
        });

        it('restores defaults from the reset button', () => {
            const {page} = buildPrefs({
                'enable-general-timeout': true,
                'enable-sensitive-sources': false,
                'detect-window-mode': true,
                'detected-window-id': 'org.mozilla.firefox',
                'sensitive-timeout': 45,
                'general-timeout': 600,
                'sensitive-sources': ['custom'],
            });
            const installedSearchRow = getInstalledSearchRow(getSourcesGroup(page));
            getFallbackNavRow(getSourcesGroup(page)).activate();
            const addRow = getAdvancedAddRow(getSourcesGroup(page));
            const feedbackRow = getFeedbackRow(getSourcesGroup(page));

            installedSearchRow.set_text('bit');
            addRow.set_text('custom');
            addRow.apply();
            getResetButton(page).click();

            assert.equal(mocks.settings.get_boolean(ENABLE_GENERAL_TIMEOUT_KEY), false);
            assert.equal(mocks.settings.get_boolean(ENABLE_SENSITIVE_SOURCES_KEY), true);
            assert.equal(mocks.settings.get_boolean(DETECT_WINDOW_MODE_KEY), false);
            assert.equal(mocks.settings.get_string(DETECTED_WINDOW_ID_KEY), '');
            assert.equal(mocks.settings.get_int('sensitive-timeout'), DEFAULT_SENSITIVE_TIMEOUT);
            assert.equal(mocks.settings.get_int('general-timeout'), DEFAULT_GENERAL_TIMEOUT);
            assert.deepEqual(mocks.settings.get_strv(SENSITIVE_SOURCES_KEY), DEFAULT_SENSITIVE_SOURCES);
            assert.equal(installedSearchRow.text, '');
            assert.equal(addRow.text, '');
            assert.equal(feedbackRow.visible, false);
        });

        it('sets tooltip and accessible label on reset and add buttons', () => {
            const {page} = buildPrefs();
            const resetGroup = getResetGroup(page);
            const resetButton = getResetButton(page);
            const installedGroup = getSourcesGroup(page);
            const searchRow = getInstalledSearchRow(installedGroup);

            searchRow.set_text('bit');
            const row = getAvailableAppRows(installedGroup)[0];

            assert.equal(resetButton.tooltip_text, 'Restore the default Clipboard Decay settings');
            assert.equal(resetButton.accessible_label, 'Restore the default Clipboard Decay settings');
            assert.equal(row.activatable, true);
            assert.equal(resetGroup.children.length, 2);
        });

        it('adds prefix icons to info, helper, feedback, and app rows', () => {
            const {page} = buildPrefs();
            const selectedGroup = getSourcesGroup(page);
            const installedGroup = getSourcesGroup(page);
            const advancedGroup = getSourcesGroup(page);
            getFallbackNavRow(advancedGroup).activate();

            assert.equal(getInfoRow(selectedGroup).prefixes[0].icon_name, 'dialog-information-symbolic');
            assert.equal(getEmptyRow(selectedGroup).prefixes[0].icon_name, 'dialog-information-symbolic');
            assert.equal(getInstalledHelperRow(installedGroup).prefixes[0].icon_name, 'system-search-symbolic');
            assert.equal(getAdvancedHintRow(advancedGroup).prefixes[0].icon_name, 'dialog-information-symbolic');
            assert.equal(getFeedbackRow(advancedGroup).prefixes[0].icon_name, 'dialog-warning-symbolic');

            getInstalledSearchRow(installedGroup).set_text('bit');
            assert.equal(getAvailableAppRows(installedGroup)[0].prefixes[0].gicon.name, 'bitwarden-icon');
            assert.equal(getAvailableAppRows(installedGroup)[0].prefixes[0].pixel_size, 32);
        });

        it('styles the feedback row as subdued validation copy', () => {
            const {page} = buildPrefs();
            const group = getSourcesGroup(page);
            getFallbackNavRow(group).activate();
            const feedbackRow = getFeedbackRow(group);

            assert.deepEqual(feedbackRow.css_classes, ['dim-label']);
        });

        it('builds an empty app catalog when app enumeration fails', () => {
            resetMocks();
            mocks.Gio.AppInfo.get_all = () => {
                throw new Error('enumeration failed');
            };

            const prefs = new ClipboardDecayPreferences();
            const catalog = prefs._buildAppCatalog();

            assert.equal(catalog.apps.length, 0);
            assert.equal(catalog.byIdentifier.size, 0);
        });

        it('builds an empty app catalog when app enumeration is unavailable', () => {
            resetMocks();
            mocks.Gio.AppInfo.get_all = undefined;

            const prefs = new ClipboardDecayPreferences();
            const catalog = prefs._buildAppCatalog();

            assert.equal(catalog.apps.length, 0);
            assert.equal(catalog.byIdentifier.size, 0);
        });

        it('deduplicates installed apps by primary identifier', () => {
            const prefs = new ClipboardDecayPreferences();
            mocks.appInfos.push(new mocks.MockAppInfo({
                displayName: 'Bitwarden Duplicate',
                id: 'com.bitwarden.desktop.desktop',
                startupWmClass: 'Bitwarden',
            }));

            const catalog = prefs._buildAppCatalog();

            assert.equal(
                catalog.apps.filter(app => app.primaryIdentifier === 'com.bitwarden').length,
                1
            );
        });

        it('describes app info using StartupWMClass fallback', () => {
            const prefs = new ClipboardDecayPreferences();
            const appInfo = new mocks.MockAppInfo({
                displayName: 'Ghostty',
                strings: {StartupWMClass: 'com.mitchellh.ghostty'},
            });
            appInfo.get_startup_wm_class = undefined;

            const app = prefs._describeAppInfo(appInfo);

            assert.equal(app.primaryIdentifier, 'com.mitchellh.ghostty');
            assert.deepEqual(app.identifiers, ['com.mitchellh.ghostty']);
        });

        it('describes app info using get_name when display name is unavailable', () => {
            const prefs = new ClipboardDecayPreferences();
            const appInfo = new mocks.MockAppInfo({
                name: 'Ghostty',
                strings: {StartupWMClass: 'com.mitchellh.ghostty'},
            });
            appInfo.get_display_name = undefined;
            appInfo.get_id = undefined;
            appInfo.get_startup_wm_class = undefined;

            const app = prefs._describeAppInfo(appInfo);

            assert.equal(app.name, 'Ghostty');
            assert.equal(app.primaryIdentifier, 'com.mitchellh.ghostty');
        });

        it('falls back to the identifier when app info has no name', () => {
            const prefs = new ClipboardDecayPreferences();
            const appInfo = new mocks.MockAppInfo({
                displayName: '',
                name: '',
                id: 'org.mozilla.firefox.desktop',
            });
            appInfo.get_startup_wm_class = undefined;

            const app = prefs._describeAppInfo(appInfo);

            assert.equal(app.name, 'org.mozilla.firefox');
            assert.deepEqual(app.identifiers, ['org.mozilla.firefox']);
        });

        it('handles app info objects with no display-name helpers', () => {
            const prefs = new ClipboardDecayPreferences();
            const appInfo = new mocks.MockAppInfo({
                id: 'org.mozilla.firefox.desktop',
            });
            appInfo.get_display_name = undefined;
            appInfo.get_name = undefined;
            appInfo.get_startup_wm_class = undefined;

            const app = prefs._describeAppInfo(appInfo);

            assert.equal(app.name, 'org.mozilla.firefox');
            assert.deepEqual(app.identifiers, ['org.mozilla.firefox']);
        });

        it('merges hidden alias identifiers into visible app catalog entries', () => {
            const prefs = new ClipboardDecayPreferences();
            const catalog = prefs._buildAppCatalog();

            const brave = catalog.apps.find(app => app.name === 'Brave Web Browser');
            assert.ok(brave);
            assert.ok(brave.identifiers.includes('brave-browser'));
            assert.ok(brave.identifiers.includes('com.brave.browser'));
            assert.equal(brave.primaryIdentifier, 'brave-browser');

            // Both identifiers resolve to the same catalog entry
            assert.equal(catalog.byIdentifier.get('brave-browser'), brave);
            assert.equal(catalog.byIdentifier.get('com.brave.browser'), brave);
        });

        it('includes hidden alias identifiers in search text', () => {
            const prefs = new ClipboardDecayPreferences();
            const catalog = prefs._buildAppCatalog();

            const brave = catalog.apps.find(app => app.name === 'Brave Web Browser');
            assert.ok(brave.searchText.includes('com.brave.browser'));
        });

        it('does not create standalone catalog entries for hidden-only apps', () => {
            const prefs = new ClipboardDecayPreferences();
            const catalog = prefs._buildAppCatalog();

            // Hidden entry should not appear as its own app
            const hiddenEntries = catalog.apps.filter(
                app => app.primaryIdentifier === 'com.brave.browser');
            assert.equal(hiddenEntries.length, 0);
        });

        it('stores all identifiers including hidden aliases when picking an app', () => {
            const {page} = buildPrefs({'sensitive-sources': []});
            const installedGroup = getSourcesGroup(page);
            const searchRow = getInstalledSearchRow(installedGroup);

            searchRow.set_text('brave');
            const availableRows = getAvailableAppRows(installedGroup);
            assert.deepEqual(availableRows.map(row => row.title), ['Brave Web Browser']);

            availableRows[0].activate();

            const stored = mocks.settings.get_strv(SENSITIVE_SOURCES_KEY);
            assert.ok(stored.includes('brave-browser'));
            assert.ok(stored.includes('com.brave.browser'));
        });

        it('backfills hidden aliases for previously selected installed apps on prefs load', () => {
            const {page} = buildPrefs({'sensitive-sources': ['brave-browser']});

            assert.deepEqual(mocks.settings.get_strv(SENSITIVE_SOURCES_KEY), [
                'brave-browser',
                'com.brave.browser',
            ]);

            const rows = getSourceRows(getSourcesGroup(page));
            assert.deepEqual(rows.map(row => row.title), ['Brave Web Browser', 'Brave Web Browser']);
            assert.deepEqual(rows.map(row => row.subtitle), ['brave-browser', 'com.brave.browser']);
        });

        it('does not rewrite settings when selected app aliases are already complete', () => {
            const prefs = new ClipboardDecayPreferences();
            const catalog = prefs._buildAppCatalog();

            resetMocks({'sensitive-sources': ['brave-browser', 'com.brave.browser']});
            let writes = 0;
            const originalSetStrv = mocks.settings.set_strv.bind(mocks.settings);
            mocks.settings.set_strv = (...args) => {
                writes++;
                return originalSetStrv(...args);
            };

            assert.equal(prefs._backfillResolvedAliases(mocks.settings, catalog), false);
            assert.equal(writes, 0);
        });

        it('skips already-present identifiers when picking an app with partial overlap', () => {
            const {page} = buildPrefs({'sensitive-sources': ['com.brave.browser']});
            const installedGroup = getSourcesGroup(page);
            const searchRow = getInstalledSearchRow(installedGroup);

            searchRow.set_text('brave');
            assert.equal(getAvailableAppRows(installedGroup).length, 1);
            assert.equal(getAvailableAppRows(installedGroup)[0].activatable, false);
            assert.equal(getPickerAddedIcon(getAvailableAppRows(installedGroup)[0]).visible, true);
        });

        it('does not duplicate identifiers when manual entry overlaps with picker alias', () => {
            const {page} = buildPrefs({'sensitive-sources': ['brave-browser']});
            const installedGroup = getSourcesGroup(page);
            const advancedGroup = getSourcesGroup(page);
            getFallbackNavRow(advancedGroup).activate();
            const addRow = getAdvancedAddRow(advancedGroup);

            // Manually add the hidden alias
            addRow.set_text('com.brave.Browser.desktop');
            addRow.apply();

            const stored = mocks.settings.get_strv(SENSITIVE_SOURCES_KEY);
            assert.deepEqual(stored, ['brave-browser', 'com.brave.browser']);
        });

        it('runtime matches hidden alias id stored by picker', () => {
            // Simulates the Brave scenario end-to-end:
            // prefs store both identifiers, runtime sees the hidden one
            resetMocks({'sensitive-sources': ['brave-browser', 'com.brave.browser']});
            const ext = makeExt();

            mocks.display.focus_window = {get_wm_class: () => 'brave-browser'};
            mocks.windowTracker._app = {get_id: () => 'com.brave.Browser.desktop'};

            assert.equal(ext._isSensitive(), true);

            // Also matches via wmClass alone
            mocks.windowTracker._app = null;
            assert.equal(ext._isSensitive(), true);

            ext.disable();
        });

        it('resolves both visible and hidden alias identifiers in selected sources list', () => {
            const {page} = buildPrefs({'sensitive-sources': ['brave-browser', 'com.brave.browser']});
            const rows = getSourceRows(getSourcesGroup(page));

            // Both resolve to the same app name with their respective identifier subtitles
            assert.deepEqual(rows.map(row => row.title), ['Brave Web Browser', 'Brave Web Browser']);
            assert.deepEqual(rows.map(row => row.subtitle), ['brave-browser', 'com.brave.browser']);
        });

        it('ignores hidden apps with no visible counterpart by display name', () => {
            resetMocks();
            mocks.appInfos.push(new mocks.MockAppInfo({
                displayName: 'Orphan Hidden App',
                id: 'com.example.orphan.desktop',
                shouldShow: false,
            }));

            const prefs = new ClipboardDecayPreferences();
            const catalog = prefs._buildAppCatalog();

            assert.equal(catalog.byIdentifier.has('com.example.orphan'), false);
            assert.equal(catalog.apps.find(app => app.name === 'Orphan Hidden App'), undefined);
        });

        it('ignores hidden aliases with no display-name helpers during catalog merge', () => {
            resetMocks();
            mocks.appInfos.push({
                should_show: () => false,
                get_id: () => 'com.example.nameless.desktop',
            });

            const prefs = new ClipboardDecayPreferences();
            const catalog = prefs._buildAppCatalog();

            assert.equal(catalog.byIdentifier.has('com.example.nameless'), false);
        });

        it('merges hidden aliases by get_name fallback during catalog merge', () => {
            resetMocks();
            mocks.appInfos.push(new mocks.MockAppInfo({
                displayName: 'Fallback Merge App',
                id: 'fallback-merge.desktop',
            }));

            const hiddenAlias = new mocks.MockAppInfo({
                displayName: 'Ignored Hidden Name',
                name: 'Fallback Merge App',
                id: 'com.example.fallbackmerge.desktop',
                shouldShow: false,
            });
            hiddenAlias.get_display_name = undefined;
            mocks.appInfos.push(hiddenAlias);

            const prefs = new ClipboardDecayPreferences();
            const catalog = prefs._buildAppCatalog();
            const app = catalog.apps.find(entry => entry.primaryIdentifier === 'fallback-merge');

            assert.ok(app.identifiers.includes('com.example.fallbackmerge'));
            assert.equal(catalog.byIdentifier.get('com.example.fallbackmerge'), app);
        });

        it('merges multiple hidden aliases into the same visible app', () => {
            resetMocks();
            mocks.appInfos.push(new mocks.MockAppInfo({
                displayName: 'Multi Alias App',
                id: 'multi-alias.desktop',
                icon: {name: 'multi-icon'},
            }));
            mocks.appInfos.push(new mocks.MockAppInfo({
                displayName: 'Multi Alias App',
                id: 'com.example.multi.desktop',
                shouldShow: false,
            }));
            mocks.appInfos.push(new mocks.MockAppInfo({
                displayName: 'Multi Alias App',
                id: 'org.example.multi.desktop',
                shouldShow: false,
            }));

            const prefs = new ClipboardDecayPreferences();
            const catalog = prefs._buildAppCatalog();

            const app = catalog.apps.find(a => a.name === 'Multi Alias App');
            assert.ok(app);
            assert.ok(app.identifiers.includes('multi-alias'));
            assert.ok(app.identifiers.includes('com.example.multi'));
            assert.ok(app.identifiers.includes('org.example.multi'));
            assert.equal(catalog.byIdentifier.get('com.example.multi'), app);
            assert.equal(catalog.byIdentifier.get('org.example.multi'), app);
        });

        it('extracts hidden alias ids with StartupWMClass fallback', () => {
            const prefs = new ClipboardDecayPreferences();

            const aliasIds = prefs._extractHiddenAliasIds(new mocks.MockAppInfo({
                displayName: 'Test',
                id: 'com.test.app.desktop',
                startupWmClass: 'TestWM',
                shouldShow: false,
            }));

            assert.deepEqual(aliasIds, ['com.test.app', 'testwm']);
        });

        it('extracts hidden alias ids via get_string when startup wm class helper is unavailable', () => {
            const prefs = new ClipboardDecayPreferences();

            const aliasIds = prefs._extractHiddenAliasIds({
                should_show: () => false,
                get_id: () => 'com.test.fallback.desktop',
                get_string: key => key === 'StartupWMClass' ? 'FallbackWM' : '',
            });

            assert.deepEqual(aliasIds, ['com.test.fallback', 'fallbackwm']);
        });

        it('returns empty alias ids when hidden-state helper is missing', () => {
            const prefs = new ClipboardDecayPreferences();

            const aliasIds = prefs._extractHiddenAliasIds({
                get_id: () => 'com.test.missingflag.desktop',
            });

            assert.deepEqual(aliasIds, []);
        });

        it('extracts hidden alias ids when only the app id is available', () => {
            const prefs = new ClipboardDecayPreferences();

            const aliasIds = prefs._extractHiddenAliasIds({
                should_show: () => false,
                get_id: () => 'com.test.onlyid.desktop',
            });

            assert.deepEqual(aliasIds, ['com.test.onlyid']);
        });

        it('returns empty alias ids for visible apps', () => {
            const prefs = new ClipboardDecayPreferences();

            const aliasIds = prefs._extractHiddenAliasIds(new mocks.MockAppInfo({
                displayName: 'Visible',
                id: 'visible.desktop',
                shouldShow: true,
            }));

            assert.deepEqual(aliasIds, []);
        });

        it('returns empty alias ids when hidden app lacks id and startup wm class', () => {
            const prefs = new ClipboardDecayPreferences();

            const aliasIds = prefs._extractHiddenAliasIds({
                should_show: () => false,
                get_string: () => null,
            });

            assert.deepEqual(aliasIds, []);
        });

        it('returns empty alias ids for apps that throw during inspection', () => {
            const prefs = new ClipboardDecayPreferences();

            const aliasIds = prefs._extractHiddenAliasIds({
                should_show() { throw new Error('crash'); },
            });

            assert.deepEqual(aliasIds, []);
        });

        it('filters hidden or identifier-less app infos', () => {
            const prefs = new ClipboardDecayPreferences();

            assert.equal(prefs._describeAppInfo(new mocks.MockAppInfo({shouldShow: false})), null);
            assert.equal(prefs._describeAppInfo(new mocks.MockAppInfo({displayName: 'Broken'})), null);
        });

        it('describes app info when visibility and startup helpers are missing', () => {
            const prefs = new ClipboardDecayPreferences();
            const app = prefs._describeAppInfo({
                get_display_name: () => 'Only ID App',
                get_id: () => 'only-id.desktop',
            });

            assert.equal(app.name, 'Only ID App');
            assert.equal(app.primaryIdentifier, 'only-id');
            assert.deepEqual(app.identifiers, ['only-id']);
            assert.equal(app.icon, null);
        });

        it('handles app-info inspection errors gracefully', () => {
            const prefs = new ClipboardDecayPreferences();
            const appInfo = {
                should_show() {
                    throw new Error('boom');
                },
            };

            assert.equal(prefs._describeAppInfo(appInfo), null);
        });

        it('falls back to manual presentation for unresolved sources', () => {
            const prefs = new ClipboardDecayPreferences();
            const presentation = prefs._resolveSourcePresentation('custom-tool', {
                byIdentifier: new Map(),
            }, text => text);

            assert.deepEqual(presentation, {
                title: 'custom-tool',
                subtitle: 'Unverified manual identifier',
                icon: null,
                iconName: 'application-x-executable-symbolic',
            });
        });

        it('matches installed apps for empty queries and keeps already-added entries visible', () => {
            const prefs = new ClipboardDecayPreferences();
            const catalog = prefs._buildAppCatalog();

            assert.deepEqual(
                prefs._matchInstalledApps(catalog, '   ').map(app => app.name),
                ['Bitwarden', 'Brave Web Browser', 'Firefox', 'KeePassXC']
            );
            assert.deepEqual(
                prefs._matchInstalledApps(catalog, 'bitwarden.desktop').map(app => app.name),
                ['Bitwarden']
            );
        });

        it('filters with rawQuery only when normalizedQuery is empty', () => {
            const prefs = new ClipboardDecayPreferences();
            const catalog = prefs._buildAppCatalog();

            const results = prefs._matchInstalledApps(catalog, '.desktop');

            assert.equal(results.length, 0);
        });

        it('returns all apps when query is null', () => {
            const prefs = new ClipboardDecayPreferences();
            const catalog = prefs._buildAppCatalog();

            const results = prefs._matchInstalledApps(catalog, null);

            assert.deepEqual(
                results.map(app => app.name),
                catalog.apps.map(app => app.name)
            );
        });

        it('shows a helper message when no installed apps match the filter', () => {
            const {prefs, page} = buildPrefs();
            const installedGroup = getSourcesGroup(page);
            const searchRow = getInstalledSearchRow(installedGroup);
            const helperRow = getInstalledHelperRow(installedGroup);
            const listGroup = getInstalledListGroup(installedGroup);

            searchRow.set_text('zzzz');

            prefs._syncInstalledAppPicker(
                {
                    browseRow: getInstalledBrowseRow(installedGroup),
                    browseButton: getInstalledBrowseButton(installedGroup),
                    dialog: getInstalledDialog(installedGroup),
                    searchRow,
                    helperRow,
                    listGroup,
                },
                mocks.settings,
                prefs._buildAppCatalog(),
                text => text
            );

            assert.equal(getAvailableAppRows(installedGroup).length, 0);
            assert.equal(helperRow.visible, true);
            assert.equal(helperRow.title, 'No installed apps match this filter.');
        });

        it('shows the idle empty-state helper when the app catalog has entries but no picker rows exist', () => {
            const {prefs, page} = buildPrefs();
            const installedGroup = getSourcesGroup(page);
            const helperRow = getInstalledHelperRow(installedGroup);

            prefs._syncInstalledAppPicker(
                {
                    browseRow: getInstalledBrowseRow(installedGroup),
                    browseButton: getInstalledBrowseButton(installedGroup),
                    dialog: getInstalledDialog(installedGroup),
                    searchRow: getInstalledSearchRow(installedGroup),
                    helperRow,
                    listGroup: {_appRows: null},
                },
                mocks.settings,
                prefs._buildAppCatalog(),
                text => text
            );

            assert.equal(helperRow.visible, true);
            assert.equal(helperRow.title, 'No installed apps are available.');
        });

        it('handles a missing search row and list group when syncing the picker', () => {
            const {prefs, page} = buildPrefs();
            const installedGroup = getSourcesGroup(page);
            const helperRow = getInstalledHelperRow(installedGroup);

            prefs._syncInstalledAppPicker(
                {
                    browseRow: getInstalledBrowseRow(installedGroup),
                    browseButton: getInstalledBrowseButton(installedGroup),
                    dialog: getInstalledDialog(installedGroup),
                    searchRow: null,
                    helperRow,
                    listGroup: null,
                },
                mocks.settings,
                prefs._buildAppCatalog(),
                text => text
            );

            assert.equal(helperRow.visible, true);
            assert.equal(helperRow.title, 'No installed apps are available.');
        });

        it('treats a null picker search text as an empty filter', () => {
            const {prefs, page} = buildPrefs();
            const installedGroup = getSourcesGroup(page);
            const listGroup = getInstalledListGroup(installedGroup);
            const helperRow = getInstalledHelperRow(installedGroup);
            const catalog = {
                apps: listGroup._appRows.map(row => row._pickerApp),
                byIdentifier: new Map(),
            };

            prefs._syncInstalledAppPicker(
                {
                    browseRow: getInstalledBrowseRow(installedGroup),
                    browseButton: getInstalledBrowseButton(installedGroup),
                    dialog: getInstalledDialog(installedGroup),
                    searchRow: {text: null},
                    helperRow,
                    listGroup,
                },
                mocks.settings,
                catalog,
                text => text
            );

            assert.equal(helperRow.visible, false);
            assert.deepEqual(
                getAvailableAppRows(installedGroup).map(row => row.title),
                ['Bitwarden', 'Brave Web Browser', 'Firefox', 'KeePassXC']
            );
        });

        it('shows an empty-state helper when no installed apps are available', () => {
            const {prefs, page} = buildPrefs(undefined, currentMocks => {
                currentMocks.appInfos = [];
                currentMocks.Gio.AppInfo.get_all = () => currentMocks.appInfos;
            });
            const installedGroup = getSourcesGroup(page);
            const helperRow = getInstalledHelperRow(installedGroup);

            prefs._syncInstalledAppPicker(
                {
                    browseRow: getInstalledBrowseRow(installedGroup),
                    browseButton: getInstalledBrowseButton(installedGroup),
                    dialog: getInstalledDialog(installedGroup),
                    searchRow: getInstalledSearchRow(installedGroup),
                    helperRow,
                    listGroup: getInstalledListGroup(installedGroup),
                },
                mocks.settings,
                {apps: [], byIdentifier: new Map()},
                text => text
            );

            assert.equal(getAvailableAppRows(installedGroup).length, 0);
            assert.equal(helperRow.visible, true);
            assert.equal(helperRow.title, 'No installed apps were found.');
        });

        it('switches a picker row back to Add when the app is removed from settings', () => {
            const {page} = buildPrefs({'sensitive-sources': ['bitwarden', 'com.bitwarden']});
            const installedGroup = getSourcesGroup(page);
            const searchRow = getInstalledSearchRow(installedGroup);

            searchRow.set_text('bit');
            const row = getAvailableAppRows(installedGroup)[0];
            assert.equal(row.activatable, false);
            assert.equal(getPickerAddedIcon(row).visible, true);

            mocks.settings.set_strv(SENSITIVE_SOURCES_KEY, []);

            assert.equal(row.activatable, true);
            assert.equal(getPickerAddedIcon(row).visible, false);
            assert.equal(row.sensitive, true);
        });

        it('syncs sensitivity when picker and source rows are temporarily missing', () => {
            const {prefs, page} = buildPrefs({'sensitive-sources': []});
            const selectedGroup = getSourcesGroup(page);
            const installedGroup = getSourcesGroup(page);
            const advancedGroup = getSourcesGroup(page);

            selectedGroup._sourceRows = null;
            installedGroup._appRows = null;

            prefs._syncSensitiveMode(
                mocks.settings,
                getGeneralTimeoutRow(page),
                {
                    sensitiveRow: getSensitiveTimeoutRow(page),
                    group: selectedGroup,
                    emptyRow: getEmptyRow(selectedGroup),
                    infoRow: getInfoRow(selectedGroup),
                    browseRow: getInstalledBrowseRow(installedGroup),
                    browseButton: getInstalledBrowseButton(installedGroup),
                    fallbackNavRow: getFallbackNavRow(advancedGroup),
                    searchRow: getInstalledSearchRow(installedGroup),
                    helperRow: getInstalledHelperRow(installedGroup),
                    listGroup: getInstalledListGroup(installedGroup),
                    navigationView: getNavigationView(advancedGroup),
                    fallbackPage: getFallbackPage(advancedGroup),
                    detectRow: getDetectRow(advancedGroup),
                    detectButton: getDetectButton(advancedGroup),
                    detectedRow: getDetectedRow(advancedGroup),
                    useDetectedButton: getUseDetectedButton(advancedGroup),
                    addRow: getAdvancedAddRow(advancedGroup),
                    hintRow: getAdvancedHintRow(advancedGroup),
                    feedbackRow: getFeedbackRow(advancedGroup),
                }
            );

            assert.equal(getEmptyRow(selectedGroup).visible, true);
            assert.equal(getInfoRow(selectedGroup).visible, false);
        });

        it('handles null listGroup in _syncSensitiveMode without crashing', () => {
            const {prefs, page} = buildPrefs({'sensitive-sources': []});
            const selectedGroup = getSourcesGroup(page);
            const advancedGroup = getSourcesGroup(page);

            prefs._syncSensitiveMode(
                mocks.settings,
                getGeneralTimeoutRow(page),
                {
                    sensitiveRow: getSensitiveTimeoutRow(page),
                    group: selectedGroup,
                    emptyRow: getEmptyRow(selectedGroup),
                    infoRow: getInfoRow(selectedGroup),
                    browseRow: getInstalledBrowseRow(selectedGroup),
                    browseButton: getInstalledBrowseButton(selectedGroup),
                    fallbackNavRow: getFallbackNavRow(advancedGroup),
                    searchRow: getInstalledSearchRow(selectedGroup),
                    helperRow: getInstalledHelperRow(selectedGroup),
                    listGroup: null,
                    navigationView: getNavigationView(advancedGroup),
                    fallbackPage: getFallbackPage(advancedGroup),
                    detectRow: getDetectRow(advancedGroup),
                    detectButton: getDetectButton(advancedGroup),
                    detectedRow: getDetectedRow(advancedGroup),
                    useDetectedButton: getUseDetectedButton(advancedGroup),
                    addRow: getAdvancedAddRow(advancedGroup),
                    hintRow: getAdvancedHintRow(advancedGroup),
                    feedbackRow: getFeedbackRow(advancedGroup),
                }
            );

            assert.equal(getEmptyRow(selectedGroup).visible, true);
        });

        it('signal objects disconnect handlers cleanly', () => {
            const button = new mocks.Gtk.Button();
            let calls = 0;
            const signalId = button.connect('clicked', () => {
                calls++;
            });

            button.disconnect(signalId);
            button.click();

            assert.equal(calls, 0);
        });

        it('mock button stores accessible labels via update_property', () => {
            const button = new mocks.Gtk.Button();

            button.update_property([mocks.Gtk.AccessibleProperty.LABEL], ['Example']);

            assert.equal(button.accessible_label, 'Example');
        });

        it('mock entry row rejects unsupported subtitle property', () => {
            assert.throws(
                () => new mocks.Adw.EntryRow({title: 'Add app identifier', subtitle: 'invalid'}),
                /does not support subtitle/
            );
        });

        it('mock app info exposes fallback getters', () => {
            const appInfo = new mocks.MockAppInfo({name: 'Fallback Name'});

            assert.equal(appInfo.get_name(), 'Fallback Name');
            assert.equal(appInfo.get_string('missing-key'), null);
        });

        it('mock key controller returns null when no key handler is connected', () => {
            const controller = new mocks.Gtk.EventControllerKey();
            assert.equal(controller.emitKeyPressed('Escape'), null);
        });

        it('mock infrastructure covers default branches', () => {
            assert.equal(mocks.settings.get_int('missing-int'), 0);
            assert.equal(mocks.settings.get_boolean('missing-bool'), false);
            assert.deepEqual(mocks.settings.get_strv('missing-list'), []);

            const entryRow = new mocks.Adw.EntryRow();
            assert.equal(entryRow.text, '');
            assert.equal(entryRow.show_apply_button, false);

            const spinRow = new mocks.Adw.SpinRow();
            assert.equal(spinRow.value, 0);
            assert.equal(spinRow.adjustment, null);
            assert.equal(spinRow.digits, 0);
            assert.equal(spinRow.subtitle, '');

            const switchRow = new mocks.Adw.SwitchRow();
            assert.equal(switchRow.active, false);
            assert.equal(switchRow.subtitle, '');

            const actionRow = new mocks.Adw.ActionRow();
            actionRow.add_prefix(new mocks.Gtk.Image({icon_name: 'dialog-information-symbolic'}));
            assert.equal(actionRow.prefixes[0].icon_name, 'dialog-information-symbolic');

            const image = new mocks.Gtk.Image({icon_name: 'dialog-warning-symbolic', pixel_size: 16});
            assert.equal(image.icon_name, 'dialog-warning-symbolic');
            assert.equal(image.pixel_size, 16);

            mocks.Main.addToStatusArea('extra-role', {name: 'indicator'});
            assert.deepEqual(mocks.panel._statusArea['extra-role'], {name: 'indicator'});
        });

        it('mock settings typed setters update stored values', () => {
            mocks.settings.set_boolean(ENABLE_SENSITIVE_SOURCES_KEY, 0);
            mocks.settings.set_int('general-timeout', '120');

            assert.equal(mocks.settings.get_boolean(ENABLE_SENSITIVE_SOURCES_KEY), false);
            assert.equal(mocks.settings.get_int('general-timeout'), 120);
        });

        it('mock timer keeps callbacks that return true and ignores missing ids', () => {
            const timerId = mocks.GLib.timeout_add_seconds(0, 1, () => true);

            mocks.GLib.fireTimer(9999);
            mocks.GLib.fireTimer(timerId);

            assert.ok(mocks.GLib._timers.has(timerId));
        });
    });
});
