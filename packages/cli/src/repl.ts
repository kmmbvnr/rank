import * as readline from 'node:readline';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { parse } from '@arrrank/interpreter';
import { isFunctionStatement } from '@arrrank/language';
import { EMPTY_CELL, addLine, cellSource, closeCell, isComplete, isEmpty } from './repl-input.js';
import { createWorkerSession } from './worker-session.js';
import { Notebook, splitSource } from './notebook.js';
import { KeyRouter, type Key } from './key-router.js';
import { LiveFunctionSession } from './live-function.js';
import { LivePreviewRunner } from './live-preview.js';
import { createReplSession, type Execution, type OutputLine, type ProgramFile } from './repl-session.js';
import { drawFrame, saveFrame, helpFrame, pauseFrame, notebookFrame } from './screen.js';
import { TerminalModeRouter } from './terminal-modes.js';

const HISTORY_LIMIT = 500;
const historyFile = (): string => path.join(os.homedir(), '.rank_history');
type FunctionPreparation = ReturnType<ReturnType<typeof createReplSession>['prepareFunctions']>;
type Session = Omit<ReturnType<typeof createReplSession>, 'snapshot' | 'prepareFunctions' | 'preview'> & {
    readonly names: string[];
    prepareFunctions: (cells: { id: number; source: string }[]) => FunctionPreparation | Promise<FunctionPreparation>;
    preview: (text: string, columns?: number) => Execution | Promise<Execution>;
    interrupt?: () => void;
    pause?: () => void;
    resume?: () => void;
    step?: (iteration?: boolean) => void;
    stepToMain?: () => void;
    endDebugRun?: () => void;
    debugNext?: () => void;
    setDebugBreakpoints?: (points: { source: string; line: number }[]) => void;
    readonly pauseRequested?: boolean;
    readonly pauseState?: import('@arrrank/interpreter').PauseSnapshot;
};

/** Coordinates explicit execution. Navigation never calls into the interpreter. */
export class NotebookRepl {
    readonly notebook = new Notebook();
    running = false;
    private startedAt?: number;
    private stopping = false;
    pauseTop = 0;
    readonly breakpoints = new Map<number, Set<number>>();
    private live?: LiveFunctionSession;
    private readonly functionExamplesByName = new Map<string, string[]>();

    get examplePrompt(): { name: string; parameter?: string; index: number; count: number } | undefined {
        return this.live?.prompt;
    }

    get promptLabel(): string {
        return 'rank> ';
    }

    get liveOutputs(): ReadonlyMap<number, OutputLine[]> | undefined { return this.live?.outputs; }
    get liveEditing(): boolean { return this.live !== undefined; }
    get exampleEditor(): Notebook | undefined {
        return this.examplePrompt ? this.live?.argumentEditor : undefined;
    }
    get exampleFields(): { name: string; source: string; cursor: number; active: boolean; error?: string }[] | undefined {
        return this.live?.fields;
    }

    get pauseSnapshot(): import('@arrrank/interpreter').PauseSnapshot | undefined {
        const pause = this.session.pauseState;
        if (!pause?.source || pause.line === undefined || !this.session.savedFile) return pause;
        const cells = this.notebook.cells.slice(0, -1).filter(cell => !cell.command);
        // Prefer the running cell when identical statements appear more than once.
        const current = this.notebook.current;
        const cell = current.source === pause.source && cells.includes(current)
            ? current : cells.find(item => item.source === pause.source);
        if (!cell) return pause;
        const offset = cells.slice(0, cells.indexOf(cell))
            .reduce((lines, item) => lines + item.source.split('\n').length, 0);
        const line = offset + pause.line;
        return { ...pause, source: cells.map(item => item.source).join('\n'), line,
            activity: pause.activity === `before line ${pause.line}` ? `before line ${line}` : pause.activity };
    }

    toggleBreakpoint(): void {
        const book = this.notebook;
        const line = book.current.source.slice(0, book.cursor).split('\n').length;
        const lines = this.breakpoints.get(book.current.id) ?? new Set<number>();
        if (lines.has(line)) lines.delete(line); else lines.add(line);
        this.breakpoints.set(book.current.id, lines);
        this.suggestion = `Breakpoint ${lines.has(line) ? 'set' : 'removed'}: cell ${book.active + 1}, line ${line}`;
    }

