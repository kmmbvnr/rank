import { parse } from '@arrrank/interpreter';
import { isFunctionStatement } from '@arrrank/language';
import { LiveFunctionSession } from './live-function.js';
import { enclosingIterationLine, LivePreviewRunner } from './live-preview.js';
import type { Notebook } from './notebook.js';
import type { OutputLine } from './repl-session.js';
import type { ReplSession } from './repl-types.js';
import { EMPTY_CELL, addLine, isComplete } from './repl-input.js';

export type LiveSubmitResult = 'absent' | 'handled' | 'complete' | 'replay';

/** Owns example arguments and isolated line previews for one function edit. */
export class LiveFunctionController {
    private live?: LiveFunctionSession;
    private focusedIteration?: number;
    private focusedThroughLine?: number;
    private readonly examples = new Map<string, string[]>();
    private readonly preview: LivePreviewRunner;
    private evaluatingStatus?: string;

    constructor(
        private readonly notebook: Notebook,
        private readonly session: ReplSession,
        private readonly columns: () => number,
        private readonly setSuggestion: (text: string) => void,
        private readonly render: () => void,
        readonly enabled: boolean,
    ) {
        this.preview = new LivePreviewRunner(
            source => this.session.preview(source, this.columns()),
            {
                onProgress: status => {
                    this.evaluatingStatus = status;
                    this.render();
                },
                interrupt: () => this.session.interrupt?.(),
            },
        );
    }

    get evaluating(): boolean { return this.evaluatingStatus !== undefined; }

    get prompt(): { name: string; parameter?: string; index: number; count: number } | undefined {
        return this.editing ? this.live?.prompt : undefined;
    }
    get outputs(): ReadonlyMap<number, OutputLine[]> | undefined { return this.editing ? this.live?.outputs : undefined; }
    get editing(): boolean { return this.live !== undefined && this.live.cellId === this.notebook.current.id; }
    get completing(): boolean {
        if (!this.editing || this.live!.existing || this.prompt) return false;
        const source = this.notebook.current.source;
        if (source.slice(this.notebook.cursor).trim()) return false;
        let state = EMPTY_CELL;
        for (const line of source.split('\n')) state = addLine(state, line.trim(), true);
        return isComplete(state);
    }
    get iterationFocus(): { line: number; offset: number; nextLine: number } | undefined {
        if (!this.editing || !this.live || this.prompt || this.focusedIteration === undefined) return undefined;
        const text = this.live.outputs.get(this.focusedIteration)?.find(output => !output.error)?.text;
        if (!text) return undefined;
        const suffix = text.indexOf(' · iteration');
        return { line: this.focusedIteration, offset: suffix < 0 ? text.length : suffix,
            nextLine: Math.min((this.focusedThroughLine ?? this.focusedIteration) + 1,
                this.notebook.current.source.split('\n').length) };
    }
    get status(): string | undefined {
        if (this.evaluatingStatus) return this.evaluatingStatus;
        if (!this.editing || !this.live || this.prompt) return undefined;
        return this.focusedIteration !== undefined
            ? '←/→ select · Esc edit · ^L run all'
            : /^\s*for\s/m.test(this.notebook.current.source) ? 'Eval · ^G loop · Esc edit · ^L run all'
            : this.live.existing ? 'Enter newline · ^R run · ^T args · ^L run all'
            : 'Enter try · ^T args · ^L run all';
    }
    get editor(): Notebook | undefined { return this.prompt ? this.live?.argumentEditor : undefined; }
    get fields(): { name: string; source: string; cursor: number; active: boolean; error?: string; summary?: string }[] | undefined {
        return this.editing ? this.live?.fields : undefined;
    }
    get hasParameters(): boolean { return !!this.live?.parameters.length; }

    clear(): void { this.live = undefined; this.clearIterationFocus(); }

    invalidatePreviews(): void {
        this.live?.outputs.clear();
        this.live?.prefixes.clear();
        this.clearIterationFocus();
    }

    reopenArguments(last = false): boolean {
        if (!this.editing || !this.live?.parameters.length) return false;
        this.live.source = this.notebook.current.source;
        this.live.stopLine = selectedLine(this.live.source, this.notebook.cursor);
        this.live.openArguments(last ? this.live.parameters.length - 1 : 0, this.session.names);
        this.updateExampleSuggestion();
        return true;
    }

    cancelExample(): void {
        const live = this.live;
        if (!live || live.argument === undefined) return;
        live.cancelArguments();
        this.notebook.replace(live.source);
        this.updateSuggestion();
    }

