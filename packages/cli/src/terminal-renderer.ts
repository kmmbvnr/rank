import type { PauseSnapshot } from '@arrrank/interpreter';
import type { NotebookRepl } from './repl.js';
import { drawFrame, editableRows, helpFrame, notebookFrame, pauseFrame, saveFrame } from './screen.js';
import type { Key } from './key-router.js';
import type { ScreenTarget } from './screen.js';
import type { TerminalModeRouter } from './terminal-modes.js';
import type { Notebook } from './notebook.js';

interface TerminalOutput {
    readonly columns?: number;
    readonly rows?: number;
    write(text: string): unknown;
}

/** Owns terminal viewport state and selects the frame for the active REPL mode. */
export class TerminalRenderer {
    private top = 0;
    private followCursor = true;
    private stopped = false;
    private lastPause?: PauseSnapshot;
    private lastPauseToken?: PauseSnapshot;
    private copyTop: number | undefined;
    private targets: readonly (ScreenTarget | undefined)[] = [];
    private cursorRow?: number;
    private anchoredCursorRow?: number;
    private mouseEditor?: { book: Notebook; field?: number };

    click(column: number, row: number): void {
        if (this.stopped || this.copying || this.modes.active) return;
        this.anchoredCursorRow = undefined;
        const target = this.targets[row];
        if (!target || !target.points.length) return;
        const point = target.points.reduce((nearest, point) =>
            Math.abs(point.column - column) < Math.abs(nearest.column - column) ? point : nearest);
        const repl = this.repl;
        this.mouseEditor = undefined;
        repl.notebook.clearSelection();
        repl.exampleEditor?.clearSelection();
        if (target.kind === 'example') {
            if (!repl.exampleEditor && !repl.reopenExample()) return;
            repl.moveExampleField(target.field! - repl.examplePrompt!.index);
            repl.exampleEditor!.cursor = point.offset;
            this.mouseEditor = { book: repl.exampleEditor!, field: target.field };
        } else if (target.kind === 'source') {
            if (repl.examplePrompt) repl.moveExampleField(-repl.examplePrompt.index - 1);
            repl.releaseLiveIteration();
            repl.notebook.active = target.cell;
            repl.notebook.cursor = point.offset;
            this.mouseEditor = { book: repl.notebook };
        }
        repl.dismiss();
        repl.notebook.discardEmptyLine();
        this.followCursor = true;
        this.render();
    }

    drag(column: number, row: number, released: boolean): void {
        const editor = this.mouseEditor;
        if (released) this.mouseEditor = undefined;
        if (!editor || this.stopped || this.copying || this.modes.active) return;
        const target = this.targets[row];
        if (!target?.points.length || (editor.field === undefined ? target.kind !== 'source'
            : target.kind !== 'example' || target.field !== editor.field)) return;
        const point = target.points.reduce((nearest, point) =>
            Math.abs(point.column - column) < Math.abs(nearest.column - column) ? point : nearest);
        editor.book.selectTo(editor.field === undefined ? target.cell : 0, point.offset, true);
        this.followCursor = true;
        this.render();
    }

    constructor(
        private readonly repl: NotebookRepl,
        private readonly modes: TerminalModeRouter,
        private readonly output: TerminalOutput,
    ) {}

    get closed(): boolean { return this.stopped; }
    get columns(): number { return this.output.columns || 80; }
    get rows(): number { return this.output.rows || 24; }
    get copying(): boolean { return this.copyTop !== undefined; }

    copyKey(key: Key): boolean {
        // Node decodes the legacy Ctrl-H byte as Backspace; DEL remains deletion.
        if (key.sequence === '\x08' || key.ctrl && key.name === 'h') {
            this.copyTop = this.copying ? undefined : 0;
        } else if (!this.copying) return false;
        else if (key.name === 'escape') this.copyTop = undefined;
        else if (key.ctrl && key.name === 'q') {
            this.copyTop = undefined;
            return false;
        } else if (key.name === 'up' || key.name === 'down') {
            this.copyTop! += key.name === 'up' ? -1 : 1;
        } else if (key.name === 'pageup' || key.name === 'pagedown') {
            this.copyTop! += (key.name === 'pageup' ? -1 : 1) * this.rows;
        } else if (key.name === 'home') this.copyTop = 0;
        else if (key.name === 'end') this.copyTop = Number.MAX_SAFE_INTEGER;
        return true;
    }

