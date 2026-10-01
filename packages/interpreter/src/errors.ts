import type { RankErrorValue, RankValue } from './value.js';
import { summarizeValue } from './value-summary.js';

export interface RankErrorLocation {
    readonly sourceId: string;
    readonly line: number;
    readonly column: number;
    readonly sourceLine: string;
}

export class RankError extends Error {
    location?: RankErrorLocation;
    private readonly calls: string[] = [];

    addCall(name: string, parameters: readonly string[], values: readonly RankValue[]): void {
        if (this.calls.length >= 8) return;
        this.calls.push(`${name}\n` + parameters.slice(0, 8).map((parameter, index) =>
            `  ${parameter} = ${values[index] === undefined ? '<missing>' : summarizeValue(values[index])}`).join('\n'));
    }

    formatCalls(): string { return this.calls.join('\n'); }

    constructor(
        message: string,
        readonly rankKind = 'Runtime',
        readonly value?: RankValue,
        private cause?: RankError,
    ) {
        super(message);
        this.name = 'RankError';
    }

    toValue(): RankErrorValue {
        return {
            kind: 'error',
            errorKind: { kind: 'label', name: this.rankKind },
            message: this.message,
            value: this.value,
            trace: this.format(),
            cause: this.cause?.toValue(),
            source: this,
        };
    }

    format(): string {
        const heading = `${this.name} [${this.rankKind}]: ${this.message}`
            + (this.calls.length ? `\n${this.formatCalls()}` : '');
        if (!this.location) return heading;
        const { sourceId, line, column, sourceLine } = this.location;
        const prefix = `${line} | `;
        const indent = sourceLine.slice(0, column - 1).replace(/[^\t]/g, ' ');
        return `${heading}\n  at ${sourceId}:${line}:${column}\n${prefix}${sourceLine}\n${' '.repeat(prefix.length)}${indent}^`;
    }

    attachCause(cause: RankError): void {
        if (this.cause) {
            this.cause.attachCause(cause);
        } else {
            this.cause = cause;
        }
    }
}

export class MissingValueError extends RankError {
    /**
     * `soft` marks data that has no value (a lookup that found nothing, an absent
     * table cell). A whole array holds such a cell as `.NA`; reading that one
     * cell by itself still raises. A strict miss, such as an index outside the
     * choices, is not data and raises for the whole array as well.
     */
    constructor(message: string, readonly soft = false) {
        super(message, 'Missing');
        this.name = 'MissingValueError';
    }
}
