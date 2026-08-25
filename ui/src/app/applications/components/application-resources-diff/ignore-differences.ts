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

// The rule types supported by Application.spec.ignoreDifferences.
export type IgnoreRuleType = 'jsonPointers' | 'jqPathExpressions' | 'managedFieldsManagers';

export interface SelectedField {
    pointer: string;
    ruleType: IgnoreRuleType;
    // manager name, only meaningful when ruleType is managedFieldsManagers
    manager?: string;
    // jq expression override; defaults to pointerToJQPath(pointer) when ruleType is jqPathExpressions
    jqExpression?: string;
}

// Converts an RFC 6901 JSON pointer to an equivalent jq path expression,
// e.g. /spec/containers/0/image -> .spec.containers[0].image
export function pointerToJQPath(pointer: string): string {
    if (pointer === '' || !pointer.startsWith('/')) {
        return '.';
    }
    let result = '';
    for (const rawSegment of pointer.slice(1).split('/')) {
        const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~');
        if (/^\d+$/.test(segment)) {
            result += `[${segment}]`;
        } else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment)) {
            result += `.${segment}`;
        } else {
            result += `["${segment.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
        }
    }
    return result;
}

// Builds the narrowest ignoreDifferences entry for one resource and a set of selected fields,
// distributing each field into the list matching its rule type.
export function buildIgnoreDifferenceForFields(state: {group?: string; kind: string; namespace?: string; name: string}, fields: SelectedField[]): models.ResourceIgnoreDifferences {
    const rule: models.ResourceIgnoreDifferences = {
        group: state.group || '',
        kind: state.kind,
        name: state.name,
        namespace: state.namespace || ''
    };
    const jsonPointers = fields.filter(f => f.ruleType === 'jsonPointers').map(f => f.pointer);
    const jqPathExpressions = fields.filter(f => f.ruleType === 'jqPathExpressions').map(f => f.jqExpression || pointerToJQPath(f.pointer));
    const managedFieldsManagers = fields.filter(f => f.ruleType === 'managedFieldsManagers' && f.manager).map(f => f.manager);
    if (jsonPointers.length > 0) {
        rule.jsonPointers = [...new Set(jsonPointers)].sort();
    }
    if (jqPathExpressions.length > 0) {
        rule.jqPathExpressions = [...new Set(jqPathExpressions)].sort();
    }
    if (managedFieldsManagers.length > 0) {
        rule.managedFieldsManagers = [...new Set(managedFieldsManagers)].sort();
    }
    return rule;
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
// group/kind/namespace/name already exists, pointers/expressions/managers are merged and de-duplicated.
export function mergeIgnoreDifferences(existing: models.ResourceIgnoreDifferences[] | undefined, addition: models.ResourceIgnoreDifferences): models.ResourceIgnoreDifferences[] {
    const result = [...(existing || [])];
    const match = result.find(rule => sameTarget(rule, addition));
    if (match) {
        const merged = {...match};
        const mergeList = (a?: string[], b?: string[]) => {
            const combined = Array.from(new Set([...(a || []), ...(b || [])])).sort();
            return combined.length > 0 ? combined : undefined;
        };
        merged.jsonPointers = mergeList(match.jsonPointers, addition.jsonPointers);
        merged.jqPathExpressions = mergeList(match.jqPathExpressions, addition.jqPathExpressions);
        merged.managedFieldsManagers = mergeList(match.managedFieldsManagers, addition.managedFieldsManagers);
        result[result.indexOf(match)] = merged;
    } else {
        result.push(addition);
    }
    return result;
}

// Maps 1-based YAML line numbers (of jsYaml.dump(obj, {indent: 2}) output) to the JSON pointer
// of the field defined on that line. Continuation lines of multi-line scalars map to the pointer
// of their key. Implemented by walking the dumped text with an indentation stack — the input is
// always js-yaml's own machine-generated output, never hand-written YAML.
export function buildLinePointerMap(yamlText: string): Map<number, string> {
    const map = new Map<number, string>();
    const lines = yamlText.split('\n');
    // stack of containers: pointer plus the indent column their children appear at
    interface Frame {
        pointer: string;
        childIndent: number;
        nextArrayIndex?: number;
    }
    const stack: Frame[] = [{pointer: '', childIndent: 0}];
    let lastPointer = '';
    // while inside a block scalar (| or >), all deeper-indented lines belong to the scalar's key
    let blockScalarIndent = -1;

    const unquoteKey = (raw: string): string => {
        const trimmed = raw.trim();
        if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
            return trimmed.slice(1, -1).replace(/''/g, "'");
        }
        if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
            try {
                return JSON.parse(trimmed);
            } catch {
                return trimmed.slice(1, -1);
            }
        }
        return trimmed;
    };

    // splits "key: value" / "key:" at the first unquoted colon followed by space or EOL
    const splitKey = (text: string): [string, string] | null => {
        let inSingle = false;
        let inDouble = false;
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (c === "'" && !inDouble) {
                inSingle = !inSingle;
            } else if (c === '"' && !inSingle && text[i - 1] !== '\\') {
                inDouble = !inDouble;
            } else if (c === ':' && !inSingle && !inDouble && (i === text.length - 1 || text[i + 1] === ' ')) {
                return [text.slice(0, i), text.slice(i + 1).trim()];
            }
        }
        return null;
    };

    for (let lineNo = 1; lineNo <= lines.length; lineNo++) {
        const line = lines[lineNo - 1];
        if (line.trim() === '') {
            continue;
        }
        const indent = line.length - line.trimStart().length;

        if (blockScalarIndent >= 0) {
            if (indent > blockScalarIndent) {
                map.set(lineNo, lastPointer);
                continue;
            }
            blockScalarIndent = -1;
        }

        // pop containers whose children can no longer appear at this indent
        while (stack.length > 1 && indent < stack[stack.length - 1].childIndent) {
            stack.pop();
        }

        let content = line.trimStart();
        let framePointer = stack[stack.length - 1].pointer;
        let effectiveIndent = indent;

        // handle (possibly nested) array item markers: "- ", "- - ", "- key: ..."
        while (content.startsWith('- ') || content === '-') {
            const frame = stack[stack.length - 1];
            if (frame.nextArrayIndex === undefined) {
                frame.nextArrayIndex = 0;
            }
            const itemPointer = `${frame.pointer}/${frame.nextArrayIndex}`;
            frame.nextArrayIndex++;
            map.set(lineNo, itemPointer);
            lastPointer = itemPointer;
            content = content === '-' ? '' : content.slice(2);
            effectiveIndent += 2;
            framePointer = itemPointer;
            // the item itself may be a container whose children appear at effectiveIndent
            stack.push({pointer: itemPointer, childIndent: effectiveIndent});
        }

        if (content === '') {
            continue;
        }

        const kv = splitKey(content);
        if (kv) {
            const [rawKey, rest] = kv;
            const pointer = `${framePointer}/${escapePointerSegment(unquoteKey(rawKey))}`;
            if (!map.has(lineNo)) {
                map.set(lineNo, pointer);
            }
            lastPointer = pointer;
            if (rest === '' || rest === '|' || rest === '>' || rest.startsWith('|') || rest.startsWith('>')) {
                if (rest.startsWith('|') || rest.startsWith('>')) {
                    blockScalarIndent = effectiveIndent;
                    // continuation lines belong to this key
                } else {
                    // value is a nested object/array starting on the next line
                    stack.push({pointer, childIndent: effectiveIndent + 2});
                }
            } else if (rest !== '') {
                // inline scalar; multi-line folded scalars (quoted strings wrapped by lineWidth)
                // produce continuation lines with deeper indent and no key pattern — they will
                // fail splitKey and fall through to the lastPointer branch below.
            }
        } else {
            // continuation line of a folded scalar
            map.set(lineNo, lastPointer);
        }
    }
    return map;
}
