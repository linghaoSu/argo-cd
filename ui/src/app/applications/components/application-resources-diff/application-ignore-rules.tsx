import * as jsYaml from 'js-yaml';
import * as React from 'react';
import {useMemo, useState} from 'react';
import {DataLoader} from 'argo-ui';
import {MonacoDiffEditor} from '../../../shared/components/monaco-diff-editor';
import * as models from '../../../shared/models';
import {services} from '../../../shared/services';
import {buildLinePointerMap, getChangedPaths, SelectedField} from './ignore-differences';
import {fieldKey, resourceKey, FieldKey, IgnoreDifferencesEditor, useIgnoreDifferencesEditor} from './ignore-differences-panel';

import './application-resources-diff.scss';

export interface ApplicationIgnoreRulesViewProps {
    application: models.Application;
}

interface DiffItem {
    key: string;
    label: string;
    group: string;
    kind: string;
    state: models.ResourceDiff;
    live: string;
    predicted: string;
    liveLines: Map<number, string>;
    predictedLines: Map<number, string>;
    changedCount: number;
}

// how the list of shown diffs is scoped
type ViewMode = 'resource' | 'kind' | 'group' | 'all';

// Standalone "Ignore Rules" tab: pick fields from Monaco diffs of live vs predicted state
// and manage Application.spec.ignoreDifferences — available regardless of sync status (issue #29330).
export const ApplicationIgnoreRulesView = (props: ApplicationIgnoreRulesViewProps) => {
    const {application} = props;
    return (
        <DataLoader
            key='ignore-rules'
            load={() =>
                services.applications.managedResources(application.metadata.name, application.metadata.namespace, {
                    fields: ['items.normalizedLiveState', 'items.predictedLiveState', 'items.group', 'items.kind', 'items.namespace', 'items.name']
                })
            }>
            {states => <IgnoreRulesLayout application={application} states={states} />}
        </DataLoader>
    );
};