    async debug(): Promise<boolean> {
        if (this.running || this.help || this.savePrompt) return false;
        if (this.live && this.live.parameters.length) {
            this.live.source = this.notebook.current.source;
            this.live.openArguments(0, this.session.names);
            this.updateExampleSuggestion();
            return false;
        }
        if (!this.notebook.atPrompt) this.notebook.replayFrom = this.notebook.active;
        this.session.debugNext?.();
        return this.submit(true);
    }

    togglePause(): void {
        if (this.session.pauseRequested) this.session.resume?.();
        else if (!this.stopping) { this.pauseTop = 0; this.session.pause?.(); }
        this.render();
    }

    get runningStatus(): string {
        if (this.startedAt === undefined) return 'Running…';
        return `${this.stopping ? 'Stopping…' : this.session.pauseRequested ? 'Pausing…' : 'Running…'} ${((performance.now() - this.startedAt) / 1000).toFixed(1)}s · ^C stop · ^P pause`;
    }

    interrupt(): void {
        if (this.startedAt === undefined || !this.session.interrupt) return;
        this.stopping = true;
        this.session.interrupt();
        this.render();
    }

    suggestion = '';
    help?: { text: string; top: number };
    savePrompt?: { choosing: boolean; exitAfterSave: boolean; loadFile?: ProgramFile; filename: Notebook; error: string };
    private completion?: { candidates: string[]; from: number; to: number; index: number };
    private preparation: Promise<void> = Promise.resolve();
    private readonly livePreview: LivePreviewRunner;

    constructor(
        readonly session: Session,
        readonly render: () => void = () => {},
        readonly columns = () => 80,
        private readonly functionExamples = false,
    ) {
        this.livePreview = new LivePreviewRunner(source => this.session.preview(source, this.columns()));
    }

    dismiss(): void { this.suggestion = ''; this.completion = undefined; }

    cancelExample(): void {
        const live = this.live;
        if (!live || live.argument === undefined) return;
        live.cancelArguments();
        this.notebook.replace(live.source);
        this.updateLiveSuggestion();
    }

    cancelLiveFunction(): void {
        const live = this.live;
        if (live?.existing && live.originalSource !== undefined) {
            this.notebook.replace(live.originalSource);
            this.notebook.cursor = Math.min(this.notebook.cursor, live.originalSource.length);
        }
        this.live = undefined;
        this.notebook.toPrompt();
        if (!live?.existing) this.notebook.replace('');
        this.dismiss();
    }

    cycleExampleCandidate(): void {
        if (!this.examplePrompt) return;
        if (!this.live!.cycleCandidate(this.session.names)) {
            this.suggestion = 'No variables available · type a value · Esc skip';
            return;
        }
        this.updateExampleSuggestion();
    }

    moveExampleField(direction: number): void {
        const live = this.live;
        if (!live || live.argument === undefined) return;
        live.moveArgument(direction, this.session.names);
        this.updateExampleSuggestion();
    }

    focusExampleFromBody(): boolean {
        const live = this.live;
        if (!live || live.argument !== undefined || !live.parameters.length) return false;
        const source = this.notebook.current.source;
        const currentLine = source.slice(0, this.notebook.cursor).split('\n').length;
        if (currentLine !== 2) return false;
        live.source = source;
        live.stopLine = this.selectedLiveLine(source, this.notebook.cursor);
        live.openArguments(live.parameters.length - 1, this.session.names);
        this.updateExampleSuggestion();
        return true;
    }

    private beginLiveFunction(source: string): boolean {
        const match = /^\s*(?:fun|memo)\s+([a-z][A-Za-z0-9_]*|update)((?:\s+[A-Za-z][A-Za-z0-9_]*)*)\s*$/.exec(source);
        if (!match) return false;
        const existing = !this.notebook.atPrompt;
        const parameters = match[2].trim() ? match[2].trim().split(/\s+/) : [];
        const body = `${source.trim()}\n  `;
        this.live = new LiveFunctionSession({
            name: match[1], parameters, header: source.trim(), source: body,
            cellIndex: this.notebook.active, existing, originalSource: existing ? source.trim() : undefined,
        }, this.session.names);
        this.notebook.replace(parameters.length ? source.trim() : body);
        if (!parameters.length) this.updateLiveSuggestion();
        else this.updateExampleSuggestion();
        return true;
    }

