import * as jsYaml from 'js-yaml';
import {
    buildIgnoreDifference,
    buildIgnoreDifferenceForFields,
    buildLinePointerMap,
    getChangedPaths,
    isValidPointer,
    mergeIgnoreDifferences,
    pointerToJQPath,
    resolvePointer
} from '../ignore-differences';
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

describe('pointerToJQPath', () => {
    it('converts simple pointers', () => {
        expect(pointerToJQPath('/spec/replicas')).toBe('.spec.replicas');
    });
    it('converts array indexes to brackets', () => {
        expect(pointerToJQPath('/spec/containers/0/image')).toBe('.spec.containers[0].image');
    });
    it('quotes keys with special characters', () => {
        expect(pointerToJQPath('/metadata/annotations/kubectl.kubernetes.io~1restartedAt')).toBe('.metadata.annotations["kubectl.kubernetes.io/restartedAt"]');
    });
    it('handles the root pointer', () => {
        expect(pointerToJQPath('')).toBe('.');
    });
});

describe('buildIgnoreDifferenceForFields', () => {
    const target = {group: 'apps', kind: 'Deployment', namespace: 'default', name: 'web'};
    it('distributes fields by rule type', () => {
        const rule = buildIgnoreDifferenceForFields(target, [
            {pointer: '/spec/replicas', ruleType: 'jsonPointers'},
            {pointer: '/spec/containers/0/image', ruleType: 'jqPathExpressions'},
            {pointer: '/metadata/managedFields', ruleType: 'managedFieldsManagers', manager: 'kube-controller-manager'}
        ]);
        expect(rule.jsonPointers).toEqual(['/spec/replicas']);
        expect(rule.jqPathExpressions).toEqual(['.spec.containers[0].image']);
        expect(rule.managedFieldsManagers).toEqual(['kube-controller-manager']);
    });
    it('omits empty lists and uses jq overrides', () => {
        const rule = buildIgnoreDifferenceForFields(target, [{pointer: '/x', ruleType: 'jqPathExpressions', jqExpression: '.spec.template.spec.containers[] | .image'}]);
        expect(rule.jsonPointers).toBeUndefined();
        expect(rule.managedFieldsManagers).toBeUndefined();
        expect(rule.jqPathExpressions).toEqual(['.spec.template.spec.containers[] | .image']);
    });
    it('drops managedFieldsManagers entries without a manager name', () => {
        const rule = buildIgnoreDifferenceForFields(target, [{pointer: '/metadata/managedFields', ruleType: 'managedFieldsManagers'}]);
        expect(rule.managedFieldsManagers).toBeUndefined();
    });
});

describe('mergeIgnoreDifferences with multiple rule types', () => {
    it('merges jq expressions and managers into an existing rule', () => {
        const existing = [{group: 'apps', kind: 'Deployment', name: 'web', namespace: 'default', jqPathExpressions: ['.a']}];
        const merged = mergeIgnoreDifferences(existing, {
            group: 'apps',
            kind: 'Deployment',
            name: 'web',
            namespace: 'default',
            jqPathExpressions: ['.b'],
            managedFieldsManagers: ['helm']
        });
        expect(merged).toHaveLength(1);
        expect(merged[0].jqPathExpressions).toEqual(['.a', '.b']);
        expect(merged[0].managedFieldsManagers).toEqual(['helm']);
        expect(merged[0].jsonPointers).toBeUndefined();
    });
});

describe('buildLinePointerMap', () => {
    // maps are validated against real js-yaml output, the same dump settings the diff view uses
    const mapFor = (obj: any) => buildLinePointerMap(jsYaml.dump(obj, {indent: 2}));

    it('maps top-level and nested keys', () => {
        const obj = {apiVersion: 'v1', kind: 'Service', spec: {clusterIP: '10.0.0.1', type: 'ClusterIP'}};
        const yaml = jsYaml.dump(obj, {indent: 2});
        const lines = yaml.trimEnd().split('\n');
        const map = mapFor(obj);
        expect(map.get(lines.indexOf('apiVersion: v1') + 1)).toBe('/apiVersion');
        expect(map.get(lines.indexOf('spec:') + 1)).toBe('/spec');
        expect(map.get(lines.indexOf('  clusterIP: 10.0.0.1') + 1)).toBe('/spec/clusterIP');
        expect(map.get(lines.indexOf('  type: ClusterIP') + 1)).toBe('/spec/type');
    });

    it('maps array items and their nested keys', () => {
        const obj = {spec: {containers: [{name: 'main', image: 'nginx:1'}, {name: 'sidecar', image: 'envoy:1'}]}};
        const yaml = jsYaml.dump(obj, {indent: 2});
        const lines = yaml.trimEnd().split('\n');
        const map = mapFor(obj);
        expect(map.get(lines.indexOf('    - name: main') + 1)).toBe('/spec/containers/0');
        expect(map.get(lines.indexOf('      image: nginx:1') + 1)).toBe('/spec/containers/0/image');
        expect(map.get(lines.indexOf('    - name: sidecar') + 1)).toBe('/spec/containers/1');
        expect(map.get(lines.indexOf('      image: envoy:1') + 1)).toBe('/spec/containers/1/image');
    });

    it('maps scalar array items', () => {
        const obj = {spec: {finalizers: ['a', 'b']}};
        const yaml = jsYaml.dump(obj, {indent: 2});
        const lines = yaml.trimEnd().split('\n');
        const map = mapFor(obj);
        expect(map.get(lines.indexOf('    - a') + 1)).toBe('/spec/finalizers/0');
        expect(map.get(lines.indexOf('    - b') + 1)).toBe('/spec/finalizers/1');
    });

    it('maps keys containing slashes and dots (annotations)', () => {
        const obj = {metadata: {annotations: {'deployment.kubernetes.io/revision': '5'}}};
        const yaml = jsYaml.dump(obj, {indent: 2});
        const lines = yaml.trimEnd().split('\n');
        const map = mapFor(obj);
        const annotationLine = lines.findIndex(l => l.includes('deployment.kubernetes.io/revision')) + 1;
        expect(map.get(annotationLine)).toBe('/metadata/annotations/deployment.kubernetes.io~1revision');
    });

    it('maps block scalar continuation lines to the key pointer', () => {
        const obj = {data: {config: 'line1\nline2\nline3\n'}};
        const yaml = jsYaml.dump(obj, {indent: 2});
        const lines = yaml.trimEnd().split('\n');
        const map = mapFor(obj);
        const keyLine = lines.findIndex(l => l.includes('config:')) + 1;
        expect(map.get(keyLine)).toBe('/data/config');
        expect(map.get(keyLine + 1)).toBe('/data/config');
        expect(map.get(keyLine + 2)).toBe('/data/config');
    });

    it('maps deeply nested mixed structures', () => {
        const obj = {spec: {template: {spec: {containers: [{env: [{name: 'FOO', value: 'bar'}]}]}}}};
        const yaml = jsYaml.dump(obj, {indent: 2});
        const lines = yaml.trimEnd().split('\n');
        const map = mapFor(obj);
        const valueLine = lines.findIndex(l => l.includes('value: bar')) + 1;
        expect(map.get(valueLine)).toBe('/spec/template/spec/containers/0/env/0/value');
    });
});