    cancel(): void {
        const live = this.live;
        if (live?.existing && live.originalSource !== undefined) {
            this.notebook.replace(live.originalSource);
            this.notebook.cursor = Math.min(this.notebook.cursor, live.originalSource.length);
        }
        this.live = undefined;
        this.clearIterationFocus();
        this.notebook.toPrompt();
        if (!live?.existing) this.notebook.replace('');
        this.setSuggestion('');
    }

    cycleCandidate(): void {
        if (!this.prompt) return;
        if (!this.live!.cycleCandidate(this.session.names)) {
            this.setSuggestion('No variables available · type a value · Esc skip');
            return;
        }
        this.updateExampleSuggestion();
    }

    moveField(direction: number): void {
        const live = this.live;
        if (!live || live.argument === undefined) return;
        const next = live.argument + direction;
        if (next < 0 || next >= live.parameters.length) {
            live.saveArgument();
            live.argument = undefined;
            live.stopLine = undefined;
            this.notebook.replace(live.source);
            if (live.values.some((value, index) => value !== live.argumentBackup[index])) {
                live.outputs.clear();
                live.prefixes.clear();
            }
            this.clearIterationFocus();
            this.placeCursorAtLineEnd(direction < 0 ? 0 : 1);
            this.updateSuggestion();
            return;
        }
        live.moveArgument(direction, this.session.names);
        this.updateExampleSuggestion();
    }

    begin(source: string): boolean {
        if (this.live && !this.notebook.cells.some(cell => cell.id === this.live!.cellId)) this.clear();
        if (!this.enabled || this.live || source.includes('\n')) return false;
        const match = /^\s*(?:fun|memo)\s+([a-z][A-Za-z0-9_]*|update)((?:\s+[A-Za-z][A-Za-z0-9_]*)*)\s*$/.exec(source);
        if (!match) return false;
        const existing = !this.notebook.atPrompt;
        const parameters = match[2].trim() ? match[2].trim().split(/\s+/) : [];
        const body = `${source.trim()}\n  `;
        this.live = new LiveFunctionSession({
            name: match[1], parameters, header: source.trim(), source: body,
            cellId: this.notebook.current.id, existing, originalSource: existing ? source.trim() : undefined,
        }, this.session.names);
        this.clearIterationFocus();
        this.notebook.replace(parameters.length ? source.trim() : body);
        if (parameters.length) this.updateExampleSuggestion(); else this.updateSuggestion();
        return true;
    }

    async rerun(): Promise<boolean> {
        if (this.live && !this.editing) return false;
        if (!this.live && !this.beginExisting()) return false;
        const live = this.live!;
        live.source = this.notebook.current.source;
        live.stopLine = selectedLine(live.source, this.notebook.cursor);
        const header = isIterationHeader(live.source.split('\n')[live.stopLine - 1]);
        if (live.parameters.length && (live.skipped || live.parameters.some((_, index) => !live.values[index]?.trim()))) {
            live.openArguments(0, this.session.names);
            this.updateExampleSuggestion();
        } else {
            live.argument = undefined;
            const line = live.stopLine;
            await this.updatePreviews(true, currentLineNumber(this.notebook) === 1 ? line - 1 : line);
            this.clearIterationFocus();
            this.placeCursorAtLineEnd(line - 1);
            if (header) this.focusIteration(line);
            live.stopLine = undefined;
        }
        this.render();
        return true;
    }

    leavePreview(): boolean {
        if (!this.editing || !this.live?.existing) return false;
        if (!this.live.skipped && this.live.parameters.every((_, index) => this.live!.values[index]?.trim()))
            this.examples.set(this.live.name, [...this.live.values]);
        this.clear();
        this.setSuggestion('');
        return true;
    }

    async selectIteration(): Promise<boolean> {
        if (this.live && !this.editing) return false;
        if (!this.live && !this.beginExisting()) return false;
        const current = currentLineNumber(this.notebook);
        const header = enclosingIterationLine(this.notebook.current.source, 0, current - 1);
        if (header === undefined) return false;
        await this.updatePreviews(false, Math.max(header, current - 1));
        return this.focusIterationFromBody();
    }

