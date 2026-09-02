import * as React from 'react';
import * as minimatch from 'minimatch';

import i18next from '../../i18n';
import {Application, ApplicationTree, State} from '../models';

type ExtensionsEventType = 'resource' | 'systemLevel' | 'appView' | 'statusPanel' | 'topBar' | 'language';
type ExtensionsType = ResourceTabExtension | SystemLevelExtension | AppViewExtension | StatusPanelExtension | TopBarActionMenuExt | LanguagePack;

class ExtensionsEventTarget {
    private listeners: Map<ExtensionsEventType, Array<(extension: ExtensionsType) => void>> = new Map();

    addEventListener(eventName: ExtensionsEventType, listener: (extension: ExtensionsType) => void) {
        if (!this.listeners.has(eventName)) {
            this.listeners.set(eventName, []);
        }
        this.listeners.get(eventName)?.push(listener);
    }

    removeEventListener(eventName: ExtensionsEventType, listenerToRemove: (extension: ExtensionsType) => void) {
        const listeners = this.listeners.get(eventName);
        if (!listeners) return;

        const filteredListeners = listeners.filter(listener => listener !== listenerToRemove);
        this.listeners.set(eventName, filteredListeners);
    }

    emit(eventName: ExtensionsEventType, extension: ExtensionsType) {
        this.listeners.get(eventName)?.forEach(listener => listener(extension));
    }
}

const extensions = {
    eventTarget: new ExtensionsEventTarget(),
    resourceExtentions: new Array<ResourceTabExtension>(),
    systemLevelExtensions: new Array<SystemLevelExtension>(),
    appViewExtensions: new Array<AppViewExtension>(),
    statusPanelExtensions: new Array<StatusPanelExtension>(),
    topBarActionMenuExts: new Array<TopBarActionMenuExt>(),
    languages: new Array<LanguagePack>()
};

function registerResourceExtension(component: ExtensionComponent, group: string, kind: string, tabTitle: string, opts?: {icon: string}) {
    const ext = {component, group, kind, title: tabTitle, icon: opts?.icon};
    extensions.resourceExtentions.push(ext);
    extensions.eventTarget.emit('resource', ext);
}

function registerSystemLevelExtension(component: ExtensionComponent, title: string, path: string, icon: string) {
    const ext = {component, title, icon, path};
    extensions.systemLevelExtensions.push(ext);
    extensions.eventTarget.emit('systemLevel', ext);
}

function registerAppViewExtension(component: AppViewExtensionComponent, title: string, icon: string, shouldDisplay?: (app: Application) => boolean) {
    const ext = {component, title, icon, shouldDisplay: shouldDisplay || (() => true)};
    extensions.appViewExtensions.push(ext);
    extensions.eventTarget.emit('appView', ext);
}

function registerStatusPanelExtension(component: StatusPanelExtensionComponent, title: string, id: string, flyout?: ExtensionComponent) {
    const ext = {component, flyout, title, id};
    extensions.statusPanelExtensions.push(ext);
    extensions.eventTarget.emit('statusPanel', ext);
}

function registerTopBarActionMenuExt(
    component: TopBarActionMenuExtComponent,
    title: string,
    id: string,
    flyout: ExtensionComponent,
    shouldDisplay: (app?: Application) => boolean = () => true,
    iconClassName?: string,
    isMiddle = false
) {
    const ext = {component, flyout, shouldDisplay, title, id, iconClassName, isMiddle};
    extensions.topBarActionMenuExts.push(ext);
    extensions.eventTarget.emit('topBar', ext);
}

function registerLanguage(pack: LanguagePack) {
    if (!pack || typeof pack.code !== 'string' || !pack.code || typeof pack.resources !== 'object' || pack.resources === null) {
        throw new Error('registerLanguage: a pack must have a non-empty `code` and a `resources` object');
    }
    i18next.addResourceBundle(pack.code, 'translation', pack.resources, true, true);
    const existing = extensions.languages.findIndex(l => l.code === pack.code);
    if (existing >= 0) {
        extensions.languages[existing] = pack;
    } else {
        extensions.languages.push(pack);
    }
    extensions.eventTarget.emit('language', pack);
}

let legacyInitialized = false;

function initLegacyExtensions() {
    if (legacyInitialized) {
        return;
    }
    legacyInitialized = true;
    const resources = (window as any).extensions.resources;
    Object.keys(resources).forEach(key => {
        const [group, kind] = key.split('/');
        registerResourceExtension(resources[key].component, group, kind, 'More');
    });
}

