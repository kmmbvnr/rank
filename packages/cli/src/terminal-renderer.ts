import type { PauseSnapshot } from '@arrrank/interpreter';
import type { NotebookRepl } from './repl.js';
import { drawFrame, helpFrame, notebookFrame, pauseFrame, saveFrame } from './screen.js';
import type { TerminalModeRouter } from './terminal-modes.js';

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

    constructor(
        private readonly repl: NotebookRepl,
        private readonly modes: TerminalModeRouter,
        private readonly output: TerminalOutput,
    ) {}

    get closed(): boolean { return this.stopped; }
    get columns(): number { return this.output.columns || 80; }
    get rows(): number { return this.output.rows || 24; }

    close(): void { this.stopped = true; }

    followKey(name?: string): void {
        this.followCursor = name !== 'pageup' && name !== 'pagedown';
    }

    page(delta: number): void {
        this.top = Math.max(0, this.top + delta * Math.max(1, this.rows - 2));
    }

    render(): void {
        if (this.stopped || !this.modes.allowRender()) return;
        const repl = this.repl;
        if (repl.savePrompt) {
            const prompt = repl.savePrompt;
            this.output.write(drawFrame(saveFrame(prompt.choosing ? undefined : prompt.filename,
                prompt.error, this.columns, this.rows, prompt.exitAfterSave, repl.running, !!prompt.loadFile)));
            return;
        }
        const pause = repl.pauseSnapshot;
        if (pause) this.lastPause = pause;
        if (repl.running && (pause || this.modes.waitingForPause && this.lastPause)) {
            const frame = pauseFrame(pause ?? this.lastPause!, this.columns, this.rows, repl.pauseTop,
                pause ? this.modes.pauseStatus : repl.runningStatus);
            repl.pauseTop = frame.top;
            this.output.write(drawFrame(frame));
            return;
        }
        if (repl.help) {
            const frame = helpFrame(repl.help.text, this.columns, this.rows, repl.help.top);
            repl.help.top = frame.top;
            this.output.write(drawFrame(frame));
            return;
        }
        if (!repl.running) this.lastPause = undefined;
        const frame = notebookFrame(repl.notebook, this.columns, this.rows,
            this.top, repl.suggestion, repl.running, this.followCursor, repl.fileStatus, repl.runningStatus,
            repl.breakpoints, repl.promptLabel, repl.liveOutputs, repl.exampleFields);
        this.top = frame.top;
        this.output.write(drawFrame(frame));
    }
}