    private beginExistingFunction(): boolean {
        const book = this.notebook;
        if (book.atPrompt) return false;
        const source = book.current.source;
        let statement;
        try {
            const statements = parse(source).statements;
            if (statements.length !== 1 || !isFunctionStatement(statements[0])) return false;
            statement = statements[0];
        } catch { return false; }
        const lines = source.split('\n');
        const stopLine = this.selectedLiveLine(source, book.cursor);
        const values = [...(this.functionExamplesByName.get(statement.name) ?? [])];
        this.live = new LiveFunctionSession({
            name: statement.name, parameters: [...statement.parameters], header: lines[0].trim(),
            source, values, cellIndex: book.active, existing: true, originalSource: source, stopLine,
        }, this.session.names);
        if (statement.parameters.length) this.updateExampleSuggestion();
        else this.updateLiveSuggestion();
        return true;
    }

    async rerun(): Promise<boolean> {
        if (this.running || this.help || this.savePrompt) return false;
        if (this.live) {
            const live = this.live;
            live.source = this.notebook.current.source;
            live.stopLine = this.selectedLiveLine(live.source, this.notebook.cursor);
            if (live.parameters.length) {
                live.openArguments(0, this.session.names);
                this.updateExampleSuggestion();
            } else {
                const line = live.stopLine;
                await this.updateLivePreviews(true, line - 1);
                this.placeCursorAtLineEnd(line - 1);
                live.stopLine = undefined;
            }
            this.render();
            return false;
        }
        if (!this.live && this.functionExamples && this.beginExistingFunction()) {
            const line = this.live!.stopLine!;
            if (!this.live!.parameters.length) {
                await this.updateLivePreviews(true, line - 1);
                this.placeCursorAtLineEnd(line - 1);
                this.live!.stopLine = undefined;
            }
            this.render();
            return false;
        }
        return this.submit(true);
    }

    private selectedLiveLine(source: string, cursor: number): number {
        const lines = source.split('\n');
        const cursorLine = source.slice(0, cursor).split('\n').length;
        const lastBodyLine = lines.at(-1)?.trim() === 'end' ? lines.length - 1 : lines.length;
        return Math.max(2, Math.min(cursorLine, Math.max(2, lastBodyLine)));
    }

    private updateLiveSuggestion(): void {
        const live = this.live;
        if (!live) return;
        const example = live.skipped ? 'no example' : live.values.join(', ');
        this.suggestion = `Live ${live.name}(${example}) · Enter preview · Ctrl-T arguments · end finish`;
    }

    private async updateLivePreviews(reset = false, throughLine?: number): Promise<void> {
        const live = this.live;
        if (!live) return;
        await this.livePreview.update(live, this.notebook.current.source, reset, throughLine);
        this.updateLiveSuggestion();
    }

    private placeCursorAfterLiveLine(line: number): void {
        const source = this.notebook.current.source;
        const lines = source.split('\n');
        const start = lines.slice(0, line).reduce((offset, item) => offset + item.length + 1, 0);
        const failed = this.live?.outputs.get(line + 1)?.some(output => output.error) ?? false;
        if (failed || line >= lines.length - 1) this.notebook.cursor = start + lines[line].length;
        else this.notebook.cursor = start + lines[line].length + 1 + lines[line + 1].length;
    }

    private placeCursorAtLineEnd(line: number): void {
        const lines = this.notebook.current.source.split('\n');
        const at = Math.max(0, Math.min(line, lines.length - 1));
        this.notebook.cursor = lines.slice(0, at).reduce((offset, item) => offset + item.length + 1, 0)
            + lines[at].length;
    }

    private rememberFunctionExample(live: LiveFunctionSession): void {
        if (!live.skipped && live.values.length === live.parameters.length)
            this.functionExamplesByName.set(live.name, [...live.values]);
    }

