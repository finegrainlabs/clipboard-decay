// SPDX-License-Identifier: GPL-2.0-or-later
// Mock framework for testing ClipboardDecay outside GNOME Shell.

/**
 * Mock St.Clipboard — records set_text calls, optionally triggers callback.
 */
export class MockClipboard {
    constructor() {
        this.calls = [];
        this.onSetText = null;   // optional callback for integration tests
        this._shouldThrow = false;
    }

    set_text(type, text) {
        this.calls.push({type, text});
        if (this._shouldThrow)
            throw new Error('mock set_text failure');
        if (this.onSetText)
            this.onSetText(type, text);
    }
}

/**
 * Mock Meta.Selection — connect/disconnect signal handlers.
 */
export class MockSelection {
    constructor() {
        this._handlers = new Map();
        this._nextId = 1;
        this._shouldThrowOnConnect = false;
    }

    connect(signal, handler) {
        if (this._shouldThrowOnConnect)
            throw new Error('mock connect failure');
        const id = this._nextId++;
        this._handlers.set(id, {signal, handler});
        return id;
    }

    disconnect(id) {
        this._handlers.delete(id);
    }

    /** Test helper: emit owner-changed to all registered handlers. */
    emitOwnerChanged(type, source) {
        for (const {signal, handler} of this._handlers.values()) {
            if (signal === 'owner-changed')
                handler(this, type, source);
        }
    }
}

/**
 * Mock GSettings — stores key-value pairs, supports connect/disconnect.
 */
export class MockSettings {
    constructor(defaults = {}) {
        this._data = {
            'enable-general-timeout': false,
            'enable-sensitive-sources': true,
            'detect-window-mode': false,
            'detected-window-id': '',
            'sensitive-timeout': 20,
            'general-timeout': 300,
            'sensitive-sources': [],
            ...defaults,
        };
        this._handlers = new Map();
        this._bindings = [];
        this._userKeys = new Set();
        this._nextId = 1;
    }

    get_int(key) {
        return this._data[key] ?? 0;
    }

    get_boolean(key) {
        return Boolean(this._data[key]);
    }

    get_strv(key) {
        return this._data[key] ?? [];
    }

    get_string(key) {
        return this._data[key] ?? '';
    }

    get_user_value(key) {
        return this._userKeys.has(key) ? {key, value: this._data[key]} : null;
    }

    connect(signal, handler) {
        const id = this._nextId++;
        this._handlers.set(id, {signal, handler});
        return id;
    }

    disconnect(id) {
        this._handlers.delete(id);
    }

    bind(key, target, property, _flags) {
        this._bindings.push({key, target, property});
        target[property] = this._data[key];
    }

    set_strv(key, value) {
        this.set(key, [...value]);
    }

    set_string(key, value) {
        this.set(key, String(value));
    }

    set_boolean(key, value) {
        this.set(key, Boolean(value));
    }

    set_int(key, value) {
        this.set(key, Number(value));
    }

    seedUserValue(key, value) {
        this._data[key] = value;
        this._userKeys.add(key);
    }

    /** Test helper: change a key and emit the changed signal. */
    set(key, value) {
        this._data[key] = value;
        this._userKeys.add(key);

        for (const binding of this._bindings) {
            if (binding.key === key)
                binding.target[binding.property] = value;
        }

        for (const {signal, handler} of this._handlers.values()) {
            if (signal === `changed::${key}`)
                handler(this, key);
        }
    }
}

/**
 * Mock GLib — timer management and constants.
 */
export class MockGLib {
    constructor() {
        this.PRIORITY_DEFAULT = 0;
        this.SOURCE_REMOVE = false;
        this.SOURCE_CONTINUE = true;
        this._nextId = 1;
        this._timers = new Map();
        this.Source = {
            remove: (id) => {
                this._timers.delete(id);
            },
        };
    }

    timeout_add_seconds(priority, seconds, callback) {
        const id = this._nextId++;
        this._timers.set(id, {priority, seconds, callback});
        return id;
    }

    /** Test helper: fire a timer callback and remove it if SOURCE_REMOVE. */
    fireTimer(id) {
        const timer = this._timers.get(id);
        if (!timer)
            return;
        const result = timer.callback();
        if (result === false || result === this.SOURCE_REMOVE)
            this._timers.delete(id);
    }

    /** Test helper: fire all pending timers. */
    fireAll() {
        for (const id of [...this._timers.keys()])
            this.fireTimer(id);
    }
}

/**
 * Mock Shell.WindowTracker
 */
