/// <reference lib="es2022.intl" />
import stringWidth from 'string-width';
import stripVTControlCharacters from 'strip-ansi';
import type { Notebook } from './notebook.js';
import type { PauseSnapshot } from '@arrrank/interpreter';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export const graphemes = (text: string): Intl.SegmentData[] => [...segmenter.segment(text)];

export interface TextRow {
    text: string;
    points: { offset: number; column: number }[];
}

/** Reserve the rightmost terminal column so native auto-wrap never owns our cursor. */
export function textColumns(columns: number): number { return Math.max(1, columns - 7); }

function visible(segment: string, column: number): string {
    if (segment === '\t') return ' '.repeat(4 - column % 4);
    return segment.replace(/[\x00-\x1f\x7f-\x9f]/g, '?');
}

/** Every caret offset is mapped to a visual row using the same layout as drawing. */
export function editableRows(source: string, columns: number): TextRow[] {
    const width = Math.max(1, columns);
    const rows: TextRow[] = [];
    let offset = 0;
    for (const line of source.split('\n')) {
        let row: TextRow = { text: '', points: [{ offset, column: 0 }] };
        let column = 0;
        rows.push(row);
        for (const part of graphemes(line)) {
            let shown = visible(part.segment, column);
            let size = stringWidth(shown);
            if (size > width) { shown = '?'; size = 1; }
            if (column + size > width) {
                row = { text: '', points: [{ offset: offset + part.index, column: 0 }] };
                rows.push(row);
                column = 0;
                shown = visible(part.segment, column);
                size = stringWidth(shown);
                if (size > width) { shown = '?'; size = 1; }
            }
            row.text += shown;
            column += size;
            row.points.push({ offset: offset + part.index + part.segment.length, column });
            if (column === width) {
                row = { text: '', points: [{ offset: offset + part.index + part.segment.length, column: 0 }] };
                rows.push(row);
                column = 0;
            }
        }
        offset += line.length + 1;
    }
    return rows;
}

function selectedRow(row: TextRow, range?: { from: number; to: number }): string {
    if (!range) return row.text;
    let offset = row.points[0].offset;
    let column = 0;
    return graphemes(row.text).map(part => {
        const point = row.points.find(point => point.column === column);
        if (point) offset = point.offset;
        column += stringWidth(part.segment);
        return offset >= range.from && offset < range.to
            ? '\x1b[7m' + part.segment + '\x1b[27m' : part.segment;
    }).join('');
}

function clean(text: string): string { return stripVTControlCharacters(text).replace(/\r/g, ''); }

/** Diagnostics wrap at spaces; only an oversized word needs a hard break. */
function errorRows(text: string, columns: number): TextRow[] {
    const rows: TextRow[] = [];
    for (let line of text.split('\n')) {
        while (true) {
            const first = editableRows(line, columns)[0];
            const end = first.points.at(-1)!.offset;
            if (end === line.length) {
                rows.push(first);
                break;
            }
            const space = line.lastIndexOf(' ', end);
            const boundary = space > 0 ? space : end;
            rows.push({ text: boundary === end ? first.text.trimEnd() : line.slice(0, boundary).trimEnd(), points: [] });
            line = line.slice(boundary).trimStart();
        }
    }
    return rows;
}
export function clipped(text: string, width: number): string {
    return editableRows(clean(text), Math.max(1, width))[0].text;
}

export interface ScreenTarget {
    readonly kind: 'source' | 'example' | 'iteration';
    readonly cell: number;
    readonly line: number;
    readonly field?: number;
    readonly points: { offset: number; column: number }[];
}

export interface ScreenFrame {
    readonly lines: string[];
    readonly cursor: { row: number; column: number };
    readonly top: number;
    readonly maxTop?: number;
    readonly cursorVisible: boolean;
    readonly cursorStyle?: 2 | 6;
    readonly targets?: readonly (ScreenTarget | undefined)[];
}