    private async submitLiveFunction(): Promise<boolean | undefined> {
        const live = this.live;
        if (!live) return undefined;
        const source = this.notebook.current.source;
        const lines = source.split('\n');
        const currentLine = source.slice(0, this.notebook.cursor).split('\n').length - 1;
        if (currentLine < lines.length - 1) {
            await this.updateLivePreviews(false, currentLine + 1);
            this.placeCursorAfterLiveLine(currentLine);
            this.render();
            return false;
        }
        if (!lines[currentLine].trim()) {
            this.notebook.newline();
            this.updateLiveSuggestion();
            this.render();
            return false;
        }
        const draft = this.notebook.preparePrompt(line => this.session.format(line));
        if (draft !== undefined) {
            this.rememberFunctionExample(live);
            this.live = undefined;
            this.dismiss();
            if (live.existing) {
                this.notebook.replayFrom = live.cellIndex;
                this.notebook.toPrompt();
                return this.submit(true);
            }
            return undefined;
        }
        await this.updateLivePreviews(false, currentLine + 1);
        this.placeCursorAfterLiveLine(currentLine);
        this.render();
        return false;
    }

    private async acceptExample(): Promise<boolean> {
        const live = this.live;
        if (!live || live.argument === undefined) return false;
        const current = live.argument;
        live.saveArgument();
        const error = live.syntaxError(live.values[current], this.session.names);
        if (error) {
            live.argumentError = { source: live.argumentEditor.current.source, message: error };
            this.suggestion = `${live.parameters[current]} is not an expression · edit it or Esc skip`;
            this.render();
            return false;
        }
        live.argumentError = undefined;
        if (current + 1 < live.parameters.length) {
            live.focusArgument(current + 1, this.session.names);
            this.updateExampleSuggestion();
            this.render();
            return false;
        }
        for (let index = 0; index < live.parameters.length; index++) {
            const fieldError = live.syntaxError(live.values[index] ?? '', this.session.names);
            if (!fieldError) continue;
            live.focusArgument(index, this.session.names);
            live.argumentError = { source: live.argumentEditor.current.source, message: fieldError };
            this.suggestion = `${live.parameters[index]} is not an expression · edit it or Esc skip`;
            this.render();
            return false;
        }
        for (let index = 0; index < live.parameters.length; index++) {
            const fieldError = await this.exampleRuntimeError(live.values[index]);
            if (!fieldError) continue;
            live.focusArgument(index, this.session.names);
            live.argumentError = { source: live.argumentEditor.current.source, message: fieldError };
            this.suggestion = `${live.parameters[index]} cannot be evaluated · edit it or Esc skip`;
            this.render();
            return false;
        }
        live.argument = undefined;
        live.skipped = false;
        this.notebook.replace(live.source);
        live.outputs.clear();
        live.prefixes.clear();
        await this.updateLivePreviews(false,
            live.stopLine === undefined ? undefined : live.stopLine - 1);
        if (live.stopLine !== undefined) {
            const line = live.stopLine;
            this.placeCursorAtLineEnd(line - 1);
            live.stopLine = undefined;
        }
        this.render();
        return false;
    }

    private async exampleRuntimeError(value: string): Promise<string | undefined> {
        const result = await this.session.preview(`Example = (${value})`, this.columns());
        const diagnostic = result.output.find(line => line.error)?.text.split('\n')[0]
            .replace(/\x1b\[[0-9;]*m/g, '');
        return diagnostic?.replace(/^error:\s*RankError\s*\[([^\]]+)\]:\s*/, '$1: ');
    }

    private updateExampleSuggestion(): void {
        const prompt = this.examplePrompt;
        if (!prompt) return;
        this.suggestion = `Example ${prompt.name} · ${prompt.parameter} (${prompt.index + 1}/${prompt.count}) · Tab variables · Enter accept · Esc skip`;
    }

    private saveLines(): string[] {
        const lines = this.notebook.fileLines();
        const draft = this.notebook.cells.at(-1)!.source;
        if (draft !== '' && !this.session.isCommand(draft.trim())) lines.push(...draft.split('\n'));
        return lines;
    }

    get unsaved(): boolean {
        const lines = this.saveLines();
        const source = lines.join('\n') + (lines.length ? '\n' : '');
        return source !== (this.session.savedFile?.source ?? '');
    }

    get fileStatus(): string {
        const file = this.session.savedFile;
        return `${file ? path.basename(file.path) : 'Untitled'} · ${this.unsaved ? 'unsaved' : 'saved'}`;
    }

    private openSavePrompt(exitAfterSave: boolean, loadFile?: ProgramFile): void {
        const filename = new Notebook();
        filename.replace(this.session.savedFile?.path ?? '');
        this.savePrompt = { choosing: exitAfterSave || !!loadFile, exitAfterSave, loadFile, filename, error: '' };
        this.render();
    }