    async forcePreview(): Promise<boolean> {
        if (!this.editing || !this.live) return false;
        this.notebook.formatCurrentLine(line => this.session.format(line));
        const source = this.notebook.current.source;
        const currentLine = source.slice(0, this.notebook.cursor).split('\n').length - 1;
        if (!/\n[\t ]*$/.test(source)) this.notebook.preparePrompt(line => this.session.format(line));
        await this.updatePreviews(true, currentLine + 1);
        this.placeCursorAfterLine(currentLine);
        this.render();
        return true;
    }

    async moveIteration(direction: number): Promise<boolean> {
        const live = this.live;
        const line = this.focusedIteration;
        if (!this.editing || !live || live.argument !== undefined || line === undefined) return false;
        const iteration = live.iterations.get(line) ?? 0;
        const next = Math.max(0, iteration + direction);
        if (next === iteration) return true;
        live.iterations.set(line, next);
        live.outputs.clear();
        live.prefixes.clear();
        await this.updatePreviews(false, this.focusedThroughLine ?? line);
        this.render();
        return true;
    }

    releaseIteration(): boolean {
        if (!this.editing || this.focusedIteration === undefined) return false;
        this.clearIterationFocus();
        this.updateSuggestion();
        this.render();
        return true;
    }

    focusIterationFromBody(header?: number): boolean {
        if (!this.editing || !this.live || this.prompt || this.focusedIteration !== undefined) return false;
        const current = currentLineNumber(this.notebook);
        const line = header ?? enclosingIterationLine(this.notebook.current.source, 1, current - 1);
        if (line !== undefined) this.focusIteration(line, header === undefined ? Math.max(line, current - 1) : line);
        if (this.focusedIteration === undefined) return false;
        this.render();
        return true;
    }

    async submit(): Promise<LiveSubmitResult> {
        const live = this.live;
        if (!this.editing || !live) return 'absent';
        this.notebook.formatCurrentLine(line => this.session.format(line));
        const source = this.notebook.current.source;
        const lines = source.split('\n');
        const currentLine = source.slice(0, this.notebook.cursor).split('\n').length - 1;
        const completing = this.completing;
        if (!completing && currentLine < lines.length - 1) {
            await this.updatePreviews(false, currentLine + 1);
            this.placeCursorAfterLine(currentLine);
            this.render();
            return 'handled';
        }
        if (!completing && !lines[currentLine].trim()) {
            this.notebook.newline();
            this.updateSuggestion();
            this.render();
            return 'handled';
        }
        const draft = this.notebook.preparePrompt(line => this.session.format(line));
        if (draft !== undefined) {
            if (!live.skipped && live.values.length === live.parameters.length)
                this.examples.set(live.name, [...live.values]);
            this.live = undefined;
            this.clearIterationFocus();
            this.setSuggestion('');
            if (live.existing) {
                this.notebook.replayFrom = this.notebook.active;
                this.notebook.toPrompt();
                return 'replay';
            }
            return 'complete';
        }
        await this.updatePreviews(false, currentLine + 1);
        this.placeCursorAfterLine(currentLine);
        this.render();
        return 'handled';
    }

    async acceptExample(): Promise<boolean> {
        const live = this.live;
        if (!live || live.argument === undefined) return false;
        const current = live.argument;
        live.saveArgument();
        const error = live.syntaxError(live.values[current], this.session.names);
        if (error) return this.rejectArgument(live, current, error, 'is not an expression');
        const currentError = await this.runtimeError(live.values[current], current);
        if (currentError) return this.rejectArgument(live, current, currentError, 'cannot be evaluated');
        live.argumentError = undefined;
        if (current + 1 < live.parameters.length) {
            live.focusArgument(current + 1, this.session.names);
            this.updateExampleSuggestion();
            this.render();
            return false;
        }
        for (let index = 0; index < live.parameters.length; index++) {
            const fieldError = live.syntaxError(live.values[index] ?? '', this.session.names);
            if (fieldError) return this.rejectArgument(live, index, fieldError, 'is not an expression');
        }
        for (let index = 0; index < live.parameters.length; index++) {
            if (index === current) continue;
            const fieldError = await this.runtimeError(live.values[index], index);
            if (fieldError) return this.rejectArgument(live, index, fieldError, 'cannot be evaluated');
        }
        live.argument = undefined;
        live.skipped = false;
        this.notebook.replace(live.source);
        live.outputs.clear();
        live.prefixes.clear();
        const header = live.stopLine !== undefined && isIterationHeader(live.source.split('\n')[live.stopLine - 1]);
        await this.updatePreviews(false, live.stopLine === undefined ? undefined : header ? live.stopLine : live.stopLine - 1);
        this.clearIterationFocus();
        if (live.stopLine !== undefined) {
            this.placeCursorAtLineEnd(live.stopLine - 1);
            if (header) this.focusIteration(live.stopLine);
            live.stopLine = undefined;
        }
        this.render();
        return false;
    }