/** Output and suggestions are model data, so old errors/listings disappear on the next frame. */
export function notebookFrame(
    notebook: Notebook, columns: number, height: number, previousTop = 0,
    suggestion = '', running = false, followCursor = true, fileStatus = '', runningStatus = 'Running…',
    breakpoints?: ReadonlyMap<number, ReadonlySet<number>>, promptLabel = 'rank> ',
    promptOutputs?: ReadonlyMap<number, readonly { text: string; error: boolean; inlineText?: string }[]>,
    promptFields?: readonly { name: string; source: string; cursor: number; active: boolean; error?: string; summary?: string;
        selection?: { from: number; to: number } }[],
    promptOutputFocus?: { readonly line: number; readonly offset: number; readonly active?: boolean; readonly nextLine?: number },
    stepping = false, anchoredCursorRow?: number, showShortcutHints = true, overscanRows = 0,
): ScreenFrame {
    const width = Math.max(1, columns - 1);
    const gutter = Math.min(Math.max(6, stringWidth(promptLabel)), Math.max(0, width - 1));
    const bodyWidth = Math.max(1, width - gutter);
    const rows: string[] = [];
    const targets: (ScreenTarget | undefined)[] = [];
    let caret = { row: 0, column: gutter };
    let errorEnd: number | undefined;
    let nextEvalRow: number | undefined;
    let nextEvalSourceLine: number | undefined;
    const dirty = notebook.dirtyFrom;
    for (const [index, cell] of notebook.cells.entries()) {
        const pending = dirty >= 0 && index >= dirty && index < notebook.cells.length - 1;
        const prompt = index === notebook.cells.length - 1;
        const live = index === notebook.active && (promptOutputs !== undefined || promptFields !== undefined);
        const editingField = live && promptFields?.some(field => field.active);
        const nextEvalLine = index === notebook.active && !editingField && (live || stepping)
            ? promptOutputFocus?.nextLine ?? cell.source.slice(0, notebook.cursor).split('\n').length : undefined;
        const label = prompt ? promptLabel : `●${String(index + 1).padStart(3)}› `;
        const color = cell.status === 'running' || cell.status === 'interrupted' ? '\x1b[33m'
            : cell.status === 'error' && cell.executed === cell.source && (index === dirty || !pending) ? '\x1b[31m'
            : pending || cell.status === 'idle' ? '\x1b[90m'
            : !cell.command && notebook.isExperimental(index) ? '\x1b[38;5;208m' : '\x1b[32m';
        const sourceRows = editableRows(cell.source, bodyWidth);
        const labelRow = prompt ? 0 : sourceRows.findIndex(row => row.text.trim() !== '');
        for (const [line, item] of sourceRows.entries()) {
            const offset = item.points[0]?.offset ?? 0;
            const sourceLine = cell.source.slice(0, offset).split('\n').length;
            const firstVisualRow = line === 0 || sourceLine !== cell.source.slice(0,
                sourceRows[line - 1].points[0]?.offset ?? 0).split('\n').length;
            const nextEval = sourceLine === nextEvalLine && firstVisualRow && !(prompt && line === labelRow);
            const breakpoint = breakpoints?.get(cell.id)?.has(sourceLine);
            const liveProgress = live && !editingField && !breakpoint;
            const hiddenFocusedDraft = promptOutputFocus && item.text.trim() === '';
            const prefix = (nextEval ? breakpoint ? '  ◆ ▶ ' : line === labelRow ? '▶' + label.slice(1) : '    ▶ '
                : breakpoint ? '    ◆ ' : line === labelRow ? label : hiddenFocusedDraft ? '      '
                : liveProgress ? '    ● '
                : item.text.trim() === '' ? '      ' : '    · ')
                .slice(-gutter || label.length);
            const progress = promptOutputs?.get(sourceLine);
            const progressColor = progress?.some(output => output.error) ? '\x1b[31m'
                : progress ? '\x1b[38;5;208m' : '\x1b[90m';
            const painted = nextEval ? '\x1b[36m' + prefix + '\x1b[0m'
                : breakpoint ? '\x1b[31m' + prefix + '\x1b[0m'
                : liveProgress ? progressColor + prefix + '\x1b[0m'
                : !prompt && line === labelRow ? color + prefix + '\x1b[0m' : prefix;
            if (nextEval) { nextEvalRow = rows.length; nextEvalSourceLine = sourceLine; }
            targets[rows.length] = { kind: 'source', cell: index, line: sourceLine,
                points: item.points.map(point => ({ offset: point.offset, column: gutter + point.column })) };
            rows.push((gutter > 0 ? painted : '') + selectedRow(item, notebook.selectionRange(index)));
            if (index === notebook.active && !editingField && !promptOutputFocus) {
                const point = item.points.find(point => point.offset === notebook.cursor);
                if (point) caret = { row: rows.length - 1, column: gutter + point.column };
            }
            const nextOffset = sourceRows[line + 1]?.points[0]?.offset;
            const nextLine = nextOffset === undefined ? undefined
                : cell.source.slice(0, nextOffset).split('\n').length;
            if (live && nextLine !== sourceLine) {
                for (const output of promptOutputs?.get(sourceLine) ?? []) {
                    const sourceText = cell.source.split('\n')[sourceLine - 1] ?? '';
                    const indent = stringWidth(/^\s*/.exec(sourceText)?.[0] ?? '');
                    const marker = output.error && gutter > 0
                        ? (' '.repeat(gutter + indent) + '! ').slice(-(gutter + indent))
                        : ' '.repeat(gutter + indent);
                    const outputWidth = output.error ? Math.min(width, 40) - gutter - indent : bodyWidth - indent;
                    const layout = output.error ? errorRows : editableRows;
                    for (const result of layout(clean(output.inlineText ?? output.text), Math.max(1, outputWidth))) {
                        if (!output.error && output.text.includes(' · iteration'))
                            targets[rows.length] = { kind: 'iteration', cell: index, line: sourceLine, points: [] };
                        rows.push((output.error ? '\x1b[31m' : promptOutputFocus?.active && promptOutputFocus.line === sourceLine ? '\x1b[7m' : '\x1b[90m')
                            + clipped(marker + result.text, width) + '\x1b[0m');
                        if (!output.error && promptOutputFocus?.line === sourceLine) {
                            const point = result.points.find(point => point.offset === promptOutputFocus.offset);
                            if (point) caret = { row: rows.length - 1, column: gutter + indent + point.column };
                        }
                    }
                }
            }
            if (live && sourceLine === 1 && nextLine !== sourceLine) {
                for (const [fieldIndex, field] of (promptFields ?? []).entries()) {
                    const label = `${field.name} = `;
                    const fieldRows = editableRows(label + field.source, bodyWidth);
                    for (const fieldRow of fieldRows) {
                        targets[rows.length] = { kind: 'example', cell: index, line: sourceLine, field: fieldIndex,
                            points: fieldRow.points.filter(point => point.offset >= label.length)
                                .map(point => ({ offset: point.offset - label.length, column: gutter + point.column })) };
                        const range = field.selection && { from: field.selection.from + label.length,
                            to: field.selection.to + label.length };
                        rows.push('\x1b[90m' + ' '.repeat(gutter) + selectedRow(fieldRow, range) + '\x1b[0m');
                        if (field.active) {
                            const point = fieldRow.points.find(point => point.offset === label.length + field.cursor);
                            if (point) caret = { row: rows.length - 1, column: gutter + point.column };
                        }
                    }
                    if (field.summary && !field.error) {
                        for (const summaryRow of editableRows('→ ' + clean(field.summary), bodyWidth))
                            rows.push('\x1b[90m' + ' '.repeat(gutter) + summaryRow.text + '\x1b[0m');
                    }
                    if (field.error) {
                        for (const errorRow of errorRows('! ' + clean(field.error), Math.max(1, Math.min(width, 40) - gutter)))
                            rows.push('\x1b[31m' + ' '.repeat(gutter) + errorRow.text + '\x1b[0m');
                    }
                }
            }
        }
        for (const output of live ? [] : cell.output) {
            const marker = (output.error || pending) && gutter > 0
                ? (' '.repeat(gutter) + (output.error ? '! ' : '~ ')).slice(-gutter) : ' '.repeat(gutter);
            const text = clean(output.inlineText ?? output.text);
            const outputWidth = output.error ? Math.max(1, Math.min(width, 40) - gutter) : bodyWidth;
            const layout = output.error ? errorRows : editableRows;
            for (const item of layout(text, outputWidth)) {
                rows.push((output.error ? '\x1b[31m' : '\x1b[90m') + clipped(marker + item.text, width) + '\x1b[0m');
            }
        }
        if (index === notebook.active && cell.status === 'error' && cell.executed === cell.source
            && (index === dirty || !pending)) errorEnd = rows.length - 1;
    }
    const footerRows = height > 1 && (showShortcutHints || running || !!suggestion || !!fileStatus) ? 1 : 0;
    const viewportHeight = Math.max(1, height - footerRows);
    const maxTop = Math.max(0, rows.length - viewportHeight);
    let top = Math.max(0, Math.min(previousTop, Math.max(0, rows.length - (followCursor ? 1 : viewportHeight))));
    if (followCursor && caret.row < top) top = caret.row;
    if (followCursor && caret.row >= top + viewportHeight) top = caret.row - viewportHeight + 1;
    if (followCursor && promptOutputFocus && nextEvalRow !== undefined
        && Math.abs(nextEvalRow - caret.row) < viewportHeight) {
        top = Math.min(top, Math.min(nextEvalRow, caret.row));
        top = Math.max(top, Math.max(nextEvalRow, caret.row) - viewportHeight + 1);
    }
    if (followCursor && errorEnd !== undefined) {
        // Include the prompt if the suffix fits. For a taller diagnostic, keep the
        // failing line visible and leave the remaining output available to Page Down.
        const end = rows.length - caret.row <= viewportHeight ? rows.length - 1 : errorEnd;
        top = Math.max(top, Math.min(caret.row, end - viewportHeight + 1));
    }
    if (followCursor && anchoredCursorRow !== undefined)
        top = Math.max(0, caret.row - Math.min(anchoredCursorRow, viewportHeight - 1));
    const renderedHeight = viewportHeight + Math.max(0, overscanRows);
    const lines = rows.slice(top, top + renderedHeight);
    while (lines.length < renderedHeight) lines.push('');
    if (footerRows) {
        const footerWidth = width;
        let status = '';
        if (!followCursor) {
            if (showShortcutHints) status = 'PgUp/PgDn scroll · Esc return';
        } else if (running) status = runningStatus;
        else status = suggestion || (showShortcutHints
            ? notebook.atPrompt ? 'Ctrl-L run all' : 'Ctrl-R run · Ctrl-L run all' : '');
        if (showShortcutHints && followCursor && !running && promptOutputFocus && nextEvalRow !== undefined
            && (nextEvalRow < top || nextEvalRow >= top + viewportHeight))
            status = `▶ line ${nextEvalSourceLine} · ${promptOutputFocus.active ? '←/→' : 'Enter'} · Esc · ^L run all`;
        status = clipped(status, Math.min(40, width));
        let label = running ? '' : fileStatus;
        if (label && followCursor) {
            const available = footerWidth - stringWidth(status) - 3;
            if (stringWidth(label) > available) {
                const separator = label.lastIndexOf(' · ');
                const state = separator >= 0 ? label.slice(separator) : '';
                const nameWidth = available - stringWidth(state) - 1;
                label = nameWidth >= 0 ? (nameWidth > 0 ? clipped(label, nameWidth) : '') + '…' + state
                    : available > 0 ? clipped(state.replace(/^ · /, ''), available) : '';
            }
        }
        lines.push(clipped(label && followCursor ? `${label} · ${status}` : status, footerWidth));
    }
    return { lines, cursor: { row: Math.max(0, Math.min(viewportHeight - 1, caret.row - top)), column: caret.column },
        top, maxTop, targets: targets.slice(top, top + renderedHeight),
        cursorVisible: caret.row >= top && caret.row < top + viewportHeight,
        cursorStyle: promptOutputFocus ? 2 : promptFields?.some(field => field.active) ? 6
            : promptOutputs || notebook.atPrompt || stepping ? 2 : 6 };
}