    requestExit(): boolean {
        if (!this.unsaved) return true;
        this.openSavePrompt(true);
        return false;
    }

    async requestSave(): Promise<void> {
        if (this.running || this.savePrompt) return;
        this.openSavePrompt(false);
        if (this.session.savedFile) await this.savePromptFile();
    }

    private openFile(file: ProgramFile): void {
        const parts = splitSource(file.source);
        this.session.replaceFile(file);
        this.notebook.clear();
        this.breakpoints.clear();
        this.live = undefined;
        for (const source of parts) this.notebook.enqueue(source, true);
        this.preparation = this.prepareFunctions();
        this.help = undefined;
        this.dismiss();
    }

    private async prepareFunctions(start = 0): Promise<void> {
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

    discardChanges(): boolean {
        const prompt = this.savePrompt;
        if (!prompt) return false;
        if (prompt.loadFile) this.openFile(prompt.loadFile);
        this.savePrompt = undefined;
        this.render();
        return prompt.exitAfterSave;
    }

    async savePromptFile(): Promise<boolean> {
        const prompt = this.savePrompt;
        if (!prompt || this.running) return false;
        this.running = true;
        this.render();
        try {
            const result = await this.session.saveFile(this.saveLines(), prompt.filename.current.source);
            if (result.ok) {
                if (prompt.loadFile?.path === this.session.savedFile?.path) prompt.loadFile = this.session.savedFile;
                return this.discardChanges();
            }
            prompt.error = result.output.filter(line => line.error).map(line => line.text).join('\n');
            return false;
        } finally { this.running = false; this.render(); }
    }

    complete(): void {
        const book = this.notebook;
        if (this.completion) {
            const item = this.completion;
            item.index = (item.index + 1) % item.candidates.length;
            const candidate = item.candidates[item.index];
            book.replace(book.current.source.slice(0, item.from) + candidate + book.current.source.slice(item.to),
                item.from + candidate.length);
            item.to = book.cursor;
            this.suggestion = `Tab: ${candidate.trim()} (${item.index + 1}/${item.candidates.length}) · Esc close`;
            return;
        }
        const prefix = book.current.source.slice(0, book.cursor);
        const line = prefix.slice(prefix.lastIndexOf('\n') + 1);
        const [candidates, word] = this.session.complete(line);
        if (!candidates.length) { this.suggestion = 'No completions'; return; }
        const from = book.cursor - word.length;
        const candidate = candidates[0];
        book.replace(prefix.slice(0, from) + candidate + book.current.source.slice(book.cursor), from + candidate.length);
        if (candidates.length > 1) {
            this.completion = { candidates, from, to: book.cursor, index: 0 };
            this.suggestion = `Tab: ${candidate.trim()} (1/${candidates.length}) · Esc close`;
        }
    }

    /** Enter in the draft resumes the edited suffix, then evaluates the new statement. */
    async submit(force = false): Promise<boolean> {
        if (this.running || this.help || this.savePrompt) return false;
        if (this.examplePrompt) return this.acceptExample();
        await this.preparation;
        if (this.live && force) {
            const before = this.notebook.current.source;
            const currentLine = before.slice(0, this.notebook.cursor).split('\n').length - 1;
            if (!/\n[\t ]*$/.test(this.notebook.current.source)) {
                this.notebook.preparePrompt(line => this.session.format(line));
            }
            await this.updateLivePreviews(true, currentLine + 1);
            this.placeCursorAfterLiveLine(currentLine);
            this.render();
            return false;
        }
        this.dismiss();
        const book = this.notebook;
        const currentRaw = book.current.source.trim();
        if (this.functionExamples && !this.live && !currentRaw.includes('\n')
            && this.beginLiveFunction(currentRaw)) {
            this.render();
            return false;
        }
        if (!book.atPrompt && !force && !this.live) { book.newline(); return false; }
        if (force) {
            if (book.current.status === 'interrupted') book.replayFrom = book.active;
            book.toPrompt();
        }
        const raw = book.current.source.trim();
        const liveResult = await this.submitLiveFunction();
        if (liveResult !== undefined) return liveResult;
        const draft = this.session.isCommand(raw) ? raw : book.preparePrompt(line => this.session.format(line));
        if (draft === undefined) return false;
        // Commit input before replay: even if an earlier instruction fails, this text stays in the document.
        const command = draft.trim() !== '' && this.session.isCommand(draft);
        if (command && (draft === 'exit' || draft === 'quit')) {
            book.replace('');
            return this.requestExit();
        }
        if (command && draft.split(/\s+/)[0] === 'help') {
            this.running = true;
            try {
                const result = await this.session.execute(draft, book.current.id, book.fileLines(), this.columns());
                book.replace('');
                this.help = { text: result.output.map(line => line.text).join('\n'), top: 0 };
                return false;
            } finally {
                this.running = false;
                this.render();
            }
        }
        if (command && draft.split(/\s+/)[0] === 'load') {
            this.running = true;
            try {
                const result = await this.session.execute(draft, book.current.id, book.fileLines(), this.columns());
                if (result.loadedFile === undefined) {
                    book.enqueue(draft);
                    book.finish(book.cells.length - 2, result);
                    return false;
                }
                if (this.unsaved) this.openSavePrompt(false, result.loadedFile);
                else { this.openFile(result.loadedFile); await this.preparation; }
                return false;
            } finally {
                this.running = false;
                this.render();
            }
        }
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

    private async run(index: number, source: string): Promise<boolean> {
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
                text: `Stopped after ${((performance.now() - this.startedAt) / 1000).toFixed(1)}s`, error: false,
            });
            book.finish(index, result);
            this.render();
            return false;
        } finally {
            clearInterval(timer);
            this.startedAt = undefined;
            this.stopping = false;
        }
    }
}

