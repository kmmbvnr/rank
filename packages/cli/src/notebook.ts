import { EMPTY_CELL, addLine, cellSource, closeCell, isComplete, isEmpty, insideText, nextIndent, scanLine } from './repl-input.js';
import type { Execution, OutputLine } from './repl-session.js';
import { editableRows, graphemes, type TextRow } from './screen.js';
import { parse } from '@rank/interpreter';

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

interface Edit { source: string; cursor: number }

/** Source and cursor are independent of terminal rows and execution state. */
export class Notebook {
    readonly cells: NotebookCell[] = [];
    active = 0;
    cursor = 0;
    replayFrom?: number;
    private nextId = 0;
    private preferredColumn?: number;
    private readonly undoStack = new Map<number, Edit[]>();
    private readonly redoStack = new Map<number, Edit[]>();

    constructor() { this.append(); }

    clear(): void {
        this.cells.length = 0;
        this.undoStack.clear();
        this.redoStack.clear();
        this.replayFrom = undefined;
        this.nextId = 0;
        this.append();
        this.toPrompt();
    }
    get current(): NotebookCell { return this.cells[this.active]; }
    get atPrompt(): boolean { return this.active === this.cells.length - 1; }
    get dirtyFrom(): number {
        const changed = this.cells.findIndex((cell, i) => i < this.cells.length - 1
            && cell.executed !== cell.source && !cell.command);
        return this.replayFrom === undefined ? changed
            : changed < 0 ? this.replayFrom : Math.min(changed, this.replayFrom);
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
        this.active = this.cells.length - 1;
        this.cursor = this.current.source.length;
        this.preferredColumn = undefined;
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
        if (source !== this.current.source) {
            const history = this.undoStack.get(this.current.id) ?? [];
            history.push({ source: this.current.source, cursor: this.cursor });
            if (history.length > 200) history.shift();
            this.undoStack.set(this.current.id, history);
            this.redoStack.delete(this.current.id);
            this.current.source = source;
        }
        this.cursor = Math.max(0, Math.min(cursor, source.length));
        this.preferredColumn = undefined;
    }

    insert(text: string, typed = false): void {
        const source = this.current.source;
        const prefix = source.slice(0, this.cursor);
        if (typed && text === ',' && !insideText(prefix.slice(prefix.lastIndexOf('\n') + 1))) text = '=';
        this.replace(prefix + text + source.slice(this.cursor), this.cursor + text.length);
    }

    newline(): void {
        const prefix = this.current.source.slice(0, this.cursor);
        const line = prefix.slice(prefix.lastIndexOf('\n') + 1);
        const indent = /^ */.exec(line)![0];
        const scan = scanLine(line);
        const extra = scan.opens.length > scan.closes || scan.folds ? '  ' : '';
        this.insert('\n' + indent + extra);
    }

    erase(backward: boolean): void {
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

    vertical(direction: number, columns: number): void {
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
            if (next < 0 || next >= this.cells.length) return;
            const fromPrompt = this.atPrompt;
            this.active = next;
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
        const from = redo ? this.redoStack : this.undoStack;
        const to = redo ? this.undoStack : this.redoStack;
        const item = from.get(this.current.id)?.pop();
        if (!item) return;
        const history = to.get(this.current.id) ?? [];
        history.push({ source: this.current.source, cursor: this.cursor });
        to.set(this.current.id, history);
        this.current.source = item.source;
        this.cursor = item.cursor;
        this.preferredColumn = undefined;
    }

    /** The bottom prompt retains the original REPL's blocks and folded expressions. */
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