export class MockWindowTracker {
    constructor() {
        this._app = null;  // set per-test
    }

    get_window_app(_win) {
        return this._app;
    }
}

/**
 * Mock PanelMenu.Button
 */
export class MockPanelMenuButton {
    constructor(_alignment, _name, _dontCreateMenu) {
        this.reactive = true;
        this.visible = true;
        this._children = [];
        this._destroyed = false;
    }

    add_child(child) {
        this._children.push(child);
    }

    destroy() {
        this._destroyed = true;
    }
}

/**
 * Mock St.Icon
 */
export class MockIcon {
    constructor(props) {
        Object.assign(this, props);
    }
}

/**
 * Mock Main.panel
 */
export class MockPanel {
    constructor() {
        this._statusArea = {};
    }

    addToStatusArea(role, indicator) {
        this._statusArea[role] = indicator;
    }
}

class MockSignalObject {
    constructor(props = {}) {
        Object.assign(this, props);
        this._handlers = new Map();
        this._nextId = 1;
    }

    connect(signal, handler) {
        const id = this._nextId++;
        this._handlers.set(id, {signal, handler});
        return id;
    }

    disconnect(id) {
        this._handlers.delete(id);
    }

    emit(signal, ...args) {
        for (const {signal: registeredSignal, handler} of this._handlers.values()) {
            if (registeredSignal === signal)
                handler(this, ...args);
        }
    }
}

class MockContainer extends MockSignalObject {
    constructor(props = {}) {
        super(props);
        this.children = [];
    }

    add(child) {
        if (!this.children.includes(child))
            this.children.push(child);
    }

    remove(child) {
        this.children = this.children.filter(existingChild => existingChild !== child);
    }
}

export class MockPreferencesPage extends MockContainer {}
export class MockPreferencesGroup extends MockContainer {}
export class MockToolbarView extends MockContainer {
    constructor(props = {}) {
        super(props);
        this.topBars = [];
        this.content = null;
    }

    add_top_bar(bar) {
        this.topBars.push(bar);
    }

    set_content(content) {
        this.content = content;
    }
}

export class MockHeaderBar extends MockSignalObject {}
export class MockAboutDialog extends MockSignalObject {
    constructor(props = {}) {
        super(props);
        this.present_calls = [];
    }

    present(window) {
        this.present_calls.push(window);
        globalThis.__mocks.presentedAboutDialogs.push(this);
    }
}

export class MockNavigationPage extends MockSignalObject {
    constructor(props = {}) {
        super(props);
        this.title = props.title ?? '';
        this.child = props.child ?? null;
        this.tag = props.tag ?? null;
    }
}

export class MockNavigationView extends MockContainer {
    constructor(props = {}) {
        super(props);
        this.pages = [];
        this.visiblePage = null;
    }

    add(page) {
        this.pages.push(page);
        if (!this.visiblePage)
            this.visiblePage = page;
    }

    push(page) {
        this.pages.push(page);
        this.visiblePage = page;
    }

    pop() {
        if (this.pages.length > 1)
            this.pages.pop();
        this.visiblePage = this.pages[this.pages.length - 1] ?? null;
    }
}
export class MockDialog extends MockContainer {
    constructor(props = {}) {
        super(props);
        this.present_calls = [];
        this.close_calls = 0;
        this.child = null;
    }

    set_child(child) {
        this.child = child;
    }

    present(window) {
        this.present_calls.push(window);
    }

    close() {
        this.close_calls++;
    }
}

export class MockActionRow extends MockSignalObject {
    constructor(props = {}) {
        super(props);
        this.prefixes = [];
        this.suffixes = [];
        this.activatable = props.activatable ?? false;
        this.visible = props.visible ?? true;
        this.title = props.title ?? '';
        this.subtitle = props.subtitle ?? '';
    }

    add_prefix(child) {
        this.prefixes.push(child);
    }

    add_suffix(child) {
        this.suffixes.push(child);
    }

    activate() {
        if (!this.activatable)
            return;
        this.emit('activated');
    }
}

export class MockExpanderRow extends MockActionRow {
    constructor(props = {}) {
        super(props);
        this.expanded = props.expanded ?? false;
        this.rows = [];
        this.subtitle = props.subtitle ?? '';
    }

    add_row(child) {
        this.rows.push(child);
    }
}

export class MockEntryRow extends MockActionRow {
    constructor(props = {}) {
        if (Object.hasOwn(props, 'subtitle'))
            throw new Error('MockEntryRow does not support subtitle');
        super(props);
        this.text = props.text ?? '';
        this.show_apply_button = props.show_apply_button ?? false;
    }