export async function startRepl(): Promise<void> {
    const terminal = process.stdin.isTTY && process.stdout.isTTY;
    const session = terminal ? await createWorkerSession() : createReplSession();
    try {
        if (terminal) await terminalRepl(session);
        else await streamRepl(session);
    } finally { await session.dispose(); }
}

/** Piped programs retain statement-oriented input without any screen escape codes. */
async function streamRepl(session: Session): Promise<void> {
    const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    let state = EMPTY_CELL;
    const file: string[] = [];
    let id = 0;
    const execute = async (source: string): Promise<boolean> => {
        const result = await session.execute(source, id++, file);
        if (result.loadedFile !== undefined) {
            const parts = splitSource(result.loadedFile.source);
            session.replaceFile(result.loadedFile);
            file.length = 0;
            file.push(...parts.flatMap(part => part.split('\n')));
            for (const part of parts) {
                if (part.trim() === '') continue;
                const loaded = await session.execute(part, id++, file, 80, true);
                for (const line of loaded.output) (line.error ? process.stderr : process.stdout).write(line.text + '\n');
                if (!loaded.ok) break;
            }
        }
        for (const line of result.output) (line.error ? process.stderr : process.stdout).write(line.text + '\n');
        if (!result.command && !result.exit) file.push(...result.source.split('\n'));
        return result.exit;
    };
    try {
        for await (const raw of input) {
            const text = raw.trim();
            if (text === '') { if (isEmpty(state)) file.push(''); continue; }
            if (isEmpty(state) && session.isCommand(text)) {
                if (await execute(text)) return;
                continue;
            }
            state = addLine(state, session.format(text));
            if (!isComplete(state)) continue;
            const source = cellSource(state);
            state = EMPTY_CELL;
            if (await execute(source)) return;
        }
        if (!isEmpty(state)) await execute(cellSource(closeCell(state)));
    } finally { input.close(); }
}

