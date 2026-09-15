import * as readline from 'node:readline';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { parse, RankError } from '@arrrank/interpreter';
import { isFunctionStatement } from '@arrrank/language';
import { EMPTY_CELL, addLine, cellSource, closeCell, isComplete, isEmpty } from './repl-input.js';
import { createWorkerSession } from './worker-session.js';
import { Notebook, splitSource } from './notebook.js';
import { createReplSession, type Execution, type OutputLine, type ProgramFile } from './repl-session.js';
import { drawFrame, saveFrame, helpFrame, pauseFrame, notebookFrame, textColumns } from './screen.js';

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

interface LiveFunction {
    readonly name: string;
    readonly parameters: string[];
    readonly header: string;
    source: string;
    values: string[];
    argument?: number;
    argumentBackup: string[];
    skipped: boolean;
    readonly outputs: Map<number, OutputLine[]>;
    readonly prefixes: Map<number, string>;
    readonly argumentEditor: Notebook;
    readonly cellIndex: number;
    readonly existing: boolean;
    readonly originalSource?: string;
    stopLine?: number;
    argumentError?: { readonly source: string; readonly message: string };
}

/** Coordinates explicit execution. Navigation never calls into the interpreter. */
export class NotebookRepl {
    readonly notebook = new Notebook();
    running = false;
    private startedAt?: number;
    private stopping = false;
    pauseTop = 0;
    readonly breakpoints = new Map<number, Set<number>>();
    private live?: LiveFunction;
    private readonly functionExamplesByName = new Map<string, string[]>();

