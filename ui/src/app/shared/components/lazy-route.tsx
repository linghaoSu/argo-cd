import * as React from 'react';
import {RouteComponentProps} from 'react-router';

// Deliberately dependency-free: `Spinner` reaches into applications/components,
// which would pull that route's code back into the entry bundle.
const RouteFallback = () => <div style={{padding: '1em'}} />;

/**
 * Wraps a `React.lazy` route component in the Suspense boundary the router
 * expects, so call sites can keep treating it as a plain component.
 *
 * Chunking policy: a separate chunk is only worth an extra round trip when the
 * code behind it is substantial or pulls in vendor code nothing else uses.
 * Small sibling views should share a chunk name rather than each getting one --
 * see `settings-container.tsx` for an example.
 */
export function lazyRoute(factory: () => Promise<{default: React.ComponentType<any>}>): React.ComponentType<RouteComponentProps<any>> {
    const Lazy = React.lazy(factory);
    return (props: RouteComponentProps<any>) => (
        <React.Suspense fallback={<RouteFallback />}>
            <Lazy {...props} />
        </React.Suspense>
    );
}