async function terminalRepl(session: Session): Promise<void> {
    const input = process.stdin;
    const output = process.stdout;
    const decoder = new StringDecoder('utf8');
    const keyInput = new (await import('node:stream')).PassThrough();
    readline.emitKeypressEvents(keyInput);
    let top = 0;
    let followCursor = true;
    let closing = false;
    let history: string[] = [];
    try { history = (await fs.readFile(historyFile(), 'utf8')).split('\n').filter(Boolean).slice(-HISTORY_LIMIT); }
    catch { /* A new session has no history yet. */ }
    const render = (): void => {
        if (closing) return;
        // Keep the last debugger frame while the worker advances to its next stop.
        if (!modeRouter.allowRender()) return;
        if (repl.savePrompt) {
            const prompt = repl.savePrompt;
            output.write(drawFrame(saveFrame(prompt.choosing ? undefined : prompt.filename,
                prompt.error, output.columns || 80, output.rows || 24, prompt.exitAfterSave, repl.running, !!prompt.loadFile)));
            return;
        }
        if (repl.running && session.pauseState) {
            const pause = repl.pauseSnapshot!;
            const frame = pauseFrame(pause,
                output.columns || 80, output.rows || 24, repl.pauseTop);
            repl.pauseTop = frame.top;
            output.write(drawFrame(frame));
            return;
        }
        if (repl.help) {
            const frame = helpFrame(repl.help.text, output.columns || 80, output.rows || 24, repl.help.top);
            repl.help.top = frame.top;
            output.write(drawFrame(frame));
            return;
        }
        const frame = notebookFrame(repl.notebook, output.columns || 80, output.rows || 24,
            top, repl.suggestion, repl.running, followCursor, repl.fileStatus, repl.runningStatus, repl.breakpoints,
            repl.promptLabel, repl.liveOutputs, repl.exampleFields);
        top = frame.top;
        output.write(drawFrame(frame));
    };
    const repl = new NotebookRepl(session, render, () => output.columns || 80, true);
    const book = repl.notebook;
    const keyRouter = new KeyRouter(repl, history, () => output.columns || 80);
    const modeRouter = new TerminalModeRouter(repl, () => output.rows || 24);
    let finish!: () => void;
    let fail!: (error: unknown) => void;
    const ended = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    const leave = (): void => { closing = true; finish(); };
    const onKey = (text: string, key: Key = {}): void => {
        if (closing) return;
        try {
            followCursor = key.name !== 'pageup' && key.name !== 'pagedown';
            if (!modeRouter.active) {
                void keyRouter.press(text, key).then(result => {
                    if (result.pageDelta) top = Math.max(0, top + result.pageDelta * Math.max(1, (output.rows || 24) - 2));
                    if (result.exit) leave(); else render();
                }, fail);
                return;
            }
            void modeRouter.press(text, key).then(mode => {
                if (mode.exit) leave(); else if (mode.render) render();
            }, fail);
        } catch (error) { fail(error); }
    };
    // Bracketed paste is data, including its newlines. It must never execute commands.
    let pending = '';
    let paste: string | undefined;
    const onData = (chunk: Buffer): void => {
        pending += decoder.write(chunk);
        for (;;) {
            const marker = paste === undefined ? '\x1b[200~' : '\x1b[201~';
            const at = pending.indexOf(marker);
            if (at >= 0) {
                const before = pending.slice(0, at);
                pending = pending.slice(at + marker.length);
                if (paste === undefined) { keyInput.write(before); paste = ''; }
                else {
                    const value = paste + before;
                    if (!modeRouter.paste(value)) book.insert(value.replace(/\r\n?/g, '\n'));
                    paste = undefined;
                    repl.dismiss();
                    render();
                }
                continue;
            }
            // Keep a possible split marker until the next chunk, but deliver ordinary Esc promptly.
            let tail = 0;
            for (let size = 2; size < marker.length; size++) {
                if (pending.endsWith(marker.slice(0, size))) tail = size;
            }
            const ready = tail ? pending.slice(0, -tail) : pending;
            pending = tail ? pending.slice(-tail) : '';
            if (paste === undefined) keyInput.write(ready); else paste += ready;
            break;
        }
    };
    const wasRaw = input.isRaw;
    const onEnd = (): void => leave();
    keyInput.on('keypress', onKey);
    output.on('resize', render);
    input.on('data', onData);
    input.on('end', onEnd);
    process.on('SIGTERM', leave);
    process.on('SIGHUP', leave);
    try {
        input.setRawMode(true);
        input.resume();
        output.write('\x1b[?1049h\x1b[?2004h\x1b[2J');
        render();
        await ended;
    } finally {
        closing = true;
        input.off('data', onData);
        input.off('end', onEnd);
        output.off('resize', render);
        keyInput.off('keypress', onKey);
        keyInput.destroy();
        process.off('SIGTERM', leave);
        process.off('SIGHUP', leave);
        input.setRawMode(wasRaw);
        input.pause();
        output.write('\x1b[?2004l\x1b[?25h\x1b[?1049l');
        try { await fs.writeFile(historyFile(), keyRouter.history.map(item => item.replace(/\n/g, ' ')).join('\n') + '\n'); }
        catch { /* A read-only home does not prevent using the REPL. */ }
    }
}
