import * as React from 'react';
import {act, fireEvent, render, screen} from '@testing-library/react';

import i18next, {DEFAULT_LANGUAGE} from '../../../i18n';
import {services, ViewPreferences} from '../../services';
import {LanguageSelector, LanguageSync} from './language-selector';

const registerLanguage = (window as any).extensionsAPI.registerLanguage as (pack: any) => void;

function pref(language?: string): ViewPreferences {
    return {language} as ViewPreferences;
}

afterEach(() => {
    act(() => {
        i18next.changeLanguage(DEFAULT_LANGUAGE);
    });
});

describe('i18n framework', () => {
    test('t() returns the English key unchanged when no pack is registered', () => {
        expect(i18next.t('Applications')).toBe('Applications');
        expect(i18next.t('Manage your repositories, projects, settings')).toBe('Manage your repositories, projects, settings');
        // '.' and ':' are literal, not key/namespace separators.
        expect(i18next.t('Loading...')).toBe('Loading...');
        expect(i18next.t('Kind: Deployment')).toBe('Kind: Deployment');
    });

    test('LanguageSelector renders nothing when no pack is registered', () => {
        const {container} = render(<LanguageSelector pref={pref()} />);
        expect(container).toBeEmptyDOMElement();
    });

    test('registerLanguage rejects malformed packs', () => {
        expect(() => registerLanguage({})).toThrow();
        expect(() => registerLanguage({code: 'xx'})).toThrow();
        expect(services.extensions.getLanguages()).toHaveLength(0);
    });

    test('registerLanguage makes the pack available and translations fall back per key', () => {
        act(() => {
            registerLanguage({code: 'zh-CN', name: '简体中文', resources: {Applications: '应用'}});
        });
        expect(services.extensions.getLanguages().map(l => l.code)).toEqual(['zh-CN']);

        act(() => {
            i18next.changeLanguage('zh-CN');
        });
        expect(i18next.t('Applications')).toBe('应用');
        // Untranslated key falls back to English, never to an empty string or a mangled key.
        expect(i18next.t('Settings')).toBe('Settings');
    });

    test('re-registering the same code replaces the pack instead of duplicating it', () => {
        act(() => {
            registerLanguage({code: 'zh-CN', name: '简体中文', resources: {Applications: '应用程序'}});
        });
        expect(services.extensions.getLanguages()).toHaveLength(1);
        expect(i18next.getResource('zh-CN', 'translation', 'Applications')).toBe('应用程序');
    });

    test('LanguageSelector lists English plus registered packs and persists the choice', () => {
        const update = jest.spyOn(services.viewPreferences, 'updatePreferences').mockImplementation(() => {});
        const {container} = render(<LanguageSelector pref={pref('en')} />);

        expect(screen.getByText('Language')).toBeInTheDocument();
        expect(container.querySelector('.select__value')).toHaveTextContent('English');
        expect(Array.from(container.querySelectorAll('.select__option')).map(o => o.textContent.trim())).toEqual(['English', '简体中文']);

        fireEvent.click(screen.getByText('简体中文'));
        expect(update).toHaveBeenCalledWith({language: 'zh-CN'});
        expect(i18next.language).toBe('zh-CN');
        expect(document.documentElement.lang).toBe('zh-CN');
        update.mockRestore();
    });

    test('LanguageSync applies the persisted language and falls back to English when its pack is missing', () => {
        render(<LanguageSync pref={pref('zh-CN')} />);
        expect(i18next.language).toBe('zh-CN');

        render(<LanguageSync pref={pref('fr')} />);
        expect(i18next.language).toBe(DEFAULT_LANGUAGE);
    });

    test('the selector label itself is translated once a pack provides it', () => {
        act(() => {
            registerLanguage({code: 'zh-CN', name: '简体中文', resources: {Language: '语言'}});
            i18next.changeLanguage('zh-CN');
        });
        render(<LanguageSelector pref={pref('zh-CN')} />);
        expect(screen.getByText('语言')).toBeInTheDocument();
    });
});
