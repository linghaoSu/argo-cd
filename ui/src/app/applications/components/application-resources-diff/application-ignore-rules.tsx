import * as jsYaml from 'js-yaml';
import * as React from 'react';
import {useContext, useMemo, useState} from 'react';
import {DataLoader, ErrorNotification, NotificationType} from 'argo-ui';
import {MonacoDiffEditor} from '../../../shared/components/monaco-diff-editor';
import * as models from '../../../shared/models';
import {Context} from '../../../shared/context';
import {services} from '../../../shared/services';
import {buildLinePointerMap, countCoveredFields, getChangedPaths, ruleMatchesResource, ChangedPath} from './ignore-differences';
import {resourceKey} from './ignore-differences-panel';

import './application-resources-diff.scss';

export interface ApplicationIgnoreRulesViewProps {
    application: models.Application;
    // pre-select this resource (set when jumping from the DIFF tab)
    initialResource?: string;
}

interface ResourceEntry {
    key: string;
    label: string;
    state: models.ResourceDiff;
    live: string;
    predicted: string;
    liveLines: Map<number, string>;
    predictedLines: Map<number, string>;
    changed: ChangedPath[];
}

// one editable rule; `saved` marks rules that came from the current application spec
interface EditableRule extends models.ResourceIgnoreDifferences {
    saved: boolean;
}

const emptyToUndefined = (list?: string[]) => (list && list.length > 0 ? list : undefined);

// "Ignored fields" tab: a rule list on the left (like a review sidebar), the impacted
// resources with a Monaco diff on the right; clicking a changed field adds it to the
// active rule (issue #29330).
export const ApplicationIgnoreRulesView = (props: ApplicationIgnoreRulesViewProps) => {
    const {application, initialResource} = props;
    return (
        <DataLoader
            key='ignore-rules'
            load={() =>
                services.applications.managedResources(application.metadata.name, application.metadata.namespace, {
                    fields: ['items.normalizedLiveState', 'items.predictedLiveState', 'items.group', 'items.kind', 'items.namespace', 'items.name']
                })
            }>
            {states => <IgnoreRulesLayout application={application} states={states} initialResource={initialResource} />}
        </DataLoader>
    );
};