const IgnoreRulesLayout = ({application, states}: {application: models.Application; states: models.ResourceDiff[]}) => {
    const [selection, setSelection] = useState<Map<FieldKey, SelectedField>>(new Map());
    const items: DiffItem[] = useMemo(
        () =>
            (states || [])
                .filter(state => !state.hook && (state.normalizedLiveState || state.predictedLiveState))
                .map(state => {
                    const live = state.normalizedLiveState ? jsYaml.dump(state.normalizedLiveState, {indent: 2}) : '';
                    const predicted = state.predictedLiveState ? jsYaml.dump(state.predictedLiveState, {indent: 2}) : '';
                    return {
                        key: resourceKey(state),
                        label: `${state.kind}/${state.name}${state.namespace ? ' (' + state.namespace + ')' : ''}`,
                        group: state.group || '',
                        kind: state.kind,
                        state,
                        live,
                        predicted,
                        liveLines: buildLinePointerMap(live),
                        predictedLines: buildLinePointerMap(predicted),
                        changedCount: getChangedPaths(state).length
                    };
                })
                .sort((a, b) => b.changedCount - a.changedCount || a.key.localeCompare(b.key)),
        [states]
    );

    const [mode, setMode] = useState<ViewMode>('resource');
    const [scopeValue, setScopeValue] = useState<string | null>(null);
    // per-resource collapse state when several diffs are shown
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

    // available values for the current mode, with diff counts for the labels
    const scopeOptions = useMemo(() => {
        const counts = new Map<string, {label: string; changed: number; resources: number}>();
        items.forEach(item => {
            const value = mode === 'kind' ? item.kind : mode === 'group' ? item.group : item.key;
            const label = mode === 'kind' ? item.kind : mode === 'group' ? item.group || '(core)' : item.label;
            const entry = counts.get(value) || {label, changed: 0, resources: 0};
            entry.changed += item.changedCount;
            entry.resources++;
            counts.set(value, entry);
        });
        return Array.from(counts.entries()).map(([value, entry]) => ({value, ...entry}));
    }, [items, mode]);

    const effectiveScope = scopeOptions.some(o => o.value === scopeValue) ? scopeValue : scopeOptions.length > 0 ? scopeOptions[0].value : null;

    const visibleItems = useMemo(() => {
        if (mode === 'all') {
            return items;
        }
        if (effectiveScope === null) {
            return [];
        }
        return items.filter(item => (mode === 'kind' ? item.kind === effectiveScope : mode === 'group' ? item.group === effectiveScope : item.key === effectiveScope));
    }, [items, mode, effectiveScope]);

    const editorProps = {application, states: states || [], selection, onSelectionChange: setSelection, visibleResources: new Set(visibleItems.map(i => i.key))};
    const editor = useIgnoreDifferencesEditor(editorProps);

    // lines to highlight per resource: any line whose pointer is selected
    const selectedLinesFor = (item: DiffItem) => {
        const selectedPointers = new Set(
            Array.from(selection.keys())
                .filter(k => k.startsWith(item.key + '|'))
                .map(k => k.slice(item.key.length + 1))
        );
        const linesFor = (map: Map<number, string>) =>
            Array.from(map.entries())
                .filter(([, pointer]) => selectedPointers.has(pointer))
                .map(([line]) => line);
        return {original: linesFor(item.liveLines), modified: linesFor(item.predictedLines)};
    };

    const onLineClick = (item: DiffItem) => (side: 'original' | 'modified', line: number) => {
        const pointer = side === 'original' ? item.liveLines.get(line) : item.predictedLines.get(line);
        if (!pointer) {
            return;
        }
        const key = fieldKey(item.state, pointer);
        const next = new Map(selection);
        if (next.has(key)) {
            next.delete(key);
        } else {
            next.set(key, {pointer, ruleType: 'jsonPointers'});
        }
        setSelection(next);
    };

    const toggleCollapsed = (key: string) => {
        const next = new Set(collapsed);
        if (next.has(key)) {
            next.delete(key);
        } else {
            next.add(key);
        }
        setCollapsed(next);
    };

    if (items.length === 0) {
        return (
            <div className='white-box' style={{margin: '1em'}}>
                <p>No managed resources with a comparable state found.</p>
            </div>
        );
    }

    const selectionCountFor = (item: DiffItem) => Array.from(selection.keys()).filter(k => k.startsWith(item.key + '|')).length;

    return (
        <div className='application-ignore-rules'>
            <div className='application-ignore-rules__toolbar'>
                <div className='application-ignore-rules__modes'>
                    {(
                        [
                            {id: 'resource', label: 'Resource'},
                            {id: 'kind', label: 'Kind'},
                            {id: 'group', label: 'Group'},
                            {id: 'all', label: 'All'}
                        ] as {id: ViewMode; label: string}[]
                    ).map(option => (
                        <button
                            key={option.id}
                            className={'application-ignore-rules__mode' + (mode === option.id ? ' application-ignore-rules__mode--active' : '')}
                            title={`Show diffs by ${option.label.toLowerCase()}`}
                            onClick={() => {
                                setMode(option.id);
                                setScopeValue(null);
                            }}>
                            {option.label}
                        </button>
                    ))}
                </div>
                {mode !== 'all' && (
                    <select className='argo-field' value={effectiveScope || ''} onChange={e => setScopeValue(e.target.value)}>
                        {scopeOptions.map(option => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                                {mode !== 'resource' ? ` — ${option.resources} resource(s)` : ''}
                                {option.changed > 0 ? `, ${option.changed} changed field(s)` : ', no differences'}
                            </option>
                        ))}
                    </select>
                )}
                <span className='application-ignore-rules__hint'>
                    <i className='fa fa-info-circle' /> Click a line number to toggle an ignore rule for that field. Live (left) vs predicted (right).
                </span>
                <span style={{flex: 1}} />
                <button className='argo-button argo-button--base-o' onClick={editor.selectSuggested}>
                    Select suggested fields
                </button>
                <button className='argo-button argo-button--base' disabled={!editor.canSave} onClick={editor.save}>
                    Save ignore differences
                </button>
            </div>
            <div className='application-ignore-rules__content'>
                <div className='application-ignore-rules__diffs'>
                    {visibleItems.length === 0 && (
                        <div className='white-box'>
                            <p>No resources in this scope.</p>
                        </div>
                    )}
                    {visibleItems.map(item => {
                        const isCollapsed = visibleItems.length > 1 && collapsed.has(item.key);
                        const selectedCount = selectionCountFor(item);
                        return (
                            <div key={item.key} className='application-ignore-rules__diff-section'>
                                {(visibleItems.length > 1 || mode !== 'resource') && (
                                    <div className='application-ignore-rules__diff-header' onClick={() => toggleCollapsed(item.key)}>
                                        <i className={`fa fa-caret-${isCollapsed ? 'right' : 'down'}`} />
                                        <span className='application-ignore-rules__diff-title'>{item.label}</span>
                                        <span className='application-ignore-rules__diff-meta'>
                                            {item.changedCount > 0 ? `${item.changedCount} changed field(s)` : 'no differences'}
                                            {selectedCount > 0 ? ` · ${selectedCount} selected` : ''}
                                        </span>
                                    </div>
                                )}
                                {!isCollapsed && (
                                    <div className='application-ignore-rules__diff' style={{height: visibleItems.length > 1 ? 360 : 'calc(100vh - 320px)', minHeight: 320}}>
                                        <MonacoDiffEditor
                                            original={item.live}
                                            modified={item.predicted}
                                            language='yaml'
                                            height='100%'
                                            selectedLines={selectedLinesFor(item)}
                                            onLineClick={onLineClick(item)}
                                        />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
                <div className='application-ignore-rules__editor'>
                    <IgnoreDifferencesEditor {...editorProps} editor={editor} />
                </div>
            </div>
        </div>
    );
};
