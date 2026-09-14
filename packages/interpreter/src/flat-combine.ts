import {
    flattenApplication,
    isReturnStatement, isRecordExpression, isParenthesizedExpression, isNumberLiteral,
    isBinaryExpression, isUnaryExpression, isNameExpression,
    isLabelLiteral, type Expression, type FunctionStatement,
} from '@arrrank/language';
import type { RankValue } from './value.js';
import type { FlatRecords } from './flat.js';

export interface FlatCombine {
    readonly order: readonly string[];
    /** Recheck captured builtin bindings and the call-depth budget before use. */
    valid(): boolean;
    run(left: bigint[], right: bigint[], output: bigint[]): void;
}
const factories = new WeakMap<object, (storage: FlatRecords) => FlatCombine | undefined>();

export function registerFlatCombine(
    operation: object, statement: FunctionStatement,
    available: (builtins: ReadonlySet<string>) => boolean,
): void {
    factories.set(operation, storage => compile(statement, storage, available));
}

export function flatCombine(operation: RankValue | undefined, storage: FlatRecords): FlatCombine | undefined {
    return typeof operation === 'object' ? factories.get(operation)?.(storage) : undefined;
}

// Only total, pure integer expressions are accepted. Unknown calls, captures,
// mutation, division, memoization, and mixed schemas retain ordinary evaluation.
function compile(
    statement: FunctionStatement, storage: FlatRecords,
    available: (builtins: ReadonlySet<string>) => boolean,
): FlatCombine | undefined {
    if (statement.memo || statement.parameters.length !== 2
        || new Set(statement.parameters).size !== 2 || statement.statements.length !== 1
        || storage.fields.some(([, type]) => type !== 'integer')) return undefined;
    const command = statement.statements[0];
    if (!isReturnStatement(command) || !command.value || !isRecordExpression(command.value)) return undefined;
    const record = command.value;
    const fields = new Map(storage.fields.map(([name], index) => [name, index]));
    if (record.fields.length !== fields.size || new Set(record.fields.map(f => f.name)).size !== fields.size) return undefined;
    const builtins = new Set<string>();
    const lines: string[] = [];
    let serial = 0, remaining = 256;
    const variable = (code: string): string => {
        const name = `v${serial++}`;
        lines.push(`const ${name} = ${code};`);
        return name;
    };
    function emit(e: Expression): string | undefined {
        if (--remaining < 0) return undefined;
        if (isParenthesizedExpression(e)) return emit(e.value);
        if (isNumberLiteral(e) && typeof e.value === 'bigint') return `${e.value}n`;
        if (isUnaryExpression(e) && ['+', '-'].includes(e.operator)) {
            const value = emit(e.operand);
            return value === undefined ? undefined : variable(e.operator === '+' ? value : `-(${value})`);
        }
        if (isBinaryExpression(e) && !e.step && ['+', '-', '*'].includes(e.operator)) {
            const left = emit(e.left), right = emit(e.right);
            return left === undefined || right === undefined ? undefined : variable(`${left} ${e.operator} ${right}`);
        }
        const chain = flattenApplication(e);
        if (chain.length === 2 && isNameExpression(chain[0]) && isLabelLiteral(chain[1])) {
            const parameter = statement.parameters.indexOf(chain[0].name);
            const field = fields.get(chain[1].name);
            if (parameter < 0 || field === undefined) return undefined;
            return `${parameter === 0 ? 'left' : 'right'}[${field}]`;
        }
        if (chain.length === 3) {
            const middle = chain[1], last = chain[2];
            const infix = isNameExpression(middle) && ['min', 'max'].includes(middle.name);
            const op = infix ? middle : last;
            if (!isNameExpression(op) || !['min', 'max'].includes(op.name)
                || statement.parameters.includes(op.name)) return undefined;
            builtins.add(op.name);
            const left = emit(chain[0]), right = emit(infix ? chain[2] : chain[1]);
            if (left === undefined || right === undefined) return undefined;
            return variable(`${left} ${op.name === 'max' ? '>' : '<'} ${right} ? ${left} : ${right}`);
        }
        return undefined;
    }
    const writes: string[] = [];
    for (const field of record.fields) {
        const index = fields.get(field.name);
        if (index === undefined) return undefined;
        const value = emit(field.value);
        if (value === undefined) return undefined;
        // Snapshot even a direct field read before any output write: output may
        // alias either input during prefix/suffix accumulation.
        writes.push(`output[${index}] = ${variable(value)};`);
    }
    if (!available(builtins)) return undefined;
    try {
        const run = new Function('left', 'right', 'output', `"use strict"; ${lines.join('\n')}\n${writes.join('\n')}`) as FlatCombine['run'];
        return { run, order: record.fields.map(field => field.name), valid: () => available(builtins) };
    } catch { return undefined; } // CSP retains ordinary Rank calls.
}
