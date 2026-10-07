/// <reference lib="es2022.intl" />
import { cellWidth, fitEnd } from './display-width.js';
import stripVTControlCharacters from 'strip-ansi';
import type { Notebook } from './notebook.js';
import { hasCode } from './repl-input.js';
import type { PauseSnapshot } from '@arrrank/interpreter';
import { importPhrases, missingImports } from './import-fix.js';
import { layoutNameFacts, type NameFacts } from './name-facts.js';
import type { ValueViewer } from './value-viewer.js';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export const graphemes = (text: string): Intl.SegmentData[] => [...segmenter.segment(text)];

export interface TextRow {
    text: string;
    points: { offset: number; column: number }[];
}

/** Reserve the rightmost terminal column so native auto-wrap never owns our cursor. */
export function textColumns(columns: number, gutter = 6): number { return Math.max(1, columns - gutter - 1); }

function visible(segment: string, column: number): string {
    if (segment === '\t') return ' '.repeat(4 - column % 4);
    return segment.replace(/[\x00-\x1f\x7f-\x9f]/g, '?');
}

/** Every caret offset is mapped to a visual row using the same layout as drawing. */
/** One-based source line of an offset, by binary search over the line starts. */
function lineNumbers(source: string): (offset: number) => number {
    const starts = [0];
    for (let at = source.indexOf('\n'); at >= 0; at = source.indexOf('\n', at + 1)) starts.push(at + 1);
    return offset => {
        let low = 0;
        let high = starts.length - 1;
        while (low < high) {
            const middle = (low + high + 1) >> 1;
            if (starts[middle] <= offset) low = middle; else high = middle - 1;
        }
        return low + 1;
    };
}

const rowCache = new Map<string, TextRow[]>();

/** Wrapped rows are identical for an unchanged cell, and every scroll frame lays all cells out again. */
export function editableRows(source: string, columns: number, cursor?: number): TextRow[] {
    const key = columns + ':' + (cursor ?? '') + ':' + source;
    let rows = rowCache.get(key);
    if (!rows) {
        rows = layoutRows(source, columns, cursor);
        if (rowCache.size >= 512) rowCache.delete(rowCache.keys().next().value!);
        rowCache.set(key, rows);
    }
    return rows;
}

/** Display-only URL shortening with a map back to the untouched source. */
function commentDisplay(line: string, width: number, cursor?: number): { text: string; offsets?: number[] } {
    const links = [...line.matchAll(/https?:\/\/[^\s<>"']+/g)];
    if (!links.length) return { text: line };
    let text = '';
    const offsets = [0];
    let from = 0;
    const appendSource = (to: number) => {
        text += line.slice(from, to);
        for (let index = from + 1; index <= to; index++) offsets.push(index);
        from = to;
    };
    for (const match of links) {
        const url = match[0].replace(/[.,;!?\)\]\}]+$/, '');
        const start = match.index!;
        const end = start + url.length;
        appendSource(start);
        if (cursor !== undefined && cursor >= start && cursor <= end) {
            appendSource(end);
            continue;
        }
        const scheme = /^https?:\/\//.exec(url)![0].length;
        let shown = url.slice(scheme);
        const budget = Math.max(1, width - 4);
        const shortened = cellWidth(shown) > budget;
        if (shortened) {
            let prefix = '';
            for (const part of graphemes(shown)) {
                if (cellWidth(prefix + part.segment + '…') > budget) break;
                prefix += part.segment;
            }
            shown = prefix + '…';
        }
        text += shown;
        for (let index = 1; index <= shown.length; index++) {
            offsets.push(shortened && index === shown.length ? end : start + scheme + index);
        }
        from = end;
    }
    appendSource(line.length);
    return { text, offsets };
}