    set_text(text) {
        this.text = text;
        this.emit('notify::text');
    }

    apply() {
        this.emit('apply');
    }
}

export class MockSearchEntry extends MockSignalObject {
    constructor(props = {}) {
        super(props);
        this.text = props.text ?? '';
        this.placeholder_text = props.placeholder_text ?? '';
        this.visible = props.visible ?? true;
        this.controllers = [];
    }

    set_text(text) {
        this.text = text;
        this.emit('notify::text');
    }

    add_controller(controller) {
        this.controllers.push(controller);
    }
}

export class MockEventControllerKey extends MockSignalObject {
    emitKeyPressed(keyval) {
        for (const {signal, handler} of this._handlers.values()) {
            if (signal === 'key-pressed')
                return handler(this, keyval, null, null);
        }

        return null;
    }
}

export class MockSpinRow extends MockActionRow {
    constructor(props = {}) {
        super(props);
        this.value = props.value ?? 0;
        this.adjustment = props.adjustment ?? null;
        this.digits = props.digits ?? 0;
        this.subtitle = props.subtitle ?? '';
    }
}

export class MockSwitchRow extends MockActionRow {
    constructor(props = {}) {
        super(props);
        this.active = props.active ?? false;
        this.subtitle = props.subtitle ?? '';
    }
}

export class MockAdjustment {
    constructor(props = {}) {
        Object.assign(this, props);
    }
}

export class MockBox extends MockContainer {
    constructor(props = {}) {
        super(props);
        Object.assign(this, props);
    }

    append(child) {
        this.add(child);
    }
}

export class MockScrolledWindow extends MockSignalObject {
    constructor(props = {}) {
        super(props);
        this.child = null;
    }

    set_child(child) {
        this.child = child;
    }
}

export class MockImage {
    constructor(props = {}) {
        Object.assign(this, props);
        this.visible = props.visible ?? true;
    }
}

export class MockAppInfo {
    constructor(props = {}) {
        this._displayName = props.displayName ?? '';
        this._name = props.name ?? this._displayName;
        this._id = props.id ?? '';
        this._startupWmClass = props.startupWmClass ?? null;
        this._strings = props.strings ?? {};
        this._icon = props.icon ?? null;
        this._shouldShow = props.shouldShow ?? true;
    }

    should_show() {
        return this._shouldShow;
    }

    get_display_name() {
        return this._displayName;
    }

    get_name() {
        return this._name;
    }

    get_id() {
        return this._id;
    }

    get_startup_wm_class() {
        return this._startupWmClass;
    }

    get_string(key) {
        return this._strings[key] ?? null;
    }

    get_icon() {
        return this._icon;
    }
}

export class MockButton extends MockSignalObject {
    constructor(props = {}) {
        super(props);
        this.accessible_label = '';
        this.icon_name = props.icon_name ?? '';
    }

    update_property(properties, values) {
        for (let i = 0; i < properties.length; i++) {
            if (properties[i] === 'label')
                this.accessible_label = values[i];
        }
    }

    click() {
        this.emit('clicked');
    }
}

export class MockPrefsWindow extends MockContainer {
    constructor(props = {}) {
        super(props);
        this.default_width = null;
        this.default_height = null;
    }

    set_default_size(width, height) {
        this.default_width = width;
        this.default_height = height;
    }

    destroy() {
        this.emit('destroy');
    }
}

/**
 * Mock display with focus_window and get_selection().
 */
export class MockDisplay {
    constructor(selection) {
        this._handlers = new Map();
        this._nextId = 1;
        this._selection = selection;
        this.focus_window = null;  // set per-test
    }

    connect(signal, handler) {
        const id = this._nextId++;
        this._handlers.set(id, {signal, handler});
        return id;
    }

    disconnect(id) {
        this._handlers.delete(id);
    }

    get_selection() {
        return this._selection;
    }

    emitFocusWindowChanged() {
        for (const {signal, handler} of this._handlers.values()) {
            if (signal === 'notify::focus-window')
                handler(this);
        }
    }
}

/**
 * Mock Extension base class — provides getSettings(), metadata, uuid.
 * Reads from globalThis.__mocks lazily so resetMocks() works between tests.
 */
export class MockExtensionBase {
    getSettings() {
        return globalThis.__mocks.settings;
    }

    get metadata() {
        return globalThis.__mocks.metadata;
    }

    get uuid() {
        return globalThis.__mocks.metadata.uuid;
    }
}

export class MockExtensionPreferencesBase {
    getSettings() {
        return globalThis.__mocks.settings;
    }

