import * as jsYaml from 'js-yaml';
import * as React from 'react';
import {useContext, useMemo, useState} from 'react';
import {ErrorNotification, NotificationType, SlidingPanel} from 'argo-ui';
import * as models from '../../../shared/models';
import {Context} from '../../../shared/context';
import {services} from '../../../shared/services';
import {
    buildIgnoreDifferenceForFields,
    getChangedPaths,
    isValidPointer,
    mergeIgnoreDifferences,
    pointerToJQPath,
    resolvePointer,
    ChangedPath,
    IgnoreRuleType,
    SelectedField
} from './ignore-differences';

import './application-resources-diff.scss';

// key of one selectable field: `${group}/${kind}/${namespace}/${name}|${pointer}`
export type FieldKey = string;

export const resourceKey = (state: {group?: string; kind: string; namespace?: string; name: string}) => `${state.group || ''}/${state.kind}/${state.namespace || ''}/${state.name}`;

export const fieldKey = (state: {group?: string; kind: string; namespace?: string; name: string}, pointer: string): FieldKey => `${resourceKey(state)}|${pointer}`;

export interface IgnoreDifferencesEditorProps {
    application: models.Application;
    states: models.ResourceDiff[];
    // selection lifted to the parent so fields can also be picked from a diff view
    selection: Map<FieldKey, SelectedField>;
    onSelectionChange: (selection: Map<FieldKey, SelectedField>) => void;
    // called after a successful save
    onSaved?: () => void;
    // renders the editor around a save/cancel header (used by the sliding panel variant);
    // when omitted the editor renders its own inline save button
    renderHeader?: (header: React.ReactNode) => void;
    // limit the field list to these resources (keys from resourceKey()); undefined shows all
    visibleResources?: Set<string>;
}

interface ResourceGroup {
    state: models.ResourceDiff;
    key: string;
    label: string;
    paths: ChangedPath[];
}

// suggests a managedFields manager name from the live state when the user switches a field to managedFieldsManagers
function suggestManager(state: models.ResourceDiff): string {
    const managedFields = resolvePointer(state.normalizedLiveState, '/metadata/managedFields');
    if (Array.isArray(managedFields) && managedFields.length > 0) {
        const manager = (managedFields[managedFields.length - 1] as {manager?: string}).manager;
        return manager || '';
    }
    return '';
}

