import type { Notebook } from './notebook.js';
import type { ReplSession } from './repl-types.js';

/** Runs committed cells and owns transient running and interruption state. */
export class ExecutionRunner {
    running = false;
    private startedAt?: number;
    private stopping = false;
    private steppedPrefix?: { id: number; source: string; next: number };

    constructor(
        private readonly notebook: Notebook,
        private readonly session: ReplSession,
        private readonly breakpoints: Map<number, Set<number>>,
        private readonly columns: () => number,
        private readonly render: () => void,
    ) {}

    get status(): string {
        if (this.startedAt === undefined) return 'Running…';
        return `${this.stopping ? 'Stopping…' : this.session.pauseRequested ? 'Pausing…' : 'Running…'} ${((performance.now() - this.startedAt) / 1000).toFixed(1)}s · ^C stop · ^P pause`;
    }

    setRunning(value: boolean): void { this.running = value; }

    interrupt(): void {
        if (this.startedAt === undefined || !this.session.interrupt) return;
        this.stopping = true;
        this.session.interrupt();
        this.render();
    }

    togglePause(): void {
        if (this.session.pauseRequested) this.session.resume?.();
        else if (!this.stopping) this.session.pause?.();
        this.render();
    }

    async exclusive<T>(task: () => Promise<T>): Promise<T> {
        this.running = true;
        try { return await task(); }
        finally { this.running = false; this.render(); }
    }

    async prepareFunctions(start = 0): Promise<void> {
        const cells = this.notebook.cells.slice(start, -1).filter(cell => !cell.command);
        const results = await this.session.prepareFunctions(cells.map(({ id, source }) => ({ id, source })));
        for (const result of results) {
            const cell = cells.find(cell => cell.id === result.id)!;
            cell.output = result.output;
            cell.errorOffset = result.errorOffset;
            cell.status = result.output.some(line => line.error) ? 'error' : 'idle';
        }
        this.render();
    }

    async execute(draft: string, command: boolean, force: boolean): Promise<boolean> {
        this.steppedPrefix = undefined;
        const book = this.notebook;
        if (draft.trim() !== '' || !force && book.dirtyFrom < 0) book.enqueue(draft);
        if (command) book.cells[book.cells.length - 2].command = true;
        const start = book.dirtyFrom;
        if (start < 0 && !command) return false;
        this.running = true;
        try {
            if (command) {
                const index = book.cells.length - 2;
                const exit = await this.run(index, draft);
                const cell = book.cells[index];
                if (!cell.command && cell.status === 'error') {
                    book.replayFrom = Math.min(book.dirtyFrom < 0 ? index : book.dirtyFrom, index);
                    book.focusError(index);
                } else book.toPrompt();
                return exit;
            }
            book.beginExecution(start);
            this.session.rewind(book.cells[start].id);
            await this.prepareFunctions(start);
            const end = book.cells.length - 1;
            for (let index = start; index < end; index++) {
                const cell = book.cells[index];
                if (cell.command) continue;
                if (cell.source.trim() === '') {
                    cell.executed = cell.source;
                    cell.output = [];
                    cell.errorOffset = undefined;
                    cell.status = 'idle';
                    continue;
                }
                book.replayFrom = index;
                if (await this.run(index, cell.source)) return true;
                if (cell.status === 'interrupted') {
                    book.replayFrom = index + 1 < end ? index + 1 : undefined;
                    book.toPrompt();
                    return false;
                }
                if (cell.status === 'error') {
                    book.focusError(index);
                    return false;
                }
            }
            book.replayFrom = undefined;
            book.toPrompt();
            return false;
        } finally {
            this.running = false;
            this.session.endDebugRun?.();
            this.render();
        }
    }

    async executeOne(index: number, source: string, offset: number): Promise<boolean> {
        const book = this.notebook;
        const cell = book.cells[index];
        const original = cell.source;
        const partial = source !== original;
        return this.exclusive(async () => {
            book.beginExecution(index);
            const exit = await this.run(index, source, partial ? { source: original, offset } : undefined);
            const consecutive = offset === 0 || this.steppedPrefix?.id === cell.id
                && this.steppedPrefix.source === original && this.steppedPrefix.next === offset;
            this.steppedPrefix = partial && cell.status === 'ok' && consecutive
                ? { id: cell.id, source: original, next: offset + source.length + 1 } : undefined;
            if (this.steppedPrefix && offset + source.length === original.length) {
                cell.executed = original;
                this.steppedPrefix = undefined;
            }
            book.replayFrom = index + 1 < book.cells.length - 1 ? index + 1 : undefined;
            if (cell.status === 'error') {
                book.replayFrom = index;
                book.focusError(index);
            }
            this.session.endDebugRun?.();
            return exit;
        });
    }

    private async run(index: number, source: string, enclosing?: { source: string; offset: number }): Promise<boolean> {
        const book = this.notebook;
        const cell = book.cells[index];
        book.active = index;
        book.cursor = cell.source.length;
        cell.status = 'running';
        cell.output = [];
        this.startedAt = performance.now();
        this.stopping = false;
        this.render();
        const timer = setInterval(() => this.render(), 100);
        try {
            await new Promise<void>(resolve => setImmediate(resolve));
            this.session.setDebugBreakpoints?.(book.cells.flatMap(item =>
                [...(this.breakpoints.get(item.id) ?? [])].map(line => ({ source: item.source, line }))));
            const pending = this.session.execute(source, cell.id, book.fileLines(), this.columns(), cell.fileSource);
            if (this.stopping) this.session.interrupt?.();
            const result = await pending;
            if (result.exit) return true;
            if (result.interrupted) result.output.unshift({
                text: `Stopped after ${((performance.now() - this.startedAt!) / 1000).toFixed(1)}s`, error: false,
            });
            book.finish(index, enclosing ? { ...result, source: enclosing.source,
                errorOffset: result.errorOffset === undefined ? undefined : enclosing.offset + result.errorOffset } : result);
            if (enclosing && result.ok) cell.executed = undefined;
            this.render();
            return false;
        } finally {
            clearInterval(timer);
            this.startedAt = undefined;
            this.stopping = false;
        }
    }
}