    close(): void { this.stopped = true; }

    followKey(name?: string, anchorCursor = false): void {
        this.anchoredCursorRow = anchorCursor ? this.cursorRow : undefined;
        this.followCursor = name !== 'pageup' && name !== 'pagedown';
    }

    page(delta: number): void {
        this.top = Math.max(0, this.top + delta * Math.max(1, this.rows - 2));
    }

    scroll(direction: number): void {
        if (this.stopped || this.copying || this.repl.savePrompt) return;
        const delta = direction * 3;
        this.anchoredCursorRow = undefined;
        if (this.repl.help) this.repl.help.top = Math.max(0, this.repl.help.top + delta);
        else if (this.repl.pauseSnapshot)
            this.repl.pauseTop = Math.max(0, this.repl.pauseTop + delta);
        else {
            this.followCursor = false;
            this.top = Math.max(0, this.top + delta);
        }
        this.render();
    }

    render(): void {
        if (this.stopped || !this.modes.allowRender()) return;
        this.targets = [];
        const mouse = this.copying ? '\x1b[?1000l\x1b[?1002l' : '\x1b[?1000h\x1b[?1002h';
        const repl = this.repl;
        if (this.copying) {
            const source = repl.notebook.cells.filter(cell => !cell.command).map(cell => cell.source).join('\n');
            const rows = editableRows(source, Math.max(1, this.columns - 1)).map(row => row.text);
            this.copyTop = Math.max(0, Math.min(this.copyTop!, rows.length - this.rows));
            const lines = rows.slice(this.copyTop, this.copyTop + this.rows);
            while (lines.length < this.rows) lines.push('');
            this.output.write(mouse + drawFrame({ lines, top: this.copyTop,
                cursor: { row: 0, column: 0 }, cursorVisible: false }));
            return;
        }
        if (repl.savePrompt) {
            const prompt = repl.savePrompt;
            this.output.write(mouse + drawFrame(saveFrame(prompt.choosing ? undefined : prompt.filename,
                prompt.error, this.columns, this.rows, prompt.exitAfterSave, repl.running, !!prompt.loadFile)));
            return;
        }
        const pause = repl.pauseSnapshot;
        if (pause && repl.session.pauseState !== this.lastPauseToken) {
            this.lastPause = pause;
            this.lastPauseToken = repl.session.pauseState;
        }
        if (repl.running && (pause || this.modes.waitingForPause && this.lastPause)) {
            const frame = pauseFrame(pause ?? this.lastPause!, this.columns, this.rows, repl.pauseTop,
                pause ? this.modes.pauseStatus : repl.runningStatus);
            repl.pauseTop = frame.top;
            this.output.write(mouse + drawFrame(frame));
            return;
        }
        if (repl.help) {
            const frame = helpFrame(repl.help.text, this.columns, this.rows, repl.help.top);
            repl.help.top = frame.top;
            this.output.write(mouse + drawFrame(frame));
            return;
        }
        if (!repl.running) { this.lastPause = undefined; this.lastPauseToken = undefined; }
        if (this.anchoredCursorRow !== undefined && repl.notebook.atPrompt && !repl.liveEditing) {
            // Finishing Ctrl-R returns to the prompt; keep its result in view
            // instead of pinning the prompt to the old source row.
            this.anchoredCursorRow = undefined;
            this.top = 0;
        }
        const frame = notebookFrame(repl.notebook, this.columns, this.rows,
            this.top, repl.suggestion, repl.running, this.followCursor, repl.fileStatus, repl.runningStatus,
            repl.breakpoints, repl.promptLabel, repl.liveOutputs, repl.exampleFields, repl.liveIterationFocus, repl.stepping,
            this.anchoredCursorRow, true, 0, repl.diagnosticOutputs);
        this.top = frame.top;
        this.cursorRow = frame.cursorVisible ? frame.cursor.row : undefined;
        this.targets = frame.targets ?? [];
        this.output.write(mouse + drawFrame(frame));
    }
}
