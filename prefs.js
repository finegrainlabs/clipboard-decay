// SPDX-License-Identifier: GPL-2.0-or-later
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
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
    getSensitiveSources,
    normalizeId,
} from './utils.js';

export default class ClipboardDecayPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const metadata = this.metadata ?? {};
        const _ = this.gettext.bind(this);

        window.set_default_size?.(760, 820);

        const appCatalog = this._buildAppCatalog();

        const page = new Adw.PreferencesPage({
            title: _('Settings'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        const {generalRow} = this._buildGeneralGroup(page, settings, _);
        const sensitiveUi = this._buildSensitiveGroup(page, window, settings, appCatalog, _);
        this._buildResetGroup(page, settings, sensitiveUi.searchRow, sensitiveUi.addRow, sensitiveUi.feedbackRow, _);
        this._buildAboutGroup(page, metadata, _);

        const syncAll = () => {
            if (this._backfillResolvedAliases(settings, appCatalog))
                return;

            this._syncSourceRows(sensitiveUi.group, settings, appCatalog, _);
            this._syncInstalledAppPicker(sensitiveUi, settings, appCatalog, _);
            this._syncSensitiveMode(settings, generalRow, sensitiveUi);
        };

        const signalIds = [
            settings.connect(`changed::${ENABLE_GENERAL_TIMEOUT_KEY}`, syncAll),
            settings.connect(`changed::${SENSITIVE_SOURCES_KEY}`, syncAll),
            settings.connect(`changed::${ENABLE_SENSITIVE_SOURCES_KEY}`, syncAll),
            settings.connect(`changed::${DETECT_WINDOW_MODE_KEY}`, () =>
                this._syncDetectionCaptureUi(settings, sensitiveUi, _)),
            settings.connect(`changed::${DETECTED_WINDOW_ID_KEY}`, () =>
                this._applyDetectedWindowId(settings, sensitiveUi, _)),
        ];
        window.connect('destroy', () => {
            for (const signalId of signalIds)
                settings.disconnect(signalId);
        });

        syncAll();
        this._syncDetectionCaptureUi(settings, sensitiveUi, _);
    }

    _buildGeneralGroup(page, settings, _) {
        const group = new Adw.PreferencesGroup({
            title: _('General Timer'),
            description: _('Optional fallback for copies that do not match a listed app.'),
        });
        page.add(group);

        const enabledRow = new Adw.SwitchRow({
            title: _('Enable'),
            subtitle: _('Use a timeout for other copies.'),
        });
        settings.bind(ENABLE_GENERAL_TIMEOUT_KEY, enabledRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        group.add(enabledRow);

        const generalRow = new Adw.SpinRow({
            title: _('General Timeout'),
            subtitle: _('Seconds before clearing other copies'),
            digits: 0,
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 3600,
                step_increment: 30,
                page_increment: 60,
                value: settings.get_int('general-timeout'),
            }),
        });
        settings.bind('general-timeout', generalRow, 'value',
            Gio.SettingsBindFlags.DEFAULT);
        group.add(generalRow);

        return {group, enabledRow, generalRow};
    }

    _buildSensitiveGroup(page, window, settings, appCatalog, _) {
        const group = new Adw.PreferencesGroup({
            title: _('Sensitive Apps'),
            description: _('Try to clear matched apps faster. On Wayland, matching is best-effort.'),
        });
        page.add(group);

        const detectionRow = new Adw.SwitchRow({
            title: _('Enable Detection'),
            subtitle: _('Use the focused app as a hint.'),
        });
        settings.bind(ENABLE_SENSITIVE_SOURCES_KEY, detectionRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        group.add(detectionRow);

        const sensitiveRow = new Adw.SpinRow({
            title: _('Sensitive Timeout'),
            subtitle: _('Seconds before clearing matched copies'),
            digits: 0,
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 3600,
                step_increment: 5,
                page_increment: 30,
                value: settings.get_int('sensitive-timeout'),
            }),
        });
        settings.bind('sensitive-timeout', sensitiveRow, 'value',
            Gio.SettingsBindFlags.DEFAULT);
        group.add(sensitiveRow);

        const emptyRow = new Adw.ActionRow({
            title: _('No apps added yet. Add apps you want Clipboard Decay to try to recognize as sensitive.'),
            visible: false,
        });
        this._addImagePrefix(emptyRow, null, 'dialog-information-symbolic');

        const infoRow = new Adw.ActionRow({
            visible: false,
            title: _('Sensitive app detection is turned off. The shorter timeout will not be used.'),
        });
        this._addImagePrefix(infoRow, null, 'dialog-information-symbolic');

        const browseRow = new Adw.ActionRow({
            title: _('Add Apps'),
            subtitle: _('Choose from installed apps.'),
        });
        const browseButton = new Gtk.Button({
            label: _('Add...'),
            valign: Gtk.Align.CENTER,
            css_classes: ['pill'],
            tooltip_text: _('Choose from installed apps'),
        });
        this._setAccessibleLabel(browseButton, _('Choose from installed apps'));
        browseRow.add_suffix(browseButton);
        group.add(browseRow);

        const dialog = new Adw.Dialog({
            title: _('Add Apps'),
            content_width: 360,
            content_height: 480,
        });

        const navigationView = new Adw.NavigationView();

        const pickerToolbarView = new Adw.ToolbarView();
        const pickerHeaderBar = new Adw.HeaderBar();
        pickerToolbarView.add_top_bar(pickerHeaderBar);

        const pickerContent = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin_top: 18,
            margin_bottom: 18,
            margin_start: 18,
            margin_end: 18,
        });
        const searchRow = new Gtk.SearchEntry({
            placeholder_text: _('Search apps...'),
            hexpand: true,
        });
        const keyController = new Gtk.EventControllerKey();
        keyController.connect('key-pressed', (_controller, keyval) => {
            if (keyval === Gdk.KEY_Escape) {
                if (navigationView.visiblePage === fallbackPage)
                    navigationView.pop();
                else
                    dialog.close();
                return Gdk.EVENT_STOP;
            }

            return Gdk.EVENT_PROPAGATE;
        });
        searchRow.add_controller(keyController);
        pickerContent.append(searchRow);

        const scrolled = new Gtk.ScrolledWindow({
            vexpand: true,
            min_content_height: 300,
        });
        const listGroup = new Adw.PreferencesGroup();
        const helperRow = new Adw.ActionRow({
            visible: false,
        });
        this._addImagePrefix(helperRow, null, 'system-search-symbolic');
        listGroup.add(helperRow);

        listGroup._appRows = appCatalog.apps.map(app =>
            this._createInstalledAppRow(settings, app, _));
        for (const row of listGroup._appRows)
            listGroup.add(row);

        scrolled.set_child(listGroup);
        pickerContent.append(scrolled);

        const fallbackNavRow = new Adw.ActionRow({
            title: _('Can\'t find your app?'),
            subtitle: _('Detect a focused window or enter an application ID manually.'),
            activatable: true,
        });
        const fallbackChevron = new Gtk.Image({
            icon_name: 'go-next-symbolic',
            pixel_size: 16,
        });
        fallbackNavRow.add_suffix(fallbackChevron);
        fallbackNavRow.connect('activated', () => navigationView.push(fallbackPage));
        const fallbackNavGroup = new Adw.PreferencesGroup();
        fallbackNavGroup.add(fallbackNavRow);
        pickerContent.append(fallbackNavGroup);

        pickerToolbarView.set_content(pickerContent);

        const pickerPage = new Adw.NavigationPage({
            title: _('Add Apps'),
            tag: 'picker',
            child: pickerToolbarView,
        });

        const fallbackToolbarView = new Adw.ToolbarView();
        const fallbackHeaderBar = new Adw.HeaderBar();
        fallbackToolbarView.add_top_bar(fallbackHeaderBar);
        const fallbackContent = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin_top: 18,
            margin_bottom: 18,
            margin_start: 18,
            margin_end: 18,
        });

        const detectRow = new Adw.ActionRow({
            title: _('Find the app you\'re using'),
            subtitle: _('Click Detect, then bring the app you want to add into focus.'),
        });
        const detectButton = new Gtk.Button({
            label: _('Detect'),
            valign: Gtk.Align.CENTER,
            css_classes: ['pill'],
            tooltip_text: _('Capture the next focused window identifier'),
        });
        this._setAccessibleLabel(detectButton, _('Capture the next focused window identifier'));
        detectRow.add_suffix(detectButton);

        const detectedRow = new Adw.ActionRow({
            title: _('No window detected yet.'),
            visible: false,
        });
        this._addImagePrefix(detectedRow, null, 'find-location-symbolic');
        const useDetectedButton = new Gtk.Button({
            label: _('Add App'),
            valign: Gtk.Align.CENTER,
            css_classes: ['pill'],
            tooltip_text: _('Add the detected app'),
        });
        this._setAccessibleLabel(useDetectedButton, _('Add the detected app'));
        useDetectedButton.sensitive = false;
        detectedRow.add_suffix(useDetectedButton);

        const addRow = new Adw.EntryRow({
            title: _('Enter app ID manually'),
            show_apply_button: true,
        });
        const hintRow = new Adw.ActionRow({
            title: _('For terminal-based workflows, use the terminal app itself rather than the command running inside it.'),
            css_classes: ['dim-label'],
        });
        this._addImagePrefix(hintRow, null, 'dialog-information-symbolic');
        const feedbackRow = new Adw.ActionRow({
            visible: false,
            css_classes: ['dim-label'],
        });
        this._addImagePrefix(feedbackRow, null, 'dialog-warning-symbolic');

        const applyIdentifier = identifier => {
            const normalized = normalizeId(identifier);
            if (!normalized) {
                this._setFeedback(feedbackRow, _('Enter an application ID.'));
                return false;
            }

            const list = getSensitiveSources(settings);
            if (list.includes(normalized)) {
                this._setFeedback(feedbackRow, _('That app is already in the list.'));
                return false;
            }

            if (!appCatalog.byIdentifier.has(normalized)) {
                this._setFeedback(feedbackRow,
                    _('This value is not known to any installed app. Clipboard Decay only matches the focused window\'s WM_CLASS or application ID.'));
                return false;
            }

            settings.set_strv(SENSITIVE_SOURCES_KEY, [...list, normalized]);
            addRow.set_text('');
            detectedRow.visible = false;
            detectedRow.title = _('No window detected yet.');
            detectedRow.subtitle = '';
            detectedRow._detectedIdentifier = '';
            useDetectedButton.sensitive = false;
            this._setFeedback(feedbackRow, '');
            navigationView.pop();
            dialog.close();
            return true;
        };

        detectButton.connect('clicked', () => {
            if (settings.get_boolean(DETECT_WINDOW_MODE_KEY)) {
                settings.set_boolean(DETECT_WINDOW_MODE_KEY, false);
                return;
            }

            settings.set_string(DETECTED_WINDOW_ID_KEY, '');
            detectedRow.visible = false;
            detectedRow.title = _('No window detected yet.');
            detectedRow.subtitle = '';
            detectedRow._detectedIdentifier = '';
            useDetectedButton.sensitive = false;
            addRow.set_text('');
            this._setFeedback(feedbackRow, '');
            settings.set_boolean(DETECT_WINDOW_MODE_KEY, true);
        });

        useDetectedButton.connect('clicked', () => {
            applyIdentifier(detectedRow._detectedIdentifier ?? '');
        });

        addRow.connect('apply', () => {
            applyIdentifier(addRow.text);
        });

        addRow.connect('notify::text', () => this._setFeedback(feedbackRow, ''));
        fallbackContent.append(detectRow);
        fallbackContent.append(detectedRow);
        fallbackContent.append(addRow);
        fallbackContent.append(hintRow);
        fallbackContent.append(feedbackRow);

        fallbackToolbarView.set_content(fallbackContent);
        const fallbackPage = new Adw.NavigationPage({
            title: _('Add App'),
            tag: 'fallback',
            child: fallbackToolbarView,
        });

        navigationView.add(pickerPage);
        navigationView.add(fallbackPage);
        navigationView.pop();
        dialog.set_child(navigationView);

        searchRow.connect('notify::text', () => {
            this._syncInstalledAppPicker(
                {browseRow, browseButton, dialog, navigationView, pickerPage, fallbackPage, fallbackNavRow, searchRow, helperRow, listGroup},
                settings,
                appCatalog,
                _
            );
        });

        browseButton.connect('clicked', () => dialog.present(window));

        group._pickerDialog = dialog;
        group._pickerFallbackPage = fallbackPage;
        group._pickerFallbackNavRow = fallbackNavRow;
        group._pickerSearchRow = searchRow;
        group._pickerListGroup = listGroup;
        group._pickerHelperRow = helperRow;

        group._sourceRows = [];
        group._emptyRow = emptyRow;
        group._infoRow = infoRow;
        group._browseRow = browseRow;

        group.add(emptyRow);
        group.add(infoRow);

        return {
            group,
            detectionRow,
            sensitiveRow,
            emptyRow,
            infoRow,
            browseRow,
            browseButton,
            dialog,
            navigationView,
            pickerPage,
            fallbackPage,
            fallbackNavRow,
            fallbackNavGroup,
            searchRow,
            helperRow,
            listGroup,
            detectRow,
            detectButton,
            detectedRow,
            useDetectedButton,
            addRow,
            hintRow,
            feedbackRow,
        };
    }

    _buildResetGroup(page, settings, searchRow, addRow, feedbackRow, _) {
        const group = new Adw.PreferencesGroup();
        page.add(group);

        const resetRow = new Adw.ActionRow({
            title: _('Restore Defaults'),
            subtitle: _('Restore the default toggles and timeouts, and clear the sensitive app list.'),
        });
        const resetButton = new Gtk.Button({
            label: _('Reset'),
            valign: Gtk.Align.CENTER,
            css_classes: ['pill'],
            tooltip_text: _('Restore the default Clipboard Decay settings'),
        });
        this._setAccessibleLabel(resetButton, _('Restore the default Clipboard Decay settings'));
        resetRow.add_suffix(resetButton);
        group.add(resetRow);

        resetButton.connect('clicked', () => {
            settings.set_boolean(ENABLE_GENERAL_TIMEOUT_KEY, DEFAULT_GENERAL_TIMEOUT_ENABLED);
            settings.set_boolean(ENABLE_SENSITIVE_SOURCES_KEY, DEFAULT_SENSITIVE_SOURCES_ENABLED);
            settings.set_int('sensitive-timeout', DEFAULT_SENSITIVE_TIMEOUT);
            settings.set_int('general-timeout', DEFAULT_GENERAL_TIMEOUT);
            settings.set_strv(SENSITIVE_SOURCES_KEY, DEFAULT_SENSITIVE_SOURCES);
            settings.set_boolean(DETECT_WINDOW_MODE_KEY, false);
            settings.set_string(DETECTED_WINDOW_ID_KEY, '');
            searchRow.set_text('');
            addRow.set_text('');
            this._setFeedback(feedbackRow, '');
        });
    }

    _buildAboutGroup(page, metadata, _) {
        const group = new Adw.PreferencesGroup({
            title: _('About'),
        });
        page.add(group);

        const versionRow = new Adw.ActionRow({
            title: _('Version'),
            subtitle: this._getDisplayedVersionName(metadata, _),
        });
        this._addImagePrefix(versionRow, null, 'dialog-information-symbolic');
        group.add(versionRow);

        const extensionIdRow = new Adw.ActionRow({
            title: _('Extension ID'),
            subtitle: metadata.uuid ?? this.uuid ?? '',
        });
        this._addImagePrefix(extensionIdRow, null, 'fingerprint-symbolic');
        group.add(extensionIdRow);

        if (metadata.url) {
            const urlRow = new Adw.ActionRow({
                title: _('Project URL'),
                subtitle: metadata.url,
            });
            this._addImagePrefix(urlRow, null, 'applications-internet-symbolic');
            group.add(urlRow);
        }
    }

    _getDisplayedVersionName(metadata, _) {
        return metadata['version-name'] ?? _('Development build');
    }

    _buildAppCatalog() {
        const apps = [];
        const byIdentifier = new Map();
        const seenPrimaryIds = new Set();
        let appInfos = [];

        try {
            appInfos = Gio.AppInfo?.get_all?.() ?? [];
        } catch {
            return {apps, byIdentifier};
        }

        // Pass 1: visible apps (shown in launcher)
        for (const appInfo of appInfos) {
            const app = this._describeAppInfo(appInfo);
            if (!app || seenPrimaryIds.has(app.primaryIdentifier))
                continue;

            seenPrimaryIds.add(app.primaryIdentifier);
            apps.push(app);

            for (const identifier of app.identifiers) {
                if (!byIdentifier.has(identifier))
                    byIdentifier.set(identifier, app);
            }
        }

        // Pass 2: hidden apps (NoDisplay=true) — merge their identifiers
        // into matching visible entries so the picker stores every alias
        // the runtime might see (e.g. com.brave.Browser ↔ brave-browser).
        const byName = new Map();
        for (const app of apps)
            byName.set(app.name, app);

        for (const appInfo of appInfos) {
            const aliasIds = this._extractHiddenAliasIds(appInfo);
            if (!aliasIds.length)
                continue;

            const displayName = (appInfo.get_display_name?.() ?? appInfo.get_name?.() ?? '').trim();
            const target = byName.get(displayName);
            if (!target)
                continue;

            for (const id of aliasIds) {
                if (!target.identifiers.includes(id)) {
                    target.identifiers.push(id);
                    target.searchText += ` ${id}`;
                }
                if (!byIdentifier.has(id))
                    byIdentifier.set(id, target);
            }
        }

        apps.sort((left, right) => left.name.localeCompare(right.name, undefined, {sensitivity: 'base'}));
        return {apps, byIdentifier};
    }

    _extractHiddenAliasIds(appInfo) {
        try {
            if (typeof appInfo.should_show !== 'function' || appInfo.should_show())
                return [];

            const appId = normalizeId(appInfo.get_id?.() ?? '');

            let startupWmClass = '';
            if (typeof appInfo.get_startup_wm_class === 'function')
                startupWmClass = normalizeId(appInfo.get_startup_wm_class() ?? '');
            else if (typeof appInfo.get_string === 'function')
                startupWmClass = normalizeId(appInfo.get_string('StartupWMClass') ?? '');

            return [appId, startupWmClass].filter(Boolean);
        } catch {
            return [];
        }
    }

    _describeAppInfo(appInfo) {
        try {
            if (typeof appInfo.should_show === 'function' && !appInfo.should_show())
                return null;

            const displayName = (appInfo.get_display_name?.() ?? appInfo.get_name?.() ?? '').trim();
            const appId = normalizeId(appInfo.get_id?.() ?? '');

            let startupWmClass = '';
            if (typeof appInfo.get_startup_wm_class === 'function') {
                startupWmClass = normalizeId(appInfo.get_startup_wm_class() ?? '');
            } else if (typeof appInfo.get_string === 'function') {
                startupWmClass = normalizeId(appInfo.get_string('StartupWMClass') ?? '');
            }

            const identifiers = [...new Set([appId, startupWmClass].filter(Boolean))];
            if (!identifiers.length)
                return null;

            return {
                name: displayName || identifiers[0],
                icon: appInfo.get_icon?.() ?? null,
                primaryIdentifier: identifiers[0],
                identifiers,
                searchText: `${displayName} ${identifiers.join(' ')}`.toLowerCase(),
            };
        } catch {
            return null;
        }
    }

    _resolveSourcePresentation(entry, appCatalog, _) {
        const app = appCatalog.byIdentifier.get(entry);
        if (!app) {
            return {
                title: entry,
                subtitle: _('Unverified manual identifier'),
                icon: null,
                iconName: 'application-x-executable-symbolic',
            };
        }

        return {
            title: app.name,
            subtitle: entry,
            icon: app.icon,
            iconName: null,
        };
    }

    _matchInstalledApps(appCatalog, query) {
        const rawQuery = (query ?? '').trim().toLowerCase();
        const normalizedQuery = normalizeId(query ?? '');
        if (!rawQuery && !normalizedQuery)
            return appCatalog.apps;

        return appCatalog.apps.filter(app =>
            app.searchText.includes(rawQuery) ||
            (normalizedQuery && app.searchText.includes(normalizedQuery))
        );
    }

    _backfillResolvedAliases(settings, appCatalog) {
        const current = getSensitiveSources(settings);
        const expanded = [...current];

        for (const identifier of current) {
            const app = appCatalog.byIdentifier.get(identifier);
            if (!app)
                continue;

            for (const alias of app.identifiers) {
                if (!expanded.includes(alias))
                    expanded.push(alias);
            }
        }

        if (expanded.length === current.length)
            return false;

        settings.set_strv(SENSITIVE_SOURCES_KEY, expanded);
        return true;
    }

    _syncSourceRows(group, settings, appCatalog, _) {
        for (const row of group._sourceRows ?? [])
            group.remove(row);

        group._sourceRows = getSensitiveSources(settings).map(
            entry => this._createSourceRow(settings, entry, appCatalog, _));

        group.remove(group._emptyRow);
        group.remove(group._infoRow);
        for (const row of group._sourceRows)
            group.add(row);

        group._emptyRow.visible = group._sourceRows.length === 0;
        group.add(group._emptyRow);
        group.add(group._infoRow);
    }

    _syncInstalledAppPicker(pickerUi, settings, appCatalog, _) {
        const query = pickerUi.searchRow?.text ?? '';
        const matches = new Set(this._matchInstalledApps(appCatalog, query));
        const selected = new Set(getSensitiveSources(settings));
        const sensitiveEnabled = settings.get_boolean(ENABLE_SENSITIVE_SOURCES_KEY);
        const rows = pickerUi.listGroup?._appRows ?? [];

        for (const row of rows) {
            const app = row._pickerApp;
            const added = app.identifiers.some(identifier => selected.has(identifier));
            row._isAdded = added;
            row.visible = matches.has(app);
            row.sensitive = sensitiveEnabled;
            row.activatable = sensitiveEnabled && !added;
            row._addedIcon.visible = added;
        }

        const visibleRows = rows.filter(row => row.visible);
        pickerUi.helperRow.visible = visibleRows.length === 0;

        if (!pickerUi.helperRow.visible)
            return;

        if (!appCatalog.apps.length) {
            pickerUi.helperRow.title = _('No installed apps were found.');
            return;
        }

        pickerUi.helperRow.title = query.trim() ?
            _('No installed apps match this filter.') :
            _('No installed apps are available.');
    }

    _createSourceRow(settings, entry, appCatalog, _) {
        const presentation = this._resolveSourcePresentation(entry, appCatalog, _);
        const row = new Adw.ActionRow({
            title: presentation.title,
            subtitle: presentation.subtitle,
        });
        this._addImagePrefix(row, presentation.icon, presentation.iconName);

        const removeBtn = new Gtk.Button({
            icon_name: 'edit-delete-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat', 'circular'],
            tooltip_text: _('Remove sensitive app'),
        });
        this._setAccessibleLabel(removeBtn, _('Remove sensitive app'));

        removeBtn.connect('clicked', () => {
            const resolvedApp = appCatalog.byIdentifier.get(entry);
            const identifiersToRemove = new Set(resolvedApp?.identifiers ?? [entry]);
            settings.set_strv(
                SENSITIVE_SOURCES_KEY,
                getSensitiveSources(settings).filter(source => !identifiersToRemove.has(source))
            );
        });

        row.add_suffix(removeBtn);
        return row;
    }

    _createInstalledAppRow(settings, app, _) {
        const row = new Adw.ActionRow({
            title: app.name,
            activatable: true,
        });
        this._addImagePrefix(row, app.icon, 'application-x-executable-symbolic', 32);

        row.connect('activated', () => {
            const existing = getSensitiveSources(settings);
            const newIds = app.identifiers.filter(identifier => !existing.includes(identifier));
            if (newIds.length)
                settings.set_strv(SENSITIVE_SOURCES_KEY, [...existing, ...newIds]);
        });

        const addedIcon = new Gtk.Image({
            icon_name: 'object-select-symbolic',
            pixel_size: 16,
            visible: false,
            css_classes: ['dim-label'],
            tooltip_text: _('Already added'),
        });

        row.add_suffix(addedIcon);

        row._pickerApp = app;
        row._addedIcon = addedIcon;
        return row;
    }

    _setAccessibleLabel(widget, label) {
        widget.update_property([Gtk.AccessibleProperty.LABEL], [label]);
    }

    _addImagePrefix(row, icon, iconName, pixelSize = 16) {
        const props = {pixel_size: pixelSize};
        if (icon)
            props.gicon = icon;
        else
            props.icon_name = iconName;

        row.add_prefix(new Gtk.Image(props));
    }

    _syncSensitiveMode(settings, generalRow, sensitiveUi) {
        const generalEnabled = settings.get_boolean(ENABLE_GENERAL_TIMEOUT_KEY);
        const sensitiveEnabled = settings.get_boolean(ENABLE_SENSITIVE_SOURCES_KEY);

        generalRow.sensitive = generalEnabled;
        sensitiveUi.sensitiveRow.visible = sensitiveEnabled;
        sensitiveUi.browseRow.visible = sensitiveEnabled;
        sensitiveUi.sensitiveRow.sensitive = sensitiveEnabled;

        sensitiveUi.browseRow.sensitive = sensitiveEnabled;
        sensitiveUi.browseButton.sensitive = sensitiveEnabled;
        sensitiveUi.searchRow.sensitive = sensitiveEnabled;
        sensitiveUi.helperRow.sensitive = sensitiveEnabled;
        sensitiveUi.detectRow.sensitive = sensitiveEnabled;
        sensitiveUi.detectButton.sensitive = sensitiveEnabled;
        sensitiveUi.fallbackNavRow.sensitive = sensitiveEnabled;
        for (const row of sensitiveUi.listGroup?._appRows ?? []) {
            row.sensitive = sensitiveEnabled;
            row.activatable = sensitiveEnabled && !row._isAdded;
        }

        sensitiveUi.addRow.sensitive = sensitiveEnabled;
        sensitiveUi.feedbackRow.sensitive = sensitiveEnabled;

        for (const row of sensitiveUi.group._sourceRows ?? [])
            row.sensitive = sensitiveEnabled;

        for (const row of sensitiveUi.group._sourceRows ?? [])
            row.visible = sensitiveEnabled;

        sensitiveUi.infoRow.visible = !sensitiveEnabled;
        sensitiveUi.emptyRow.visible = sensitiveEnabled && (sensitiveUi.group._sourceRows ?? []).length === 0;
    }

    _setFeedback(row, message) {
        row.title = message;
        row.visible = Boolean(message);
    }

    _syncDetectionCaptureUi(settings, sensitiveUi, _) {
        const detecting = settings.get_boolean?.(DETECT_WINDOW_MODE_KEY);
        sensitiveUi.detectButton.label = detecting ? _('Cancel') : _('Detect');
        sensitiveUi.detectButton.tooltip_text = detecting ?
            _('Cancel focused-window detection') :
            _('Capture the next focused window identifier');
        this._setAccessibleLabel(
            sensitiveUi.detectButton,
            detecting ? _('Cancel focused-window detection') : _('Capture the next focused window identifier')
        );
        sensitiveUi.detectRow.subtitle = detecting ?
            _('Bring the app you want to add into focus.') :
            _('Click Detect, then bring the app you want to add into focus.');
    }

    _applyDetectedWindowId(settings, sensitiveUi, _) {
        const detected = normalizeId(settings.get_string?.(DETECTED_WINDOW_ID_KEY) ?? '');
        if (!detected)
            return;

        if (sensitiveUi.navigationView.visiblePage !== sensitiveUi.fallbackPage)
            sensitiveUi.navigationView.push(sensitiveUi.fallbackPage);
        sensitiveUi.detectedRow.visible = true;
        sensitiveUi.detectedRow.title = _('We found this app');
        sensitiveUi.detectedRow.subtitle = detected;
        sensitiveUi.detectedRow._detectedIdentifier = detected;
        sensitiveUi.useDetectedButton.sensitive = true;
        sensitiveUi.addRow.set_text(detected);
        this._setFeedback(sensitiveUi.feedbackRow, '');
    }
}