const IgnoreRulesLayout = ({application, states, initialResource}: {application: models.Application; states: models.ResourceDiff[]; initialResource?: string}) => {
    const appContext = useContext(Context);

    const resources: ResourceEntry[] = useMemo(
        () =>
            (states || [])
                .filter(state => !state.hook && (state.normalizedLiveState || state.predictedLiveState))
                .map(state => {
                    const live = state.normalizedLiveState ? jsYaml.dump(state.normalizedLiveState, {indent: 2}) : '';
                    const predicted = state.predictedLiveState ? jsYaml.dump(state.predictedLiveState, {indent: 2}) : '';
                    return {
                        key: resourceKey(state),
                        label: `${state.group || ''}/${state.kind}/${state.namespace ? state.namespace + '/' : ''}${state.name}`,
                        state,
                        live,
                        predicted,
                        liveLines: buildLinePointerMap(live),
                        predictedLines: buildLinePointerMap(predicted),
                        changed: getChangedPaths(state)
                    };
                })
                .sort((a, b) => b.changed.length - a.changed.length || a.key.localeCompare(b.key)),
        [states]
    );

    const initialRules: EditableRule[] = useMemo(
        () => (application.spec.ignoreDifferences || []).map(rule => ({...rule, saved: true})),

        [application]
    );
    const [rules, setRules] = useState<EditableRule[]>(initialRules);
    const [activeRuleIndex, setActiveRuleIndex] = useState<number | null>(null);
    const [activeResourceKey, setActiveResourceKey] = useState<string | null>(initialResource || null);
    const [search, setSearch] = useState('');
    const [onlyOutOfSync, setOnlyOutOfSync] = useState(false);
    const [saving, setSaving] = useState(false);

    const activeResource = resources.find(r => r.key === activeResourceKey) || resources.find(r => r.changed.length > 0) || resources[0];
    const activeRule = activeRuleIndex !== null ? rules[activeRuleIndex] : null;

    // impact summary: how many resources still differ if the current rules are saved
    const impact = useMemo(() => {
        const differing = resources.filter(r => r.changed.length > 0);
        const remaining = differing.filter(r => countCoveredFields(rules, r.state, r.changed) < r.changed.length);
        return {differing: differing.length, remaining: remaining.length};
    }, [resources, rules]);

    const visibleResources = resources.filter(r => {
        if (onlyOutOfSync && r.changed.length === 0) {
            return false;
        }
        return !search || r.label.toLowerCase().includes(search.toLowerCase());
    });

    const addRule = (template?: Partial<models.ResourceIgnoreDifferences>) => {
        const next: EditableRule = {
            group: template?.group ?? '',
            kind: template?.kind ?? '',
            name: template?.name ?? '',
            namespace: template?.namespace ?? '',
            jsonPointers: template?.jsonPointers,
            saved: false
        };
        setRules([...rules, next]);
        setActiveRuleIndex(rules.length);
    };

    const updateActiveRule = (patch: Partial<models.ResourceIgnoreDifferences>) => {
        if (activeRuleIndex === null) {
            return;
        }
        setRules(rules.map((rule, i) => (i === activeRuleIndex ? {...rule, ...patch, saved: false} : rule)));
    };

    const removeRule = (index: number) => {
        const next = [...rules];
        next.splice(index, 1);
        setRules(next);
        setActiveRuleIndex(null);
    };

    // clicking a changed field in the diff: add the pointer to the active rule, or create
    // a rule for the resource when none is active / the active rule doesn't match
    const onFieldClick = (resource: ResourceEntry, pointer: string) => {
        if (activeRule && ruleMatchesResource(activeRule, resource.state)) {
            const pointers = activeRule.jsonPointers || [];
            updateActiveRule({jsonPointers: pointers.includes(pointer) ? pointers.filter(p => p !== pointer) : [...pointers, pointer].sort()});
            return;
        }
        const existingIndex = rules.findIndex(rule => ruleMatchesResource(rule, resource.state));
        if (existingIndex >= 0) {
            const rule = rules[existingIndex];
            const pointers = rule.jsonPointers || [];
            setRules(
                rules.map((r, i) =>
                    i === existingIndex ? {...r, saved: false, jsonPointers: pointers.includes(pointer) ? pointers.filter(p => p !== pointer) : [...pointers, pointer].sort()} : r
                )
            );
            setActiveRuleIndex(existingIndex);
            return;
        }
        addRule({
            group: resource.state.group || '',
            kind: resource.state.kind,
            name: resource.state.name,
            namespace: resource.state.namespace || '',
            jsonPointers: [pointer]
        });
    };

    const selectSuggested = () => {
        if (!activeResource) {
            return;
        }
        const suggested = activeResource.changed.filter(p => p.suggested).map(p => p.pointer);
        if (suggested.length === 0) {
            return;
        }
        const existingIndex = rules.findIndex(rule => ruleMatchesResource(rule, activeResource.state));
        if (existingIndex >= 0) {
            const rule = rules[existingIndex];
            setRules(rules.map((r, i) => (i === existingIndex ? {...r, saved: false, jsonPointers: Array.from(new Set([...(rule.jsonPointers || []), ...suggested])).sort()} : r)));
            setActiveRuleIndex(existingIndex);
        } else {
            addRule({
                group: activeResource.state.group || '',
                kind: activeResource.state.kind,
                name: activeResource.state.name,
                namespace: activeResource.state.namespace || '',
                jsonPointers: suggested.sort()
            });
        }
    };

    const dirty = useMemo(() => rules.some(r => !r.saved) || rules.length !== initialRules.length, [rules, initialRules]);
    const invalidRules = rules.filter(r => !r.kind.trim());

    const save = async () => {
        setSaving(true);
        try {
            const spec = JSON.parse(JSON.stringify(application.spec)) as models.ApplicationSpec;
            spec.ignoreDifferences = rules.map(editable => ({
                group: editable.group,
                kind: editable.kind,
                name: editable.name,
                namespace: editable.namespace,
                jsonPointers: emptyToUndefined(editable.jsonPointers),
                jqPathExpressions: emptyToUndefined(editable.jqPathExpressions),
                managedFieldsManagers: emptyToUndefined(editable.managedFieldsManagers)
            }));
            await services.applications.updateSpec(application.metadata.name, application.metadata.namespace, spec);
            setRules(rules.map(rule => ({...rule, saved: true})));
            appContext.notifications.show({content: 'Saved ignored fields rules. Refresh the application to recalculate the diff.', type: NotificationType.Success});
        } catch (e) {
            appContext.notifications.show({content: <ErrorNotification title='Unable to save ignored fields' e={e} />, type: NotificationType.Error});
        } finally {
            setSaving(false);
        }
    };

    // lines highlighted in the diff for the active resource: fields covered by any current rule
    const highlight = useMemo(() => {
        if (!activeResource) {
            return {original: [] as number[], modified: [] as number[]};
        }
        const matching = rules.filter(rule => ruleMatchesResource(rule, activeResource.state));
        const covered = new Set(
            activeResource.changed
                .filter(path => matching.some(rule => (rule.jsonPointers || []).some(p => path.pointer === p || path.pointer.startsWith(p + '/'))))
                .map(p => p.pointer)
        );
        // also highlight pointers explicitly listed in the active rule even when not changed
        (activeRule && ruleMatchesResource(activeRule, activeResource.state) ? activeRule.jsonPointers || [] : []).forEach(p => covered.add(p));
        const linesFor = (map: Map<number, string>) =>
            Array.from(map.entries())
                .filter(([, pointer]) => covered.has(pointer))
                .map(([line]) => line);
        return {original: linesFor(activeResource.liveLines), modified: linesFor(activeResource.predictedLines)};
    }, [activeResource, rules, activeRule]);

    const onLineClick = (side: 'original' | 'modified', line: number) => {
        if (!activeResource) {
            return;
        }
        const pointer = side === 'original' ? activeResource.liveLines.get(line) : activeResource.predictedLines.get(line);
        if (pointer) {
            onFieldClick(activeResource, pointer);
        }
    };

    // modified-side line of the first changed field, so the diff opens scrolled to the action
    const firstChangedLine = useMemo(() => {
        if (!activeResource || activeResource.changed.length === 0) {
            return undefined;
        }
        const changedPointers = new Set(activeResource.changed.map(p => p.pointer));
        const lines = Array.from(activeResource.predictedLines.entries())
            .filter(([, pointer]) => changedPointers.has(pointer))
            .map(([line]) => line);
        return lines.length > 0 ? Math.min(...lines) : undefined;
    }, [activeResource]);

    if (resources.length === 0) {
        return (
            <div className='white-box' style={{margin: '1em'}}>
                <p>No managed resources with a comparable state found.</p>
            </div>
        );
    }

    const coveredFor = (resource: ResourceEntry) => countCoveredFields(rules, resource.state, resource.changed);

    const listName = (list: 'jsonPointers' | 'jqPathExpressions' | 'managedFieldsManagers') => list;

    return (
        <div className='application-ignore-rules'>
            <div className='application-ignore-rules__topbar'>
                <div>
                    <h4 style={{margin: 0}}>Edit ignored fields</h4>
                    <span className='application-ignore-rules__hint'>Create and preview application-level rules before saving.</span>
                </div>
                <span style={{flex: 1}} />
                <button className='argo-button argo-button--base' disabled={saving || !dirty || invalidRules.length > 0} onClick={save}>
                    Save
                </button>
            </div>
            <div className='application-ignore-rules__columns'>
                {/* left: rule list */}
                <div className='application-ignore-rules__rules'>
                    <div className='application-ignore-rules__rules-header'>
                        <span>RULES ({rules.length})</span>
                        <button className='argo-button argo-button--base-o' onClick={() => addRule()}>
                            + Add rule
                        </button>
                    </div>
                    {rules.map((rule, index) => (
                        <div
                            key={index}
                            className={'application-ignore-rules__rule-card' + (index === activeRuleIndex ? ' application-ignore-rules__rule-card--active' : '')}
                            onClick={() => setActiveRuleIndex(index === activeRuleIndex ? null : index)}>
                            <div className='application-ignore-rules__rule-card-title'>
                                <span>Rule {index + 1}</span>
                                <span className={'application-ignore-rules__rule-state' + (rule.saved ? '' : ' application-ignore-rules__rule-state--dirty')}>
                                    {index === activeRuleIndex ? 'ACTIVE' : rule.saved ? 'SAVED' : 'UNSAVED'}
                                </span>
                            </div>
                            <div className='application-ignore-rules__rule-card-meta'>
                                {rule.group || ''}/{rule.kind || '?'}
                                {rule.name ? `/${rule.name}` : ''} ·{' '}
                                {(rule.jsonPointers || []).length + (rule.jqPathExpressions || []).length + (rule.managedFieldsManagers || []).length} item(s)
                            </div>
                        </div>
                    ))}
                    {activeRule && (
                        <div className='application-ignore-rules__rule-editor white-box'>
                            <div className='application-ignore-rules__rule-editor-title'>
                                <span>Rule {activeRuleIndex + 1} · Active rule</span>
                                <button className='argo-button argo-button--base-o' onClick={() => removeRule(activeRuleIndex)}>
                                    Remove
                                </button>
                            </div>
                            <label>Group</label>
                            <input
                                className='argo-field'
                                placeholder='e.g. apps or empty for core'
                                value={activeRule.group || ''}
                                onChange={e => updateActiveRule({group: e.target.value})}
                            />
                            <label>Kind</label>
                            <input className='argo-field' value={activeRule.kind || ''} onChange={e => updateActiveRule({kind: e.target.value})} />
                            <label>Name (empty matches all)</label>
                            <input className='argo-field' value={activeRule.name || ''} onChange={e => updateActiveRule({name: e.target.value})} />
                            <label>Namespace (empty matches all)</label>
                            <input className='argo-field' value={activeRule.namespace || ''} onChange={e => updateActiveRule({namespace: e.target.value})} />
                            {(['jsonPointers', 'jqPathExpressions', 'managedFieldsManagers'] as const).map(list => (
                                <div key={list}>
                                    <label>{listName(list)}</label>
                                    {(activeRule[list] || []).map((entry, i) => (
                                        <div key={i} className='application-ignore-rules__rule-entry'>
                                            <input
                                                className='argo-field'
                                                value={entry}
                                                onChange={e => {
                                                    const next = [...(activeRule[list] || [])];
                                                    next[i] = e.target.value;
                                                    updateActiveRule({[list]: next});
                                                }}
                                            />
                                            <a title='Remove entry' onClick={() => updateActiveRule({[list]: (activeRule[list] || []).filter((_, j) => j !== i)})}>
                                                <i className='fa fa-times' />
                                            </a>
                                        </div>
                                    ))}
                                    <a onClick={() => updateActiveRule({[list]: [...(activeRule[list] || []), '']})}>
                                        <i className='fa fa-plus-circle' /> add
                                    </a>
                                </div>
                            ))}
                            {!activeRule.kind.trim() && <p style={{color: 'red'}}>Kind is required.</p>}
                        </div>
                    )}
                </div>
                {/* right: impact + resource list + diff */}
                <div className='application-ignore-rules__main'>
                    <div className='application-ignore-rules__impact'>
                        <span>
                            OutOfSync impact: <strong>{impact.differing} resource(s) currently differ</strong> → <strong>{impact.remaining} would still differ</strong> after these
                            rules
                        </span>
                        <span style={{flex: 1}} />
                        <input className='argo-field' style={{maxWidth: '16em'}} placeholder='Search resource...' value={search} onChange={e => setSearch(e.target.value)} />
                        <label className='application-ignore-rules__hint' style={{whiteSpace: 'nowrap'}}>
                            <input type='checkbox' checked={onlyOutOfSync} onChange={() => setOnlyOutOfSync(!onlyOutOfSync)} /> only with differences
                        </label>
                    </div>
                    <div className='application-ignore-rules__resource-list'>
                        {visibleResources.map(resource => {
                            const covered = coveredFor(resource);
                            const stillDiffers = resource.changed.length > covered;
                            return (
                                <div
                                    key={resource.key}
                                    className={
                                        'application-ignore-rules__resource-row' +
                                        (activeResource && resource.key === activeResource.key ? ' application-ignore-rules__resource-row--active' : '')
                                    }
                                    onClick={() => setActiveResourceKey(resource.key)}>
                                    <div>
                                        <div className='application-ignore-rules__resource-name'>{resource.label}</div>
                                        <div className='application-ignore-rules__hint'>
                                            {resource.changed.length} current difference(s) · {covered} covered
                                        </div>
                                    </div>
                                    <span style={{flex: 1}} />
                                    {resource.changed.length > 0 && (
                                        <span className={'application-ignore-rules__impact-badge' + (stillDiffers ? '' : ' application-ignore-rules__impact-badge--resolved')}>
                                            OutOfSync → {stillDiffers ? 'OutOfSync' : 'Synced'}
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    {activeResource && (
                        <React.Fragment>
                            <div className='application-ignore-rules__diff-header'>
                                <span className='application-ignore-rules__diff-title'>
                                    {activeResource.state.kind} / {activeResource.state.name}
                                </span>
                                <span className='application-ignore-rules__hint'>Namespace: {activeResource.state.namespace || '-'}</span>
                                <span className='application-ignore-rules__hint'>Click a changed field's line number to add it to a rule.</span>
                                <span style={{flex: 1}} />
                                <button className='argo-button argo-button--base-o' onClick={selectSuggested}>
                                    Ignore suggested
                                </button>
                            </div>
                            {activeResource.changed.length === 0 && (
                                <div className='application-ignore-rules__hint' style={{padding: '0.4em 0'}}>
                                    No differences for this resource. Ignored fields stay highlighted for review.
                                </div>
                            )}
                            {activeResource.changed.length > 0 && coveredFor(activeResource) >= activeResource.changed.length && (
                                <div className='application-ignore-rules__hint' style={{padding: '0.4em 0'}}>
                                    No remaining differences with the proposed rules. Ignored fields stay highlighted for review.
                                </div>
                            )}
                            <div className='application-ignore-rules__diff'>
                                <MonacoDiffEditor
                                    original={activeResource.live}
                                    modified={activeResource.predicted}
                                    language='yaml'
                                    height='100%'
                                    selectedLines={highlight}
                                    onLineClick={onLineClick}
                                    revealModifiedLine={firstChangedLine}
                                />
                            </div>
                        </React.Fragment>
                    )}
                </div>
            </div>
        </div>
    );
};
