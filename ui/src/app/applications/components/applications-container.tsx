import * as React from 'react';
import {Route, RouteComponentProps, Switch} from 'react-router';

import {lazyRoute} from '../../shared/components/lazy-route';

/*
 * The two views under this route are both large (~3.4k and ~2.1k lines with
 * their subtrees) and share almost no code, so they get separate chunks: a user
 * on the list page should not pay for the details page.
 *
 * The fullscreen logs view is small on its own but pulls in the same log
 * viewer as the details page, so it shares that chunk rather than adding a
 * third request.
 */
const ApplicationsList = lazyRoute(() => import(/* webpackChunkName: "applications-list" */ './applications-list/applications-list').then(m => ({default: m.ApplicationsList})));
const ApplicationSetsList = lazyRoute(() =>
    import(/* webpackChunkName: "applications-list" */ './applications-list/application-sets-list').then(m => ({default: m.ApplicationSetsList}))
);
const ApplicationDetails = lazyRoute(() =>
    import(/* webpackChunkName: "application-details" */ './application-details/application-details').then(m => ({default: m.ApplicationDetails}))
);
const ApplicationFullscreenLogs = lazyRoute(() =>
    import(/* webpackChunkName: "application-details" */ './application-fullscreen-logs/application-fullscreen-logs').then(m => ({default: m.ApplicationFullscreenLogs}))
);

export const ApplicationsContainer = (props: RouteComponentProps<any>) => {
    // Determine objectListKind from the route path
    const objectListKind = props.match.path.includes('/applicationsets') ? 'applicationset' : 'application';

    return (
        <Switch>
            <Route
                exact={true}
                path={`${props.match.path}`}
                render={() => (objectListKind === 'application' ? <ApplicationsList {...(props as any)} /> : <ApplicationSetsList {...(props as any)} />)}
            />
            <Route exact={true} path={`${props.match.path}/:name`} render={routeProps => <ApplicationDetails objectListKind={objectListKind} {...(routeProps as any)} />} />
            <Route
                exact={true}
                path={`${props.match.path}/:appnamespace/:name`}
                render={routeProps => <ApplicationDetails objectListKind={objectListKind} {...(routeProps as any)} />}
            />
            <Route exact={true} path={`${props.match.path}/:name/:namespace/:container/logs`} component={ApplicationFullscreenLogs} />
            <Route exact={true} path={`${props.match.path}/:appnamespace/:name/:namespace/:container/logs`} component={ApplicationFullscreenLogs} />
        </Switch>
    );
};