/** Saving has its own filename editor and never changes the source cursor. */
export function saveFrame(
    filename: Notebook | undefined, error: string, columns: number, height: number,
    exitAfterSave = false, saving = false, loadAfterSave = false,
): ScreenFrame {
    if (!filename) {
        const question = loadAfterSave ? 'Save changes before loading another file?' : 'Save changes before exit?';
        const frame = helpFrame(question + '\n\nEnter / S: save\nD: discard changes\nEsc: cancel', columns, height);
        if (height > 1) frame.lines[height - 1] = clipped('Enter save · D discard · Esc cancel', Math.max(1, columns - 1));
        return frame;
    }
    const width = Math.max(1, columns - 1);
    const viewportHeight = Math.max(1, height - 1);
    const fileRows = editableRows('File: ' + filename.current.source, width);
    const rows = [clipped(loadAfterSave ? 'Save before loading' : exitAfterSave ? 'Save before exit' : 'Save program', width), '', ...fileRows.map(row => row.text)];
    let caret = { row: 2, column: 6 };
    for (const [index, row] of fileRows.entries()) {
        const point = row.points.find(point => point.offset === filename.cursor + 6);
        if (point) caret = { row: index + 2, column: point.column };
    }
    if (error) rows.push('', ...editableRows(clean(error), width).map(row => '\x1b[31m' + row.text + '\x1b[0m'));
    const top = Math.max(0, Math.min(caret.row, rows.length - viewportHeight));
    const lines = rows.slice(top, top + viewportHeight);
    while (lines.length < viewportHeight) lines.push('');
    if (height > 1) lines.push(clipped(saving ? 'Saving…' : exitAfterSave ? 'Enter save and exit · Esc cancel' : 'Enter save · Esc cancel', width));
    return { lines, top, cursor: { row: caret.row - top, column: caret.column }, cursorVisible: true };
}