    private beginExisting(): boolean {
        if (!this.enabled || this.notebook.atPrompt) return false;
        const source = this.notebook.current.source;
        let statement;
        try {
            const statements = parse(source).statements;
            if (statements.length !== 1 || !isFunctionStatement(statements[0])) return false;
            statement = statements[0];
        } catch { return false; }
        this.live = new LiveFunctionSession({
            name: statement.name, parameters: [...statement.parameters], header: source.split('\n')[0].trim(),
            source, values: [...(this.examples.get(statement.name) ?? [])], cellId: this.notebook.current.id,
            existing: true, originalSource: source, stopLine: selectedLine(source, this.notebook.cursor),
        }, this.session.names);
        if (statement.parameters.length) this.updateExampleSuggestion(); else this.updateSuggestion();
        return true;
    }

    private rejectArgument(live: LiveFunctionSession, index: number, error: string, reason: string): false {
        live.focusArgument(index, this.session.names);
        live.argumentError = { source: live.argumentEditor.current.source, message: error };
        this.setSuggestion(`${live.parameters[index]} ${reason} · edit it or Esc skip`);
        this.render();
        return false;
    }

    private async runtimeError(value: string, index: number): Promise<string | undefined> {
        const result = await this.session.preview(`(${value})`, this.columns(), true);
        this.live?.summaries.delete(index);
        if (result.ok && result.valueSummary !== undefined && result.valueSummary !== value.trim())
            this.live?.summaries.set(index, { source: value, text: result.valueSummary });
        const failure = result.output.find(line => line.error);
        const diagnostic = (failure?.inlineText ?? failure?.text)?.replace(/\x1b\[[0-9;]*m/g, '');
        return diagnostic?.replace(/^error:\s*RankError\s*\[([^\]]+)\]:\s*/, '$1: ');
    }

    private updateExampleSuggestion(): void {
        const prompt = this.prompt;
        if (prompt) this.setSuggestion(`Example ${prompt.name} · ${prompt.parameter} (${prompt.index + 1}/${prompt.count}) · Tab variables · Enter accept · Esc skip`);
    }

    private updateSuggestion(): void {
        if (this.live) this.setSuggestion('');
    }

    private focusIteration(line: number, throughLine = line): void {
        if (!this.live || !isIterationHeader(this.notebook.current.source.split('\n')[line - 1])
            || !this.live.outputs.get(line)?.some(output => !output.error)) return;
        this.focusedIteration = line;
        this.focusedThroughLine = throughLine;
    }

    private clearIterationFocus(): void {
        this.focusedIteration = undefined;
        this.focusedThroughLine = undefined;
    }

    private async updatePreviews(reset = false, throughLine?: number): Promise<void> {
        if (!this.live) return;
        await this.preview.updateFunction(this.live, this.notebook.current.source, reset, throughLine);
        this.updateSuggestion();
    }

    private placeCursorAfterLine(line: number): void {
        const lines = this.notebook.current.source.split('\n');
        const start = lines.slice(0, line).reduce((offset, item) => offset + item.length + 1, 0);
        const failed = this.live?.outputs.get(line + 1)?.some(output => output.error) ?? false;
        this.notebook.cursor = failed || line >= lines.length - 1
            ? start + lines[line].length : start + lines[line].length + 1 + lines[line + 1].length;
    }

    private placeCursorAtLineEnd(line: number): void {
        const lines = this.notebook.current.source.split('\n');
        const at = Math.max(0, Math.min(line, lines.length - 1));
        this.notebook.cursor = lines.slice(0, at).reduce((offset, item) => offset + item.length + 1, 0) + lines[at].length;
    }
}

function currentLineNumber(notebook: Notebook): number {
    return notebook.current.source.slice(0, notebook.cursor).split('\n').length;
}

function isIterationHeader(line = ''): boolean {
    return /^\s*for\s+.+\s+in\s+.+$/.test(line);
}

function selectedLine(source: string, cursor: number): number {
    const lines = source.split('\n');
    const cursorLine = source.slice(0, cursor).split('\n').length;
    const lastBodyLine = lines.at(-1)?.trim() === 'end' ? lines.length - 1 : lines.length;
    return Math.max(2, Math.min(cursorLine, Math.max(2, lastBodyLine)));
}
