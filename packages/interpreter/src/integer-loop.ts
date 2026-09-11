import {
    isAssignmentStatement, isBinaryExpression, isUnaryExpression,
    isParenthesizedExpression, isNumberLiteral, isBooleanLiteral, isNameExpression,
    type Expression, type ForStatement,
} from 'rank-language';
import { completed, type Completed } from './execution.js';
import { RankError } from './errors.js';
import type { RankValue } from './value.js';

interface Host {
    read(name: string): RankValue | undefined;
    writer(name: string): (value: RankValue) => void;
    locate(error: unknown, index: number): unknown;
    compiled?(source: string): void;
    executed?(): void;
}
interface Term { code: string; type: 'integer' | 'boolean' }
const comparisons: Record<string, string> = {
    less: '<', greater: '>', atmost: '<=', atleast: '>=', equal: '===', notequal: '!==',
};

/** Whole numeric loop: keep reads in local registers, but commit each assignment
 * through the normal writer so fixed types and partial state on errors survive. */
export function compileIntegerLoop(statement: ForStatement, host: Host): {
    run(): Completed<RankValue | undefined> | undefined;
} | undefined {
    if (!statement.condition || !statement.statements.length || statement.statements.length > 32) return undefined;
    const names: string[] = [], required = new Set<number>(), assigned = new Set<string>();
    const writers: ((value: RankValue) => void)[] = [];
    let serial = 0;
    function slot(name: string): number {
        let index = names.indexOf(name);
        if (index < 0) { index = names.length; names.push(name); }
        return index;
    }
    function emit(e: Expression, lines: string[]): Term | undefined {
        if (serial > 256) return undefined;
        if (isParenthesizedExpression(e)) return emit(e.value, lines);
        if (isNumberLiteral(e) && typeof e.value === 'bigint') return { code: `${e.value}n`, type: 'integer' };
        if (isBooleanLiteral(e)) return { code: String(e.value), type: 'boolean' };
        if (isNameExpression(e) && !e.name.includes('.')) {
            const index = slot(e.name);
            if (!assigned.has(e.name)) required.add(index);
            return { code: `r${index}`, type: 'integer' };
        }
        if (isUnaryExpression(e)) {
            const value = emit(e.operand, lines);
            if (!value) return undefined;
            if (e.operator === 'not' && value.type === 'boolean') return { code: `!(${value.code})`, type: 'boolean' };
            if (value.type === 'integer' && ['+', '-'].includes(e.operator)) {
                return { code: e.operator === '+' ? value.code : `-(${value.code})`, type: 'integer' };
            }
            return undefined;
        }
        if (!isBinaryExpression(e) || e.step) return undefined;
        if (isNameExpression(e.right) && ['reduce', 'scan', 'outer', 'segment'].includes(e.right.name)) return undefined;
        const left = emit(e.left, lines), right = emit(e.right, lines);
        if (!left || !right) return undefined;
        const a = left.code, b = right.code, op = e.operator;
        const name = `v${serial++}`;
        if (left.type === 'boolean' && right.type === 'boolean' && ['and', 'or', 'xor'].includes(op)) {
            lines.push(`const ${name} = (${a}) ${op === 'and' ? '&&' : op === 'or' ? '||' : '!=='} (${b});`);
            return { code: name, type: 'boolean' };
        }
        if (left.type !== 'integer' || right.type !== 'integer') return undefined;
        if (op in comparisons) {
            lines.push(`const ${name} = (${a}) ${comparisons[op]} (${b});`);
            return { code: name, type: 'boolean' };
        }
        if (['+', '-', '*'].includes(op)) lines.push(`const ${name} = (${a}) ${op} (${b});`);
        else if (op === '//' || op === '%') {
            lines.push(`if ((${b}) === 0n) throw zero();`);
            lines.push(`const m${serial} = (${a}) % (${b});`);
            const adjust = `(m${serial} !== 0n && (m${serial} < 0n) !== ((${b}) < 0n))`;
            lines.push(`const ${name} = ${op === '//' ? `(${a}) / (${b}) - (${adjust} ? 1n : 0n)` : `m${serial} + (${adjust} ? (${b}) : 0n)`};`);
        } else return undefined;
        return { code: name, type: 'integer' };
    }
    const tests: string[] = [];
    const test = emit(statement.condition, tests);
    if (!test || test.type !== 'boolean') return undefined;
    const body: string[] = [];
    for (const [index, assignment] of statement.statements.entries()) {
        if (!isAssignmentStatement(assignment) || assignment.name.includes('.')) return undefined;
        const destination = slot(assignment.name);
        if (assignment.operator !== '=' && !assigned.has(assignment.name)) required.add(destination);
        const lines: string[] = [];
        const value = emit(assignment.value, lines);
        if (!value || value.type !== 'integer') return undefined;
        let result = value.code;
        if (assignment.operator !== '=') {
            const op = assignment.operator.slice(0, -1);
            if (['+', '-', '*'].includes(op)) result = `(r${destination}) ${op} (${result})`;
            else if (op === '%' || op === '//') {
                lines.push(`if ((${result}) === 0n) throw zero();`);
                const remainder = `c${index}`;
                lines.push(`const ${remainder} = r${destination} % (${result});`);
                const adjust = `(${remainder} !== 0n && (${remainder} < 0n) !== ((${result}) < 0n))`;
                result = op === '%' ? `${remainder} + (${adjust} ? (${result}) : 0n)`
                    : `r${destination} / (${result}) - (${adjust} ? 1n : 0n)`;
            } else return undefined;
        }
        writers.push(host.writer(assignment.name));
        body.push(`location = ${index};`, ...lines, `const out${index} = ${result};`,
            `writers[${index}](out${index}); r${destination} = out${index}; result = out${index};`);
        assigned.add(assignment.name);
    }
    const source = `"use strict"; return function(input) {
        let ${names.map((_, index) => `r${index} = input[${index}]`).join(',')};
        let result, location = -1;
        try { for (;;) { location = -1; ${tests.join('\n')}
            if (!(${test.code})) break;
            ${body.join('\n')}
        } return result; } catch (error) { throw locate(error, location); }
    };`;
    let run: (values: (RankValue | undefined)[]) => RankValue | undefined;
    try { run = new Function('writers', 'zero', 'locate', source)(writers,
        () => new RankError('division by zero'), host.locate); }
    catch { return undefined; }
    host.compiled?.(source);
    return { run: () => {
        const values: (RankValue | undefined)[] = [];
        for (const index of required) {
            const value = host.read(names[index]);
            if (typeof value !== 'bigint') return undefined;
            values[index] = value;
        }
        host.executed?.();
        return completed(run(values));
    } };
}