    get metadata() {
        return globalThis.__mocks.metadata;
    }

    get uuid() {
        return globalThis.__mocks.metadata.uuid;
    }

    gettext(text) {
        return text;
    }
}

// ─── Factory ───────────────────────────────────────────────────────────

/**
 * Create a complete, fresh set of interconnected mocks.
 * Returns an object suitable for `globalThis.__mocks`.
 */
export function createMocks(settingsDefaults) {
    const clipboard = new MockClipboard();
    const selection = new MockSelection();
    const settings = new MockSettings(settingsDefaults);
    const glib = new MockGLib();
    const windowTracker = new MockWindowTracker();
    const panel = new MockPanel();
    const display = new MockDisplay(selection);
    const appInfos = [
        new MockAppInfo({
            displayName: 'Bitwarden',
            id: 'com.bitwarden.desktop.desktop',
            startupWmClass: 'Bitwarden',
            icon: {name: 'bitwarden-icon'},
        }),
        new MockAppInfo({
            displayName: 'Brave Web Browser',
            id: 'brave-browser.desktop',
            icon: {name: 'brave-icon'},
        }),
        new MockAppInfo({
            displayName: 'Brave Web Browser',
            id: 'com.brave.Browser.desktop',
            shouldShow: false,
            icon: {name: 'brave-icon'},
        }),
        new MockAppInfo({
            displayName: 'Firefox',
            id: 'org.mozilla.firefox.desktop',
            startupWmClass: 'firefox',
            icon: {name: 'firefox-icon'},
        }),
        new MockAppInfo({
            displayName: 'KeePassXC',
            id: 'org.keepassxc.KeePassXC.desktop',
            startupWmClass: 'KeePassXC',
            icon: {name: 'keepassxc-icon'},
        }),
    ];

    return {
        // Direct references (used by tests)
        clipboard,
        selection,
        settings,
        GLib: glib,
        windowTracker,
        panel,
        display,
        appInfos,
        MockAppInfo,

        // Namespaced objects (used by Proxy-based hook modules)
        St: {
            Clipboard: {get_default: () => clipboard},
            ClipboardType: {CLIPBOARD: 0},
            Icon: MockIcon,
        },
        Shell: {
            WindowTracker: {get_default: () => windowTracker},
        },
        Gio: {
            SettingsBindFlags: {DEFAULT: 0},
            AppInfo: {
                get_all: () => globalThis.__mocks.appInfos,
            },
        },
        Adw: {
            AboutDialog: MockAboutDialog,
            Dialog: MockDialog,
            ExpanderRow: MockExpanderRow,
            HeaderBar: MockHeaderBar,
            NavigationPage: MockNavigationPage,
            NavigationView: MockNavigationView,
            PreferencesPage: MockPreferencesPage,
            PreferencesGroup: MockPreferencesGroup,
            SpinRow: MockSpinRow,
            ToolbarView: MockToolbarView,
            SwitchRow: MockSwitchRow,
            EntryRow: MockEntryRow,
            ActionRow: MockActionRow,
        },
        Gtk: {
            Adjustment: MockAdjustment,
            Box: MockBox,
            Button: MockButton,
            EventControllerKey: MockEventControllerKey,
            Image: MockImage,
            License: {GPL_2_0: 'GPL_2_0'},
            SearchEntry: MockSearchEntry,
            ScrolledWindow: MockScrolledWindow,
            AccessibleProperty: {LABEL: 'label'},
            Align: {CENTER: 'center'},
            Orientation: {VERTICAL: 'vertical'},
        },
        Gdk: {
            KEY_Escape: 'Escape',
            EVENT_STOP: true,
            EVENT_PROPAGATE: false,
        },
        Main: {
            panel,
            addToStatusArea: (...args) => panel.addToStatusArea(...args),
        },

        // Classes (used by Proxy construct traps)
        PanelMenuButton: MockPanelMenuButton,
        Icon: MockIcon,
        ExtensionBase: MockExtensionBase,
        ExtensionPreferencesBase: MockExtensionPreferencesBase,
        PrefsWindow: MockPrefsWindow,
        metadata: {
            name: 'Clipboard Decay',
            description: 'Clears the clipboard after a configurable timeout. Optionally detects copies from selected sensitive apps (e.g. password managers) and applies a shorter timer. This extension reads and writes the system clipboard.',
            uuid: 'clipboard-decay@finegrainlabs',
            url: 'https://github.com/finegrainlabs/clipboard-decay',
        },
        presentedAboutDialogs: [],
    };
}
