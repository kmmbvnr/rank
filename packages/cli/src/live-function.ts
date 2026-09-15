import { parse, RankError } from '@arrrank/interpreter';
import { Notebook } from './notebook.js';
import type { OutputLine } from './repl-session.js';

export interface LiveFunctionInit {
    name: string;
    parameters: string[];
    header: string;
    source: string;
    values?: string[];
    cellId: number;
    existing: boolean;
    originalSource?: string;
    stopLine?: number;
}

export class LiveFunctionSession {
    readonly name: string;
    readonly parameters: string[];
    readonly header: string;
    source: string;
    values: string[];
    argument?: number;
    argumentBackup: string[];
    skipped = false;
    readonly outputs = new Map<number, OutputLine[]>();
    readonly prefixes = new Map<number, string>();
    readonly iterations = new Map<number, number>();
    readonly argumentEditor = new Notebook();
    readonly cellId: number;
    readonly existing: boolean;
    readonly originalSource?: string;
    stopLine?: number;
    argumentError?: { readonly source: string; readonly message: string };

    constructor(init: LiveFunctionInit, names: readonly string[]) {
        this.name = init.name;
        this.parameters = init.parameters;
        this.header = init.header;
        this.source = init.source;
        this.values = [...(init.values ?? [])];
        this.argument = init.parameters.length ? 0 : undefined;
        this.argumentBackup = [...this.values];
        this.cellId = init.cellId;
        this.existing = init.existing;
        this.originalSource = init.originalSource;
        this.stopLine = init.stopLine;
        if (this.argument !== undefined) this.focusArgument(this.argument, names);
    }

    get prompt(): { name: string; parameter: string; index: number; count: number } | undefined {
        if (this.argument === undefined) return undefined;
        return { name: this.name, parameter: this.parameters[this.argument],
            index: this.argument, count: this.parameters.length };
    }

    get fields(): { name: string; source: string; cursor: number; active: boolean; error?: string }[] | undefined {
        if (this.skipped || this.argument === undefined && this.values.length !== this.parameters.length) return undefined;
        return this.parameters.map((name, index) => ({
            name,
            source: index === this.argument ? this.argumentEditor.current.source : this.values[index] ?? '',
            cursor: index === this.argument ? this.argumentEditor.cursor : 0,
            active: index === this.argument,
            error: index === this.argument && this.argumentError?.source === this.argumentEditor.current.source
                ? this.argumentError.message : undefined,
        }));
    }

    openArguments(index: number, names: readonly string[]): void {
        this.argumentBackup = [...this.values];
        this.skipped = false;
        this.focusArgument(index, names);
    }

    focusArgument(index: number, names: readonly string[]): void {
        this.argument = Math.max(0, Math.min(this.parameters.length - 1, index));
        const parameter = this.parameters[this.argument];
        this.argumentEditor.replace(this.values[this.argument] ?? (names.includes(parameter) ? parameter : ''));
        this.argumentError = undefined;
    }

    saveArgument(): void {
        if (this.argument !== undefined) this.values[this.argument] = this.argumentEditor.current.source.trim();
    }

    moveArgument(direction: number, names: readonly string[]): void {
        if (this.argument === undefined) return;
        this.saveArgument();
        const next = Math.max(0, Math.min(this.parameters.length - 1, this.argument + direction));
        if (next !== this.argument) this.focusArgument(next, names);
    }

    cycleCandidate(names: readonly string[]): boolean {
        const candidates = names.filter(name => /^[A-Z]/.test(name));
        if (!candidates.length) return false;
        const current = this.argumentEditor.current.source.trim();
        const at = candidates.indexOf(current);
        this.argumentEditor.replace(candidates[(at + 1) % candidates.length]);
        this.argumentError = undefined;
        return true;
    }

    cancelArguments(): void {
        const hadExample = this.argumentBackup.length === this.parameters.length;
        if (hadExample) {
            this.values = [...this.argumentBackup];
            this.skipped = false;
        } else {
            this.values = [];
            this.skipped = true;
            this.outputs.clear();
        }
        this.argument = undefined;
        this.argumentError = undefined;
    }

    syntaxError(value: string, names: readonly string[]): string | undefined {
        if (!value) return 'A value is required';
        try {
            parse(`Example = (${value})`, '<example>', {
                bindings: new Map(names.map(name => [name, false])),
            });
            return undefined;
        } catch (error) {
            return error instanceof RankError
                ? `${error.rankKind}: ${error.message.replace(/ at \d+:\d+$/, '')}`
                : String(error);
        }
    }
}
