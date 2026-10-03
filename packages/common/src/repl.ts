import { EMPTY_CELL, addLine, hasCode, isComplete } from './repl-input.js';
import { Notebook, type NotebookCell } from './notebook.js';
import { FileWorkflow, type SavePrompt } from './file-workflow.js';
import { ExecutionRunner } from './execution-runner.js';
import { LiveConditionalController } from './live-conditional-controller.js';
import { LiveFunctionController } from './live-function-controller.js';
import { enclosingIterationLine } from './live-preview.js';
import { importPosition, missingImports } from './import-fix.js';
import { type OutputLine } from './repl-session.js';
import type { ReplSession } from './repl-types.js';
import { notebookScope, notebookValueDiagnostics } from './value-diagnostics.js';
import { createModuleLoader, importedPaths, type ModuleSource } from './module-loader.js';
import { nameFactsIn, type NameFacts } from './name-facts.js';
import { ValueViewer } from './value-viewer.js';


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
    get evaluating(): boolean { return this.liveFunction.evaluating || this.liveConditional.evaluating; }

    get examplePrompt(): { name: string; parameter?: string; index: number; count: number } | undefined {
        return this.liveFunction.prompt;
    }

    get promptLabel(): string {
        return 'rank> ';
    }

    get liveOutputs(): ReadonlyMap<number, OutputLine[]> | undefined {
        return this.liveFunction.outputs ?? this.liveConditional.outputs;
    }
    get diagnosticOutputs(): ReadonlyMap<number, OutputLine[]> | undefined {
        if (this.running) return undefined;
        const facts = this.session.diagnosticFacts;
        const key = JSON.stringify([this.notebook.active, this.notebook.dirtyFrom,
            this.notebook.cells.map(cell =>
                [cell.id, cell.source, cell.executed, cell.command, cell.status]), facts, this.session.testExamples,
            this.importedSources()]);
        if (this.diagnosticCache?.key !== key) this.diagnosticCache = {
            key, outputs: notebookValueDiagnostics(this.notebook, facts, this.session.testExamples, this.loadModule),
        };
        return this.diagnosticCache.outputs;
    }
    /** The name under the source cursor, while the source is being edited. Gone as soon as the source changes. */
    get nameFacts(): NameFacts | undefined {
        if (this.running || this.liveEditing) return undefined;
        const book = this.notebook;
        const current = book.current;
        if (current.command || !current.source.trim()) return undefined;
        const facts = this.session.diagnosticFacts;
        const key = JSON.stringify([book.active, book.dirtyFrom,
            book.cells.map(cell => [cell.id, cell.source, cell.executed, cell.command, cell.status]), facts,
            this.importedSources()]);
        if (this.nameFactsCache?.key !== key) {
            const scope = notebookScope(book, facts, this.loadModule);
            this.nameFactsCache = { key, lookup: nameFactsIn(current.source, scope.clean ? facts : [], [], scope, this.loadModule) };
        }
        return this.nameFactsCache.lookup?.(book.cursor);
    }
    private readonly modules?: ModuleSource;
    private readonly loadModule?: ReturnType<typeof createModuleLoader>;
    /** What the notebook's imports say now, so a module edited on disk invalidates the cached analysis. */
    private importedSources(): (string | null)[] {
        if (!this.modules) return [];
        return importedPaths(this.notebook.cells.map(cell => cell.source)).map(path => {
            try { return this.modules!(path) ?? null; } catch { return null; }
        });
    }
    private nameFactsCache?: { key: string; lookup: ReturnType<typeof nameFactsIn> };
    private diagnosticCache?: { key: string; outputs: ReadonlyMap<number, OutputLine[]> };
    get liveEditing(): boolean { return this.liveFunction.editing || this.liveConditional.editing; }
    get completingLiveFunction(): boolean { return this.liveFunction.completing; }
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
    /** Whether an iteration can be stepped here: one is selected, or the cursor sits inside a loop. */
    get liveIterationAvailable(): boolean {
        if (this.liveIterationFocused) return true;
        if (!this.liveEditing || this.examplePrompt || this.running || this.help || this.savePrompt) return false;
        const source = this.notebook.current.source;
        const line = source.slice(0, this.notebook.cursor).split('\n').length - 1;
        return enclosingIterationLine(source, 0, line) !== undefined;
    }

    get pauseSnapshot(): import('@arrrank/interpreter').PauseSnapshot | undefined {
        const pause = this.session.pauseState;
        if (!pause?.source || pause.line === undefined) return pause;
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

    interrupt(): void {
        if (this.execution.running) this.execution.interrupt();
        else this.session.interrupt?.();
    }

    private importFocus?: { id: number; index: number };

    /** Modules the active cell's last error suggests importing. */
    get importFixes(): string[] {
        const cell = this.notebook.current;
        if (this.running || cell.status !== 'error' || cell.executed !== cell.source) return [];
        return missingImports(cell.output);
    }

    /** The focused suggestion under the active cell, while that error stands. */
    get importFixFocus(): number | undefined {
        const focus = this.importFocus;
        if (focus?.id !== this.notebook.current.id || focus.index >= this.importFixes.length) return undefined;
        return focus.index;
    }

    focusImportFix(): boolean {
        if (!this.importFixes.length) return false;
        this.importFocus = { id: this.notebook.current.id, index: 0 };
        return true;
    }

    moveImportFix(direction: number): void {
        const count = this.importFixes.length;
        if (this.importFixFocus === undefined || !count) return;
        this.importFocus!.index = (this.importFixFocus + direction + count) % count;
    }

    releaseImportFix(): boolean {
        const focused = this.importFixFocus !== undefined;
        this.importFocus = undefined;
        return focused;
    }

    /** Adds `use module` among the imports, runs it, then reruns the failed instruction. */
    async applyImportFix(index = this.importFixFocus ?? 0): Promise<boolean> {
        const module = this.importFixes[index];
        this.importFocus = undefined;
        if (module === undefined || this.help || this.savePrompt) return false;
        const book = this.notebook;
        const failing = book.active;
        const cursor = book.cursor;
        const { index: position, line } = importPosition(book.cells, module, failing);
        if (line === undefined) book.insertCell(position, `use ${module}`);
        else {
            const lines = book.cells[position].source.split('\n');
            lines.splice(line, 0, `use ${module}`);
            book.cells[position].source = lines.join('\n');
        }
        book.selectTo(position, 0);
        const exit = await this.rerun();
        if (exit || book.cells[position].status !== 'ok') return exit;
        book.selectTo(failing + (line === undefined ? 1 : 0), cursor);
        return this.rerun();
    }

    private valueFocusId?: number;

    /** The cell's result that can be opened in a viewer, if it has one. */
    private valueOutput(cell: NotebookCell): (OutputLine & { ref: number; view: string }) | undefined {
        if (cell.command || cell.status !== 'ok' || cell.executed !== cell.source) return undefined;
        return cell.output.find((line): line is OutputLine & { ref: number; view: string } =>
            !line.error && line.ref !== undefined && line.view !== undefined);
    }

    /** The cell whose result row has focus, while that row is still there. */
    get valueFocus(): number | undefined {
        const cell = this.notebook.current;
        return this.valueFocusId === cell.id && this.valueOutput(cell) && !this.running ? cell.id : undefined;
    }

    /** Moves onto the result row just above or below the cursor's cell, if that cell has one to open. */
    focusValue(direction: -1 | 1): boolean {
        if (this.running || this.liveEditing || this.help || this.savePrompt) return false;
        const book = this.notebook;
        let index = book.active;
        if (direction < 0) {
            index--;
            while (index >= 0 && book.cells[index].command) index--;
        }
        const cell = book.cells[index];
        if (!cell || !this.valueOutput(cell)) return false;
        book.active = index;
        book.cursor = cell.source.length;
        this.valueFocusId = cell.id;
        return true;
    }

    /** Puts the focus back on a cell's result row, as when its viewer closes. */
    focusResult(cellId: number): void {
        const index = this.notebook.cells.findIndex(cell => cell.id === cellId);
        if (index < 0 || !this.valueOutput(this.notebook.cells[index])) return;
        this.notebook.active = index;
        this.notebook.cursor = this.notebook.cells[index].source.length;
        this.valueFocusId = cellId;
    }

    /** Closes the open viewer and puts the focus back on its result row; `message` says why it closed early. */
    closeViewer(message = ''): void {
        const viewer = this.help?.viewer;
        if (!viewer) return;
        this.help = undefined;
        if (viewer.restoreFocus) this.focusResult(viewer.cell);
        if (message) this.suggestion = message;
    }

    releaseValue(): boolean {
        const focused = this.valueFocusId !== undefined;
        this.valueFocusId = undefined;
        return focused;
    }

    /** Opens the focused result, or the one in `cellId`, in the full-screen viewer. */
    async openValue(cellId = this.valueFocusId): Promise<boolean> {
        // Opened from the focused row (keys), closing goes back to it; opened by a tap, the row stays unselected.
        const fromFocus = cellId !== undefined && this.valueFocusId === cellId;
        this.valueFocusId = undefined;
        const cell = this.notebook.cells.find(cell => cell.id === cellId);
        const line = cell && this.valueOutput(cell);
        if (!cell || !line || this.running || this.help || this.savePrompt) return false;
        try {
            // The name a result was assigned to, or else the expression itself.
            const last = cell.source.trim().split('\n').at(-1)!.trim();
            const title = /^([A-Za-z_]\w*)\s*=(?!=)/.exec(cell.source.trim())?.[1] ?? last;
            const viewer = new ValueViewer(title, cell.id, request => this.session.inspect(line.ref, request),
                () => ({ rows: this.rows(), columns: this.columns() }));
            viewer.restoreFocus = fromFocus;
            if (await viewer.load()) this.help = { text: '', top: 0, viewer };
            else this.suggestion = 'That value is gone · run the cell again';
        } catch {
            this.suggestion = 'Could not read that value';
        }
        return true;
    }

    private suggestionText = '';
    get suggestion(): string {
        if (this.evaluating) return this.liveFunction?.status || this.liveConditional?.status || '';
        if (this.valueFocus !== undefined) return this.suggestionText || 'Enter view · Esc back';
        if (this.stepping) return 'Enter newline · ^R step · ^L run all';
        if (this.liveIterationFocused) return this.iterationSelecting
            ? '←/→ select · Esc edit · ^L run all'
            : 'Enter select · Esc edit · ^L run all';
        return this.suggestionText || (this.advancing ? 'Enter newline · ^R run · ^L run all' : '')
            || this.liveFunction?.status || this.liveConditional?.status || '';
    }
    set suggestion(value: string) { this.suggestionText = value; }
    /** A help text, or a held value open in a viewer (then `text` is empty). */
    help?: { text: string; top: number; viewer?: ValueViewer };
    /** Rows of the screen, for a viewer to size its window. */
    rows = (): number => 24;
    private completion?: { candidates: string[]; from: number; to: number; index: number; original: string; trailingSpace?: boolean };
    get hasCompletion(): boolean { return !!this.openCompletion(); }

    /**
     * The completion whose inserted text is still in the draft. Text replaced any other way
     * (history, a pasted line, a host edit) closes it, so Tab starts a new completion and
     * cancel never splices an old range into different text.
     */
    private openCompletion(): NonNullable<NotebookRepl['completion']> | undefined {
        const item = this.completion;
        if (!item) return undefined;
        let inserted = item.candidates[item.index];
        if (item.trailingSpace && !inserted.endsWith(' ')) inserted += ' ';
        if (this.notebook.current.source.slice(item.from, item.to) === inserted) return item;
        this.completion = undefined;
        return undefined;
    }

    cancelCompletion(): boolean {
        const item = this.openCompletion();
        if (!item) return false;
        const book = this.notebook;
        book.replace(book.current.source.slice(0, item.from) + item.original + book.current.source.slice(item.to),
            item.from + item.original.length);
        this.dismiss();
        return true;
    }

    get savePrompt(): SavePrompt | undefined { return this.files.prompt; }
    set savePrompt(prompt: SavePrompt | undefined) { this.files.prompt = prompt; }

    constructor(
        readonly session: ReplSession,
        readonly render: () => void = () => {},
        readonly columns = () => 80,
        functionExamples = false,
        /** Where `use "path"` finds a module, for analysis only; without it imports stay opaque. */
        modules?: ModuleSource,
    ) {
        this.modules = modules;
        this.loadModule = modules && createModuleLoader(modules);
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
        // Running an edited cell settles its boundaries first: one statement per cell.
        book.resplit(book.active);
        const targetIndex = book.active;
        const targetCursor = book.cursor;
        const pendingFrom = book.dirtyFrom;
        const firstSource = book.cells.findIndex(cell => !cell.command && hasCode(cell.source));
        if (!book.atPrompt && (book.active === firstSource || pendingFrom === firstSource && firstSource < targetIndex)) {
            await this.execution.exclusive(async () => {
                await this.session.resetExecution();
                book.resetExecution();
                this.liveFunction.invalidatePreviews();
                this.liveConditional.invalidatePreviews();
                await this.execution.prepareFunctions();
            });
        }
        if (!book.atPrompt && book.dirtyFrom >= 0 && book.dirtyFrom < targetIndex) {
            const start = book.dirtyFrom;
            for (let index = start; index < targetIndex; index++) {
                const cell = book.cells[index];
                if (cell.command) continue;
                if (!hasCode(cell.source)) {
                    cell.executed = cell.source;
                    cell.output = [];
                    cell.status = 'idle';
                    continue;
                }
                const exit = await this.execution.executeOne(index);
                if (exit || cell.status === 'error' || cell.status === 'interrupted') return exit;
            }
            book.selectTo(targetIndex, targetCursor);
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
        if (hasCode(book.current.source)) {
            const exit = await this.execution.executeOne(index);
            if (exit || book.current.status === 'error' || book.current.status === 'interrupted') return exit;
        }
        book.active = Math.min(index + 1, book.cells.length - 1);
        book.cursor = book.atPrompt ? book.current.source.length : 0;
        while (!book.atPrompt && !hasCode(book.current.source)) book.active++;
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

    complete(trailingSpace = false): void {
        const book = this.notebook;
        if (book.indentToCode()) { this.dismiss(); return; }
        const open = this.openCompletion();
        if (open) {
            const item = open;
            item.index = (item.index + 1) % item.candidates.length;
            let candidate = item.candidates[item.index];
            if (item.trailingSpace && !candidate.endsWith(' ')) candidate += ' ';
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
        let candidate = candidates[0];
        if (trailingSpace && !candidate.endsWith(' ')) candidate += ' ';
        book.replace(prefix.slice(0, from) + candidate + book.current.source.slice(book.cursor), from + candidate.length);
        this.completion = { candidates, from, to: book.cursor, index: 0, original: word, trailingSpace };
        if (candidates.length > 1) {
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
        if (!book.atPrompt && !force && !this.liveEditing) {
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
