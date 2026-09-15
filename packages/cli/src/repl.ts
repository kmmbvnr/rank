import * as readline from 'node:readline';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { EMPTY_CELL, addLine, cellSource, closeCell, isComplete, isEmpty } from './repl-input.js';
import { createWorkerSession } from './worker-session.js';
import { Notebook, splitSource } from './notebook.js';
import { KeyRouter, type Key } from './key-router.js';
import { FileWorkflow, type SavePrompt } from './file-workflow.js';
import { ExecutionRunner } from './execution-runner.js';
import { LiveConditionalController } from './live-conditional-controller.js';
import { LiveFunctionController } from './live-function-controller.js';
import { createReplSession, type OutputLine } from './repl-session.js';
import type { ReplSession } from './repl-types.js';
import { TerminalModeRouter } from './terminal-modes.js';
import { TerminalRenderer } from './terminal-renderer.js';
import { TerminalInputDecoder } from './terminal-input.js';

const HISTORY_LIMIT = 500;
const historyFile = (): string => path.join(os.homedir(), '.rank_history');

/** Coordinates explicit execution. Navigation never calls into the interpreter. */
export class NotebookRepl {
    readonly notebook = new Notebook();
    pauseTop = 0;
    readonly breakpoints = new Map<number, Set<number>>();
    private readonly liveFunction: LiveFunctionController;
    private readonly liveConditional: LiveConditionalController;
    private readonly files: FileWorkflow;
    private readonly execution: ExecutionRunner;

    get running(): boolean { return this.execution.running; }

    get examplePrompt(): { name: string; parameter?: string; index: number; count: number } | undefined {
        return this.liveFunction.prompt;
    }

    get promptLabel(): string {
        return 'rank> ';
    }

