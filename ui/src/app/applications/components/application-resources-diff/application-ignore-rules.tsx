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
    state: models.ResourceDiff;
    live: string;
    predicted: string;
    liveLines: Map<number, string>;
    predictedLines: Map<number, string>;
    changedCount: number;
}

// Standalone "Ignore Rules" tab: pick fields from a Monaco diff of live vs predicted state
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
    const [activeKey, setActiveKey] = useState<string | null>(null);
    const active = items.find(i => i.key === activeKey) || items[0];

    const editorProps = {application, states: states || [], selection, onSelectionChange: setSelection};
    const editor = useIgnoreDifferencesEditor(editorProps);

    // lines to highlight for the active resource: any line whose pointer (or an ancestor field) is selected
    const selectedLines = useMemo(() => {
        if (!active) {
            return {original: [] as number[], modified: [] as number[]};
        }
        const selectedPointers = new Set(
            Array.from(selection.keys())
                .filter(k => k.startsWith(active.key + '|'))
                .map(k => k.slice(active.key.length + 1))
        );
        const linesFor = (map: Map<number, string>) =>
            Array.from(map.entries())
                .filter(([, pointer]) => selectedPointers.has(pointer))
                .map(([line]) => line);
        return {original: linesFor(active.liveLines), modified: linesFor(active.predictedLines)};
    }, [selection, active]);

    const onLineClick = (side: 'original' | 'modified', line: number) => {
        if (!active) {
            return;
        }
        const pointer = side === 'original' ? active.liveLines.get(line) : active.predictedLines.get(line);
        if (!pointer) {
            return;
        }
        const key = fieldKey(active.state, pointer);
        const next = new Map(selection);
        if (next.has(key)) {
            next.delete(key);
        } else {
            next.set(key, {pointer, ruleType: 'jsonPointers'});
        }
        setSelection(next);
    };

    if (items.length === 0) {
        return (
            <div className='white-box' style={{margin: '1em'}}>
                <p>No managed resources with a comparable state found.</p>
            </div>
        );
    }

    return (
        <div className='application-ignore-rules'>
            <div className='application-ignore-rules__toolbar'>
                <select className='argo-field' value={active.key} onChange={e => setActiveKey(e.target.value)}>
                    {items.map(item => (
                        <option key={item.key} value={item.key}>
                            {item.label}
                            {item.changedCount > 0 ? ` — ${item.changedCount} changed field(s)` : ' — no differences'}
                        </option>
                    ))}
                </select>
                <span className='application-ignore-rules__hint'>
                    <i className='fa fa-info-circle' /> Click a line number in the diff to toggle an ignore rule for that field. Live state (left) vs predicted state (right).
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
                <div className='application-ignore-rules__diff'>
                    <MonacoDiffEditor original={active.live} modified={active.predicted} language='yaml' height='100%' selectedLines={selectedLines} onLineClick={onLineClick} />
                </div>
                <div className='application-ignore-rules__editor'>
                    <IgnoreDifferencesEditor {...editorProps} editor={editor} />
                </div>
            </div>
        </div>
    );
};
