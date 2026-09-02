import * as moment from 'moment';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {Select, SelectOption} from 'argo-ui';

import i18next, {DEFAULT_LANGUAGE} from '../../../i18n';
import {services, ViewPreferences} from '../../services';
import {LanguagePack} from '../../services/extensions-service';

function useRegisteredLanguages(): LanguagePack[] {
    const [languages, setLanguages] = React.useState<LanguagePack[]>(() => services.extensions.getLanguages());

    React.useEffect(() => {
        const onLanguage = () => setLanguages(services.extensions.getLanguages());
        services.extensions.addEventListener('language', onLanguage);
        return () => services.extensions.removeEventListener('language', onLanguage);
    }, []);

    return languages;
}

export function applyLanguage(code: string) {
    const lang = code || DEFAULT_LANGUAGE;
    if (i18next.language !== lang) {
        i18next.changeLanguage(lang);
    }
    moment.locale(lang);
    document.documentElement.lang = lang;
}

/**
 * Keeps i18next in sync with the persisted language preference. The preferred pack may register after the first
 * render (extensions.js is deferred), so we re-apply whenever the set of registered languages changes. Renders nothing.
 */
export const LanguageSync = ({pref}: {pref: ViewPreferences}): null => {
    const languages = useRegisteredLanguages();
    const preferred = pref.language || DEFAULT_LANGUAGE;
    const available = preferred === DEFAULT_LANGUAGE || languages.some(l => l.code === preferred);

    React.useEffect(() => {
        applyLanguage(available ? preferred : DEFAULT_LANGUAGE);
    }, [preferred, available]);

    return null;
};

/**
 * "Language" row for Settings > Appearance, next to Theme. Renders nothing unless at least one language pack is
 * registered, so installations without packs see no change.
 */
export const LanguageSelector = ({pref}: {pref: ViewPreferences}) => {
    const {t} = useTranslation();
    const languages = useRegisteredLanguages();

    if (languages.length === 0) {
        return null;
    }

    const current = languages.some(l => l.code === pref.language) ? pref.language : DEFAULT_LANGUAGE;

    return (
        <div className='row'>
            <span id='appearance-language-label'>{t('Language')}</span>
            <div aria-labelledby='appearance-language-label' role='group' className='language-selector'>
                <Select
                    value={current}
                    onChange={(value: SelectOption) => {
                        applyLanguage(value.value);
                        services.viewPreferences.updatePreferences({language: value.value});
                    }}
                    options={[{value: DEFAULT_LANGUAGE, title: 'English'}, ...languages.map(l => ({value: l.code, title: l.name || l.code}))]}
                />
            </div>
        </div>
    );
};