function layoutRows(source: string, columns: number, cursor?: number): TextRow[] {
    const width = Math.max(1, columns);
    const rows: TextRow[] = [];
    let offset = 0;
    for (const line of source.split('\n')) {
        const comment = /^\s*rem(?:\s|$)/.test(line);
        const display = comment ? commentDisplay(line, width, cursor === undefined ? undefined : cursor - offset) : { text: line };
        const sourceOffset = (index: number) => offset + (display.offsets?.[index] ?? index);
        let row: TextRow = { text: '', points: [{ offset, column: 0 }] };
        let column = 0;
        rows.push(row);
        for (const part of graphemes(display.text)) {
            // Wrap comment words visually, keeping every source offset and space intact.
            // Oversized words still use the ordinary grapheme-level fallback.
            if (comment && !/\s/.test(part.segment) && part.index > 0 && /\s/.test(display.text[part.index - 1])) {
                const rest = display.text.slice(part.index);
                const end = rest.search(/\s/);
                const wordWidth = cellWidth(end < 0 ? rest : rest.slice(0, end));
                if (column > 0 && wordWidth <= width && column + wordWidth > width) {
                    row = { text: '', points: [{ offset: sourceOffset(part.index), column: 0 }] };
                    rows.push(row);
                    column = 0;
                }
            }
            let shown = visible(part.segment, column);
            let size = cellWidth(shown);
            if (size > width) { shown = '?'; size = 1; }
            if (column + size > width) {
                row = { text: '', points: [{ offset: sourceOffset(part.index), column: 0 }] };
                rows.push(row);
                column = 0;
                shown = visible(part.segment, column);
                size = cellWidth(shown);
                if (size > width) { shown = '?'; size = 1; }
            }
            row.text += shown;
            column += size;
            row.points.push({ offset: sourceOffset(part.index + part.segment.length), column });
            if (column === width) {
                row = { text: '', points: [{ offset: sourceOffset(part.index + part.segment.length), column: 0 }] };
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
        column += cellWidth(part.segment);
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
/** One row of at most `width` cells; a longer text ends in an ellipsis instead of wrapping. */
function oneRow(text: string, width: number): string {
    const plain = clean(text);
    return cellWidth(plain) <= width ? plain : clipped(plain, Math.max(1, width - 1)) + '…';
}

/** Break text at spaces into rows that fit; a word longer than a row is cut. */
export function wrapped(text: string, width: number): string[] {
    const rows: string[] = [];
    let row = '';
    for (const word of text.split(' ')) {
        let rest = word;
        while (cellWidth(rest) > width) {
            if (row) { rows.push(row); row = ''; }
            let cut = '';
            for (const char of rest) {
                if (cellWidth(cut + char) > width) break;
                cut += char;
            }
            if (!cut) break;
            rows.push(cut);
            rest = rest.slice(cut.length);
        }
        const joined = row ? row + ' ' + rest : rest;
        if (cellWidth(joined) <= width) row = joined;
        else { rows.push(row); row = rest; }
    }
    if (row || !rows.length) rows.push(row);
    return rows;
}

export function clipped(text: string, width: number): string {
    return editableRows(clean(text), Math.max(1, width))[0].text;
}

export interface ScreenTarget {
    readonly kind: 'source' | 'example' | 'iteration' | 'autofix' | 'value';
    readonly cell: number;
    readonly line: number;
    readonly field?: number;
    /** The held value a `value` row opens. */
    readonly ref?: number;
    readonly points: { offset: number; column: number }[];
    /** Import suggestions on an error row, by screen column. */
    readonly fixes?: readonly { index: number; module: string; from: number; to: number }[];
}

/** The suggestion under a column of an autofix row. */
export function fixAt(target: ScreenTarget | undefined, column: number): { index: number; module: string } | undefined {
    return target?.fixes?.find(fix => column >= fix.from && column < fix.to);
}

export interface ScreenFrame {
    readonly lines: string[];
    readonly cursor: { row: number; column: number };
    readonly top: number;
    readonly maxTop?: number;
    readonly cursorVisible: boolean;
    /** Absolute row of the cursor in the whole notebook, for callers that scroll inside an overscanned frame. */
    readonly caretRow?: number;
    readonly cursorStyle?: 2 | 6;
    readonly targets?: readonly (ScreenTarget | undefined)[];
    /** Index in `lines` of the footer row showing the name under the cursor, for dimmer, smaller styling. */
    readonly factsRow?: number;
    /** The footer row when it holds a quiet status (running, run time), drawn like a name under the cursor. */
    readonly statusRow?: number;
    /** The footer wraps onto this many rows (at least one) when its text is long. */
    readonly factsRowCount?: number;
    /** Indexes in `lines` of the rows that show a result, a value or an error, rather than code, so a host can draw them smaller. */
    readonly resultRows?: readonly number[];
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
    diagnostics?: ReadonlyMap<number, readonly { text: string; error: boolean; inlineText?: string }[]>,
    importFixFocus?: number, nameFacts?: NameFacts, valueFocus?: number, sourceGutter = 6,
): ScreenFrame {
    const width = Math.max(1, columns - 1);
    const gutter = Math.min(Math.max(sourceGutter, cellWidth(promptLabel)), Math.max(0, width - 1));
    const bodyWidth = Math.max(1, width - gutter);
    const rows: string[] = [];
    const targets: (ScreenTarget | undefined)[] = [];
    const resultRows: number[] = [];
    let caret = { row: 0, column: gutter };
    let errorEnd: number | undefined;
    let nextEvalRow: number | undefined;
    let nextEvalSourceLine: number | undefined;
    const dirty = notebook.dirtyFrom;
    let number = 0;
    for (const [index, cell] of notebook.cells.entries()) {
        const pending = dirty >= 0 && index >= dirty && index < notebook.cells.length - 1;
        const prompt = index === notebook.cells.length - 1;
        const live = index === notebook.active && (promptOutputs !== undefined || promptFields !== undefined);
        const editingField = live && promptFields?.some(field => field.active);
        const nextEvalLine = index === notebook.active && !editingField && (live || stepping)
            ? promptOutputFocus?.nextLine ?? cell.source.slice(0, notebook.cursor).split('\n').length : undefined;
        const numbered = prompt || cell.command || hasCode(cell.source);
        if (numbered && !prompt) number++;
        const label = prompt ? promptLabel : `●${String(number).padStart(3)}› `;
        const color = cell.status === 'running' || cell.status === 'interrupted' ? '\x1b[33m'
            : cell.status === 'error' && cell.executed === cell.source && (index === dirty || !pending) ? '\x1b[31m'
            : pending || cell.status === 'idle' ? '\x1b[90m'
            : !cell.command && notebook.isExperimental(index) ? '\x1b[38;5;208m' : '\x1b[32m';
        const sourceRows = editableRows(cell.source, bodyWidth, index === notebook.active ? notebook.cursor : undefined);
        const labelRow = prompt ? 0 : numbered ? sourceRows.findIndex(row => row.text.trim() !== '') : -1;
        const lineAt = lineNumbers(cell.source);
        for (const [line, item] of sourceRows.entries()) {
            const offset = item.points[0]?.offset ?? 0;
            const sourceLine = lineAt(offset);
            const firstVisualRow = line === 0 || sourceLine !== lineAt(sourceRows[line - 1].points[0]?.offset ?? 0);
            const nextEval = sourceLine === nextEvalLine && firstVisualRow && !(prompt && line === labelRow);
            const breakpoint = breakpoints?.get(cell.id)?.has(sourceLine);
            const liveProgress = live && !editingField && !breakpoint;
            const hiddenFocusedDraft = promptOutputFocus && item.text.trim() === '';
            const steppingNext = nextEval && (stepping || !!promptOutputFocus);
            const marker = breakpoint ? '    ◆ ' : line === labelRow ? label : hiddenFocusedDraft ? '      '
                : steppingNext ? '    ● '
                : liveProgress ? '    ● '
                : item.text.trim() === '' || !numbered ? '      ' : '    · ';
            const prefix = fitEnd(marker, gutter || cellWidth(label));
            const progress = promptOutputs?.get(sourceLine);
            const progressColor = progress?.some(output => output.error) ? '\x1b[31m'
                : progress ? '\x1b[38;5;208m' : '\x1b[90m';
            const painted = breakpoint ? '\x1b[31m' + prefix + '\x1b[0m'
                : steppingNext ? '\x1b[36m' + prefix + '\x1b[0m'
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
            const nextLine = nextOffset === undefined ? undefined : lineAt(nextOffset);
            if ((live || index === notebook.active && diagnostics) && nextLine !== sourceLine) {
                const outputs = [...(live ? promptOutputs?.get(sourceLine) ?? [] : []),
                    ...(index === notebook.active ? diagnostics?.get(sourceLine) ?? [] : [])];
                for (const output of outputs) {
                    const sourceText = cell.source.split('\n')[sourceLine - 1] ?? '';
                    const indent = cellWidth(/^\s*/.exec(sourceText)?.[0] ?? '');
                    const marker = output.error && gutter > 0
                        ? fitEnd('! ', gutter + indent) : ' '.repeat(gutter + indent);
                    const outputWidth = output.error ? Math.min(width, 40) - gutter - indent : bodyWidth - indent;
                    const layout = output.error ? errorRows : editableRows;
                    for (const result of layout(clean(output.inlineText ?? output.text), Math.max(1, outputWidth))) {
                        if (!output.error && output.text.includes(' · iteration'))
                            targets[rows.length] = { kind: 'iteration', cell: index, line: sourceLine, points: [] };
                        resultRows.push(rows.length);
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
        const modules = live ? [] : missingImports(cell.output);
        const committed = live ? [] : cell.output;
        for (let at = 0; at < committed.length; at++) {
            const output = committed[at];
            // A failed execution describes its original source, not the edited draft.
            if (output.error && cell.executed !== undefined && cell.executed !== cell.source) continue;
            const marker = (output.error || pending) && gutter > 0
                ? fitEnd(output.error ? '! ' : '~ ', gutter) : ' '.repeat(gutter);
            // A result that opens in a viewer says what it is, and is a stop for the arrow keys.
            const openable = !output.error && output.view !== undefined && output.ref !== undefined;
            const focused = openable && cell.id === valueFocus;
            if (openable) {
                // Two rows at most: the preview, kept to one row with its ends and a gap, and what the value is.
                // The note under it (`shape 3 4, 12 values`) repeats the shape, so only a note that adds something stays.
                const next = committed[at + 1];
                const note = next && !next.error && next.view === undefined && next.ref === output.ref ? clean(next.text) : '';
                if (note) at++;
                const detail = output.view!.endsWith(']') || !note ? output.view! : `${output.view} · ${note}`;
                for (const [part, line] of [clean(output.inlineText ?? output.text).split('\n')[0], detail].entries()) {
                    targets[rows.length] = { kind: 'value', cell: index, line: 0, ref: output.ref, points: [] };
                    if (focused && part === 0) caret = { row: rows.length, column: gutter };
                    resultRows.push(rows.length);
                    rows.push((focused ? '\x1b[7m' : '\x1b[90m')
                        + oneRow((part === 0 ? marker : ' '.repeat(gutter)) + line, width) + '\x1b[0m');
                }
                continue;
            }
            const cleaned = clean(output.inlineText ?? output.text);
            const text = output.error ? importPhrases(cleaned).text : cleaned;
            const outputWidth = output.error ? Math.max(1, Math.min(width, 40) - gutter) : bodyWidth;
            const layout = output.error ? errorRows : editableRows;
            for (const item of layout(text, outputWidth)) {
                const shown = clipped(marker + item.text, width);
                if (!output.error || !modules.length) {
                    resultRows.push(rows.length);
                    rows.push((output.error ? '\x1b[31m' : '\x1b[90m') + shown + '\x1b[0m');
                    continue;
                }
                const fixFocus = index === notebook.active ? importFixFocus : undefined;
                const fixes: { index: number; module: string; from: number; to: number }[] = [];
                const painted = shown.replace(/use\u00a0([\w.-]+)/g, (phrase, module: string, at: number) => {
                    const fix = modules.indexOf(module);
                    if (fix < 0) return phrase;
                    const from = cellWidth(shown.slice(0, at));
                    fixes.push({ index: fix, module, from, to: from + cellWidth(phrase) });
                    if (fix === fixFocus) caret = { row: rows.length, column: from };
                    return (fix === fixFocus ? '\x1b[7m' : '\x1b[4m') + phrase
                        + (fix === fixFocus ? '\x1b[27m' : '\x1b[24m');
                });
                if (fixes.length) targets[rows.length] = { kind: 'autofix', cell: index, line: 0, points: [], fixes };
                resultRows.push(rows.length);
                rows.push('\x1b[31m' + painted.replace(/\u00a0/g, ' ') + '\x1b[0m');
            }
        }
        if (index === notebook.active && cell.status === 'error' && cell.executed === cell.source
            && (index === dirty || !pending)) errorEnd = rows.length - 1;
    }
    // Errors, running status, completion candidates and iteration hints keep the footer; otherwise a name under the cursor owns it.
    // A tap on a touch console places the cursor without following it, so the cursor being on screen is enough.
    const cursorShown = followCursor || caret.row >= previousTop && caret.row < previousTop + height;
    const showFacts = !!nameFacts && cursorShown && overscanRows <= 1 && !running && !suggestion && !promptOutputFocus && valueFocus === undefined;
    // The name under the cursor wraps onto as many rows as it needs, within a third of the screen.
    const factsLines = showFacts ? layoutNameFacts(nameFacts!, width).slice(0, Math.max(1, Math.floor(height / 2))) : [];
    const footerRows = height > 1 && (showShortcutHints || running || !!suggestion || !!fileStatus || showFacts)
        ? Math.max(1, factsLines.length) : 0;
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
    // The footer must not bury the last row (the prompt): if the end of the notebook was on screen
    // without it, scroll one row so it stays reachable, as long as the cursor remains in view.
    if (footerRows && previousTop + height >= rows.length && top + viewportHeight < rows.length
        && caret.row >= maxTop) top = maxTop;
    // The footer takes the row that was the viewport's last; keep a cursor that sat there in view.
    if (showFacts && !followCursor && caret.row >= top + viewportHeight && caret.row < top + height)
        top = Math.min(maxTop, caret.row - viewportHeight + 1);
    const renderedHeight = viewportHeight + Math.max(0, overscanRows);
    const lines = rows.slice(top, top + renderedHeight);
    while (lines.length < renderedHeight) lines.push('');
    let factsRow: number | undefined;
    let statusRow: number | undefined;
    // The footer sits directly under the viewport, ahead of any overscan rows, so it is never
    // pushed below the visible area.
    let footerLine: string | undefined;
    let footerLines: string[] | undefined;
    if (footerRows && showFacts) {
        factsRow = viewportHeight;
        footerLines = factsLines.map(line => '\x1b[90m' + clipped(line, width) + '\x1b[0m');
    } else if (footerRows) {
        const footerWidth = width;
        let status = '';
        if (!followCursor) {
            if (showShortcutHints) status = 'PgUp/PgDn scroll · Esc return';
        } else if (running) status = runningStatus;
        else status = suggestion || (showShortcutHints
            ? notebook.atPrompt ? 'Ctrl-L run all' : 'Ctrl-R run · Ctrl-L run all' : '');
        if (showShortcutHints && followCursor && !running && promptOutputFocus && nextEvalRow !== undefined
            && (nextEvalRow < top || nextEvalRow >= top + viewportHeight))
            status = `next: line ${nextEvalSourceLine} · ${promptOutputFocus.active ? '←/→' : 'Enter'} · Esc · ^L run all`;
        status = clipped(status, Math.min(40, width));
        let label = running ? '' : fileStatus;
        if (label && followCursor) {
            const available = footerWidth - cellWidth(status) - 3;
            if (cellWidth(label) > available) {
                const separator = label.lastIndexOf(' · ');
                const state = separator >= 0 ? label.slice(separator) : '';
                const nameWidth = available - cellWidth(state) - 1;
                label = nameWidth >= 0 ? (nameWidth > 0 ? clipped(label, nameWidth) : '') + '…' + state
                    : available > 0 ? clipped(state.replace(/^ · /, ''), available) : '';
            }
        }
        footerLine = clipped(label && followCursor ? `${label} · ${status}` : status, footerWidth);
        if (followCursor && (running || RUN_TIME.test(suggestion))) {
            footerLine = '\x1b[90m' + footerLine + '\x1b[0m';
            statusRow = viewportHeight;
        }
    }
    if (footerLines) lines.splice(viewportHeight, 0, ...footerLines);
    else if (footerLine !== undefined) lines.splice(viewportHeight, 0, footerLine);
    return { lines, cursor: { row: Math.max(0, Math.min(viewportHeight - 1, caret.row - top)), column: caret.column },
        top, maxTop, targets: targets.slice(top, top + renderedHeight), factsRow, statusRow, factsRowCount: footerLines?.length,
        resultRows: resultRows.filter(row => row >= top && row < top + renderedHeight).map(row => row - top),
        cursorVisible: caret.row >= top && caret.row < top + viewportHeight, caretRow: caret.row,
        cursorStyle: promptOutputFocus ? 2 : promptFields?.some(field => field.active) ? 6
            : promptOutputs && !stepping ? 6 : notebook.atPrompt || stepping ? 2 : 6 };
}

/** The footer text of a finished fast run. */
export const RUN_TIME = /^Done in \d+\.\d\ds$/;

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

const NUMBER = /^-?(\d[\d_]*\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** A window of a held value: header, row labels and as many cells as the screen holds. */
export function viewerFrame(viewer: ValueViewer, columns: number, height: number): ScreenFrame {
    const width = Math.max(1, columns - 1);
    const view = viewer.view;
    const pad = (text: string, size: number, right: boolean): string =>
        right ? ' '.repeat(Math.max(0, size - cellWidth(text))) + text : text + ' '.repeat(Math.max(0, size - cellWidth(text)));
    const slice = view.kind === 'grid' && view.slice.length
        ? ` [${view.slice.map(item => item.index).join(', ')}${view.scroll.columns ? ', :, :' : ', :'}]` : '';
    const title = clipped(`${view.title} · ${view.typeLine}${slice}`, width);
    const header: string[] = [];
    const body: string[] = [];
    let position = '';
    if (view.kind === 'text') {
        body.push(...view.text.split('\n').map(line => clipped(line, width)));
    } else if (view.kind === 'list') {
        const keyWidth = Math.min(20, Math.max(3, ...view.rows.map(([key]) => cellWidth(key))));
        header.push('\x1b[90m' + clipped(pad('key', keyWidth, false) + '  value', width) + '\x1b[0m');
        body.push(...view.rows.map(([key, text]) => clipped(pad(clipped(key, keyWidth), keyWidth, false) + '  ' + text, width)));
        const { offset, count, length } = view.scroll;
        position = count ? `${offset + 1}–${offset + count} of ${length}` : 'empty';
        if (view.more) position += ' · m read more';
        if (view.note) position += ` · ${view.note}`;
        if (viewer.readNote) position += ` · ${viewer.readNote}`;
    } else {
        const labelWidth = Math.max(0, ...view.rowLabels.map(label => cellWidth(label)));
        const sizes = view.columnLabels.map((label, column) =>
            Math.max(cellWidth(label), ...view.cells.map(row => cellWidth(row[column] ?? ''))));
        const numeric = view.columnLabels.map((_, column) =>
            view.cells.length > 0 && view.cells.every(row => NUMBER.test((row[column] ?? '').trim())));
        // Every column that fits whole; the first is clipped rather than left out.
        let used = labelWidth + 3;
        let shown = 0;
        while (shown < sizes.length && (shown === 0 || used + sizes[shown] + 2 <= width)) {
            used += sizes[shown] + (shown ? 2 : 0);
            shown++;
        }
        viewer.shown = Math.max(1, shown);
        const render = (cells: readonly string[]): string => cells.slice(0, shown)
            .map((cell, column) => pad(cell, sizes[column], numeric[column])).join('  ');
        const heading = view.columnLabels.length === 1 && view.columnLabels[0] === '' ? ['value'] : view.columnLabels;
        header.push('\x1b[90m' + clipped(' '.repeat(labelWidth) + '   ' + render(heading), width) + '\x1b[0m');
        body.push(...view.cells.map((row, index) =>
            '\x1b[90m' + pad(view.rowLabels[index], labelWidth, true) + ' │\x1b[0m ' + clipped(render(row), Math.max(1, width - labelWidth - 3))));
        const { rows, columns: horizontal } = view.scroll;
        position = rows.count ? `rows ${rows.offset + 1}–${rows.offset + rows.count} of ${rows.length}` : 'empty';
        if (view.slice.length) position += ` · slice ${view.slice[0].index + 1} of ${view.slice[0].length}`;
        if (horizontal && horizontal.length > 1) {
            const last = Math.min(horizontal.offset + viewer.shown, horizontal.offset + horizontal.count);
            position += ` · columns ${horizontal.offset + 1}–${last} of ${horizontal.length}`;
        }
    }
    const keys = view.kind === 'grid' && view.slice.length ? '↑↓←→ PgUp/PgDn [ ] Esc'
        : view.kind === 'list' ? '↑↓ PgUp/PgDn Esc' : '↑↓←→ PgUp/PgDn Esc';
    const lines = ['\x1b[1m' + title + '\x1b[0m', ...(header.length ? header : ['']), ...body.slice(0, Math.max(0, height - 3))];
    while (lines.length < Math.max(1, height - 1)) lines.push('');
    if (height > 1) lines.push('\x1b[90m' + clipped(position ? `${position} · ${keys}` : keys, width) + '\x1b[0m');
    return { lines, top: 0, cursor: { row: 0, column: 0 }, cursorVisible: false };
}

/** Absolute addressing and explicit erasure; never infer where a previous write left the cursor. */
export function drawFrame(frame: ScreenFrame): string {
    let text = '\x1b[?25l';
    for (const [index, line] of frame.lines.entries()) text += `\x1b[${index + 1};1H\x1b[2K${line}`;
    return text + `\x1b[${frame.cursorStyle ?? 6} q` + `\x1b[${frame.cursor.row + 1};${frame.cursor.column + 1}H`
        + (frame.cursorVisible ? '\x1b[?25h' : '');
}
