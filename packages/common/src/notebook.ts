import {
    EMPTY_CELL, addLine, cellSource, closeCell, isComplete, isEmpty,
    nextIndent, scanLine, startsDedent, typeAssignKey,
} from './repl-input.js';
import type { Execution, OutputLine } from './repl-session.js';
import { editableRows, graphemes, type TextRow } from './screen.js';
import { parse } from '@arrrank/interpreter';

/** Keep top-level statements separate, with their blocks and source spacing intact. */
export function splitSource(source: string): string[] {
    const text = source.replace(/\r\n/g, '\n');
    if (text === '') return [];
    const lines = (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n');
    const ends = new Map<number, number>();
    try {
        for (const statement of parse(text).statements) {
            const range = statement.$cstNode!.range;
            ends.set(range.start.line, range.end.line);
        }
    } catch {
        // A file with a syntax error must still open for correction.
        let state = EMPTY_CELL;
        let start = 0;
        for (const [index, line] of lines.entries()) {
            state = addLine(state, line.trim(), true);
            if (isComplete(state)) {
                ends.set(start, index);
                start = index + 1;
                state = EMPTY_CELL;
            }
        }
        if (start < lines.length) ends.set(start, lines.length - 1);
    }
    const cells: string[] = [];
    for (let start = 0; start < lines.length;) {
        const end = ends.get(start) ?? start;
        cells.push(lines.slice(start, end + 1).join('\n'));
        start = end + 1;
    }
    return cells;
}

export interface NotebookCell {
    readonly id: number;
    source: string;
    executed?: string;
    output: OutputLine[];
    command: boolean;
    fileSource?: boolean;
    errorOffset?: number;
    status: 'idle' | 'running' | 'ok' | 'error' | 'interrupted';
}

function clearEmptyResult(cell: NotebookCell): void {
    if (cell.source.trim() !== '') return;
    cell.output = [];
    cell.errorOffset = undefined;
    cell.status = 'idle';
}

interface Edit { source: string; cursor: number; document?: NotebookCell[]; replayFrom?: number }

/** Source and cursor are independent of terminal rows and execution state. */
export class Notebook {
    readonly cells: NotebookCell[] = [];
    active = 0;
    cursor = 0;
    replayFrom?: number;
    private nextId = 0;
    private experimentalFrom?: number;
    private preferredColumn?: number;
    private temporaryHead?: number;
    private selectionAnchor?: { id: number; offset: number };
    private temporaryLine?: { cell: NotebookCell; source: string; start: number; end: number };
    private readonly undoStack = new Map<number, Edit[]>();
    private readonly redoStack = new Map<number, Edit[]>();

    constructor() { this.append(); }

    clear(): void {
        this.clearSelection();
        this.cells.length = 0;
        this.undoStack.clear();
        this.redoStack.clear();
        this.replayFrom = undefined;
        this.experimentalFrom = undefined;
        this.temporaryHead = undefined;
        this.temporaryLine = undefined;
        this.nextId = 0;
        this.append();
        this.toPrompt();
    }
    get current(): NotebookCell { return this.cells[this.active]; }
    get atPrompt(): boolean { return this.active === this.cells.length - 1; }
    get selection(): { start: number; from: number; end: number; to: number } | undefined {
        const anchor = this.selectionAnchor;
        if (!anchor) return undefined;
        const index = this.cells.findIndex(cell => cell.id === anchor.id);
        if (index < 0 || index === this.active && anchor.offset === this.cursor) return undefined;
        return index < this.active || index === this.active && anchor.offset < this.cursor
            ? { start: index, from: anchor.offset, end: this.active, to: this.cursor }
            : { start: this.active, from: this.cursor, end: index, to: anchor.offset };
    }

    clearSelection(): void { this.selectionAnchor = undefined; }

    selectTo(cell: number, cursor: number, extend = false): void {
        if (extend) this.selectionAnchor ??= { id: this.current.id, offset: this.cursor };
        else this.clearSelection();
        this.temporaryLine = undefined;
        this.temporaryHead = undefined;
        this.active = cell;
        this.cursor = Math.max(0, Math.min(cursor, this.current.source.length));
        this.preferredColumn = undefined;
    }

    selectionRange(index: number): { from: number; to: number } | undefined {
        const selected = this.selection;
        if (!selected || index < selected.start || index > selected.end || this.cells[index].command) return undefined;
        return { from: index === selected.start ? selected.from : 0,
            to: index === selected.end ? selected.to : this.cells[index].source.length + 1 };
    }

    get selectedText(): string {
        return this.cells.flatMap((cell, index) => {
            const range = this.selectionRange(index);
            return range ? [cell.source.slice(range.from, range.to)] : [];
        }).join('\n');
    }

    selectMove(key: string, columns: number): void {
        this.selectionAnchor ??= { id: this.current.id, offset: this.cursor };
        // A selection must not create or remove temporary source rows.
        this.temporaryLine = undefined;
        this.temporaryHead = undefined;
        if (key === 'up' || key === 'down') this.vertical(key === 'up' ? -1 : 1, columns);
        else if (key === 'home' || key === 'end') this.lineEdge(key === 'end');
        else {
            const direction = key === 'left' ? -1 : 1;
            if (direction < 0 ? this.cursor === 0 : this.cursor === this.current.source.length) {
                let next = this.active + direction;
                while (next >= 0 && next < this.cells.length && this.cells[next].command) next += direction;
                if (next >= 0 && next < this.cells.length) {
                    this.active = next;
                    this.cursor = direction < 0 ? this.current.source.length : 0;
                }
            } else this.horizontal(direction);
        }
    }

    replaceSelection(text: string): boolean {
        const range = this.selection;
        if (!range) return false;
        const first = this.cells[range.start];
        const source = first.source.slice(0, range.from) + text + this.cells[range.end].source.slice(range.to);
        if (range.start === range.end) this.replace(source, range.from + text.length);
        else {
            const history = this.undoStack.get(first.id) ?? [];
            history.push({ source: first.source, cursor: range.from,
                document: this.cells.map(cell => ({ ...cell })), replayFrom: this.replayFrom });
            if (history.length > 200) history.shift();
            this.undoStack.set(first.id, history);
            this.redoStack.delete(first.id);
            const includesPrompt = range.end === this.cells.length - 1;
            this.cells.splice(range.start + 1, range.end - range.start);
            first.source = source;
            clearEmptyResult(first);
            if (includesPrompt) this.append();
            this.active = range.start;
            this.cursor = range.from + text.length;
            this.replayFrom = Math.min(this.replayFrom ?? range.start, range.start);
        }
        this.clearSelection();
        this.preferredColumn = undefined;
        return true;
    }
    get dirtyFrom(): number {
        const changed = this.cells.findIndex((cell, i) => i < this.cells.length - 1
            && cell.executed !== cell.source && !cell.command);
        return this.replayFrom === undefined ? changed
            : changed < 0 ? this.replayFrom : Math.min(changed, this.replayFrom);
    }

    /** Replaying against retained state breaks the sequential-run provenance. */
    beginExecution(start: number): void {
        if (this.cells.slice(start, -1).some(cell => !cell.command && cell.executed?.trim())) {
            this.experimentalFrom = Math.min(this.experimentalFrom ?? Infinity, this.cells[start].id);
        }
    }

    isExperimental(index: number): boolean {
        return this.experimentalFrom !== undefined && this.cells[index].id >= this.experimentalFrom;
    }

    resetExecution(): void {
        this.experimentalFrom = undefined;
        this.replayFrom = undefined;
        for (const cell of this.cells) {
            if (cell.command) continue;
            cell.executed = undefined;
            cell.output = [];
            cell.errorOffset = undefined;
            cell.status = 'idle';
        }
    }

    enqueue(source: string, fileSource = false): void {
        this.toPrompt();
        this.current.source = source;
        this.current.fileSource = fileSource;
        if (source.trim() === '') this.current.executed = source;
        this.append();
        this.toPrompt();
    }

    private append(): void {
        this.cells.push({ id: this.nextId++, source: '', output: [], command: false, status: 'idle' });
    }

    toPrompt(): void {
        this.clearSelection();
        this.active = this.cells.length - 1;
        this.discardEmptyHead();
        this.cursor = this.current.source.length;
        this.preferredColumn = undefined;
    }

    private discardEmptyHead(): void {
        if (this.temporaryHead === undefined || this.active === 0) return;
        const head = this.cells[0];
        if (head?.id === this.temporaryHead && head.source === '') {
            this.cells.shift();
            this.active--;
            this.undoStack.delete(head.id);
            this.redoStack.delete(head.id);
            if (this.replayFrom !== undefined) this.replayFrom = Math.max(0, this.replayFrom - 1);
        }
        this.temporaryHead = undefined;
    }

    focusError(index: number): void {
        this.active = index;
        this.cursor = this.current.errorOffset ?? this.current.source.length;
        this.lineEdge(true);
    }

    /** Commands are transient: they have output but do not become program text. */
    fileLines(): string[] {
        return this.cells.filter((cell, i) => !cell.command && i < this.cells.length - 1)
            .flatMap(cell => cell.source.split('\n'));
    }

    replace(source: string, cursor = source.length): void {
        this.clearSelection();
        if (source !== this.current.source) {
            const history = this.undoStack.get(this.current.id) ?? [];
            history.push({ source: this.current.source, cursor: this.cursor });
            if (history.length > 200) history.shift();
            this.undoStack.set(this.current.id, history);
            this.redoStack.delete(this.current.id);
            this.current.source = source;
            clearEmptyResult(this.current);
        }
        this.cursor = Math.max(0, Math.min(cursor, source.length));
        this.preferredColumn = undefined;
    }

    insert(text: string, typed = false): void {
        // The assign key rewrites the line it lands on, so it replaces any selection first.
        if (typed && text === ',' && this.selection) this.replaceSelection('');
        if (this.selection) {
            this.replaceSelection(text);
            return;
        }
        const source = this.current.source;
        const prefix = source.slice(0, this.cursor);
        const suffix = source.slice(this.cursor);
        if (typed && text === ',') {
            const start = prefix.lastIndexOf('\n') + 1;
            const assign = typeAssignKey(prefix.slice(start), suffix.split('\n')[0]);
            if (assign !== undefined) {
                this.replace(source.slice(0, start) + assign + suffix, start + assign.length);
                return;
            }
        }
        this.replace(prefix + text + suffix, this.cursor + text.length);
    }

    newline(): void {
        const prefix = this.current.source.slice(0, this.cursor);
        const line = prefix.slice(prefix.lastIndexOf('\n') + 1);
        const indent = /^ */.exec(line)![0];
        const scan = scanLine(line);
        const extra = scan.opens.length > scan.closes || scan.folds ? '  ' : '';
        this.insert('\n' + indent + extra);
    }

    indentToCode(): boolean {
        const source = this.current.source;
        const start = source.lastIndexOf('\n', this.cursor - 1) + 1;
        const end = source.indexOf('\n', start);
        const line = source.slice(start, end < 0 ? source.length : end);
        const leading = /^ */.exec(line)![0];
        if (this.cursor > start + leading.length) return false;
        let state = EMPTY_CELL;
        for (const previous of source.slice(0, start).split('\n')) {
            if (previous.trim()) state = addLine(state, previous.trim(), true);
        }
        const indent = nextIndent(state, startsDedent(line));
        const target = start + Math.max(indent.length, leading.length);
        if (this.cursor >= target) return false;
        if (leading.length < indent.length)
            this.replace(source.slice(0, start) + indent + source.slice(start + leading.length), target);
        else this.cursor = target;
        return true;
    }

    temporaryNewline(): void {
        this.discardEmptyLine();
        if (this.temporaryLine) {
            if (!this.temporaryLine.source.slice(this.temporaryLine.start, this.temporaryLine.end).trim()) return;
            this.temporaryLine = undefined;
        }
        this.newline();
        const source = this.current.source;
        const start = source.lastIndexOf('\n', this.cursor - 1) + 1;
        const end = source.indexOf('\n', this.cursor);
        const stop = end < 0 ? source.length : end;
        if (!source.slice(start, stop).trim())
            this.temporaryLine = { cell: this.current, source, start, end: stop };
    }

    discardEmptyLine(): void {
        const pending = this.temporaryLine;
        if (!pending) return;
        if (pending.cell.source !== pending.source) {
            const source = pending.cell.source;
            const suffix = pending.source.slice(pending.end);
            const end = source.length - suffix.length;
            if (!source.startsWith(pending.source.slice(0, pending.start)) || !source.endsWith(suffix)
                || end < pending.start || source.slice(pending.start, end).includes('\n')) {
                this.temporaryLine = undefined;
                return;
            }
            pending.source = source;
            pending.end = end;
        }
        if (this.current === pending.cell && this.cursor >= pending.start && this.cursor <= pending.end) return;
        this.temporaryLine = undefined;
        if (pending.source.slice(pending.start, pending.end).trim()) return;
        const from = pending.start - 1;
        pending.cell.source = pending.source.slice(0, from) + pending.source.slice(pending.end);
        if (this.current === pending.cell && this.cursor > pending.end)
            this.cursor -= pending.end - from;
    }

    erase(backward: boolean): void {
        if (this.replaceSelection('')) return;
        const source = this.current.source;
        if (backward && source === '') {
            let index = this.active;
            if (this.atPrompt) {
                index -= 1;
                while (index >= 0 && this.cells[index].command) index -= 1;
                if (index < 0) return;
                if (this.cells[index].source !== '') {
                    this.active = index;
                    this.cursor = this.current.source.length;
                    this.preferredColumn = undefined;
                    return;
                }
            }
            const pending = this.dirtyFrom;
            const [removed] = this.cells.splice(index, 1);
            this.undoStack.delete(removed.id);
            this.redoStack.delete(removed.id);
            const nextPending = pending > index ? pending - 1 : pending;
            this.replayFrom = nextPending >= 0 && nextPending < this.cells.length - 1 ? nextPending : undefined;
            // An empty cell right above an empty prompt folds into it, where the cursor already was.
            if (index === this.active && index === this.cells.length - 1 && this.cells[index].source === '') {
                this.toPrompt();
                return;
            }
            let previous = index - 1;
            while (previous >= 0 && this.cells[previous].command) previous -= 1;
            this.active = previous >= 0 ? previous : Math.min(index, this.cells.length - 1);
            this.cursor = previous >= 0 ? this.current.source.length : 0;
            this.preferredColumn = undefined;
            return;
        }
        const stops = [0, ...graphemes(source).map(part => part.index + part.segment.length)];
        const from = backward ? stops.filter(at => at < this.cursor).at(-1) ?? 0 : this.cursor;
        const to = backward ? this.cursor : stops.find(at => at > this.cursor) ?? source.length;
        this.replace(source.slice(0, from) + source.slice(to), from);
        if (backward) this.dropClearedLine(source);
    }

    /** Erasing the last character of a cell's last line removes the line too, so
     * no blank row is left hanging; an empty prompt right below takes the cursor. */
    dropClearedLine(before: string): void {
        if (this.atPrompt) return;
        const source = this.current.source;
        const start = source.lastIndexOf('\n') + 1;
        if (this.cursor < start || source.slice(start).trim()
            || !before.slice(before.lastIndexOf('\n') + 1).trim()) return;
        const promptBelow = this.active === this.cells.length - 2 && this.cells.at(-1)!.source === '';
        this.replace(source.slice(0, Math.max(0, start - 1)));
        if (this.current.source === '') this.erase(true);
        else if (promptBelow) this.toPrompt();
    }

    horizontal(direction: number): void {
        const stops = [0, ...graphemes(this.current.source).map(part => part.index + part.segment.length)];
        this.cursor = direction < 0
            ? stops.filter(at => at < this.cursor).at(-1) ?? 0
            : stops.find(at => at > this.cursor) ?? this.current.source.length;
        this.preferredColumn = undefined;
    }

    lineEdge(end: boolean): void {
        const text = this.current.source;
        this.cursor = end ? text.indexOf('\n', this.cursor) : text.lastIndexOf('\n', this.cursor - 1) + 1;
        if (this.cursor < 0) this.cursor = text.length;
        this.preferredColumn = undefined;
    }

    vertical(direction: number, columns: number, allowPrepend = false): void {
        const rows = editableRows(this.current.source, columns);
        // At a wrap boundary the caret belongs to the following visual row.
        let row = 0;
        rows.forEach((item, index) => {
            if (item.points.some(point => point.offset === this.cursor)) row = index;
        });
        const here = rows[row].points.find(point => point.offset === this.cursor)!;
        this.preferredColumn ??= here.column;
        let target: TextRow | undefined = rows[row + direction];
        if (!target) {
            let next = this.active + direction;
            while (next >= 0 && next < this.cells.length && this.cells[next].command) next += direction;
            if (next < 0 && allowPrepend && this.current.source.trim() !== '') {
                this.cells.unshift({ id: this.cells[0].id - 1, source: '', executed: '',
                    output: [], command: false, status: 'idle' });
                this.temporaryHead = this.cells[0].id;
                if (this.replayFrom !== undefined) this.replayFrom += 1;
                this.active = 0;
                this.cursor = 0;
                this.preferredColumn = undefined;
                return;
            }
            if (next < 0 || next >= this.cells.length) return;
            const fromPrompt = this.atPrompt;
            this.active = next;
            this.discardEmptyHead();
            if (fromPrompt && direction < 0) {
                this.cursor = this.current.source.length;
                this.preferredColumn = undefined;
                return;
            }
            const adjacent = editableRows(this.current.source, columns);
            target = direction < 0 ? adjacent.at(-1)! : adjacent[0];
        }
        const point = [...target.points].reverse().find(point => point.column <= this.preferredColumn!)
            ?? target.points[0];
        this.cursor = point.offset;
    }

    undo(redo = false): void {
        this.clearSelection();
        const from = redo ? this.redoStack : this.undoStack;
        const to = redo ? this.undoStack : this.redoStack;
        const item = from.get(this.current.id)?.pop();
        if (!item) return;
        const history = to.get(this.current.id) ?? [];
        history.push({ source: this.current.source, cursor: this.cursor,
            ...(item.document ? { document: this.cells.map(cell => ({ ...cell })), replayFrom: this.replayFrom } : {}) });
        to.set(this.current.id, history);
        if (item.document) {
            this.cells.splice(0, this.cells.length, ...item.document);
            this.replayFrom = item.replayFrom;
        }
        this.current.source = item.source;
        this.cursor = item.cursor;
        this.preferredColumn = undefined;
    }

    /** The bottom prompt retains the original REPL's blocks and folded expressions. */
    formatCurrentLine(format = (line: string) => line): void {
        const source = this.current.source;
        const start = source.lastIndexOf('\n', this.cursor - 1) + 1;
        const foundEnd = source.indexOf('\n', this.cursor);
        const end = foundEnd < 0 ? source.length : foundEnd;
        const raw = source.slice(start, end).trim();
        if (!raw) return;
        let state = EMPTY_CELL;
        for (const line of source.slice(0, start).split('\n')) {
            if (line.trim()) state = addLine(state, format(line.trim()), true);
        }
        const line = format(raw);
        const formatted = nextIndent(state, startsDedent(line)) + line;
        this.replace(source.slice(0, start) + formatted + source.slice(end), start + formatted.length);
    }

    preparePrompt(format = (line: string) => line): string | undefined {
        let state = EMPTY_CELL;
        const lines = this.current.source.split('\n');
        for (const [index, line] of lines.entries()) {
            if (line.trim() === '') {
                if (index === lines.length - 1 && !isEmpty(state)) state = closeCell(state);
                continue;
            }
            state = addLine(state, format(line.trim()), index < lines.length - 1);
        }
        if (isEmpty(state)) return '';
        if (isComplete(state)) return cellSource(state);
        this.insert('\n' + nextIndent(state));
        return undefined;
    }

    finish(index: number, result: Execution): void {
        const cell = this.cells[index];
        cell.source = result.source;
        cell.executed = result.source;
        cell.command = result.command;
        cell.output = result.output;
        cell.errorOffset = result.errorOffset;
        cell.status = result.interrupted ? 'interrupted' : result.ok ? 'ok' : 'error';
        // Execution-time formatting is not another edit, but undo still reaches the typed source.
        if (index === this.cells.length - 1) this.append();
        if (this.active === index) this.cursor = Math.min(this.cursor, cell.source.length);
    }
}