// hook holding all editor state and derived data, shared by the tab view and the sliding panel
export function useIgnoreDifferencesEditor(props: IgnoreDifferencesEditorProps) {
    const {application, states, selection, onSelectionChange, onSaved} = props;
    const appContext = useContext(Context);
    const [customPointers, setCustomPointers] = useState<Map<string, string>>(new Map());
    const [customInputFor, setCustomInputFor] = useState<string>('');
    // existing rules are editable locally and written back on save
    const [existingRules, setExistingRules] = useState<models.ResourceIgnoreDifferences[] | null>(null);
    const [saving, setSaving] = useState(false);

    const effectiveExistingRules = existingRules !== null ? existingRules : application.spec.ignoreDifferences || [];

    const groups: ResourceGroup[] = useMemo(
        () =>
            states
                .filter(state => !state.hook)
                .map(state => ({
                    state,
                    key: resourceKey(state),
                    label: `${state.kind}/${state.name}${state.namespace ? ' (' + state.namespace + ')' : ''}`,
                    paths: getChangedPaths(state)
                }))
                .filter(group => group.paths.length > 0),
        [states]
    );

    const setField = (key: FieldKey, field: SelectedField | null) => {
        const next = new Map(selection);
        if (field) {
            next.set(key, field);
        } else {
            next.delete(key);
        }
        onSelectionChange(next);
    };

    const selectSuggested = () => {
        const next = new Map(selection);
        groups.forEach(group =>
            group.paths
                .filter(p => p.suggested)
                .forEach(p => {
                    const key = fieldKey(group.state, p.pointer);
                    if (!next.has(key)) {
                        next.set(key, {pointer: p.pointer, ruleType: 'jsonPointers'});
                    }
                })
        );
        onSelectionChange(next);
    };

    const buildRules = (): models.ResourceIgnoreDifferences[] => {
        let rules = [...effectiveExistingRules];
        groups.forEach(group => {
            const fields: SelectedField[] = group.paths.map(p => selection.get(fieldKey(group.state, p.pointer))).filter((f): f is SelectedField => !!f);
            const custom = (customPointers.get(group.key) || '')
                .split('\n')
                .map(v => v.trim())
                .filter(v => v !== '')
                .map((pointer): SelectedField => ({pointer, ruleType: 'jsonPointers'}));
            const all = [...fields, ...custom];
            if (all.length > 0) {
                rules = mergeIgnoreDifferences(rules, buildIgnoreDifferenceForFields(group.state, all));
            }
        });
        return rules;
    };

    const customCount = Array.from(customPointers.values())
        .flatMap(v => v.split('\n'))
        .filter(v => v.trim() !== '').length;
    const selectedCount = selection.size + customCount;
    const invalidCustom = Array.from(customPointers.values())
        .flatMap(v => v.split('\n'))
        .map(v => v.trim())
        .filter(v => v !== '' && !isValidPointer(v));
    const missingManager = Array.from(selection.values()).some(f => f.ruleType === 'managedFieldsManagers' && !(f.manager || '').trim());
    const existingChanged = existingRules !== null;

    const preview = useMemo(() => {
        if (selectedCount === 0 && !existingChanged) {
            return '';
        }
        try {
            return jsYaml.dump({ignoreDifferences: buildRules()}, {indent: 2});
        } catch {
            return '';
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selection, customPointers, groups, application, existingRules]);

    const save = async () => {
        setSaving(true);
        try {
            const spec = JSON.parse(JSON.stringify(application.spec)) as models.ApplicationSpec;
            spec.ignoreDifferences = buildRules();
            await services.applications.updateSpec(application.metadata.name, application.metadata.namespace, spec);
            appContext.notifications.show({
                content: 'Saved ignore differences rules. Refresh the application to recalculate the diff.',
                type: NotificationType.Success
            });
            onSelectionChange(new Map());
            setCustomPointers(new Map());
            setExistingRules(null);
            if (onSaved) {
                onSaved();
            }
        } catch (e) {
            appContext.notifications.show({
                content: <ErrorNotification title='Unable to save ignore differences' e={e} />,
                type: NotificationType.Error
            });
        } finally {
            setSaving(false);
        }
    };

    const removeExistingRule = (index: number) => {
        const next = [...effectiveExistingRules];
        next.splice(index, 1);
        setExistingRules(next);
    };

    const removeExistingEntry = (index: number, list: 'jsonPointers' | 'jqPathExpressions' | 'managedFieldsManagers', entry: string) => {
        const next = effectiveExistingRules.map((rule, i) => {
            if (i !== index) {
                return rule;
            }
            const updated = {...rule, [list]: (rule[list] || []).filter(v => v !== entry)};
            if ((updated[list] || []).length === 0) {
                delete updated[list];
            }
            return updated;
        });
        // drop rules that no longer ignore anything
        setExistingRules(next.filter(rule => (rule.jsonPointers || []).length > 0 || (rule.jqPathExpressions || []).length > 0 || (rule.managedFieldsManagers || []).length > 0));
    };

    const canSave = !saving && (selectedCount > 0 || existingChanged) && invalidCustom.length === 0 && !missingManager;

    return {
        groups,
        setField,
        selectSuggested,
        selectedCount,
        invalidCustom,
        missingManager,
        existingChanged,
        effectiveExistingRules,
        removeExistingRule,
        removeExistingEntry,
        resetExisting: () => setExistingRules(null),
        customPointers,
        setCustomPointers,
        customInputFor,
        setCustomInputFor,
        preview,
        save,
        saving,
        canSave
    };
}

export type IgnoreDifferencesEditorState = ReturnType<typeof useIgnoreDifferencesEditor>;

// The editor body: field selection with rule types, existing rules management and spec preview.
export const IgnoreDifferencesEditor = (props: IgnoreDifferencesEditorProps & {editor: IgnoreDifferencesEditorState; hideFieldList?: boolean}) => {
    const {selection, editor} = props;
    const {
        groups,
        setField,
        invalidCustom,
        missingManager,
        effectiveExistingRules,
        removeExistingRule,
        removeExistingEntry,
        existingChanged,
        resetExisting,
        customPointers,
        setCustomPointers,
        customInputFor,
        setCustomInputFor,
        preview
    } = editor;
    const visibleGroups = props.visibleResources ? groups.filter(g => props.visibleResources.has(g.key)) : groups;
    return (
        <div className='application-resources-diff__ignore-editor'>
            {!props.hideFieldList && visibleGroups.length === 0 && <p>No field-level differences detected.</p>}
            {!props.hideFieldList &&
                visibleGroups.map(group => (
                    <div key={group.key} className='white-box' style={{marginTop: '1em'}}>
                        <p style={{fontWeight: 'bold'}}>{group.label}</p>
                        {group.paths.map(path => {
                            const key = fieldKey(group.state, path.pointer);
                            const field = selection.get(key);
                            const liveValue = resolvePointer(group.state.normalizedLiveState, path.pointer);
                            return (
                                <div key={key} className='application-resources-diff__ignore-editor__field'>
                                    <label>
                                        <input type='checkbox' checked={!!field} onChange={() => setField(key, field ? null : {pointer: path.pointer, ruleType: 'jsonPointers'})} />{' '}
                                        <code>{path.pointer}</code>
                                        {path.suggested && <span title='Commonly controller-managed field'> ★</span>}
                                        {liveValue !== undefined && <span style={{opacity: 0.7}}> (live: {JSON.stringify(liveValue)})</span>}
                                    </label>
                                    {field && (
                                        <span className='application-resources-diff__ignore-editor__rule-type'>
                                            <select
                                                className='argo-field'
                                                value={field.ruleType}
                                                onChange={e => {
                                                    const ruleType = e.target.value as IgnoreRuleType;
                                                    setField(key, {
                                                        ...field,
                                                        ruleType,
                                                        manager: ruleType === 'managedFieldsManagers' ? field.manager || suggestManager(group.state) : field.manager,
                                                        jqExpression: ruleType === 'jqPathExpressions' ? field.jqExpression || pointerToJQPath(path.pointer) : field.jqExpression
                                                    });
                                                }}>
                                                <option value='jsonPointers'>JSON pointer</option>
                                                <option value='jqPathExpressions'>JQ expression</option>
                                                <option value='managedFieldsManagers'>Managed fields manager</option>
                                            </select>
                                            {field.ruleType === 'jqPathExpressions' && (
                                                <input
                                                    className='argo-field'
                                                    value={field.jqExpression || ''}
                                                    title='JQ path expression'
                                                    onChange={e => setField(key, {...field, jqExpression: e.target.value})}
                                                />
                                            )}
                                            {field.ruleType === 'managedFieldsManagers' && (
                                                <input
                                                    className='argo-field'
                                                    value={field.manager || ''}
                                                    placeholder='manager name, e.g. kube-controller-manager'
                                                    title='Field manager whose managed fields should be ignored'
                                                    onChange={e => setField(key, {...field, manager: e.target.value})}
                                                />
                                            )}
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                        {customInputFor === group.key ? (
                            <textarea
                                className='argo-field'
                                placeholder='/spec/some/path (one JSON pointer per line)'
                                value={customPointers.get(group.key) || ''}
                                onChange={e => setCustomPointers(new Map(customPointers).set(group.key, e.target.value))}
                            />
                        ) : (
                            <a onClick={() => setCustomInputFor(group.key)}>+ add custom JSON pointer</a>
                        )}
                    </div>
                ))}
            {invalidCustom.length > 0 && (
                <p style={{color: 'red'}}>
                    Invalid JSON pointer(s): {invalidCustom.join(', ')}. Pointers must start with <code>/</code>.
                </p>
            )}
            {missingManager && <p style={{color: 'red'}}>Each managed fields manager rule needs a manager name.</p>}
            <div className='white-box' style={{marginTop: '1em'}}>
                <p style={{fontWeight: 'bold'}}>Existing rules</p>
                {effectiveExistingRules.length === 0 && <p>This application has no ignore differences rules yet.</p>}
                {effectiveExistingRules.map((rule, index) => (
                    <div key={index} className='application-resources-diff__ignore-editor__existing-rule'>
                        <div>
                            <code>
                                {rule.group || '""'}/{rule.kind}
                                {rule.namespace ? `/${rule.namespace}` : ''}
                                {rule.name ? `/${rule.name}` : ''}
                            </code>{' '}
                            <a title='Remove this rule' onClick={() => removeExistingRule(index)}>
                                <i className='fa fa-times' /> remove rule
                            </a>
                        </div>
                        <ul>
                            {(['jsonPointers', 'jqPathExpressions', 'managedFieldsManagers'] as const).flatMap(list =>
                                (rule[list] || []).map(entry => (
                                    <li key={`${list}:${entry}`}>
                                        <code>{entry}</code> <span style={{opacity: 0.7}}>({list})</span>{' '}
                                        <a title='Remove this entry' onClick={() => removeExistingEntry(index, list, entry)}>
                                            <i className='fa fa-times' />
                                        </a>
                                    </li>
                                ))
                            )}
                        </ul>
                    </div>
                ))}
                {existingChanged && <a onClick={resetExisting}>reset existing rule changes</a>}
            </div>
            {preview && (
                <div className='white-box' style={{marginTop: '1em'}}>
                    <p style={{fontWeight: 'bold'}}>Application spec preview</p>
                    <pre>{preview}</pre>
                </div>
            )}
        </div>
    );
};

export interface IgnoreDifferencesPanelProps {
    application: models.Application;
    states: models.ResourceDiff[];
    shown: boolean;
    onClose: (saved: boolean) => void;
    selection: Map<FieldKey, SelectedField>;
    onSelectionChange: (selection: Map<FieldKey, SelectedField>) => void;
}

// SlidingPanel wrapper used from the DIFF tab.
export const IgnoreDifferencesPanel = (props: IgnoreDifferencesPanelProps) => {
    const {application, states, shown, onClose, selection, onSelectionChange} = props;
    const editorProps: IgnoreDifferencesEditorProps = {
        application,
        states,
        selection,
        onSelectionChange,
        onSaved: () => onClose(true)
    };
    const editor = useIgnoreDifferencesEditor(editorProps);
    return (
        <SlidingPanel
            isShown={shown}
            onClose={() => onClose(false)}
            header={
                <div>
                    <button className='argo-button argo-button--base' disabled={!editor.canSave} onClick={editor.save}>
                        Save ignore differences
                    </button>{' '}
                    <button className='argo-button argo-button--base-o' onClick={() => onClose(false)}>
                        Cancel
                    </button>
                </div>
            }>
            <div>
                <h4>Ignore differences</h4>
                <p>
                    Select changed fields (here or directly in the diff gutter), pick a rule type per field, and save them to <code>spec.ignoreDifferences</code> of this
                    Application. Saved rules take effect after the diff is recalculated on the next refresh.
                </p>
                <button className='argo-button argo-button--base-o' onClick={editor.selectSuggested}>
                    Select suggested fields
                </button>
                <IgnoreDifferencesEditor {...editorProps} editor={editor} />
            </div>
        </SlidingPanel>
    );
};
