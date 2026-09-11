import {
    isAssignmentStatement, isIfStatement, isPushStatement, isArrayAssignmentStatement, isApplicationExpression, isBinaryExpression, isUnaryExpression,
    isParenthesizedExpression, isNumberLiteral, isBooleanLiteral, isNameExpression,
    type Expression, type ForStatement, type Statement,
} from 'rank-language';
import { completed, type Completed } from './execution.js';
import { RankError } from './errors.js';
import { isRankIndex, type RankValue } from './value.js';
import { RankDeque } from './containers.js';
import { indexKey } from './index-key.js';


interface Host {
    read(name: string): RankValue | undefined;
    writer(name: string): (value: RankValue) => void;
    locate(error: unknown, statement: Statement): unknown;
    ranges(): boolean;
    module(name: string): boolean;
    builtin(module: string, name: string): boolean;
    compiled?(source: string): void;
    executed?(): void;
}
interface Term { code: string; type: 'integer' | 'boolean' }
const comparisons: Record<string, string> = {
    less: '<', greater: '>', atmost: '<=', atleast: '>=', equal: '===', notequal: '!==',
};

/** Whole numeric loop: keep reads in local registers, but commit each assignment
 * through the normal writer so fixed types and partial state on errors survive. */
export function compileIntegerLoop(statement: ForStatement, host: Host, iteration?: {
    readonly names: readonly string[]; readonly iterable: Expression;
}): {
    run(): Completed<RankValue | undefined> | undefined;
} | undefined {
    if (!statement.condition || !statement.statements.length || statement.statements.length > 32) return undefined;
    const names: string[] = [], required = new Set<number>(), assigned = new Set<string>();
    const writers: ((value: RankValue) => void)[] = [];
    const binders: ((value: RankValue) => void)[] = [];
    const written = new Set<string>();
    const containers = new Map<string, { slot: number; kind: 'index' | 'deque'; integers: boolean }>();
    const builtins = new Map<string, string>();
    let needsAlgo = false;
    let serial = 0;
    function container(name: string, kind: 'index' | 'deque', integers = false): string | undefined {
        if (name.includes('.')) return undefined;
        const old = containers.get(name);
        if (old && old.kind !== kind) return undefined;
        const info = old ?? { slot: slot(name), kind, integers };
        info.integers ||= integers;
        containers.set(name, info);
        return `r${info.slot}`;
    }
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
        if (isApplicationExpression(e) && e.arguments.length === 1 && isNameExpression(e.arguments[0])) {
            const op = e.arguments[0].name;
            if (op === 'even' || op === 'odd') {
                const value = emit(e.head, lines);
                if (value?.type !== 'integer') return undefined;
                builtins.set(op, 'numbers');
                return { code: `((${value.code}) % 2n ${op === 'even' ? '===' : '!=='} 0n)`, type: 'boolean' };
            }
            if ((op === 'len' || op === 'pop') && isNameExpression(e.head)) {
                const receiver = container(e.head.name, 'deque', op === 'pop');
                if (!receiver) return undefined;
                builtins.set(op, op === 'len' ? 'sequences' : 'algo');
                const name = `v${serial++}`;
                lines.push(`const ${name} = ${op === 'len' ? `BigInt(${receiver}.size)` : `${receiver}.pop()`};`);
                return { code: name, type: 'integer' };
            }
            return undefined;
        }
        if (!isBinaryExpression(e) || e.step) return undefined;
        if (e.operator === 'in' && isNameExpression(e.right)) {
            const receiver = container(e.right.name, 'index');
            const key = emit(e.left, lines);
            if (!receiver || key?.type !== 'integer') return undefined;
            return { code: `${receiver}.entries.has(key([${key.code}]))`, type: 'boolean' };
        }
        if (isNameExpression(e.right) && ['reduce', 'scan', 'outer', 'segment'].includes(e.right.name)) return undefined;
        if (e.operator === '**') {
            let exponent = e.right;
            while (isParenthesizedExpression(exponent)) exponent = exponent.value;
            if (!isNumberLiteral(exponent) || typeof exponent.value !== 'bigint' || exponent.value < 0n) return undefined;
            // Power binds before an unparenthesized sign, as in the evaluator.
            const signed = isUnaryExpression(e.left) && ['+', '-'].includes(e.left.operator) ? e.left : undefined;
            const base = emit(signed ? signed.operand : e.left, lines);
            if (base?.type !== 'integer') return undefined;
            const name = `v${serial++}`;
            const negative = signed?.operator === '-';
            lines.push(`const ${name} = ${negative ? '-' : ''}((${base.code}) ** ${exponent.value}n);`);
            return { code: name, type: 'integer' };
        }
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
    let setup = '', header: string, bindings = '';
    if (iteration) {
        let range = iteration.iterable;
        while (isParenthesizedExpression(range)) range = range.value;
        if (!isBinaryExpression(range) || !['to', 'until'].includes(range.operator)
            || iteration.names.length > 2 || iteration.names.some(name => name.includes('.'))
            || new Set(iteration.names.filter(name => name !== '#')).size !== iteration.names.filter(name => name !== '#').length) return undefined;
        const start = emit(range.left, tests), end = emit(range.right, tests);
        const step = range.step ? emit(range.step, tests) : { code: '1n', type: 'integer' };
        if (start?.type !== 'integer' || end?.type !== 'integer' || step?.type !== 'integer') return undefined;
        setup = `${tests.join('\n')} const start = ${start.code}, end = ${end.code}, stride = ${step.code};
            if (stride === 0n) throw badStep();`;
        const indexed = iteration.names.length === 2 && iteration.names[1] !== '#';
        header = `for (let cursor = start${indexed ? ', ordinal = 0n' : ''};
            stride > 0n ? cursor ${range.operator === 'to' ? '<=' : '<'} end : cursor ${range.operator === 'to' ? '>=' : '>'} end;
            cursor += stride${indexed ? ', ordinal += 1n' : ''}) { location = -1;`;
        for (const [index, name] of iteration.names.entries()) {
            if (name === '#') continue;
            const target = slot(name), value = index === 0 ? 'cursor' : 'ordinal';
            bindings += `binders[${binders.length}](${value}); r${target} = ${value};\n`;
            binders.push(host.writer(name));
            assigned.add(name);
            written.add(name);
        }
    } else {
        const test = emit(statement.condition, tests);
        if (!test || test.type !== 'boolean') return undefined;
        header = `for (;;) { location = -1; ${tests.join('\n')} if (!(${test.code})) break;`;
    }
    const locations: Statement[] = [];
    function statements(commands: readonly Statement[], body: string[]): boolean {
        for (const assignment of commands) {
            const location = locations.length;
            if (location >= 32) return false;
            locations.push(assignment);
            if (isPushStatement(assignment)) {
                if (!isNameExpression(assignment.receiver)) return false;
                const receiver = container(assignment.receiver.name, 'deque');
                const lines: string[] = [];
                const value = emit(assignment.value, lines);
                if (!receiver || value?.type !== 'integer') return false;
                needsAlgo = true;
                body.push(`location = ${location};`, ...lines, `${receiver}.push(${value.code}); result = undefined;`);
                continue;
            }
            if (isArrayAssignmentStatement(assignment)) {
                if (assignment.operator !== '=') return false;
                const receiver = container(assignment.name, 'index');
                if (!receiver) return false;
                const lines: string[] = [], keys: string[] = [];
                for (const address of assignment.indices) {
                    if (address.all || address.sign || !address.value) return false;
                    const value = emit(address.value, lines);
                    if (value?.type !== 'integer') return false;
                    keys.push(value.code);
                }
                const name = `key${serial++}`;
                lines.push(`const ${name} = key([${keys.join(',')}]);`);
                const value = emit(assignment.value, lines);
                if (value?.type !== 'integer') return false;
                body.push(`location = ${location};`, ...lines, `${receiver}.entries.set(${name}, ${value.code}); result = undefined;`);
                continue;
            }
            if (isIfStatement(assignment)) {
                const incoming = new Set(assigned);
                const outcomes: Set<string>[] = [];
                const branches = [
                    { condition: assignment.condition, statements: assignment.thenStatements },
                    ...assignment.elifClauses,
                ];
                body.push(`location = ${location}; result = undefined;`);
                for (const branch of branches) {
                    assigned.clear();
                    for (const name of incoming) assigned.add(name);
                    const lines: string[] = [];
                    const condition = emit(branch.condition, lines);
                    if (condition?.type !== 'boolean') return false;
                    body.push(`location = ${location};`, ...lines, `if (${condition.code}) {`);
                    if (!statements(branch.statements, body)) return false;
                    outcomes.push(new Set(assigned));
                    body.push('} else {');
                }
                assigned.clear();
                for (const name of incoming) assigned.add(name);
                if (!statements(assignment.elseStatements, body)) return false;
                outcomes.push(new Set(assigned));
                body.push('}'.repeat(branches.length));
                assigned.clear();
                for (const name of outcomes[0]) {
                    if (outcomes.every(outcome => outcome.has(name))) assigned.add(name);
                }
                continue;
            }
            const index = writers.length;
            if (!isAssignmentStatement(assignment) || assignment.name.includes('.')) return false;
            const destination = slot(assignment.name);
            written.add(assignment.name);
            if (assignment.operator !== '=' && !assigned.has(assignment.name)) required.add(destination);
            const lines: string[] = [];
            const value = emit(assignment.value, lines);
            if (!value || value.type !== 'integer') return false;
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
                } else return false;
            }
            writers.push(host.writer(assignment.name));
            body.push(`location = ${location};`, ...lines, `const out${index} = ${result};`,
                `writers[${index}](out${index}); r${destination} = out${index}; result = out${index};`);
            assigned.add(assignment.name);
        }
        return true;
    }
    const body: string[] = [];
    if (!statements(statement.statements, body)) return undefined;
    // Container bindings must remain stable throughout the compiled region.
    if ([...containers].some(([name, info]) => written.has(name) || required.has(info.slot))) return undefined;
    if ([...builtins.keys()].some(name => written.has(name))) return undefined;
    const source = `"use strict"; return function(input) {
        let ${names.map((_, index) => `r${index} = input[${index}]`).join(',')};
        let result, location = -1;
        try { ${setup} ${header}
            ${bindings} ${body.join('\n')}
            location = -1;
        } return result; } catch (error) { throw locate(error, location); }
    };`;
    let run: (values: (RankValue | undefined)[]) => RankValue | undefined;
    try { run = new Function('writers', 'binders', 'zero', 'badStep', 'locate', 'key', source)(writers, binders,
        () => new RankError('division by zero'), () => new RankError('range step must be a nonzero integer'),
        (error: unknown, index: number) => host.locate(error, index < 0 ? statement : locations[index]), indexKey); }
    catch { return undefined; }
    host.compiled?.(source);
    return { run: () => {
        if (iteration && !host.ranges()) return undefined;
        if (needsAlgo && !host.module('algo')) return undefined;
        for (const [name, module] of builtins) if (!host.builtin(module, name)) return undefined;
        const values: (RankValue | undefined)[] = [];
        for (const index of required) {
            const value = host.read(names[index]);
            if (typeof value !== 'bigint') return undefined;
            values[index] = value;
        }
        for (const [name, info] of containers) {
            const value = host.read(name);
            if (value === undefined) return undefined;
            if (info.kind === 'index' ? !isRankIndex(value) : !(value instanceof RankDeque)) return undefined;
            if (info.integers && value instanceof RankDeque) {
                for (const item of value.values()) if (typeof item !== 'bigint') return undefined;
            }
            values[info.slot] = value;
        }
        host.executed?.();
        return completed(run(values));
    } };
}
