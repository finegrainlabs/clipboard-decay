// SPDX-License-Identifier: GPL-2.0-or-later
// ESM loader hooks — intercept gi:// and resource:// imports, return mock source.
//
// All mock module source strings are evaluated in the MAIN thread.
// Property access is deferred to globalThis.__mocks so tests can swap mocks.

const MOCK_MODULES = {
    'gi://St': `
        export default new Proxy({}, {
            get(_, prop) { return globalThis.__mocks.St[prop]; },
            set(_, prop, val) { globalThis.__mocks.St[prop] = val; return true; },
        });
    `,

    'gi://Meta': `
        export default {
            SelectionType: { SELECTION_PRIMARY: 0, SELECTION_CLIPBOARD: 1, SELECTION_DND: 2 },
        };
    `,

    'gi://GLib': `
        export default new Proxy({}, {
            get(_, prop) { return globalThis.__mocks.GLib[prop]; },
            set(_, prop, val) { globalThis.__mocks.GLib[prop] = val; return true; },
        });
    `,

    'gi://Shell': `
        export default new Proxy({}, {
            get(_, prop) { return globalThis.__mocks.Shell[prop]; },
            set(_, prop, val) { globalThis.__mocks.Shell[prop] = val; return true; },
        });
    `,

    'gi://Adw': `
        export default new Proxy({}, {
            get(_, prop) { return globalThis.__mocks.Adw[prop]; },
            set(_, prop, val) { globalThis.__mocks.Adw[prop] = val; return true; },
        });
    `,

    'gi://Gio': `
        export default new Proxy({}, {
            get(_, prop) { return globalThis.__mocks.Gio[prop]; },
            set(_, prop, val) { globalThis.__mocks.Gio[prop] = val; return true; },
        });
    `,

    'gi://Gtk': `
        export default new Proxy({}, {
            get(_, prop) { return globalThis.__mocks.Gtk[prop]; },
            set(_, prop, val) { globalThis.__mocks.Gtk[prop] = val; return true; },
        });
    `,

    'gi://Gdk': `
        export default new Proxy({}, {
            get(_, prop) { return globalThis.__mocks.Gdk[prop]; },
            set(_, prop, val) { globalThis.__mocks.Gdk[prop] = val; return true; },
        });
    `,

    'resource:///org/gnome/shell/ui/main.js': `
        // Main.panel must proxy to current globalThis.__mocks.panel
        export const panel = new Proxy({}, {
            get(_, prop) {
                return globalThis.__mocks.panel[prop];
            },
            set(_, prop, val) {
                globalThis.__mocks.panel[prop] = val;
                return true;
            }
        });
    `,

    'resource:///org/gnome/shell/ui/panelMenu.js': `
        // PanelMenu.Button is used as a constructor: new PanelMenu.Button(...)
        export const Button = new Proxy(function(){}, {
            construct(_, args, newTarget) {
                return Reflect.construct(
                    globalThis.__mocks.PanelMenuButton, args, newTarget);
            },
            get(_, prop) {
                return globalThis.__mocks.PanelMenuButton[prop];
            }
        });
    `,

    'resource:///org/gnome/shell/extensions/extension.js': `
        // Extension is used as: class X extends Extension { ... }
        // The Proxy must preserve newTarget in construct so the subclass
        // prototype chain is correct (subclass methods are accessible).
        export const Extension = new Proxy(function(){}, {
            construct(_, args, newTarget) {
                return Reflect.construct(
                    globalThis.__mocks.ExtensionBase, args, newTarget);
            },
            get(_, prop) {
                if (prop === 'prototype')
                    return globalThis.__mocks.ExtensionBase.prototype;
                return globalThis.__mocks.ExtensionBase[prop];
            }
        });
    `,

    'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js': `
        export const ExtensionPreferences = new Proxy(function(){}, {
            construct(_, args, newTarget) {
                return Reflect.construct(
                    globalThis.__mocks.ExtensionPreferencesBase, args, newTarget);
            },
            get(_, prop) {
                if (prop === 'prototype')
                    return globalThis.__mocks.ExtensionPreferencesBase.prototype;
                return globalThis.__mocks.ExtensionPreferencesBase[prop];
            }
        });
    `,
};

/**
 * Resolve hook — redirect gi:// and resource:// to virtual mock URLs.
 */
export function resolve(specifier, context, nextResolve) {
    if (specifier in MOCK_MODULES)
        return {shortCircuit: true, url: `mock://${encodeURIComponent(specifier)}`};
    return nextResolve(specifier, context);
}

/**
 * Load hook — serve mock source code for virtual mock URLs.
 */
export function load(url, context, nextLoad) {
    if (url.startsWith('mock://')) {
        const specifier = decodeURIComponent(url.slice('mock://'.length));
        const source = MOCK_MODULES[specifier];
        if (source)
            return {shortCircuit: true, format: 'module', source};
    }
    return nextLoad(url, context);
}
