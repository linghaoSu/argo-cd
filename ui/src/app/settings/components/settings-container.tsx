import * as React from 'react';
import {Redirect, Route, RouteComponentProps, Switch} from 'react-router';
import {KeybindingProvider} from 'argo-ui/v2';

import {lazyRoute} from '../../shared/components/lazy-route';

/*
 * Settings sub-pages are small (most are 40-500 lines) and share their
 * dependencies with the rest of the settings area, so giving each one its own
 * chunk would trade a single ~40 KB download for a dozen ~2-4 KB serial
 * requests as the user clicks through the nav. They therefore share the
 * "settings-pages" chunk name and are fetched together.
 *
 * The two outliers are split out: they are an order of magnitude larger than
 * their siblings and each is reachable only from a specific nav entry.
 */
const page = (factory: () => Promise<{default: React.ComponentType<any>}>) => lazyRoute(factory);

const SettingsOverview = page(() => import(/* webpackChunkName: "settings-pages" */ './settings-overview/settings-overview').then(m => ({default: m.SettingsOverview})));
const CertsList = page(() => import(/* webpackChunkName: "settings-pages" */ './certs-list/certs-list').then(m => ({default: m.CertsList})));
const GpgKeysList = page(() => import(/* webpackChunkName: "settings-pages" */ './gpgkeys-list/gpgkeys-list').then(m => ({default: m.GpgKeysList})));
const ClustersList = page(() => import(/* webpackChunkName: "settings-pages" */ './clusters-list/clusters-list').then(m => ({default: m.ClustersList})));
const ClusterDetails = page(() => import(/* webpackChunkName: "settings-pages" */ './cluster-details/cluster-details').then(m => ({default: m.ClusterDetails})));
const ProjectsList = page(() => import(/* webpackChunkName: "settings-pages" */ './projects-list/projects-list').then(m => ({default: m.ProjectsList})));
const AccountsList = page(() => import(/* webpackChunkName: "settings-pages" */ './accounts-list/accounts-list').then(m => ({default: m.AccountsList})));
const AccountDetails = page(() => import(/* webpackChunkName: "settings-pages" */ './account-details/account-details').then(m => ({default: m.AccountDetails})));
const AppearanceList = page(() => import(/* webpackChunkName: "settings-pages" */ './appearance-list/appearance-list').then(m => ({default: m.AppearanceList})));
const AdvancedSettings = page(() => import(/* webpackChunkName: "settings-pages" */ './advanced-settings/advanced-settings').then(m => ({default: m.AdvancedSettings})));

// Large enough to be worth their own chunks.
const ReposList = page(() => import(/* webpackChunkName: "settings-repos" */ './repos-list/repos-list').then(m => ({default: m.ReposList})));
const ProjectDetails = page(() => import(/* webpackChunkName: "settings-project-details" */ './project-details/project-details').then(m => ({default: m.ProjectDetails})));

export const SettingsContainer = (props: RouteComponentProps<any>) => (
    <KeybindingProvider>
        <Switch>
            <Route exact={true} path={`${props.match.path}`} component={SettingsOverview} />
            <Route exact={true} path={`${props.match.path}/repos`} component={ReposList} />
            <Route exact={true} path={`${props.match.path}/certs`} component={CertsList} />
            <Route exact={true} path={`${props.match.path}/gpgkeys`} component={GpgKeysList} />
            <Route exact={true} path={`${props.match.path}/clusters`} component={ClustersList} />
            <Route exact={true} path={`${props.match.path}/clusters/:server`} component={ClusterDetails} />
            <Route exact={true} path={`${props.match.path}/projects`} component={ProjectsList} />
            <Route exact={true} path={`${props.match.path}/projects/:name`} component={ProjectDetails} />
            <Route exact={true} path={`${props.match.path}/accounts`} component={AccountsList} />
            <Route exact={true} path={`${props.match.path}/accounts/:name`} component={AccountDetails} />
            <Route exact={true} path={`${props.match.path}/appearance`} component={AppearanceList} />
            <Route exact={true} path={`${props.match.path}/advanced`} component={AdvancedSettings} />
            <Redirect path='*' to={`${props.match.path}`} />
        </Switch>
    </KeybindingProvider>
);