/** Source context belongs to the paused execution, including calls in another cell. */
export function pauseFrame(
    pause: PauseSnapshot, columns: number, height: number, previousTop = 0, status = '',
): ScreenFrame {
    const width = Math.max(1, columns - 1);
    const rows: string[] = [];
    const append = (text: string, color = '') => {
        for (const row of editableRows(clean(text), width))
            rows.push(color ? color + row.text + '\x1b[0m' : row.text);
    };
    append(`Paused · ${pause.activity ?? 'evaluating'}`);
    const source = pause.source?.split(/\r?\n/);
    const line = pause.line;
    let state = pause.state ?? '';
    if (source && line !== undefined && line >= 1 && line <= source.length) {
        // Numbered context replaces the snapshot's path and plain source line.
        const stateLines = state.split('\n');
        if (stateLines[1] === source[line - 1]) {
            state = stateLines.slice(2).join('\n').trimStart();
        }
    }
    const stack = state.match(/(?:^|\n\n)(Call stack \(outermost first\):\n[^]*?)(?=\n\n|$)/);
    if (stack) {
        append(stack[1] + '\n');
        state = state.replace(stack[0], '').trimStart();
    }
    if (source && line !== undefined && line >= 1 && line <= source.length) {
        append(pause.activity === `before line ${line}` ? '● Next to execute' : '● Currently executing');
        const start = Math.max(0, Math.min(line - 3, source.length - 6));
        const end = Math.min(source.length, start + 6);
        const digits = String(end).length;
        const code: string[] = [];
        let currentStart = 0;
        let currentHeight = 0;
        for (let index = start; index < end; index++) {
            const current = index === line - 1;
            const label = `${current ? '●' : ' '} ${String(index + 1).padStart(digits)} │ ${source[index]}`;
            const wrapped = editableRows(clean(label), width);
            // The editor reserves a cursor row at exact width; paused code has no cursor.
            if (wrapped.length > 1 && wrapped.at(-1)!.text === '') wrapped.pop();
            if (current) { currentStart = code.length; currentHeight = wrapped.length; }
            const color = current ? '\x1b[1;38;5;179m' : '\x1b[90m';
            code.push(...wrapped.map(row => color + row.text + '\x1b[0m'));
        }
        // Six screen rows, including wraps. Keep the current line in view and
        // trim following context before moving the variables below the code.
        const first = Math.max(0, currentStart + Math.min(currentHeight, 6) - 6);
        const visible = code.slice(first, first + 6);
        rows.push(...visible);
        for (let index = visible.length; index < 6; index++) rows.push('');
    }
    let bindingIndex = 0;
    let inBindings = false;
    append('');
    for (const row of state.split('\n')) {
        if (/^(Variables \(current scope\)|Globals|.* locals):$/.test(row)) inBindings = true;
        const binding = inBindings && /^  \S+ = /.test(row) ? pause.bindings?.[bindingIndex++] : undefined;
        const next = pause.activity === `before line ${pause.line}`;
        const focus = next && binding?.write ? '\x1b[38;5;179m' : next && binding?.read ? '\x1b[38;5;110m' : '';
        append(row, focus);
    }
    for (const [key, value] of Object.entries(pause.details ?? {})) append(`${key}: ${value}`);
    const contentHeight = Math.max(1, height - 1);
    const top = Math.max(0, Math.min(previousTop, rows.length - contentHeight));
    const lines = rows.slice(top, top + contentHeight);
    while (lines.length < contentHeight) lines.push('');
    if (height > 1) lines.push(clipped(status || 't step · n loop · g main · ↵ · ^C stop', Math.min(40, width)));
    return { lines, top, cursor: { row: 0, column: 0 }, cursorVisible: false };
}

/** Help is a temporary screen; its text never belongs to the notebook. */
export function helpFrame(text: string, columns: number, height: number, previousTop = 0): ScreenFrame {
    const width = Math.max(1, columns - 1);
    const contentHeight = Math.max(1, height - 1);
    const rows = editableRows(clean(text), width).map(row => row.text);
    const top = Math.max(0, Math.min(previousTop, rows.length - contentHeight));
    const lines = rows.slice(top, top + contentHeight);
    while (lines.length < contentHeight) lines.push('');
    if (height > 1) lines.push(clipped('Esc close · ↑/↓ scroll · PgUp/PgDn', width));
    return { lines, top, cursor: { row: 0, column: 0 }, cursorVisible: false };
}

/** Absolute addressing and explicit erasure; never infer where a previous write left the cursor. */
export function drawFrame(frame: ScreenFrame): string {
    let text = '\x1b[?25l';
    for (const [index, line] of frame.lines.entries()) text += `\x1b[${index + 1};1H\x1b[2K${line}`;
    return text + `\x1b[${frame.cursorStyle ?? 6} q` + `\x1b[${frame.cursor.row + 1};${frame.cursor.column + 1}H`
        + (frame.cursorVisible ? '\x1b[?25h' : '');
}
