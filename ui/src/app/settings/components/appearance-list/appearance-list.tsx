import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {DataLoader, Page} from '../../../shared/components';
import {LanguageSelector} from '../../../shared/components/language-selector/language-selector';
import {services} from '../../../shared/services';
import {Select, SelectOption} from 'argo-ui';

require('./appearance-list.scss');

export const AppearanceList = () => {
    const {t} = useTranslation();
    return (
        <Page
            title={t('Appearance')}
            toolbar={{
                breadcrumbs: [{title: t('Settings'), path: '/settings'}, {title: t('Appearance')}]
            }}>
            <DataLoader load={() => services.viewPreferences.getPreferences()}>
                {pref => (
                    <div className='appearance-list'>
                        <div className='argo-container'>
                            <div className='appearance-list__panel'>
                                <div className='row'>
                                    <span>{t('Theme')}</span>
                                    <Select
                                        value={pref.theme}
                                        onChange={(value: SelectOption) => services.viewPreferences.updatePreferences({theme: value.value})}
                                        options={[
                                            {value: 'auto', title: t('Auto')},
                                            {value: 'light', title: t('Light')},
                                            {value: 'dark', title: t('Dark')}
                                        ]}></Select>
                                </div>
                                <LanguageSelector pref={pref} />
                            </div>
                        </div>
                    </div>
                )}
            </DataLoader>
        </Page>
    );
};
