import * as models from '../../../shared/models';

// Fields that are almost always mutated by controllers and are safe defaults to suggest ignoring.
const SUGGESTED_POINTER_PREFIXES = ['/status', '/metadata/generation', '/metadata/managedFields', '/metadata/resourceVersion'];

export interface ChangedPath {
    // RFC 6901 JSON pointer to the changed field, e.g. /spec/replicas
    pointer: string;
    // value in the normalized live state (undefined when the field was added)
    live?: unknown;
    // value in the predicted live state (undefined when the field was removed)
    predicted?: unknown;
    // true when the pointer matches a well-known controller-managed field
    suggested: boolean;
}

function escapePointerSegment(segment: string): string {
    return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function collectChangedPaths(live: unknown, predicted: unknown, pointer: string, out: ChangedPath[]) {
    if (live === predicted) {
        return;
    }
    const bothArrays = Array.isArray(live) && Array.isArray(predicted);
    const bothObjects = !bothArrays && isObject(live) && isObject(predicted) && !Array.isArray(live) && !Array.isArray(predicted);
    if (bothArrays) {
        const liveArr = live as unknown[];
        const predictedArr = predicted as unknown[];
        const len = Math.max(liveArr.length, predictedArr.length);
        for (let i = 0; i < len; i++) {
            collectChangedPaths(liveArr[i], predictedArr[i], `${pointer}/${i}`, out);
        }
        return;
    }
    if (bothObjects) {
        const keys = new Set([...Object.keys(live as object), ...Object.keys(predicted as object)]);
        keys.forEach(key =>
            collectChangedPaths((live as Record<string, unknown>)[key], (predicted as Record<string, unknown>)[key], `${pointer}/${escapePointerSegment(key)}`, out)
        );
        return;
    }
    if (isObject(live) || isObject(predicted) || live !== predicted) {
        // leaf mismatch (different scalars, or type mismatch between the two states)
        if (JSON.stringify(live) === JSON.stringify(predicted)) {
            return;
        }
        out.push({
            pointer,
            live,
            predicted,
            suggested: SUGGESTED_POINTER_PREFIXES.some(prefix => pointer === prefix || pointer.startsWith(prefix + '/'))
        });
    }
}

// Returns the JSON pointers of every leaf field that differs between the normalized live state
// and the predicted live state of a managed resource.
export function getChangedPaths(state: models.ResourceDiff): ChangedPath[] {
    const out: ChangedPath[] = [];
    collectChangedPaths(state.normalizedLiveState, state.predictedLiveState, '', out);
    return out;
}

// Resolves an RFC 6901 JSON pointer against an object; returns undefined when the path does not exist.
export function resolvePointer(obj: unknown, pointer: string): unknown {
    if (pointer === '') {
        return obj;
    }
    if (!pointer.startsWith('/')) {
        return undefined;
    }
    let current: unknown = obj;
    for (const rawSegment of pointer.slice(1).split('/')) {
        const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~');
        if (Array.isArray(current)) {
            const index = Number(segment);
            if (!Number.isInteger(index) || index < 0 || index >= current.length) {
                return undefined;
            }
            current = current[index];
        } else if (isObject(current) && segment in current) {
            current = (current as Record<string, unknown>)[segment];
        } else {
            return undefined;
        }
    }
    return current;
}

export function isValidPointer(pointer: string): boolean {
    return pointer === '' || (pointer.startsWith('/') && !pointer.includes('//'));
}

// Builds the narrowest ignoreDifferences entry for one resource and a set of selected JSON pointers.
export function buildIgnoreDifference(state: {group?: string; kind: string; namespace?: string; name: string}, jsonPointers: string[]): models.ResourceIgnoreDifferences {
    return {
        group: state.group || '',
        kind: state.kind,
        name: state.name,
        namespace: state.namespace || '',
        jsonPointers: [...jsonPointers].sort()
    };
}

function sameTarget(a: models.ResourceIgnoreDifferences, b: models.ResourceIgnoreDifferences): boolean {
    return (a.group || '') === (b.group || '') && a.kind === b.kind && (a.name || '') === (b.name || '') && (a.namespace || '') === (b.namespace || '');
}

// Merges a new rule into an existing ignoreDifferences list. When a rule for the same
// group/kind/namespace/name already exists, pointers are merged and de-duplicated.
export function mergeIgnoreDifferences(existing: models.ResourceIgnoreDifferences[] | undefined, addition: models.ResourceIgnoreDifferences): models.ResourceIgnoreDifferences[] {
    const result = [...(existing || [])];
    const match = result.find(rule => sameTarget(rule, addition));
    if (match) {
        const merged = {...match};
        merged.jsonPointers = Array.from(new Set([...(match.jsonPointers || []), ...(addition.jsonPointers || [])])).sort();
        result[result.indexOf(match)] = merged;
    } else {
        result.push(addition);
    }
    return result;
}