export interface ResourceTabExtension {
    title: string;
    group: string;
    kind: string;
    component: ExtensionComponent;
    icon?: string;
}

export interface SystemLevelExtension {
    title: string;
    component: SystemExtensionComponent;
    icon?: string;
    path?: string;
}

export interface AppViewExtension {
    component: AppViewExtensionComponent;
    title: string;
    icon?: string;
    shouldDisplay: (app: Application) => boolean;
}

export interface StatusPanelExtension {
    component: StatusPanelExtensionComponent;
    flyout?: StatusPanelExtensionFlyoutComponent;
    title: string;
    id: string;
}

export interface TopBarActionMenuExt {
    component: TopBarActionMenuExtComponent;
    flyout: TopBarActionMenuExtFlyoutComponent;
    shouldDisplay: (app: Application) => boolean;
    title: string;
    id: string;
    iconClassName?: string;
    isMiddle?: boolean;
    isNarrow?: boolean;
}

export interface LanguagePack {
    /** BCP 47 language tag, e.g. 'zh-CN' or 'ko'. Used as the i18next language and the moment locale. */
    code: string;
    /** Display name in the language itself, shown in the language selector, e.g. '简体中文'. */
    name: string;
    /** Flat map of English source string -> translation. */
    resources: {[key: string]: string};
    /** Argo CD version the pack was built against, e.g. 'v3.4'. Informational only. */
    argocdVersion?: string;
}

export type ExtensionComponent = React.ComponentType<ExtensionComponentProps>;
export type SystemExtensionComponent = React.ComponentType;
export type AppViewExtensionComponent = React.ComponentType<AppViewComponentProps>;
export type StatusPanelExtensionComponent = React.ComponentType<StatusPanelComponentProps>;
export type StatusPanelExtensionFlyoutComponent = React.ComponentType<StatusPanelFlyoutProps>;
export type TopBarActionMenuExtComponent = React.ComponentType<TopBarActionMenuExtComponentProps>;
export type TopBarActionMenuExtFlyoutComponent = React.ComponentType<TopBarActionMenuExtFlyoutProps>;

export interface Extension {
    component: ExtensionComponent;
}

export interface ExtensionComponentProps {
    resource: State;
    tree: ApplicationTree;
    application: Application;
}

export interface AppViewComponentProps {
    application: Application;
    tree: ApplicationTree;
}

export interface StatusPanelComponentProps {
    application: Application;
    openFlyout: () => any;
}

export interface TopBarActionMenuExtComponentProps {
    application: Application;
    tree: ApplicationTree;
    openFlyout: () => any;
}

export interface StatusPanelFlyoutProps {
    application: Application;
    tree: ApplicationTree;
}

export interface TopBarActionMenuExtFlyoutProps {
    application: Application;
    tree: ApplicationTree;
}

export class ExtensionsService {
    public addEventListener(evtType: ExtensionsEventType, cb: (ext: ExtensionsType) => void) {
        extensions.eventTarget.addEventListener(evtType, cb);
    }

    public removeEventListener(evtType: ExtensionsEventType, cb: (ext: ExtensionsType) => void) {
        extensions.eventTarget.removeEventListener(evtType, cb);
    }

    public getResourceTabs(group: string, kind: string): ResourceTabExtension[] {
        initLegacyExtensions();
        const items = extensions.resourceExtentions.filter(extension => minimatch(group, extension.group) && minimatch(kind, extension.kind)).slice();
        return items.sort((a, b) => a.title.localeCompare(b.title));
    }

    public getSystemExtensions(): SystemLevelExtension[] {
        return extensions.systemLevelExtensions.slice();
    }

    public getAppViewExtensions(): AppViewExtension[] {
        return extensions.appViewExtensions.slice();
    }

    public getStatusPanelExtensions(): StatusPanelExtension[] {
        return extensions.statusPanelExtensions.slice();
    }
    public getActionMenuExtensions(): TopBarActionMenuExt[] {
        return extensions.topBarActionMenuExts.slice();
    }

    public getLanguages(): LanguagePack[] {
        return extensions.languages.slice();
    }
}

((window: any) => {
    // deprecated: kept for backwards compatibility
    window.extensions = {resources: {}};
    window.extensionsAPI = {
        registerResourceExtension,
        registerSystemLevelExtension,
        registerAppViewExtension,
        registerStatusPanelExtension,
        registerTopBarActionMenuExt,
        registerLanguage
    };
})(window);
