/// <reference lib="es2022.intl" />
import stringWidth from 'string-width';
import { stripVTControlCharacters } from 'node:util';
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

function clean(text: string): string { return stripVTControlCharacters(text).replace(/\r/g, ''); }
export function clipped(text: string, width: number): string {
    return editableRows(clean(text), Math.max(1, width))[0].text;
}

export interface ScreenFrame {
    readonly lines: string[];
    readonly cursor: { row: number; column: number };
    readonly top: number;
    readonly cursorVisible: boolean;
}

/** Output and suggestions are model data, so old errors/listings disappear on the next frame. */
export function notebookFrame(
    notebook: Notebook, columns: number, height: number, previousTop = 0,
    suggestion = '', running = false, followCursor = true, fileStatus = '', runningStatus = 'Running…',
    breakpoints?: ReadonlyMap<number, ReadonlySet<number>>, promptLabel = 'rank> ',
    promptOutputs?: ReadonlyMap<number, readonly { text: string; error: boolean }[]>,
    promptFields?: readonly { name: string; source: string; cursor: number; active: boolean; error?: string }[],
    promptOutputFocus?: { readonly line: number; readonly offset: number },
): ScreenFrame {
    const width = Math.max(1, columns - 1);
    const gutter = Math.min(Math.max(6, stringWidth(promptLabel)), Math.max(0, width - 1));
    const bodyWidth = Math.max(1, width - gutter);
    const rows: string[] = [];
    let caret = { row: 0, column: gutter };
    let errorEnd: number | undefined;
    const dirty = notebook.dirtyFrom;
    for (const [index, cell] of notebook.cells.entries()) {
        const pending = dirty >= 0 && index >= dirty && index < notebook.cells.length - 1;
        const prompt = index === notebook.cells.length - 1;
        const live = index === notebook.active && (promptOutputs !== undefined || promptFields !== undefined);
        const editingField = live && promptFields?.some(field => field.active);
        const label = prompt ? promptLabel : `●${String(index + 1).padStart(3)}› `;
        const color = cell.status === 'running' || cell.status === 'interrupted' ? '\x1b[33m'
            : cell.status === 'error' && cell.executed === cell.source && (index === dirty || !pending) ? '\x1b[31m'
            : pending || cell.status === 'idle' ? '\x1b[90m' : '\x1b[32m';
        const sourceRows = editableRows(cell.source, bodyWidth);
        const labelRow = prompt ? 0 : sourceRows.findIndex(row => row.text.trim() !== '');
        for (const [line, item] of sourceRows.entries()) {
            const offset = item.points[0]?.offset ?? 0;
            const sourceLine = cell.source.slice(0, offset).split('\n').length;
            const breakpoint = breakpoints?.get(cell.id)?.has(sourceLine);
            const liveProgress = live && !editingField && !breakpoint;
            const hiddenFocusedDraft = promptOutputFocus && item.text.trim() === '';
            const prefix = (breakpoint ? '    ◆ ' : line === labelRow ? label : hiddenFocusedDraft ? '      '
                : liveProgress ? '    ● '
                : item.text.trim() === '' ? '      ' : '    · ')
                .slice(-gutter || label.length);
            const progressColor = promptOutputs?.has(sourceLine) ? '\x1b[32m' : '\x1b[90m';
            const painted = breakpoint ? '\x1b[31m' + prefix + '\x1b[0m'
                : liveProgress ? progressColor + prefix + '\x1b[0m'
                : !prompt && line === labelRow ? color + prefix + '\x1b[0m' : prefix;
            rows.push((gutter > 0 ? painted : '') + item.text);
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
                    for (const result of editableRows(clean(output.text), Math.max(1, bodyWidth - indent))) {
                        rows.push((output.error ? '\x1b[31m' : '\x1b[90m')
                            + clipped(marker + result.text, width) + '\x1b[0m');
                        if (!output.error && promptOutputFocus?.line === sourceLine) {
                            const point = result.points.find(point => point.offset === promptOutputFocus.offset);
                            if (point) caret = { row: rows.length - 1, column: gutter + indent + point.column };
                        }
                    }
                }
            }
            if (live && sourceLine === 1 && nextLine !== sourceLine) {
                for (const field of promptFields ?? []) {
                    const label = `${field.name} = `;
                    const fieldRows = editableRows(label + field.source, bodyWidth);
                    for (const fieldRow of fieldRows) {
                        rows.push('\x1b[90m' + ' '.repeat(gutter) + fieldRow.text + '\x1b[0m');
                        if (field.active) {
                            const point = fieldRow.points.find(point => point.offset === label.length + field.cursor);
                            if (point) caret = { row: rows.length - 1, column: gutter + point.column };
                        }
                    }
                    if (field.error) {
                        for (const errorRow of editableRows('! ' + clean(field.error), bodyWidth))
                            rows.push('\x1b[31m' + ' '.repeat(gutter) + errorRow.text + '\x1b[0m');
                    }
                }
            }
        }
        for (const output of live ? [] : cell.output) {
            const marker = output.error && gutter > 0
                ? (' '.repeat(gutter) + '! ').slice(-gutter) : ' '.repeat(gutter);
            const text = clean(output.text);
            for (const item of editableRows(text, bodyWidth)) {
                rows.push((output.error ? '\x1b[31m' : '\x1b[90m') + clipped(marker + item.text, width) + '\x1b[0m');
            }
        }
        if (index === notebook.active && cell.status === 'error' && cell.executed === cell.source
            && (index === dirty || !pending)) errorEnd = rows.length - 1;
    }
    const footerRows = height > 1 ? 1 : 0;
    const viewportHeight = Math.max(1, height - footerRows);
    let top = Math.max(0, Math.min(previousTop, Math.max(0, rows.length - viewportHeight)));
    if (followCursor && caret.row < top) top = caret.row;
    if (followCursor && caret.row >= top + viewportHeight) top = caret.row - viewportHeight + 1;
    if (followCursor && errorEnd !== undefined) {
        // Include the prompt if the suffix fits. For a taller diagnostic, keep the
        // failing line visible and leave the remaining output available to Page Down.
        const end = rows.length - caret.row <= viewportHeight ? rows.length - 1 : errorEnd;
        top = Math.max(top, Math.min(caret.row, end - viewportHeight + 1));
    }
    const lines = rows.slice(top, top + viewportHeight);
    while (lines.length < viewportHeight) lines.push('');
    if (footerRows) {
        const footerWidth = Math.min(40, width);
        const status = !followCursor ? 'PgUp/PgDn scroll · Esc return' : running ? runningStatus
            : suggestion || (notebook.atPrompt
                ? 'Enter run · help'
                : 'Ctrl-R rerun · help');
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
        top, cursorVisible: caret.row >= top && caret.row < top + viewportHeight };
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
        const start = Math.max(0, Math.min(line - 3, source.length - 4));
        const end = Math.min(source.length, start + 4);
        const digits = String(end).length;
        for (let index = start; index < end; index++) {
            const current = index === line - 1;
            append(`${current ? '●' : ' '} ${String(index + 1).padStart(digits)} │ ${source[index]}`,
                current ? '\x1b[1;33m' : '\x1b[90m');
        }
    }
    append('\n' + state);
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
    return text + `\x1b[${frame.cursor.row + 1};${frame.cursor.column + 1}H`
        + (frame.cursorVisible ? '\x1b[?25h' : '');
}
