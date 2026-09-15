import { parse } from '@arrrank/interpreter';
import { isFunctionStatement } from '@arrrank/language';
import { LiveFunctionSession } from './live-function.js';
import { LivePreviewRunner } from './live-preview.js';
import type { Notebook } from './notebook.js';
import type { OutputLine } from './repl-session.js';
import type { ReplSession } from './repl-types.js';

export type LiveSubmitResult = 'absent' | 'handled' | 'complete' | 'replay';

/** Owns example arguments and isolated line previews for one function edit. */
export class LiveFunctionController {
    private live?: LiveFunctionSession;
    private readonly examples = new Map<string, string[]>();
    private readonly preview: LivePreviewRunner;

    constructor(
        private readonly notebook: Notebook,
        private readonly session: ReplSession,
        private readonly columns: () => number,
        private readonly setSuggestion: (text: string) => void,
        private readonly render: () => void,
        readonly enabled: boolean,
    ) {
        this.preview = new LivePreviewRunner(source => this.session.preview(source, this.columns()));
    }

    get prompt(): { name: string; parameter?: string; index: number; count: number } | undefined {
        return this.live?.prompt;
    }
    get outputs(): ReadonlyMap<number, OutputLine[]> | undefined { return this.live?.outputs; }
    get editing(): boolean { return this.live !== undefined; }
    get status(): string | undefined {
        if (!this.live || this.prompt) return undefined;
        const example = this.live.skipped ? 'no example' : this.live.values.join(', ');
        return `Live ${this.live.name}(${example}) · ${enterAction(this.notebook)} · Ctrl-T arguments`;
    }
    get editor(): Notebook | undefined { return this.prompt ? this.live?.argumentEditor : undefined; }
    get fields(): { name: string; source: string; cursor: number; active: boolean; error?: string }[] | undefined {
        return this.live?.fields;
    }
    get hasParameters(): boolean { return !!this.live?.parameters.length; }

    clear(): void { this.live = undefined; }

    reopenArguments(): boolean {
        if (!this.live?.parameters.length) return false;
        this.live.source = this.notebook.current.source;
        this.live.openArguments(0, this.session.names);
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
        if (!this.live || this.live.argument === undefined) return;
        this.live.moveArgument(direction, this.session.names);
        this.updateExampleSuggestion();
    }

    focusExampleFromBody(): boolean {
        const live = this.live;
        if (!live || live.argument !== undefined || !live.parameters.length) return false;
        const source = this.notebook.current.source;
        if (source.slice(0, this.notebook.cursor).split('\n').length !== 2) return false;
        live.source = source;
        live.stopLine = selectedLine(source, this.notebook.cursor);
        live.openArguments(live.parameters.length - 1, this.session.names);
        this.updateExampleSuggestion();
        return true;
    }

    begin(source: string): boolean {
        if (!this.enabled || this.live || source.includes('\n')) return false;
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
        if (parameters.length) this.updateExampleSuggestion(); else this.updateSuggestion();
        return true;
    }

    async rerun(): Promise<boolean> {
        if (!this.live && !this.beginExisting()) return false;
        const live = this.live!;
        live.source = this.notebook.current.source;
        live.stopLine = selectedLine(live.source, this.notebook.cursor);
        if (live.parameters.length) {
            live.openArguments(0, this.session.names);
            this.updateExampleSuggestion();
        } else {
            const line = live.stopLine;
            await this.updatePreviews(true, line - 1);
            this.placeCursorAtLineEnd(line - 1);
            live.stopLine = undefined;
        }
        this.render();
        return true;
    }

    async forcePreview(): Promise<boolean> {
        if (!this.live) return false;
        this.notebook.formatCurrentLine(line => this.session.format(line));
        const source = this.notebook.current.source;
        const currentLine = source.slice(0, this.notebook.cursor).split('\n').length - 1;
        if (!/\n[\t ]*$/.test(source)) this.notebook.preparePrompt(line => this.session.format(line));
        await this.updatePreviews(true, currentLine + 1);
        this.placeCursorAfterLine(currentLine);
        this.render();
        return true;
    }

    async submit(): Promise<LiveSubmitResult> {
        const live = this.live;
        if (!live) return 'absent';
        this.notebook.formatCurrentLine(line => this.session.format(line));
        const source = this.notebook.current.source;
        const lines = source.split('\n');
        const currentLine = source.slice(0, this.notebook.cursor).split('\n').length - 1;
        if (currentLine < lines.length - 1) {
            await this.updatePreviews(false, currentLine + 1);
            this.placeCursorAfterLine(currentLine);
            this.render();
            return 'handled';
        }
        if (!lines[currentLine].trim()) {
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
            this.setSuggestion('');
            if (live.existing) {
                this.notebook.replayFrom = live.cellIndex;
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
            const fieldError = await this.runtimeError(live.values[index]);
            if (fieldError) return this.rejectArgument(live, index, fieldError, 'cannot be evaluated');
        }
        live.argument = undefined;
        live.skipped = false;
        this.notebook.replace(live.source);
        live.outputs.clear();
        live.prefixes.clear();
        await this.updatePreviews(false, live.stopLine === undefined ? undefined : live.stopLine - 1);
        if (live.stopLine !== undefined) {
            this.placeCursorAtLineEnd(live.stopLine - 1);
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
            source, values: [...(this.examples.get(statement.name) ?? [])], cellIndex: this.notebook.active,
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

    private async runtimeError(value: string): Promise<string | undefined> {
        const result = await this.session.preview(`Example = (${value})`, this.columns());
        const diagnostic = result.output.find(line => line.error)?.text.split('\n')[0]
            .replace(/\x1b\[[0-9;]*m/g, '');
        return diagnostic?.replace(/^error:\s*RankError\s*\[([^\]]+)\]:\s*/, '$1: ');
    }

    private updateExampleSuggestion(): void {
        const prompt = this.prompt;
        if (prompt) this.setSuggestion(`Example ${prompt.name} · ${prompt.parameter} (${prompt.index + 1}/${prompt.count}) · Tab variables · Enter accept · Esc skip`);
    }

    private updateSuggestion(): void {
        if (this.live) this.setSuggestion('');
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

function enterAction(notebook: Notebook): string {
    const source = notebook.current.source;
    const line = source.slice(source.lastIndexOf('\n', notebook.cursor - 1) + 1,
        source.indexOf('\n', notebook.cursor) < 0 ? source.length : source.indexOf('\n', notebook.cursor)).trim();
    if (!line) return 'Enter keep blank line';
    if (/^(?:else|elif)\b/.test(line)) return 'Enter enter branch';
    if (line === 'end') return 'Enter apply end';
    return 'Enter evaluate line';
}

function selectedLine(source: string, cursor: number): number {
    const lines = source.split('\n');
    const cursorLine = source.slice(0, cursor).split('\n').length;
    const lastBodyLine = lines.at(-1)?.trim() === 'end' ? lines.length - 1 : lines.length;
    return Math.max(2, Math.min(cursorLine, Math.max(2, lastBodyLine)));
}
