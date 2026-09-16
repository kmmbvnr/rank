import { EMPTY_CELL, addLine, isComplete } from './repl-input.js';
import { Notebook, splitSource } from './notebook.js';
import { FileWorkflow, type SavePrompt } from './file-workflow.js';
import { ExecutionRunner } from './execution-runner.js';
import { LiveConditionalController } from './live-conditional-controller.js';
import { LiveFunctionController } from './live-function-controller.js';
import { enclosingIterationLine } from './live-preview.js';
import { type OutputLine } from './repl-session.js';
import type { ReplSession } from './repl-types.js';


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
    get exampleFields(): { name: string; source: string; cursor: number; active: boolean; error?: string; summary?: string }[] | undefined {
        return this.liveFunction.fields;
    }
    iterationSelecting = false;
    private stepTarget?: { id: number; source: string; cursor: number };
    private evaluationCell?: number;
    get advancing(): boolean {
        return this.stepping || this.liveIterationFocused
            || this.evaluationCell === this.notebook.current.id && this.liveEditing;
    }
    get stepping(): boolean {
        return this.stepTarget?.id === this.notebook.current.id
            && this.stepTarget.source === this.notebook.current.source && this.stepTarget.cursor === this.notebook.cursor;
    }
    get liveIterationFocus(): { line: number; offset: number; nextLine: number; active: boolean } | undefined {
        const focus = this.liveFunction.iterationFocus ?? this.liveConditional.iterationFocus;
        return focus ? { ...focus, active: this.iterationSelecting } : undefined;
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
        if (this.stepping) return 'Enter newline · ^R step · ^L run all';
        if (this.liveIterationFocused) return this.iterationSelecting
            ? '←/→ select · Esc edit · ^L run all'
            : 'Enter select · Esc edit · ^L run all';
        return this.suggestionText || (this.advancing ? 'Enter newline · ^R run · ^L run all' : '')
            || this.liveFunction?.status || this.liveConditional?.status || '';
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
        this.evaluationCell = undefined;
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

    reopenExample(last = false): boolean { return this.liveFunction.reopenArguments(last); }

    async moveLiveIteration(direction: number): Promise<boolean> {
        if (await this.liveFunction.moveIteration(direction)) return true;
        return this.liveConditional.moveIteration(direction);
    }

    releaseLiveIteration(): boolean {
        if (this.liveIterationFocused) this.evaluationCell = this.notebook.current.id;
        this.iterationSelecting = false;
        return this.liveFunction.releaseIteration() || this.liveConditional.releaseIteration();
    }

    editSource(): boolean {
        const stepping = this.stepTarget !== undefined;
        this.stepTarget = undefined;
        const focused = this.releaseLiveIteration();
        const closed = this.liveFunction.leavePreview() || this.liveConditional.leavePreview();
        this.evaluationCell = undefined;
        if (closed) this.render();
        return focused || closed || stepping;
    }

    insertEvaluationLine(): void {
        const source = this.notebook.current.source;
        this.notebook.temporaryNewline();
        if (source !== this.notebook.current.source) {
            this.liveFunction.invalidatePreviews();
            this.liveConditional.invalidatePreviews();
        }
    }

    async selectIteration(): Promise<void> {
        if (this.running || this.help || this.savePrompt) return;
        if (this.liveIterationFocused) { this.iterationSelecting = true; return; }
        const source = this.notebook.current.source;
        const target = source.slice(0, this.notebook.cursor).split('\n').length - 1;
        if (enclosingIterationLine(source, 0, target) === undefined) {
            this.suggestion = 'No loop here · ^L run all';
            return;
        }
        const selected = await this.liveFunction.selectIteration() || await this.liveConditional.selectIteration();
        this.iterationSelecting = selected;
    }

    focusLiveIterationFromBody(header?: number): boolean {
        const focused = this.liveFunction.focusIterationFromBody(header) || this.liveConditional.focusIterationFromBody(header);
        if (focused) this.iterationSelecting = false;
        return focused;
    }

    async rerun(): Promise<boolean> {
        if (this.running || this.help || this.savePrompt) return false;
        await this.files.ready;
        this.stepTarget = undefined;
        this.iterationSelecting = false;
        const book = this.notebook;
        const firstSource = book.cells.findIndex(cell => !cell.command && cell.source.trim() !== '');
        const firstPart = splitSource(book.current.source).find(part => part.trim() !== '');
        const firstEnd = firstPart === undefined ? -1 : book.current.source.indexOf(firstPart) + firstPart.length;
        if (!book.atPrompt && book.active === firstSource && book.cursor <= firstEnd) {
            await this.execution.exclusive(async () => {
                await this.session.resetExecution();
                book.resetExecution();
                this.liveFunction.invalidatePreviews();
                this.liveConditional.invalidatePreviews();
                await this.execution.prepareFunctions();
            });
        }
        if (await this.liveFunction.rerun() || await this.liveConditional.rerun()) {
            this.evaluationCell = book.current.id;
            this.iterationSelecting = this.liveIterationFocused;
            return false;
        }
        if (book.atPrompt || book.current.command) return this.submit(true);
        return this.runInstruction();
    }

    private async runInstruction(): Promise<boolean> {
        const book = this.notebook;
        const index = book.active;
        let offset = 0;
        const parts = splitSource(book.current.source);
        let selected = parts.length - 1;
        for (const [part, source] of parts.entries()) {
            if (book.cursor <= offset + source.length) { selected = part; break; }
            offset += source.length + 1;
        }
        const source = parts[selected] ?? '';
        const exit = await this.execution.executeOne(index, source, offset);
        if (exit || book.current.status === 'error' || book.current.status === 'interrupted') return exit;
        if (selected + 1 < parts.length) book.cursor = offset + source.length + 1;
        else {
            book.active = Math.min(index + 1, book.cells.length - 1);
            book.cursor = book.atPrompt ? book.current.source.length : 0;
        }
        while (!book.atPrompt && !book.current.source.trim()) book.active++;
        if (!book.atPrompt) this.stepTarget = { id: book.current.id, source: book.current.source, cursor: book.cursor };
        return false;
    }

    async restart(): Promise<boolean> {
        if (this.running || this.help || this.savePrompt) return false;
        await this.files.ready;
        this.stepTarget = undefined;
        this.evaluationCell = undefined;
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
        if (book.indentToCode()) { this.dismiss(); return; }
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
        const [candidates, word] = this.session.complete(prefix);
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
        if (!force && this.stepping) return this.rerun();
        if (this.examplePrompt) {
            const exit = await this.liveFunction.acceptExample();
            this.iterationSelecting = this.liveIterationFocused;
            return exit;
        }
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
        if (!book.atPrompt && !force && !this.liveEditing && book.current.status !== 'error') {
            book.newline();
            return false;
        }
        if (force) {
            if (book.current.status === 'interrupted') book.replayFrom = book.active;
            book.toPrompt();
            // Run edits above a suspended draft without submitting or replacing it.
            if (this.liveEditing) return this.execution.execute('', false, true);
        }
        const raw = book.current.source.trim();
        const selectedIndex = book.active;
        const selectedCursor = book.cursor;
        const liveResult = await this.liveFunction.submit();
        if (liveResult === 'handled') return false;
        if (liveResult === 'replay') {
            book.active = selectedIndex;
            book.cursor = Math.min(selectedCursor, book.current.source.length);
            return this.runInstruction();
        }
        const conditionalResult = await this.liveConditional.submit();
        if (conditionalResult === 'handled') return false;
        if (conditionalResult === 'replay') {
            book.active = selectedIndex;
            book.cursor = Math.min(selectedCursor, book.current.source.length);
            return this.runInstruction();
        }
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
