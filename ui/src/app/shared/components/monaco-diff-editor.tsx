import * as React from 'react';

import * as monacoEditor from 'monaco-editor';
import {services} from '../services';
import {getTheme, createSystemThemeListener} from '../utils';

export interface MonacoDiffProps {
    original: string;
    modified: string;
    language?: string;
    height?: number | string;
    options?: monacoEditor.editor.IDiffEditorConstructionOptions;
    // 1-based line numbers (in the given side's text) to decorate as selected
    selectedLines?: {original: number[]; modified: number[]};
    // fires when the user clicks a line's glyph margin / line number area
    onLineClick?: (side: 'original' | 'modified', line: number) => void;
    // scroll this modified-side line into view when the model content changes
    revealModifiedLine?: number;
}

const MonacoDiffEditorLazy = React.lazy(() =>
    import('monaco-editor').then(monaco => {
        const Component = (props: MonacoDiffProps) => {
            const containerRef = React.useRef<HTMLDivElement | null>(null);
            const editorRef = React.useRef<monacoEditor.editor.IStandaloneDiffEditor | null>(null);
            const decorationsRef = React.useRef<{original: string[]; modified: string[]}>({original: [], modified: []});
            const onLineClickRef = React.useRef(props.onLineClick);
            React.useEffect(() => {
                onLineClickRef.current = props.onLineClick;
            }, [props.onLineClick]);

            React.useEffect(() => {
                const subscription = services.viewPreferences.getPreferences().subscribe(preferences => {
                    monaco.editor.setTheme(getTheme(preferences.theme) === 'dark' ? 'vs-dark' : 'vs');
                });
                const destroySystemThemeListener = createSystemThemeListener(systemTheme => monaco.editor.setTheme(systemTheme === 'dark' ? 'vs-dark' : 'vs'));
                return () => {
                    subscription.unsubscribe();
                    destroySystemThemeListener();
                };
            }, []);

            // create the diff editor once
            React.useEffect(() => {
                if (!containerRef.current) {
                    return undefined;
                }
                const editor = monaco.editor.createDiffEditor(containerRef.current, {
                    readOnly: true,
                    renderSideBySide: true,
                    automaticLayout: true,
                    glyphMargin: true,
                    minimap: {enabled: false},
                    scrollBeyondLastLine: false,
                    scrollbar: {alwaysConsumeMouseWheel: false},
                    ...props.options
                });
                editorRef.current = editor;
                const listeners = [
                    editor.getOriginalEditor().onMouseDown(e => handleMouse('original', e)),
                    editor.getModifiedEditor().onMouseDown(e => handleMouse('modified', e))
                ];
                function handleMouse(side: 'original' | 'modified', e: monacoEditor.editor.IEditorMouseEvent) {
                    const t = e.target.type;
                    if (
                        (t === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
                            t === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS ||
                            t === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS) &&
                        e.target.position &&
                        onLineClickRef.current
                    ) {
                        onLineClickRef.current(side, e.target.position.lineNumber);
                    }
                }
                return () => {
                    listeners.forEach(l => l.dispose());
                    editor.dispose();
                    editorRef.current = null;
                };
                // eslint-disable-next-line react-hooks/exhaustive-deps
            }, []);

            // update models when content changes
            React.useEffect(() => {
                const editor = editorRef.current;
                if (!editor) {
                    return;
                }
                const current = editor.getModel();
                if (current && current.original && current.modified && current.original.getValue() === props.original && current.modified.getValue() === props.modified) {
                    return;
                }
                const original = monaco.editor.createModel(props.original, props.language || 'yaml');
                const modified = monaco.editor.createModel(props.modified, props.language || 'yaml');
                editor.setModel({original, modified});
                decorationsRef.current = {original: [], modified: []};
                if (props.revealModifiedLine) {
                    editor.getModifiedEditor().revealLineInCenter(props.revealModifiedLine);
                }
                if (current && current.original) {
                    current.original.dispose();
                }
                if (current && current.modified) {
                    current.modified.dispose();
                }
            }, [props.original, props.modified, props.language]);

            // apply selected-line decorations
            React.useEffect(() => {
                const editor = editorRef.current;
                if (!editor) {
                    return;
                }
                const apply = (side: 'original' | 'modified') => {
                    const sideEditor = side === 'original' ? editor.getOriginalEditor() : editor.getModifiedEditor();
                    const lines = (props.selectedLines && props.selectedLines[side]) || [];
                    decorationsRef.current[side] = sideEditor.deltaDecorations(
                        decorationsRef.current[side],
                        lines.map(line => ({
                            range: new monaco.Range(line, 1, line, 1),
                            options: {
                                isWholeLine: true,
                                className: 'monaco-diff-editor__selected-line',
                                glyphMarginClassName: 'monaco-diff-editor__selected-glyph fa fa-eye-slash'
                            }
                        }))
                    );
                };
                apply('original');
                apply('modified');
                // bring the most recently selected line into view
                const revealTarget =
                    props.selectedLines &&
                    (props.selectedLines.modified.length > 0
                        ? {side: 'modified', line: props.selectedLines.modified[props.selectedLines.modified.length - 1]}
                        : props.selectedLines.original.length > 0
                          ? {side: 'original', line: props.selectedLines.original[props.selectedLines.original.length - 1]}
                          : null);
                if (revealTarget) {
                    const sideEditor = revealTarget.side === 'original' ? editor.getOriginalEditor() : editor.getModifiedEditor();
                    sideEditor.revealLineInCenterIfOutsideViewport(revealTarget.line);
                }
            }, [props.selectedLines, props.original, props.modified]);

            return <div ref={containerRef} style={{height: props.height || '100%', width: '100%'}} />;
        };
        return {default: Component};
    })
);

export const MonacoDiffEditor = (props: MonacoDiffProps) => (
    <React.Suspense fallback={<div>Loading...</div>}>
        <MonacoDiffEditorLazy {...props} />
    </React.Suspense>
);
