// SPDX-License-Identifier: GPL-2.0-or-later

export const SENSITIVE_SOURCES_KEY = 'sensitive-sources';
export const ENABLE_GENERAL_TIMEOUT_KEY = 'enable-general-timeout';
export const ENABLE_SENSITIVE_SOURCES_KEY = 'enable-sensitive-sources';
export const DETECT_WINDOW_MODE_KEY = 'detect-window-mode';
export const DETECTED_WINDOW_ID_KEY = 'detected-window-id';
export const DEFAULT_GENERAL_TIMEOUT_ENABLED = false;
export const DEFAULT_SENSITIVE_SOURCES_ENABLED = true;
export const DEFAULT_SENSITIVE_TIMEOUT = 20;
export const DEFAULT_GENERAL_TIMEOUT = 300;

export const DEFAULT_SENSITIVE_SOURCES = [];

/**
 * Strip whitespace, lowercase, and remove any trailing .desktop suffixes.
 * Handles edge cases like Bitwarden Flatpak (com.bitwarden.desktop.desktop).
 */
export function normalizeId(raw) {
    if (typeof raw !== 'string')
        return '';

    let id = raw.trim().toLowerCase();
    while (id.endsWith('.desktop'))
        id = id.slice(0, -8);
    return id;
}

export function normalizeIdList(list) {
    if (!Array.isArray(list))
        return [];

    return [...new Set(list.map(normalizeId).filter(Boolean))];
}

export function getSensitiveSources(settings) {
    return normalizeIdList(settings.get_strv?.(SENSITIVE_SOURCES_KEY) ?? []);
}

export function generalTimeoutEnabled(settings) {
    return settings.get_boolean?.(ENABLE_GENERAL_TIMEOUT_KEY) ??
        DEFAULT_GENERAL_TIMEOUT_ENABLED;
}

export function sensitiveSourcesEnabled(settings) {
    return settings.get_boolean?.(ENABLE_SENSITIVE_SOURCES_KEY) ??
        DEFAULT_SENSITIVE_SOURCES_ENABLED;
}
