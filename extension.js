// SPDX-License-Identifier: GPL-2.0-or-later
import St from 'gi://St';
import Meta from 'gi://Meta';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {
    DETECT_WINDOW_MODE_KEY,
    DETECTED_WINDOW_ID_KEY,
    ENABLE_GENERAL_TIMEOUT_KEY,
    ENABLE_SENSITIVE_SOURCES_KEY,
    SENSITIVE_SOURCES_KEY,
    generalTimeoutEnabled,
    getSensitiveSources,
    normalizeId,
    sensitiveSourcesEnabled,
} from './utils.js';

export default class ClipboardDecay extends Extension {
    enable() {
        try {
            this.disable();

            this._enabled = true;
            this._settings = this.getSettings();
            this._clipboard = St.Clipboard.get_default();
            this._selection = global.display.get_selection();
            this._tracker = Shell.WindowTracker.get_default();

            this._timerId = null;
            this._isSelfClear = false;
            this._selSignalId = null;
            this._settingsSignalIds = [];
            this._focusCaptureSignalId = null;
            this._focusCaptureTimeoutId = null;
            this._focusCaptureIgnoreWindow = null;
            this._generalTimeoutEnabled = false;
            this._sensitiveSources = new Set();
            this._sensitiveSourcesEnabled = true;

            this._loadDecaySettings();
            this._settingsSignalIds = [
                this._settings.connect(
                    `changed::${ENABLE_GENERAL_TIMEOUT_KEY}`,
                    () => {
                        this._loadDecaySettings();
                        this._clearArmedDecay();
                    }),
                this._settings.connect(
                    `changed::${ENABLE_SENSITIVE_SOURCES_KEY}`,
                    () => {
                        this._loadDecaySettings();
                        this._clearArmedDecay();
                    }),
                this._settings.connect(
                    `changed::${SENSITIVE_SOURCES_KEY}`,
                    () => this._loadDecaySettings()),
                this._settings.connect(
                    `changed::${DETECT_WINDOW_MODE_KEY}`,
                    () => this._syncFocusCaptureMode()),
            ];

            this._syncFocusCaptureMode();

            // Panel indicator — hide entire button so it takes no panel space
            this._indicator = new PanelMenu.Button(0.0, this.metadata.name, true);
            this._indicator.reactive = false;
            this._icon = new St.Icon({
                icon_name: 'preferences-system-time-symbolic',
                style_class: 'system-status-icon',
            });
            this._indicator.add_child(this._icon);
            this._indicator.visible = false;
            Main.panel.addToStatusArea(this.uuid, this._indicator);

            // Clipboard monitoring — owner-changed(guint type, MetaSelectionSource src)
            this._selSignalId = this._selection.connect(
                'owner-changed', this._onOwnerChanged.bind(this));
        } catch (e) {
            console.error(`[clipboard-decay] Failed to enable extension: ${e}`);
            this.disable();
        }
    }

    _loadDecaySettings() {
        this._generalTimeoutEnabled = generalTimeoutEnabled(this._settings);
        this._sensitiveSourcesEnabled = sensitiveSourcesEnabled(this._settings);
        this._sensitiveSources = new Set(getSensitiveSources(this._settings));
    }

    _clearArmedDecay() {
        this._cancelTimer();

        if (this._indicator)
            this._indicator.visible = false;
    }

    _getFocusedSourceInfo() {
        const win = global.display.focus_window;
        if (!win)
            return {hasWindow: false, wmClass: '', appId: ''};

        const wmClass = normalizeId(win.get_wm_class() ?? '');
        const app = this._tracker.get_window_app(win);
        const appId = normalizeId(app?.get_id() ?? '');

        return {hasWindow: true, wmClass, appId};
    }

    _getDetectableWindowId() {
        const sourceInfo = this._getFocusedSourceInfo();
        if (!sourceInfo.hasWindow)
            return '';

        return sourceInfo.appId || sourceInfo.wmClass || '';
    }

    _stopFocusCapture() {
        if (this._focusCaptureSignalId !== null)
            global.display.disconnect(this._focusCaptureSignalId);

        if (this._focusCaptureTimeoutId !== null)
            GLib.Source.remove(this._focusCaptureTimeoutId);

        this._focusCaptureSignalId = null;
        this._focusCaptureTimeoutId = null;
        this._focusCaptureIgnoreWindow = null;
    }

    _captureFocusedWindowId() {
        if (global.display.focus_window === this._focusCaptureIgnoreWindow)
            return false;

        const identifier = this._getDetectableWindowId();
        if (!identifier)
            return false;

        this._settings.set_string?.(DETECTED_WINDOW_ID_KEY, identifier);
        this._settings.set_boolean?.(DETECT_WINDOW_MODE_KEY, false);
        return true;
    }

