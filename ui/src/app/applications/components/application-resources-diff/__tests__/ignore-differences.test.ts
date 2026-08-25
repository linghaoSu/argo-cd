import {buildIgnoreDifference, getChangedPaths, isValidPointer, mergeIgnoreDifferences, resolvePointer} from '../ignore-differences';
import * as models from '../../../../shared/models';

const makeState = (live: any, predicted: any): models.ResourceDiff =>
    ({
        group: 'apps',
        kind: 'Deployment',
        namespace: 'default',
        name: 'guestbook-ui',
        normalizedLiveState: live,
        predictedLiveState: predicted,
        hook: false
    }) as models.ResourceDiff;

describe('getChangedPaths', () => {
    it('detects changed scalar fields', () => {
        const state = makeState({spec: {replicas: 3}}, {spec: {replicas: 2}});
        const paths = getChangedPaths(state);
        expect(paths.map(p => p.pointer)).toEqual(['/spec/replicas']);
        expect(paths[0].live).toBe(3);
        expect(paths[0].predicted).toBe(2);
    });

    it('detects added and removed fields', () => {
        const state = makeState({metadata: {labels: {a: '1'}}}, {metadata: {labels: {a: '1', b: '2'}}, spec: {}});
        const pointers = getChangedPaths(state).map(p => p.pointer);
        expect(pointers).toContain('/metadata/labels/b');
    });

    it('recurses into arrays by index', () => {
        const state = makeState(
            {spec: {containers: [{image: 'nginx:1'}, {image: 'sidecar:1'}]}},
            {spec: {containers: [{image: 'nginx:2'}, {image: 'sidecar:1'}]}}
        );
        expect(getChangedPaths(state).map(p => p.pointer)).toEqual(['/spec/containers/0/image']);
    });

    it('escapes special characters in keys', () => {
        const state = makeState({metadata: {annotations: {'kubectl.kubernetes.io/restartedAt': 'x'}}}, {metadata: {annotations: {'kubectl.kubernetes.io/restartedAt': 'y'}}});
        expect(getChangedPaths(state).map(p => p.pointer)).toEqual(['/metadata/annotations/kubectl.kubernetes.io~1restartedAt']);
    });

    it('marks controller-managed fields as suggested', () => {
        const state = makeState({status: {replicas: 1}, spec: {replicas: 1}}, {status: {replicas: 2}, spec: {replicas: 2}});
        const paths = getChangedPaths(state);
        expect(paths.find(p => p.pointer === '/status/replicas').suggested).toBe(true);
        expect(paths.find(p => p.pointer === '/spec/replicas').suggested).toBe(false);
    });

    it('returns no paths for identical states', () => {
        const state = makeState({spec: {a: [1, 2]}}, {spec: {a: [1, 2]}});
        expect(getChangedPaths(state)).toEqual([]);
    });
});

describe('resolvePointer', () => {
    const obj = {spec: {containers: [{name: 'main'}], 'weird/key': {'~tilde': 5}}};
    it('resolves nested object and array paths', () => {
        expect(resolvePointer(obj, '/spec/containers/0/name')).toBe('main');
    });
    it('resolves escaped segments', () => {
        expect(resolvePointer(obj, '/spec/weird~1key/~0tilde')).toBe(5);
    });
    it('returns undefined for missing paths and bad indexes', () => {
        expect(resolvePointer(obj, '/spec/missing')).toBeUndefined();
        expect(resolvePointer(obj, '/spec/containers/5')).toBeUndefined();
        expect(resolvePointer(obj, 'no-leading-slash')).toBeUndefined();
    });
    it('returns the object itself for the empty pointer', () => {
        expect(resolvePointer(obj, '')).toBe(obj);
    });
});

describe('isValidPointer', () => {
    it('accepts valid pointers and rejects invalid ones', () => {
        expect(isValidPointer('/spec/replicas')).toBe(true);
        expect(isValidPointer('')).toBe(true);
        expect(isValidPointer('spec/replicas')).toBe(false);
        expect(isValidPointer('/spec//replicas')).toBe(false);
    });
});

describe('buildIgnoreDifference / mergeIgnoreDifferences', () => {
    it('builds a narrow rule for a resource', () => {
        expect(buildIgnoreDifference({group: 'apps', kind: 'Deployment', namespace: 'default', name: 'web'}, ['/spec/replicas'])).toEqual({
            group: 'apps',
            kind: 'Deployment',
            name: 'web',
            namespace: 'default',
            jsonPointers: ['/spec/replicas']
        });
    });

    it('merges pointers into an existing rule for the same resource', () => {
        const existing = [{group: 'apps', kind: 'Deployment', name: 'web', namespace: 'default', jsonPointers: ['/spec/replicas']}];
        const merged = mergeIgnoreDifferences(existing, {group: 'apps', kind: 'Deployment', name: 'web', namespace: 'default', jsonPointers: ['/spec/replicas', '/status']});
        expect(merged).toHaveLength(1);
        expect(merged[0].jsonPointers).toEqual(['/spec/replicas', '/status']);
    });

    it('appends a new rule for a different resource and leaves existing rules untouched', () => {
        const existing = [{kind: 'Service', name: 'svc', jsonPointers: ['/spec/clusterIP']} as models.ResourceIgnoreDifferences];
        const merged = mergeIgnoreDifferences(existing, {group: 'apps', kind: 'Deployment', name: 'web', namespace: 'default', jsonPointers: ['/spec/replicas']});
        expect(merged).toHaveLength(2);
        expect(existing).toHaveLength(1);
    });

    it('handles undefined existing rules', () => {
        expect(mergeIgnoreDifferences(undefined, {kind: 'Deployment', jsonPointers: ['/x']})).toHaveLength(1);
    });
});
