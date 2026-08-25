import {Checkbox, DataLoader} from 'argo-ui';
import * as jsYaml from 'js-yaml';
import * as React from 'react';
import {parseDiff} from 'react-diff-view';
import 'react-diff-view/style/index.css';
import {diffLines, formatLines} from 'unidiff';
import {Context} from '../../../shared/context';
import * as models from '../../../shared/models';
import {services} from '../../../shared/services';
import {buildLinePointerMap, SelectedField} from './ignore-differences';
import {fieldKey, FieldKey, IgnoreDifferencesPanel} from './ignore-differences-panel';
import {IndividualDiffSection} from './individual-diff-section';

import './application-resources-diff.scss';

export interface ApplicationResourcesDiffProps {
    states: models.ResourceDiff[];
    // when provided, enables the "Ignore differences" editor which saves rules to the application spec
    application?: models.Application;
}

export const ApplicationResourcesDiff = (props: ApplicationResourcesDiffProps) => {
    const appContext = React.useContext(Context);
    const [showIgnoreEditor, setShowIgnoreEditor] = React.useState(false);
    // fields picked either from the diff gutter or inside the editor panel
    const [selection, setSelection] = React.useState<Map<FieldKey, SelectedField>>(new Map());
    return (
        <DataLoader key='resource-diff' load={() => services.viewPreferences.getPreferences()}>
            {pref => {
                const items = props.states
                    .map(state => {
                        return {
                            a: state.normalizedLiveState ? jsYaml.dump(state.normalizedLiveState, {indent: 2}) : '',
                            b: state.predictedLiveState ? jsYaml.dump(state.predictedLiveState, {indent: 2}) : '',
                            hook: state.hook,
                            state,
                            // doubles as sort order
                            name: (state.group || '') + '/' + state.kind + '/' + (state.namespace ? state.namespace + '/' : '') + state.name
                        };
                    })
                    .filter(i => !i.hook)
                    .filter(i => i.a !== i.b);
                const diffText = items
                    .map(i => {
                        const context = pref.appDetails.compactDiff ? 2 : Number.MAX_SAFE_INTEGER;
                        // react-diff-view, awesome as it is, does not accept unidiff format, you must add a git header section
                        return `diff --git a/${i.name} b/${i.name}
index 6829b8a2..4c565f1b 100644
${formatLines(diffLines(i.a, i.b), {context, aname: `a/${name}}`, bname: `b/${i.name}`})}`;
                    })
                    .join('\n');
                // maps a diff file path back to its resource state and line->pointer maps for the gutter checkboxes
                const lineMapByPath = new Map<string, {state: models.ResourceDiff; oldLines: Map<number, string>; newLines: Map<number, string>}>();
                if (props.application) {
                    items.forEach(i =>
                        lineMapByPath.set(i.name, {
                            state: i.state,
                            oldLines: buildLinePointerMap(i.a),
                            newLines: buildLinePointerMap(i.b)
                        })
                    );
                }
                // assume that if you only have one file, we don't need the file path
                const whiteBox = props.states.length > 1 ? 'white-box' : '';
                const showPath = props.states.length > 1;
                const files = parseDiff(diffText);
                const viewType = pref.appDetails.inlineDiff ? 'unified' : 'split';
                const toggleField = (state: models.ResourceDiff, pointer: string) => {
                    const key = fieldKey(state, pointer);
                    const next = new Map(selection);
                    if (next.has(key)) {
                        next.delete(key);
                    } else {
                        next.set(key, {pointer, ruleType: 'jsonPointers'});
                    }
                    setSelection(next);
                };
                return (
                    <div className='application-resources-diff'>
                        <div className={whiteBox + ' application-resources-diff__checkboxes'}>
                            <Checkbox
                                id='compactDiff'
                                checked={pref.appDetails.compactDiff}
                                onChange={() =>
                                    services.viewPreferences.updatePreferences({
                                        appDetails: {
                                            ...pref.appDetails,
                                            compactDiff: !pref.appDetails.compactDiff
                                        }
                                    })
                                }
                            />
                            <label htmlFor='compactDiff'>Compact diff</label>
                            <Checkbox
                                id='inlineDiff'
                                checked={pref.appDetails.inlineDiff}
                                onChange={() =>
                                    services.viewPreferences.updatePreferences({
                                        appDetails: {
                                            ...pref.appDetails,
                                            inlineDiff: !pref.appDetails.inlineDiff
                                        }
                                    })
                                }
                            />
                            <label htmlFor='inlineDiff'>Inline diff</label>
                            {props.application && (
                                <React.Fragment>
                                    <button className='argo-button argo-button--base-o' onClick={() => setShowIgnoreEditor(true)}>
                                        <i className='fa fa-eye-slash' /> Ignore differences
                                        {selection.size > 0 && <span className='application-resources-diff__selection-count'>{selection.size}</span>}
                                    </button>
                                    <button
                                        className='argo-button argo-button--base-o'
                                        title='Open the Ignored Fields editor'
                                        onClick={() => appContext.navigation.goto('.', {tab: 'ignore-rules'}, {replace: true})}>
                                        <i className='fa fa-external-link-alt' /> Edit ignored fields
                                    </button>
                                </React.Fragment>
                            )}
                        </div>
                        {files
                            .sort((a: any, b: any) => a.newPath.localeCompare(b.newPath))
                            .map((file: any) => {
                                const lineMaps = lineMapByPath.get(file.newPath) || (lineMapByPath.size === 1 ? Array.from(lineMapByPath.values())[0] : undefined);
                                return (
                                    <IndividualDiffSection
                                        key={file.newPath}
                                        file={file}
                                        showPath={showPath}
                                        whiteBox={whiteBox}
                                        viewType={viewType}
                                        selectable={
                                            props.application &&
                                            lineMaps && {
                                                isSelected: (pointer: string) => selection.has(fieldKey(lineMaps.state, pointer)),
                                                toggle: (pointer: string) => toggleField(lineMaps.state, pointer),
                                                pointerForLine: (side: 'old' | 'new', line: number) => (side === 'old' ? lineMaps.oldLines.get(line) : lineMaps.newLines.get(line))
                                            }
                                        }
                                    />
                                );
                            })}
                        {props.application && (
                            <IgnoreDifferencesPanel
                                application={props.application}
                                states={props.states}
                                shown={showIgnoreEditor}
                                onClose={() => setShowIgnoreEditor(false)}
                                selection={selection}
                                onSelectionChange={setSelection}
                            />
                        )}
                    </div>
                );
            }}
        </DataLoader>
    );
};
