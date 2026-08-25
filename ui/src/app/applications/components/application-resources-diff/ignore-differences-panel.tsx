import * as jsYaml from 'js-yaml';
import * as React from 'react';
import {useContext, useMemo, useState} from 'react';
import {ErrorNotification, NotificationType, SlidingPanel} from 'argo-ui';
import * as models from '../../../shared/models';
import {Context} from '../../../shared/context';
import {services} from '../../../shared/services';
import {buildIgnoreDifference, getChangedPaths, isValidPointer, mergeIgnoreDifferences, resolvePointer, ChangedPath} from './ignore-differences';

import './application-resources-diff.scss';

export interface IgnoreDifferencesPanelProps {
    application: models.Application;
    states: models.ResourceDiff[];
    shown: boolean;
    onClose: (saved: boolean) => void;
}

interface ResourceGroup {
    state: models.ResourceDiff;
    label: string;
    paths: ChangedPath[];
}

const pathKey = (state: models.ResourceDiff, pointer: string) => `${state.group || ''}/${state.kind}/${state.namespace || ''}/${state.name}|${pointer}`;

// Panel that lets the user pick changed fields from the current diff and save them as
// Application.spec.ignoreDifferences rules (issue #29330).
export const IgnoreDifferencesPanel = (props: IgnoreDifferencesPanelProps) => {
    const {application, states, shown, onClose} = props;
    const appContext = useContext(Context);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [customPointers, setCustomPointers] = useState<Map<string, string>>(new Map());
    const [customInput, setCustomInput] = useState<{resource: string; value: string}>({resource: '', value: ''});
    const [saving, setSaving] = useState(false);

    const groups: ResourceGroup[] = useMemo(
        () =>
            states
                .filter(state => !state.hook)
                .map(state => ({
                    state,
                    label: `${state.kind}/${state.name}${state.namespace ? ' (' + state.namespace + ')' : ''}`,
                    paths: getChangedPaths(state)
                }))
                .filter(group => group.paths.length > 0),
        [states]
    );

    const toggle = (key: string) => {
        const next = new Set(selected);
        if (next.has(key)) {
            next.delete(key);
        } else {
            next.add(key);
        }
        setSelected(next);
    };

    const selectSuggested = () => {
        const next = new Set(selected);
        groups.forEach(group => group.paths.filter(p => p.suggested).forEach(p => next.add(pathKey(group.state, p.pointer))));
        setSelected(next);
    };

    const buildRules = (): models.ResourceIgnoreDifferences[] => {
        let rules = application.spec.ignoreDifferences || [];
        groups.forEach(group => {
            const pointers = group.paths.map(p => p.pointer).filter(pointer => selected.has(pathKey(group.state, pointer)));
            const groupId = `${group.state.group || ''}/${group.state.kind}/${group.state.namespace || ''}/${group.state.name}`;
            const custom = (customPointers.get(groupId) || '')
                .split('\n')
                .map(v => v.trim())
                .filter(v => v !== '');
            const all = [...pointers, ...custom];
            if (all.length > 0) {
                rules = mergeIgnoreDifferences(rules, buildIgnoreDifference(group.state, all));
            }
        });
        return rules;
    };

    const selectedCount = selected.size + Array.from(customPointers.values()).filter(v => v.trim() !== '').length;
    const invalidCustom = Array.from(customPointers.values())
        .flatMap(v => v.split('\n'))
        .map(v => v.trim())
        .filter(v => v !== '' && !isValidPointer(v));

    const preview = useMemo(() => {
        if (selectedCount === 0) {
            return '';
        }
        try {
            return jsYaml.dump({ignoreDifferences: buildRules()}, {indent: 2});
        } catch {
            return '';
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selected, customPointers, groups, application]);

    const save = async () => {
        setSaving(true);
        try {
            const spec = JSON.parse(JSON.stringify(application.spec)) as models.ApplicationSpec;
            spec.ignoreDifferences = buildRules();
            await services.applications.updateSpec(application.metadata.name, application.metadata.namespace, spec);
            appContext.notifications.show({
                content: `Saved ${selectedCount} ignore differences rule field(s). Refresh the application to recalculate the diff.`,
                type: NotificationType.Success
            });
            setSelected(new Set());
            setCustomPointers(new Map());
            onClose(true);
        } catch (e) {
            appContext.notifications.show({
                content: <ErrorNotification title='Unable to save ignore differences' e={e} />,
                type: NotificationType.Error
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <SlidingPanel
            isShown={shown}
            onClose={() => onClose(false)}
            header={
                <div>
                    <button className='argo-button argo-button--base' disabled={saving || selectedCount === 0 || invalidCustom.length > 0} onClick={save}>
                        Save ignore differences
                    </button>{' '}
                    <button className='argo-button argo-button--base-o' onClick={() => onClose(false)}>
                        Cancel
                    </button>
                </div>
            }>
            <div className='application-resources-diff__ignore-editor'>
                <h4>Ignore differences</h4>
                <p>
                    Select the changed fields to add to <code>spec.ignoreDifferences</code> of this Application. Saved rules take effect after the diff is recalculated on the next
                    refresh.
                </p>
                <button className='argo-button argo-button--base-o' onClick={selectSuggested}>
                    Select suggested fields
                </button>
                {groups.length === 0 && <p>No field-level differences detected.</p>}
                {groups.map(group => {
                    const groupId = `${group.state.group || ''}/${group.state.kind}/${group.state.namespace || ''}/${group.state.name}`;
                    return (
                        <div key={groupId} className='white-box' style={{marginTop: '1em'}}>
                            <p style={{fontWeight: 'bold'}}>{group.label}</p>
                            {group.paths.map(path => {
                                const key = pathKey(group.state, path.pointer);
                                const liveValue = resolvePointer(group.state.normalizedLiveState, path.pointer);
                                return (
                                    <div key={key} style={{marginBottom: '0.25em'}}>
                                        <label>
                                            <input type='checkbox' checked={selected.has(key)} onChange={() => toggle(key)} /> <code>{path.pointer}</code>
                                            {path.suggested && <span title='Commonly controller-managed field'> ★</span>}
                                            {liveValue !== undefined && <span style={{opacity: 0.7}}> (live: {JSON.stringify(liveValue)})</span>}
                                        </label>
                                    </div>
                                );
                            })}
                            {customInput.resource === groupId ? (
                                <textarea
                                    className='argo-field'
                                    placeholder='/spec/some/path (one JSON pointer per line)'
                                    value={customPointers.get(groupId) || ''}
                                    onChange={e => setCustomPointers(new Map(customPointers).set(groupId, e.target.value))}
                                />
                            ) : (
                                <a onClick={() => setCustomInput({resource: groupId, value: ''})}>+ add custom JSON pointer</a>
                            )}
                        </div>
                    );
                })}
                {invalidCustom.length > 0 && (
                    <p style={{color: 'red'}}>
                        Invalid JSON pointer(s): {invalidCustom.join(', ')}. Pointers must start with <code>/</code>.
                    </p>
                )}
                {preview && (
                    <div className='white-box' style={{marginTop: '1em'}}>
                        <p style={{fontWeight: 'bold'}}>Application spec preview</p>
                        <pre>{preview}</pre>
                    </div>
                )}
            </div>
        </SlidingPanel>
    );
};
