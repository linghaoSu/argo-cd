import * as React from 'react';
import {useMemo, useState} from 'react';
import {Decoration, Diff, Hunk, getChangeKey, getCollapsedLinesCountBetween, expandFromRawCode, markEdits, parseDiff, tokenize} from 'react-diff-view';
import 'react-diff-view/style/index.css';
import {diffLines, formatLines} from 'unidiff';

import './application-resources-diff.scss';

export interface ExpandableDiffSelection {
    // pointer of the field on a given side/line, from the line->pointer maps
    pointerForLine: (side: 'old' | 'new', line: number) => string | undefined;
    // toggles the field in the active rule
    toggle: (pointer: string) => void;
    // true when the field is part of a proposed/saved rule (renders checked + highlighted)
    isSelected: (pointer: string) => boolean;
}

export interface ExpandableResourceDiffProps {
    // old side: normalized live state YAML
    live: string;
    // new side: predicted live state YAML
    predicted: string;
    // number of context lines around changes (Number.MAX_SAFE_INTEGER disables collapsing)
    context: number;
    viewType: 'unified' | 'split';
    selection?: ExpandableDiffSelection;
}

const EXPAND_STEP = 20;

// Plain react-diff-view diff (same renderer as the DIFF tab) with GitHub-style
// "expand up / all / down" controls between hunks and a selection gutter.
export const ExpandableResourceDiff = (props: ExpandableResourceDiffProps) => {
    const {live, predicted, context, viewType, selection} = props;

    const liveSource = useMemo(() => live.replace(/\n$/, '').split('\n'), [live]);

    const initialFile = useMemo(() => {
        const diffText = `diff --git a/resource b/resource
index 00000000..11111111 100644
${formatLines(diffLines(live, predicted), {context, aname: 'a/resource', bname: 'b/resource'})}`;
        const [file] = parseDiff(diffText, {nearbySequences: 'zip'});
        return file;
    }, [live, predicted, context]);

    // expanded hunks are kept per initialFile; when the underlying diff changes, reset lazily
    const [expandedState, setExpandedState] = useState<{source: any; hunks: any[]} | null>(null);
    const hunks = expandedState && expandedState.source === initialFile ? expandedState.hunks : initialFile ? initialFile.hunks : [];
    const setHunks = (next: any[]) => setExpandedState({source: initialFile, hunks: next});

    const tokens = useMemo(() => {
        try {
            return tokenize(hunks, {highlight: false, enhancers: [markEdits(hunks, {type: 'block'})]});
        } catch {
            return undefined;
        }
    }, [hunks]);

    // selected change keys drive react-diff-view's built-in selected line styling
    const selectedChangeKeys = useMemo(() => {
        if (!selection) {
            return [];
        }
        const keys: string[] = [];
        hunks.forEach((hunk: any) =>
            hunk.changes.forEach((change: any) => {
                const side: 'old' | 'new' = change.type === 'delete' ? 'old' : 'new';
                const line = change.type === 'delete' ? change.lineNumber : change.type === 'insert' ? change.lineNumber : change.newLineNumber;
                const pointer = change.type === 'normal' ? undefined : selection.pointerForLine(side, line);
                if (pointer && selection.isSelected(pointer)) {
                    keys.push(getChangeKey(change));
                }
            })
        );
        return keys;
    }, [hunks, selection]);

    const expand = (start: number, end: number) => setHunks(expandFromRawCode(hunks, liveSource, start, end));

    const renderGutter = selection
        ? (options: any) => {
              const {change, side, renderDefault} = options;
              if (change.type === 'insert' || change.type === 'delete') {
                  const lineSide: 'old' | 'new' = change.type === 'delete' ? 'old' : 'new';
                  if ((side === 'old' && change.type === 'insert') || (side === 'new' && change.type === 'delete')) {
                      return renderDefault();
                  }
                  const pointer = selection.pointerForLine(lineSide, change.lineNumber);
                  if (pointer) {
                      return (
                          <span className='application-resources-diff__gutter'>
                              <input type='checkbox' title={`Ignore ${pointer}`} checked={selection.isSelected(pointer)} onChange={() => selection.toggle(pointer)} />
                              {renderDefault()}
                          </span>
                      );
                  }
              }
              return renderDefault();
          }
        : undefined;

    if (!initialFile || hunks.length === 0) {
        return <p className='application-ignore-rules__hint'>The live and predicted states are identical.</p>;
    }

    // build children: an expander Decoration before every hunk (and a tail expander after the last)
    const children: React.ReactNode[] = [];
    let previousHunk: any = null;
    hunks.forEach((hunk: any, index: number) => {
        const collapsed = getCollapsedLinesCountBetween(previousHunk, hunk);
        if (collapsed > 0) {
            const start = previousHunk ? previousHunk.oldStart + previousHunk.oldLines : 1;
            const end = hunk.oldStart;
            children.push(
                <Decoration key={`expand-${index}`}>
                    <div className='application-ignore-rules__expander'>
                        {collapsed > EXPAND_STEP && (
                            <a onClick={() => expand(Math.max(start, end - EXPAND_STEP), end)}>
                                <i className='fa fa-angle-up' /> {EXPAND_STEP} lines
                            </a>
                        )}
                        <a onClick={() => expand(start, end)}>
                            <i className='fa fa-angle-double-up' />
                            <i className='fa fa-angle-double-down' /> all {collapsed} lines
                        </a>
                        {collapsed > EXPAND_STEP && (
                            <a onClick={() => expand(start, Math.min(end, start + EXPAND_STEP))}>
                                <i className='fa fa-angle-down' /> {EXPAND_STEP} lines
                            </a>
                        )}
                    </div>
                </Decoration>
            );
        }
        children.push(<Hunk key={`hunk-${hunk.content}-${index}`} hunk={hunk} />);
        previousHunk = hunk;
    });
    if (previousHunk) {
        const lastEnd = previousHunk.oldStart + previousHunk.oldLines;
        const tail = liveSource.length - lastEnd + 1;
        if (tail > 0) {
            children.push(
                <Decoration key='expand-tail'>
                    <div className='application-ignore-rules__expander'>
                        {tail > EXPAND_STEP && (
                            <a onClick={() => expand(lastEnd, lastEnd + EXPAND_STEP)}>
                                <i className='fa fa-angle-down' /> {EXPAND_STEP} lines
                            </a>
                        )}
                        <a onClick={() => expand(lastEnd, liveSource.length + 1)}>
                            <i className='fa fa-angle-double-down' /> all {tail} lines
                        </a>
                    </div>
                </Decoration>
            );
        }
    }

    return (
        <Diff
            viewType={viewType}
            diffType={initialFile.type}
            hunks={hunks}
            tokens={tokens}
            hunkClassName='custom-diff-hunk'
            renderGutter={renderGutter}
            selectedChanges={selectedChangeKeys}>
            {() => children}
        </Diff>
    );
};