    get examplePrompt(): { name: string; parameter?: string; index: number; count: number } | undefined {
        if (!this.live || this.live.argument === undefined) return undefined;
        const { name, parameters, argument } = this.live;
        return { name, parameter: parameters[argument], index: argument, count: parameters.length };
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
        const live = this.live;
        if (!live || live.skipped || live.argument === undefined
            && live.values.length !== live.parameters.length) return undefined;
        return live.parameters.map((name, index) => ({
            name,
            source: index === live.argument ? live.argumentEditor.current.source : live.values[index] ?? '',
            cursor: index === live.argument ? live.argumentEditor.cursor : 0,
            active: index === live.argument,
            error: index === live.argument && live.argumentError?.source === live.argumentEditor.current.source
                ? live.argumentError.message : undefined,
        }));
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
            this.live.argumentBackup = [...this.live.values];
            this.live.argument = 0;
            this.live.argumentEditor.replace(this.live.values[0] ?? '');
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

    constructor(
        readonly session: Session,
        readonly render: () => void = () => {},
        readonly columns = () => 80,
        private readonly functionExamples = false,
    ) {}

    dismiss(): void { this.suggestion = ''; this.completion = undefined; }

    cancelExample(): void {
        const live = this.live;
        if (!live || live.argument === undefined) return;
        const hadExample = live.argumentBackup.length === live.parameters.length;
        if (hadExample) live.values = [...live.argumentBackup];
        else { live.values = []; live.skipped = true; live.outputs.clear(); }
        live.argument = undefined;
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
        const editor = this.live!.argumentEditor;
        const current = editor.current.source.trim();
        const candidates = this.session.names.filter(name => /^[A-Z]/.test(name));
        if (!candidates.length) {
            this.suggestion = 'No variables available · type a value · Esc skip';
            return;
        }
        const at = candidates.indexOf(current);
        const next = candidates[(at + 1) % candidates.length];
        editor.replace(next);
        this.updateExampleSuggestion();
    }

    private beginLiveFunction(source: string): boolean {
        const match = /^\s*(?:fun|memo)\s+([a-z][A-Za-z0-9_]*|update)((?:\s+[A-Za-z][A-Za-z0-9_]*)*)\s*$/.exec(source);
        if (!match) return false;
        const existing = !this.notebook.atPrompt;
        const parameters = match[2].trim() ? match[2].trim().split(/\s+/) : [];
        const body = `${source.trim()}\n  `;
        const argumentEditor = new Notebook();
        const first = parameters.length && this.session.names.includes(parameters[0]) ? parameters[0] : '';
        argumentEditor.replace(first);
        this.live = {
            name: match[1], parameters, header: source.trim(), source: body, values: [],
            argument: parameters.length ? 0 : undefined, argumentBackup: [], skipped: false,
            outputs: new Map(), prefixes: new Map(), argumentEditor,
            cellIndex: this.notebook.active, existing,
            originalSource: existing ? source.trim() : undefined,
        };
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
        const cursorLine = source.slice(0, book.cursor).split('\n').length;
        const stopLine = Math.max(1, Math.min(cursorLine, Math.max(1, lines.length - 1)));
        const values = [...(this.functionExamplesByName.get(statement.name) ?? [])];
        const argumentEditor = new Notebook();
        const first = values[0] ?? (statement.parameters.length
            && this.session.names.includes(statement.parameters[0]) ? statement.parameters[0] : '');
        argumentEditor.replace(first);
        this.live = {
            name: statement.name, parameters: [...statement.parameters], header: lines[0].trim(),
            source, values, argument: statement.parameters.length ? 0 : undefined,
            argumentBackup: [...values], skipped: false, outputs: new Map(), prefixes: new Map(),
            argumentEditor, cellIndex: book.active, existing: true, originalSource: source, stopLine,
        };
        if (statement.parameters.length) this.updateExampleSuggestion();
        else this.updateLiveSuggestion();
        return true;
    }

    async rerun(): Promise<boolean> {
        if (this.running || this.help || this.savePrompt) return false;
        if (!this.live && this.functionExamples && this.beginExistingFunction()) {
            const line = this.live!.stopLine!;
            if (!this.live!.parameters.length) {
                await this.updateLivePreviews(true);
                this.placeCursorAtLineEnd(line - 1);
                this.live!.stopLine = undefined;
            }
            this.render();
            return false;
        }
        return this.submit(true);
    }

    private updateLiveSuggestion(): void {
        const live = this.live;
        if (!live) return;
        const example = live.skipped ? 'no example' : live.values.join(', ');
        this.suggestion = `Live ${live.name}(${example}) · Enter preview · Ctrl-T arguments · end finish`;
    }

    private async updateLivePreviews(reset = false): Promise<void> {
        const live = this.live;
        if (!live || live.skipped || live.values.length !== live.parameters.length) return;
        if (reset) {
            live.outputs.clear();
            live.prefixes.clear();
        }
        const lines = this.notebook.current.source.split('\n');
        const bodyEnd = live.existing && lines.at(-1)?.trim() === 'end' ? lines.length - 1 : lines.length;
        let state = EMPTY_CELL;
        const completed: { line: number; body: string }[] = [];
        for (let index = 1; index < bodyEnd; index++) {
            const line = lines[index];
            if (!line.trim()) continue;
            state = addLine(state, line.replace(/^  /, '').trimEnd(), true);
            if (!isComplete(state)) continue;
            const body = lines.slice(1, index + 1).join('\n');
            if (live.stopLine === undefined || index + 1 <= live.stopLine)
                completed.push({ line: index + 1, body });
            state = EMPTY_CELL;
        }
        const changed = completed.some(item => live.prefixes.has(item.line) && live.prefixes.get(item.line) !== item.body)
            || [...live.prefixes].some(([line]) => !completed.some(item => item.line === line));
        if (changed) {
            live.outputs.clear();
            live.prefixes.clear();
        }
        for (const item of completed) {
            if (live.outputs.has(item.line)) continue;
            const preview = this.previewFunctionSource(live, item.body);
            const result = await this.session.preview(preview, this.columns());
            live.outputs.set(item.line, result.output);
            live.prefixes.set(item.line, item.body);
        }
        this.updateLiveSuggestion();
    }

    private previewFunctionSource(live: LiveFunction, body: string): string {
        const lines = body.split('\n');
        const last = [...lines].reverse().find(line => line.trim())?.trim() ?? '';
        let fallback = '';
        if (!/^return\b/.test(last) && !/^yield\b/.test(last)) {
            const assignment = /^\s*([A-Za-z][A-Za-z0-9_]*)(?:\s+.*?)?\s*(?:=|\+=|-=|\*=|\*\*=|\/=|\/\/=|%=|and=|or=|xor=)/;
            const lastAssignment = assignment.exec(last)?.[1];
            if (lastAssignment) fallback = `\n  return ${lastAssignment}`;
            else if (last && !/^(?:if|elif|else|for|try|catch|finally|end|break|continue)\b/.test(last)) {
                let at = lines.length - 1;
                while (at >= 0 && !lines[at].trim()) at--;
                lines[at] = lines[at].replace(last, `return ${last}`);
            } else {
                const assigned = [...lines].reverse().map(line => assignment.exec(line)?.[1])
                    .find(Boolean);
                fallback = `\n  return ${assigned ?? '0'}`;
            }
        }
        const call = [...live.values.map(value => `(${value})`), live.name].join(' ');
        return `${live.header}\n${lines.join('\n')}${fallback}\nend\n${call}`;
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

    private rememberFunctionExample(live: LiveFunction): void {
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
            await this.updateLivePreviews();
            this.placeCursorAfterLiveLine(currentLine);
            this.render();
            return false;
        }
        if (!lines[currentLine].trim()) {
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
        await this.updateLivePreviews();
        this.placeCursorAfterLiveLine(currentLine);
        this.render();
        return false;
    }

    private async acceptExample(): Promise<boolean> {
        const live = this.live;
        if (!live || live.argument === undefined) return false;
        const value = live.argumentEditor.current.source.trim();
        if (!value) {
            this.suggestion = `${live.parameters[live.argument]} needs a value · Tab variables · Esc skip`;
            this.render();
            return false;
        }
        try {
            parse(`Example = (${value})`, '<example>', {
                bindings: new Map(this.session.names.map(name => [name, false])),
            });
            live.argumentError = undefined;
        } catch (error) {
            const message = error instanceof RankError
                ? `${error.rankKind}: ${error.message.replace(/ at \d+:\d+$/, '')}`
                : String(error);
            live.argumentError = { source: live.argumentEditor.current.source, message };
            this.suggestion = `${live.parameters[live.argument]} is not an expression · edit it or Esc skip`;
            this.render();
            return false;
        }
        live.values[live.argument] = value;
        if (live.argument + 1 < live.parameters.length) {
            live.argument++;
            const parameter = live.parameters[live.argument];
            live.argumentEditor.replace(live.values[live.argument]
                ?? (this.session.names.includes(parameter) ? parameter : ''));
            this.updateExampleSuggestion();
            this.render();
            return false;
        }
        live.argument = undefined;
        live.skipped = false;
        this.notebook.replace(live.source);
        live.outputs.clear();
        live.prefixes.clear();
        await this.updateLivePreviews();
        if (live.stopLine !== undefined) {
            const line = live.stopLine;
            this.placeCursorAtLineEnd(line - 1);
            live.stopLine = undefined;
        }
        this.render();
        return false;
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
            await this.updateLivePreviews(true);
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

interface Key { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean; sequence?: string }

async function terminalRepl(session: Session): Promise<void> {
    const input = process.stdin;
    const output = process.stdout;
    const decoder = new StringDecoder('utf8');
    const keyInput = new (await import('node:stream')).PassThrough();
    readline.emitKeypressEvents(keyInput);
    let top = 0;
    let followCursor = true;
    let closing = false;
    let stepping = false;
    let history: string[] = [];
    let historyIndex = -1;
    let historyDraft = '';
    try { history = (await fs.readFile(historyFile(), 'utf8')).split('\n').filter(Boolean).slice(-HISTORY_LIMIT); }
    catch { /* A new session has no history yet. */ }
    const render = (): void => {
        if (closing) return;
        // Keep the last debugger frame while the worker advances to its next stop.
        if (stepping && repl.running && !session.pauseState) return;
        stepping = false;
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
    let finish!: () => void;
    let fail!: (error: unknown) => void;
    const ended = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    const leave = (): void => { closing = true; finish(); };
    const onKey = (text: string, key: Key = {}): void => {
        if (closing) return;
        if (repl.running) {
            if (key.ctrl && key.name === 'c') { stepping = false; repl.interrupt(); }
            else if (key.ctrl && key.name === 'p') { stepping = false; repl.togglePause(); }
            else if (session.pauseState) {
                if (key.name === 'return' || key.name === 'enter') session.resume?.();
                else if (!key.meta && key.name === 'g') { stepping = true; repl.pauseTop = 0; session.stepToMain?.(); }
                else if (!key.meta && key.name === 't') { stepping = true; repl.pauseTop = 0; session.step?.(); }
                else if (!key.meta && key.name === 'n') { stepping = true; repl.pauseTop = 0; session.step?.(true); }
                else if (key.name === 'up') repl.pauseTop--;
                else if (key.name === 'down') repl.pauseTop++;
                else if (key.name === 'pageup') repl.pauseTop -= Math.max(1, (output.rows || 24) - 2);
                else if (key.name === 'pagedown') repl.pauseTop += Math.max(1, (output.rows || 24) - 2);
                render();
            }
            return;
        }
        try {
            followCursor = key.name !== 'pageup' && key.name !== 'pagedown';
            if (repl.examplePrompt) {
                const example = repl.exampleEditor!;
                if (key.name === 'escape' || key.ctrl && key.name === 'c') repl.cancelExample();
                else if (key.name === 'return' || key.name === 'enter') {
                    void repl.submit().then(exit => { if (exit) leave(); else render(); }, fail);
                } else if (key.name === 'tab' || key.name === 'up' || key.name === 'down') repl.cycleExampleCandidate();
                else if (key.name === 'backspace' || key.name === 'delete') example.erase(key.name === 'backspace');
                else if (key.name === 'left' || key.name === 'right') example.horizontal(key.name === 'left' ? -1 : 1);
                else if (key.name === 'home' || key.ctrl && key.name === 'a') example.lineEdge(false);
                else if (key.name === 'end' || key.ctrl && key.name === 'e') example.lineEdge(true);
                else if (key.ctrl && key.name === 'u') example.replace('');
                else if (!key.ctrl && !key.meta && text && text >= ' ') example.insert(text, true);
                render();
                return;
            }
            if (repl.savePrompt) {
                const prompt = repl.savePrompt;
                if (key.name === 'escape' || key.ctrl && key.name === 'c') repl.savePrompt = undefined;
                else if (prompt.choosing) {
                    if (key.name === 'return' || key.name === 'enter' || !key.ctrl && /^[sy]$/i.test(text)) {
                        prompt.choosing = false;
                        if (repl.session.savedFile) void repl.savePromptFile().then(exit => { if (exit) leave(); }, fail);
                    }
                    else if (!key.ctrl && /^[dn]$/i.test(text)) {
                        if (repl.discardChanges()) leave();
                        return;
                    }
                } else {
                    const file = prompt.filename;
                    if (key.name === 'return' || key.name === 'enter') {
                        void repl.savePromptFile().then(exit => { if (exit) leave(); }, fail);
                    } else if (key.name === 'backspace' || key.name === 'delete') file.erase(key.name === 'backspace');
                    else if (key.name === 'left' || key.name === 'right') file.horizontal(key.name === 'left' ? -1 : 1);
                    else if (key.name === 'home' || key.ctrl && key.name === 'a') file.lineEdge(false);
                    else if (key.name === 'end' || key.ctrl && key.name === 'e') file.lineEdge(true);
                    else if (key.ctrl && key.name === 'u') file.replace('');
                    else if (!key.ctrl && !key.meta && text && text >= ' ') file.insert(text);
                }
                render();
                return;
            }
            if (key.ctrl && (key.name === 'q' || key.name === 'd' && book.current.source === '')) {
                if (repl.requestExit()) leave();
                return;
            }
            if (key.ctrl && key.name === 's') {
                void repl.requestSave().catch(fail);
                return;
            }
            if (repl.help) {
                if (key.name === 'escape') repl.help = undefined;
                else if (key.name === 'up') repl.help.top -= 1;
                else if (key.name === 'down') repl.help.top += 1;
                else if (key.name === 'pageup') repl.help.top -= Math.max(1, (output.rows || 24) - 1);
                else if (key.name === 'pagedown') repl.help.top += Math.max(1, (output.rows || 24) - 1);
                else if (key.name === 'home') repl.help.top = 0;
                else if (key.name === 'end') repl.help.top = Number.MAX_SAFE_INTEGER;
                render();
                return;
            }
            if (key.ctrl && key.name === 'b') repl.toggleBreakpoint();
            else if (key.ctrl && key.name === 't') { void repl.debug().then(exit => { if (exit) leave(); else render(); }, fail); }
            else if (key.name === 'tab') repl.complete();
            else if (key.name === 'escape') {
                if (repl.suggestion) repl.dismiss();
                else book.toPrompt();
            } else {
                repl.dismiss();
                if (key.name === 'return' || key.name === 'enter' || key.ctrl && key.name === 'r') {
                    const source = book.current.source;
                    if (book.atPrompt && source.trim()) {
                        history = [...history.filter(item => item !== source), source].slice(-HISTORY_LIMIT);
                        historyIndex = -1;
                    }
                    const action = key.ctrl && key.name === 'r' ? repl.rerun() : repl.submit(Boolean(key.meta));
                    void action.then(exit => {
                        if (exit) leave(); else render();
                    }, fail);
                } else if (key.ctrl && key.name === 'c') {
                    if (repl.liveEditing) repl.cancelLiveFunction();
                    else { book.toPrompt(); book.replace(''); }
                }
                else if (key.ctrl && key.name === 'z') book.undo();
                else if (key.ctrl && key.name === 'y') book.undo(true);
                else if (key.ctrl && key.name === 'p') {
                    if (historyIndex < 0) historyDraft = book.current.source;
                    historyIndex = Math.min(history.length - 1, historyIndex + 1);
                    if (historyIndex >= 0) book.replace(history[history.length - 1 - historyIndex]);
                } else if (key.ctrl && key.name === 'n') {
                    historyIndex = Math.max(-1, historyIndex - 1);
                    book.replace(historyIndex < 0 ? historyDraft : history[history.length - 1 - historyIndex]);
                } else if (key.name === 'up' || key.name === 'down') {
                    book.vertical(key.name === 'up' ? -1 : 1, textColumns(output.columns || 80));
                } else if (key.name === 'pageup' || key.name === 'pagedown') {
                    top = Math.max(0, top + (key.name === 'pageup' ? -1 : 1) * Math.max(1, (output.rows || 24) - 2));
                } else if (key.name === 'left' || key.name === 'right') book.horizontal(key.name === 'left' ? -1 : 1);
                else if (key.name === 'home' || key.ctrl && key.name === 'a') book.lineEdge(false);
                else if (key.name === 'end' || key.ctrl && key.name === 'e') {
                    if (key.ctrl && key.name === 'end') book.toPrompt(); else book.lineEdge(true);
                } else if (key.name === 'backspace' || key.name === 'delete') book.erase(key.name === 'backspace');
                else if (key.ctrl && key.name === 'u') book.replace(book.current.source.slice(book.cursor), 0);
                else if (key.ctrl && key.name === 'k') {
                    const end = book.current.source.indexOf('\n', book.cursor);
                    book.replace(book.current.source.slice(0, book.cursor)
                        + book.current.source.slice(end < 0 ? book.current.source.length : end), book.cursor);
                } else if (!key.ctrl && !key.meta && text && text >= ' ') book.insert(text, true);
            }
            render();
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
                    if (!repl.running) {
                        if (repl.savePrompt) {
                            if (!repl.savePrompt.choosing) repl.savePrompt.filename.insert((paste + before).replace(/[\r\n]/g, ''));
                        } else if (!repl.help) book.insert((paste + before).replace(/\r\n?/g, '\n'));
                    }
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
        try { await fs.writeFile(historyFile(), history.map(item => item.replace(/\n/g, ' ')).join('\n') + '\n'); }
        catch { /* A read-only home does not prevent using the REPL. */ }
    }
}
