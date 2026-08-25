import * as React from 'react';
import {useState} from 'react';
import {Diff, Hunk, tokenize, markEdits} from 'react-diff-view';
import 'react-diff-view/style/index.css';

import './application-resources-diff.scss';

export interface DiffFieldSelection {
    isSelected: (pointer: string) => boolean;
    toggle: (pointer: string) => void;
    pointerForLine: (side: 'old' | 'new', line: number) => string | undefined;
}

export interface IndividualDiffSectionProps {
    file: any;
    showPath: boolean;
    whiteBox: string;
    viewType: string;
    // when set, changed lines get a gutter checkbox to select the field for an ignoreDifferences rule
    selectable?: DiffFieldSelection;
}

export const IndividualDiffSection = (props: IndividualDiffSectionProps) => {
    const {file, showPath, whiteBox, viewType, selectable} = props;
    const [collapsed, setCollapsed] = useState(false);
    const tokens = tokenize(file.hunks, {
        highlight: false,
        enhancers: [markEdits(file.hunks, {type: 'block'})]
    });

    const renderGutter = selectable
        ? (options: any) => {
              const {change, side, renderDefault} = options;
              // only changed lines are selectable; the pointer comes from the matching side's line map
              if (change.type === 'insert' || change.type === 'delete') {
                  const lineSide: 'old' | 'new' = change.type === 'delete' ? 'old' : 'new';
                  // in split view each change renders gutters on both sides; only annotate its own side
                  if ((side === 'old' && change.type === 'insert') || (side === 'new' && change.type === 'delete')) {
                      return renderDefault();
                  }
                  const pointer = selectable.pointerForLine(lineSide, change.lineNumber);
                  if (pointer) {
                      return (
                          <span className='application-resources-diff__gutter'>
                              <input type='checkbox' title={`Ignore ${pointer}`} checked={selectable.isSelected(pointer)} onChange={() => selectable.toggle(pointer)} />
                              {renderDefault()}
                          </span>
                      );
                  }
              }
              return renderDefault();
          }
        : undefined;

    return (
        <div className={`${whiteBox} application-component-diff__diff`}>
            {showPath && (
                <p className='application-resources-diff__diff__title'>
                    {file.newPath}
                    <i className={`fa fa-caret-${collapsed ? 'down' : 'up'} diff__collapse`} onClick={() => setCollapsed(!collapsed)} />
                </p>
            )}
            {!collapsed && (
                <Diff viewType={viewType} diffType={file.type} hunks={file.hunks} tokens={tokens} hunkClassName='custom-diff-hunk' renderGutter={renderGutter}>
                    {(hunks: any) => hunks.map((hunk: any) => <Hunk key={hunk.content} hunk={hunk} />)}
                </Diff>
            )}
        </div>
    );
};