    _syncFocusCaptureMode() {
        if (!this._settings || !global.display)
            return;

        const detecting = this._settings.get_boolean?.(DETECT_WINDOW_MODE_KEY);
        if (!detecting) {
            this._stopFocusCapture();
            return;
        }

        if (this._focusCaptureSignalId !== null)
            return;

        this._focusCaptureIgnoreWindow = global.display.focus_window ?? null;
        this._focusCaptureSignalId = global.display.connect('notify::focus-window', () => {
            this._captureFocusedWindowId();
        });
        this._focusCaptureTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            30,
            () => {
                this._settings.set_boolean?.(DETECT_WINDOW_MODE_KEY, false);
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _matchesSensitiveSource(sourceInfo) {
        if (!this._sensitiveSourcesEnabled || !sourceInfo)
            return false;

        return Boolean(
            (sourceInfo.wmClass && this._sensitiveSources.has(sourceInfo.wmClass)) ||
            (sourceInfo.appId && this._sensitiveSources.has(sourceInfo.appId))
        );
    }

    _isSensitive() {
        try {
            return this._matchesSensitiveSource(this._getFocusedSourceInfo());
        } catch {
            return false;
        }
    }

    _getDecayPlan() {
        if (this._isSensitive()) {
            return {
                seconds: this._settings.get_int('sensitive-timeout'),
                iconName: 'dialog-password-symbolic',
            };
        }

        if (!this._generalTimeoutEnabled)
            return null;

        return {
            seconds: this._settings.get_int('general-timeout'),
            iconName: 'preferences-system-time-symbolic',
        };
    }

    _shouldIgnoreRelayEvent() {
        if (!this._sensitiveSourcesEnabled || this._timerId === null)
            return false;

        try {
            const sourceInfo = this._getFocusedSourceInfo();
            return sourceInfo.hasWindow &&
                !sourceInfo.wmClass &&
                (!sourceInfo.appId || sourceInfo.appId.startsWith('window:'));
        } catch {
            // Stale/destroyed window — preserve existing timer.
            return true;
        }
    }

    _onOwnerChanged(_sel, type, _source) {
        if (type !== Meta.SelectionType.SELECTION_CLIPBOARD)
            return;

        // Ignore our own clear — flag is only true during set_text() call stack
        if (this._isSelfClear)
            return;

        // Guard against queued signals delivered after disable() has
        // destroyed the indicator / icon GObjects.
        if (!this._enabled || !this._settings || !this._indicator)
            return;

        // Relay helpers such as wl-copy or OSC-52 bridges often re-assert
        // ownership from transient surfaces with no WM_CLASS and no useful
        // app-id. When a decay timer is already running, preserve it instead
        // of letting the relay event downgrade a sensitive timeout.
        if (this._shouldIgnoreRelayEvent())
            return;

        this._cancelTimer();

        const plan = this._getDecayPlan();
        if (!plan) {
            this._indicator.visible = false;
            return;
        }

        const seconds = Math.max(1, plan.seconds);

        // Update indicator
        this._icon.icon_name = plan.iconName;
        this._indicator.visible = true;

        // Arm decay timer
        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, seconds, () => {
                this._timerId = null;        // null BEFORE clear (exception safety)
                this._clearClipboard();
                return GLib.SOURCE_REMOVE;
            });
    }

    _clearClipboard() {
        // Flag is only true during the synchronous set_text() call.
        // owner-changed fires synchronously via g_signal_emit() inside set_text(),
        // so the handler sees the flag and skips. try/finally guarantees reset
        // even if set_text() throws — preventing the flag from getting stuck.
        this._isSelfClear = true;
        try {
            this._clipboard.set_text(St.ClipboardType.CLIPBOARD, '');
        } catch (e) {
            console.error(`[clipboard-decay] Failed to clear clipboard: ${e}`);
        } finally {
            this._isSelfClear = false;
        }

        if (this._indicator)
            this._indicator.visible = false;
    }

    _cancelTimer() {
        if (typeof this._timerId === 'number')
            GLib.Source.remove(this._timerId);

        this._timerId = null;
    }

    disable() {
        this._enabled = false;
        this._cancelTimer();
        this._isSelfClear = false;
        this._stopFocusCapture();

        if (this._selection && this._selSignalId) {
            this._selection.disconnect(this._selSignalId);
        }
        this._selSignalId = null;
        this._focusCaptureSignalId = null;
        this._focusCaptureTimeoutId = null;
        this._focusCaptureIgnoreWindow = null;

        if (this._settings && this._settingsSignalIds) {
            for (const signalId of this._settingsSignalIds)
                this._settings.disconnect(signalId);
        }
        this._settingsSignalIds = null;

        this._indicator?.destroy();
        this._indicator = null;
        this._icon = null;
        this._selection = null;
        this._clipboard = null;
        this._settings = null;
        this._generalTimeoutEnabled = null;
        this._sensitiveSources = null;
        this._sensitiveSourcesEnabled = null;
        this._tracker = null;
    }
}
