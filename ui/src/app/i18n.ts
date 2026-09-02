import {createInstance, i18n} from 'i18next';
import {initReactI18next} from 'react-i18next';

export const DEFAULT_LANGUAGE = 'en';

// Translation keys are the English source strings themselves. With no language pack registered, `t(key)`
// returns the key unchanged, so the UI renders exactly as it did before i18n was introduced and no `en`
// resource bundle is needed in this repository. Language packs are registered at runtime by UI extensions
// through `extensionsAPI.registerLanguage` (see shared/services/extensions-service.ts).
//
// A dedicated instance (rather than the i18next global singleton) is used so that the import shape is the same
// under webpack (ESM) and jest (CJS), and so that extensions bundling their own i18next cannot interfere.
const i18next: i18n = createInstance({
    lng: DEFAULT_LANGUAGE,
    fallbackLng: DEFAULT_LANGUAGE,
    // Keys are full sentences: '.' and ':' must be treated literally, not as key/namespace separators.
    keySeparator: false,
    nsSeparator: false,
    resources: {},
    returnEmptyString: false,
    // Translations are only ever rendered as React text nodes, which React escapes itself.
    interpolation: {escapeValue: false},
    react: {
        useSuspense: false,
        // extensions.js is a deferred script, so packs usually register after the first render.
        bindI18n: 'languageChanged',
        bindI18nStore: 'added'
    }
});

i18next.use(initReactI18next).init();

export default i18next;