    get liveOutputs(): ReadonlyMap<number, OutputLine[]> | undefined {
        return this.liveFunction.outputs ?? this.liveConditional.outputs;
    }
    get liveEditing(): boolean { return this.liveFunction.editing || this.liveConditional.editing; }
    get exampleEditor(): Notebook | undefined { return this.liveFunction.editor; }
    get exampleFields(): { name: string; source: string; cursor: number; active: boolean; error?: string }[] | undefined {
        return this.liveFunction.fields;
    }
    get liveIterationFocus(): { line: number; offset: number } | undefined {
        return this.liveFunction.iterationFocus ?? this.liveConditional.iterationFocus;
    }
    get liveIterationFocused(): boolean { return this.liveIterationFocus !== undefined; }

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
        if (this.liveFunction.reopenArguments()) return false;
        if (!this.notebook.atPrompt) this.notebook.replayFrom = this.notebook.active;
        this.session.debugNext?.();
        return this.submit(true);
    }

    togglePause(): void {
        this.pauseTop = 0;
        this.execution.togglePause();
    }

    get runningStatus(): string { return this.execution.status; }

    interrupt(): void { this.execution.interrupt(); }

    private suggestionText = '';
    get suggestion(): string {
        return this.suggestionText || this.liveFunction?.status || this.liveConditional?.status || '';
    }
    set suggestion(value: string) { this.suggestionText = value; }
    help?: { text: string; top: number };
    private completion?: { candidates: string[]; from: number; to: number; index: number };

    get savePrompt(): SavePrompt | undefined { return this.files.prompt; }
    set savePrompt(prompt: SavePrompt | undefined) { this.files.prompt = prompt; }

    constructor(
        readonly session: ReplSession,
        readonly render: () => void = () => {},
        readonly columns = () => 80,
        functionExamples = false,
    ) {
        this.execution = new ExecutionRunner(this.notebook, session, this.breakpoints, columns, render);
        this.liveFunction = new LiveFunctionController(
            this.notebook, session, columns, text => { this.suggestion = text; }, render, functionExamples,
        );
        this.liveConditional = new LiveConditionalController(
            this.notebook, session, columns, text => { this.suggestion = text; }, render, functionExamples,
        );
        this.files = new FileWorkflow(
            this.notebook, session, this.breakpoints, start => this.execution.prepareFunctions(start),
            () => { this.liveFunction.clear(); this.liveConditional.clear(); this.help = undefined; this.dismiss(); },
            () => this.running, running => { this.execution.setRunning(running); }, render,
        );
    }

    dismiss(): void { this.suggestion = ''; this.completion = undefined; }

    cancelExample(): void { this.liveFunction.cancelExample(); }

    cancelLiveFunction(): void {
        if (this.liveFunction.editing) this.liveFunction.cancel();
        else this.liveConditional.cancel();
        this.completion = undefined;
    }

    cycleExampleCandidate(): void {
        this.liveFunction.cycleCandidate();
    }

    moveExampleField(direction: number): void {
        this.liveFunction.moveField(direction);
    }

    async moveLiveIteration(direction: number): Promise<boolean> {
        if (await this.liveFunction.moveIteration(direction)) return true;
        return this.liveConditional.moveIteration(direction);
    }

    releaseLiveIteration(): boolean {
        return this.liveFunction.releaseIteration() || this.liveConditional.releaseIteration();
    }

    focusLiveIterationFromBody(): boolean {
        return this.liveFunction.focusIterationFromBody() || this.liveConditional.focusIterationFromBody();
    }

    focusExampleFromBody(): boolean {
        return this.liveFunction.focusExampleFromBody();
    }

    async rerun(): Promise<boolean> {
        if (this.running || this.help || this.savePrompt) return false;
        if (await this.liveFunction.rerun()) return false;
        if (await this.liveConditional.rerun()) return false;
        return this.submit(true);
    }

    async restart(): Promise<boolean> {
        if (this.running || this.help || this.savePrompt) return false;
        await this.files.ready;
        return this.execution.exclusive(async () => {
            const book = this.notebook;
            const draft = book.cells.at(-1)!.source;
            let state = EMPTY_CELL;
            for (const line of draft.split('\n')) state = addLine(state, line, true);
            const complete = draft.trim() !== '' && isComplete(state) && !this.session.isCommand(draft.trim());
            await this.session.resetExecution();
            if (complete) {
                book.enqueue(draft);
                this.liveFunction.clear();
                this.liveConditional.clear();
            } else {
                this.liveFunction.invalidatePreviews();
                this.liveConditional.invalidatePreviews();
            }
            this.dismiss();
            book.resetExecution();
            return this.execution.execute('', false, true);
        });
    }

    get unsaved(): boolean { return this.files.unsaved; }
    get fileStatus(): string { return this.files.status; }
    requestExit(): boolean { return this.files.requestExit(); }
    requestSave(): Promise<void> { return this.files.requestSave(); }

    discardChanges(): boolean { return this.files.discardChanges(); }
    savePromptFile(): Promise<boolean> { return this.files.savePromptFile(); }

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
        if (this.examplePrompt) return this.liveFunction.acceptExample();
        await this.files.ready;
        if (force && await this.liveFunction.forcePreview()) return false;
        if (force && await this.liveConditional.forcePreview()) return false;
        this.dismiss();
        const book = this.notebook;
        let currentRaw = book.current.source.trim();
        if (this.liveFunction.enabled && !book.current.source.includes('\n')
            && /^\s*(?:fun|memo|if|for)\b/.test(currentRaw)) {
            book.formatCurrentLine(line => this.session.format(line));
            currentRaw = book.current.source.trim();
        }
        if (this.liveFunction.begin(currentRaw)) {
            this.render();
            return false;
        }
        if (await this.liveConditional.begin(currentRaw)) return false;
        if (!book.atPrompt && !force && !this.liveEditing) { book.newline(); return false; }
        if (force) {
            if (book.current.status === 'interrupted') book.replayFrom = book.active;
            book.toPrompt();
            // Run edits above a suspended draft without submitting or replacing it.
            if (this.liveEditing) return this.execution.execute('', false, true);
        }
        const raw = book.current.source.trim();
        const liveResult = await this.liveFunction.submit();
        if (liveResult === 'handled') return false;
        if (liveResult === 'replay') return this.submit(true);
        const conditionalResult = await this.liveConditional.submit();
        if (conditionalResult === 'handled') return false;
        if (conditionalResult === 'replay') return this.submit(true);
        const draft = this.session.isCommand(raw) ? raw : book.preparePrompt(line => this.session.format(line));
        if (draft === undefined) return false;
        // Commit input before replay: even if an earlier instruction fails, this text stays in the document.
        const command = draft.trim() !== '' && this.session.isCommand(draft);
        if (command && (draft === 'exit' || draft === 'quit')) {
            book.replace('');
            return this.requestExit();
        }
        if (command && draft.split(/\s+/)[0] === 'help') {
            return this.execution.exclusive(async () => {
                const result = await this.session.execute(draft, book.current.id, book.fileLines(), this.columns());
                book.replace('');
                this.help = { text: result.output.map(line => line.text).join('\n'), top: 0 };
                return false;
            });
        }
        if (command && draft.split(/\s+/)[0] === 'load') {
            return this.execution.exclusive(async () => {
                const result = await this.session.execute(draft, book.current.id, book.fileLines(), this.columns());
                if (result.loadedFile === undefined) {
                    book.enqueue(draft);
                    book.finish(book.cells.length - 2, result);
                    return false;
                }
                this.files.offerLoadedFile(result.loadedFile);
                await this.files.ready;
                return false;
            });
        }
        return this.execution.execute(draft, command, force);
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
async function streamRepl(session: ReplSession): Promise<void> {
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

async function terminalRepl(session: ReplSession): Promise<void> {
    const input = process.stdin;
    const output = process.stdout;
    const keyInput = new (await import('node:stream')).PassThrough();
    readline.emitKeypressEvents(keyInput);
    let history: string[] = [];
    try { history = (await fs.readFile(historyFile(), 'utf8')).split('\n').filter(Boolean).slice(-HISTORY_LIMIT); }
    catch { /* A new session has no history yet. */ }
    let renderer: TerminalRenderer;
    const render = (): void => renderer?.render();
    const repl = new NotebookRepl(session, render, () => output.columns || 80, true);
    const book = repl.notebook;
    const keyRouter = new KeyRouter(repl, history, () => output.columns || 80);
    const modeRouter = new TerminalModeRouter(repl, () => output.rows || 24);
    renderer = new TerminalRenderer(repl, modeRouter, output);
    let finish!: () => void;
    let fail!: (error: unknown) => void;
    const ended = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    const leave = (): void => { renderer.close(); finish(); };
    const onKey = (text: string, key: Key = {}): void => {
        if (renderer.closed) return;
        try {
            renderer.followKey(key.name);
            if (!modeRouter.active) {
                void keyRouter.press(text, key).then(result => {
                    if (result.pageDelta) renderer.page(result.pageDelta);
                    if (result.exit) leave(); else render();
                }, fail);
                return;
            }
            void modeRouter.press(text, key).then(mode => {
                if (mode.exit) leave(); else if (mode.render) render();
            }, fail);
        } catch (error) { fail(error); }
    };
    const inputDecoder = new TerminalInputDecoder(
        text => { keyInput.write(text); },
        value => {
            if (!modeRouter.paste(value)) book.insert(value.replace(/\r\n?/g, '\n'));
            repl.dismiss();
            render();
        },
    );
    const onData = (chunk: Buffer): void => { inputDecoder.write(chunk); };
    const wasRaw = input.isRaw;
    const onEnd = (): void => { inputDecoder.end(); leave(); };
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
        renderer.close();
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
