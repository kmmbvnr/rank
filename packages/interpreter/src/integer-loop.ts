import {
    isAssignmentStatement, isIfStatement, isForStatement, isBreakStatement, isContinueStatement, isPushStatement, isArrayAssignmentStatement, isApplicationExpression, isBinaryExpression, isUnaryExpression,
    isStringLiteral, isReturnStatement, isArrayExpression, isParenthesizedExpression, isNumberLiteral, isBooleanLiteral, isNameExpression,
    type Expression, type ForStatement, type Statement,
} from 'rank-language';
import { completed, type Completed } from './execution.js';
import { RankError } from './errors.js';
import { isRankArray, isRankIndex, type RankArray, type RankValue } from './value.js';
import { RankDeque } from './containers.js';
import { indexKey } from './index-key.js';
import { materializedArrayItems } from './array-storage.js';


interface IterationBinding {
    readonly names: readonly string[];
    readonly iterable: Expression;
}
interface Host {
    readonly textLoops: boolean;
    readonly nestedLoops: boolean;
    readonly arrayReads: boolean;
    readonly arrayIteration: boolean;
    iterationValues(binding: IterationBinding, source: RankArray | string): Iterable<RankValue>;
    readonly arrayWrites: boolean;
    readonly compoundWrites: boolean;
    readonly extrema: boolean;
    readonly absolute: boolean;
    readonly booleanLocals: boolean;
    readonly booleanArrays: boolean;
    readonly arrayLocals: boolean;
    readonly returns: boolean;
    canReturn(): boolean;
    returnValue(value: RankValue): never;
    dimension(value: bigint): number;
    extremeParts(expression: Expression): Expression[] | undefined;
    arrayOffset(source: RankArray, indices: readonly bigint[]): number;
    arrayRead(source: RankArray, indices: readonly bigint[]): RankValue;
    iteration(condition: Expression | undefined): IterationBinding | undefined;
    read(name: string): RankValue | undefined;
    writer(name: string): (value: RankValue) => void;
    prepareWriter?(name: string, checked: (value: RankValue) => void): (value: RankValue) => void;
    locate(error: unknown, statement: Statement): unknown;
    ranges(): boolean;
    module(name: string): boolean;
    builtin(module: string, name: string): boolean;
    compiled?(source: string): void;
    executed?(): void;
}
interface Term { code: string; type: 'integer' | 'boolean' | 'text' }
const comparisons: Record<string, string> = {
    less: '<', greater: '>', atmost: '<=', atleast: '>=', equal: '===', notequal: '!==',
};

/** Whole numeric loop: keep reads in local registers and commit every assignment.
 * Writers retain fixed-type checks and partial state on errors; optional bound
 * writers specialize repeated known-value stores within one invocation. */
type CompiledLoop = {
    run(insideFinally?: boolean, insideGenerator?: boolean): Completed<RankValue | undefined> | undefined;
};

export function compileIntegerLoop(statement: ForStatement, host: Host, iteration?: IterationBinding): CompiledLoop | undefined {
    const numeric = compileTypedLoop(statement, host, iteration, new Set());
    if (!host.textLoops) return numeric;
    const candidates = new Set<string>();
    function collect(node: Statement) {
        if (isForStatement(node)) {
            let input = host.iteration(node.condition)?.iterable;
            while (input && isParenthesizedExpression(input)) input = input.value;
            if (input && isNameExpression(input) && !input.name.includes('.')) candidates.add(input.name);
            node.statements.forEach(collect);
        } else if (isIfStatement(node)) {
            node.thenStatements.forEach(collect);
            node.elseStatements.forEach(collect);
            node.elifClauses.forEach(branch => branch.statements.forEach(collect));
        }
    }
    collect(statement);
    if (!candidates.size) return numeric;
    // Cache type signatures, never values or invocation frames. Keep growth bounded.
    const variants = new Map<string, CompiledLoop | undefined>();
    return { run: (insideFinally, insideGenerator) => {
        const result = numeric?.run(insideFinally, insideGenerator);
        if (result) return result;
        const text = [...candidates].filter(name => typeof host.read(name) === 'string');
        if (!text.length) return undefined;
        const key = JSON.stringify(text);
        if (!variants.has(key)) {
            if (variants.size >= 8) return undefined;
            variants.set(key, compileTypedLoop(statement, host, iteration, new Set(text)));
        }
        return variants.get(key)?.run(insideFinally, insideGenerator);
    } };
}

function compileTypedLoop(statement: ForStatement, host: Host, iteration: IterationBinding | undefined, textSources: ReadonlySet<string>): CompiledLoop | undefined {
    if (!statement.statements.length || statement.statements.length > 32) return undefined;
    const localTypes = new Map<string, Term['type']>();
    const names: string[] = [], required = new Set<number>(), assigned = new Set<string>();
    const writers: ((value: RankValue) => void)[] = [];
    const binders: ((value: RankValue) => void)[] = [];
    const writerNames: string[] = [], binderNames: string[] = [];
    const written = new Set<string>();
    const containers = new Map<string, { slot: number; kind: 'index' | 'deque'; integers: boolean }>();
    const builtins = new Map<string, string>();
    const arrays = new Map<string, { slot: number; rank: number; type: Term['type'] }>();
    const arrayInputs = new Set<string>(), arrayDefinitions = new Set<string>();
    const aliases: [string, string][] = [];
    const iterators: ((source: RankArray | string) => Iterable<RankValue>)[] = [];
    const destinations = new Map<string, { slot: number; rank: number; compound: boolean; type?: Term['type'] }>();
    let needsAlgo = false, needsRanges = false, hasControl = false, hasReturn = false;
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
    function emit(e: Expression, lines: string[], hint?: Term['type']): Term | undefined {
        if (serial > 256) return undefined;
        if (isParenthesizedExpression(e)) return emit(e.value, lines, hint);
        if (isNumberLiteral(e) && typeof e.value === 'bigint') return { code: `${e.value}n`, type: 'integer' };
        if (isStringLiteral(e) && host.textLoops) return { code: JSON.stringify(e.value), type: 'text' };
        if (isBooleanLiteral(e)) return { code: String(e.value), type: 'boolean' };
        if (isNameExpression(e) && !e.name.includes('.')) {
            if (arrays.has(e.name)) return undefined;
            const type = localTypes.get(e.name) ?? (textSources.has(e.name) ? 'text' : hint ?? 'integer');
            if (hint && type !== hint || type === 'boolean' && !host.booleanLocals) return undefined;
            localTypes.set(e.name, type);
            const index = slot(e.name);
            if (!assigned.has(e.name)) required.add(index);
            return { code: `r${index}`, type };
        }
        if (isUnaryExpression(e)) {
            const value = emit(e.operand, lines, e.operator === 'not' ? 'boolean' : 'integer');
            if (!value) return undefined;
            if (e.operator === 'not' && value.type === 'boolean') return { code: `!(${value.code})`, type: 'boolean' };
            if (value.type === 'integer' && ['+', '-'].includes(e.operator)) {
                return { code: e.operator === '+' ? value.code : `-(${value.code})`, type: 'integer' };
            }
            return undefined;
        }
        if (host.extrema && isApplicationExpression(e)) {
            const parts = host.extremeParts(e);
            const last = parts?.at(-1);
            if (parts && [2, 3].includes(parts.length) && last && isNameExpression(last) && ['min', 'max'].includes(last.name)) {
                const left = emit(parts[0], lines);
                if (left?.type !== 'integer') return undefined;
                builtins.set(last.name, 'numbers');
                if (parts.length === 2) return left;
                const right = emit(parts[1], lines);
                if (right?.type !== 'integer') return undefined;
                const name = `v${serial++}`;
                lines.push(`const ${name} = (${right.code}) ${last.name === 'min' ? '<' : '>'} (${left.code}) ? (${right.code}) : (${left.code});`);
                return { code: name, type: 'integer' };
            }
        }
        if (isApplicationExpression(e) && e.arguments.length === 1 && isNameExpression(e.arguments[0])) {
            const op = e.arguments[0].name;
            if (op === 'abs' && host.absolute) {
                const value = emit(e.head, lines);
                if (value?.type !== 'integer') return undefined;
                builtins.set(op, 'numbers');
                const name = `v${serial++}`;
                lines.push(`const ${name} = (${value.code}) < 0n ? -(${value.code}) : (${value.code});`);
                return { code: name, type: 'integer' };
            }
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
        }
        if (isApplicationExpression(e)) {
            if (!host.arrayReads) return undefined;
            const flatten = (node: Expression): Expression[] => isApplicationExpression(node)
                ? [...flatten(node.head), ...node.arguments.flatMap(flatten)] : [node];
            const [head, ...arguments_] = flatten(e);
            if (!isNameExpression(head) || head.name.includes('.')) return undefined;
            const previous = arrays.get(head.name);
            const type = previous?.type ?? destinations.get(head.name)?.type ?? hint ?? 'integer';
            if (type === 'text') return undefined;
            if (hint && hint !== type || type === 'boolean' && !host.booleanArrays) return undefined;
            if (previous && previous.rank !== arguments_.length) return undefined;
            const indices: string[] = [];
            for (const argument of arguments_) {
                const value = emit(argument, lines);
                if (value?.type !== 'integer') return undefined;
                indices.push(value.code);
            }
            const info = previous ?? { slot: slot(head.name), rank: indices.length, type };
            arrays.set(head.name, info);
            if (!assigned.has(head.name)) arrayInputs.add(head.name);
            const name = `v${serial++}`;
            lines.push(`const ${name} = arrayRead(r${info.slot}, [${indices.join(',')}]);`);
            return { code: name, type };
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
        const textPair = ['equal', 'notequal'].includes(e.operator) && (isStringLiteral(e.right)
            || isNameExpression(e.right) && localTypes.get(e.right.name) === 'text');
        const booleanPair = ['and', 'or', 'xor'].includes(e.operator)
            || ['equal', 'notequal'].includes(e.operator) && (isBooleanLiteral(e.right)
                || isNameExpression(e.right) && localTypes.get(e.right.name) === 'boolean');
        const left = emit(e.left, lines, textPair ? 'text' : booleanPair ? 'boolean' : undefined);
        const right = emit(e.right, lines, left?.type === 'text' ? 'text' : booleanPair || left?.type === 'boolean' ? 'boolean' : undefined);
        if (!left || !right) return undefined;
        const a = left.code, b = right.code, op = e.operator;
        const name = `v${serial++}`;
        if (left.type === 'boolean' && right.type === 'boolean' && ['and', 'or', 'xor'].includes(op)) {
            lines.push(`const ${name} = (${a}) ${op === 'and' ? '&&' : op === 'or' ? '||' : '!=='} (${b});`);
            return { code: name, type: 'boolean' };
        }
        if (left.type === right.type && ['boolean', 'text'].includes(left.type) && ['equal', 'notequal'].includes(op)) {
            lines.push(`const ${name} = (${a}) ${comparisons[op]} (${b});`);
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
    function loopParts(node: ForStatement, iteration: IterationBinding | undefined, location: number) {
        const tests: string[] = [];
        let setup = '', header: string, bindings = '';
        if (iteration) {
            let range = iteration.iterable;
            while (isParenthesizedExpression(range)) range = range.value;
            if (iteration.names.length > 2 || iteration.names.some(name => name.includes('.'))
                || new Set(iteration.names.filter(name => name !== '#')).size !== iteration.names.filter(name => name !== '#').length) return undefined;
            const indexed = iteration.names.length === 2 && iteration.names[1] !== '#';
            const arrayIteration = isNameExpression(range);
            const textIteration = isNameExpression(range) && textSources.has(range.name);
            if (textIteration && isNameExpression(range)) {
                const source = emit(range, tests, 'text');
                if (source?.type !== 'text') return undefined;
                setup = `const iterable = iterators[${iterators.length}](${source.code}); ${indexed ? 'let ordinal = 0n;' : ''}`;
                iterators.push(source => host.iterationValues(iteration, source));
                header = `for (const cursor of iterable) { location = ${location};`;
            } else if (isNameExpression(range)) {
                if (!host.arrayIteration || range.name.includes('.')) return undefined;
                const old = arrays.get(range.name);
                if (old && (old.rank !== 1 || old.type !== 'integer')) return undefined;
                const info = old ?? { slot: slot(range.name), rank: 1, type: 'integer' as const };
                arrays.set(range.name, info);
                if (!assigned.has(range.name)) arrayInputs.add(range.name);
                const binding = iteration;
                setup = `const iterable = iterators[${iterators.length}](r${info.slot}); ${indexed ? 'let ordinal = 0n;' : ''}`;
                iterators.push(source => host.iterationValues(binding, source));
                header = `for (const cursor of iterable) { location = ${location};`;
            } else {
                needsRanges = true;
                if (!isBinaryExpression(range) || !['to', 'until'].includes(range.operator)) return undefined;
                const start = emit(range.left, tests), end = emit(range.right, tests);
                const step = range.step ? emit(range.step, tests) : { code: '1n', type: 'integer' };
                if (start?.type !== 'integer' || end?.type !== 'integer' || step?.type !== 'integer') return undefined;
                setup = `${tests.join('\n')} const start = ${start.code}, end = ${end.code}, stride = ${step.code};
                    if (stride === 0n) throw badStep();`;
                header = `for (let cursor = start${indexed ? ', ordinal = 0n' : ''};
                    stride > 0n ? cursor ${range.operator === 'to' ? '<=' : '<'} end : cursor ${range.operator === 'to' ? '>=' : '>'} end;
                    cursor += stride${indexed ? ', ordinal += 1n' : ''}) { location = ${location};`;
            }
            for (const [index, name] of iteration.names.entries()) {
                if (name === '#') continue;
                const type = index === 0 && textIteration ? 'text' : 'integer';
                if (localTypes.has(name) && localTypes.get(name) !== type) return undefined;
                localTypes.set(name, type);
                const target = slot(name), value = index === 0 ? 'cursor' : arrayIteration ? 'ordinal++' : 'ordinal';
                bindings += `const bound${binders.length} = ${value}; binders[${binders.length}](bound${binders.length}); r${target} = bound${binders.length};\n`;
                binders.push(host.writer(name));
                binderNames.push(name);
                assigned.add(name);
                written.add(name);
            }
        } else {
            const test = node.condition ? emit(node.condition, tests, 'boolean') : { code: 'true', type: 'boolean' };
            if (!test || test.type !== 'boolean') return undefined;
            header = `for (;;) { location = ${location}; ${tests.join('\n')} if (!(${test.code})) break;`;
        }
        return { setup, header, bindings };
    }
    const root = loopParts(statement, iteration, -1);
    if (!root) return undefined;
    const locations: Statement[] = [];
    function statements(commands: readonly Statement[], body: string[]): 'next' | 'stop' | undefined {
        for (const assignment of commands) {
            const location = locations.length;
            if (location >= 32) return undefined;
            locations.push(assignment);
            if (isForStatement(assignment)) {
                if (!host.nestedLoops) return undefined;
                const incoming = new Set(assigned);
                const loop = loopParts(assignment, host.iteration(assignment.condition), location);
                if (!loop) return undefined;
                body.push(`{ let result; location = ${location}; ${loop.setup} ${loop.header}`,
                    'let iterationResult;', loop.bindings);
                if (statements(assignment.statements, body) === undefined) return undefined;
                body.push(`result = iterationResult; location = ${location}; } iterationResult = result; }`);
                // An inner loop may run zero times, or leave through break.
                assigned.clear();
                for (const name of incoming) assigned.add(name);
                continue;
            }
            if (isReturnStatement(assignment)) {
                if (!host.returns || !assignment.value) return undefined;
                hasControl = true; hasReturn = true;
                const lines: string[] = [];
                let expression = assignment.value;
                while (isParenthesizedExpression(expression)) expression = expression.value;
                const array = isNameExpression(expression) ? arrays.get(expression.name) : undefined;
                let value: string;
                if (array && isNameExpression(expression)) {
                    if (!assigned.has(expression.name)) arrayInputs.add(expression.name);
                    value = `r${array.slot}`;
                } else {
                    const result = emit(expression, lines);
                    if (!result) return undefined;
                    value = result.code;
                }
                body.push(`location = ${location};`, ...lines, `leave(${value});`);
                return 'stop';
            }
            if (isBreakStatement(assignment) || isContinueStatement(assignment)) {
                hasControl = true;
                body.push(`location = ${location}; ${isBreakStatement(assignment) ? 'break' : 'continue'};`);
                return 'stop';
            }
            if (isPushStatement(assignment)) {
                if (!isNameExpression(assignment.receiver)) return undefined;
                const receiver = container(assignment.receiver.name, 'deque');
                const lines: string[] = [];
                const value = emit(assignment.value, lines);
                if (!receiver || value?.type !== 'integer') return undefined;
                needsAlgo = true;
                body.push(`location = ${location};`, ...lines, `${receiver}.push(${value.code}); iterationResult = undefined;`);
                continue;
            }
            if (isArrayAssignmentStatement(assignment)) {
                const compound = assignment.operator !== '=';
                const booleanUpdate = ['and=', 'or=', 'xor='].includes(assignment.operator);
                if (compound && (!host.compoundWrites || !['+=', '-=', '*=', '//=', '%=', 'and=', 'or=', 'xor='].includes(assignment.operator))) return undefined;
                if (assignment.name.includes('.')) return undefined;
                const knownArray = arrays.get(assignment.name);
                if (knownArray && knownArray.rank !== assignment.indices.length) return undefined;
                const previous = destinations.get(assignment.name);
                if (previous && previous.rank !== assignment.indices.length) return undefined;
                const target = previous ?? { slot: slot(assignment.name), rank: assignment.indices.length, compound, type: undefined as Term['type'] | undefined };
                target.compound ||= compound;
                destinations.set(assignment.name, target);
                if (!assigned.has(assignment.name)) arrayInputs.add(assignment.name);
                const receiver = `r${target.slot}`;
                const lines: string[] = [], keys: string[] = [];
                for (const address of assignment.indices) {
                    if (address.all || address.sign || !address.value) return undefined;
                    const value = emit(address.value, lines);
                    if (value?.type !== 'integer') return undefined;
                    keys.push(value.code);
                }
                const name = `key${serial++}`;
                lines.push(`const ${name} = ${receiver}.kind === 'array'
                    ? arrayOffset(${receiver}, [${keys.join(',')}]) : key([${keys.join(',')}]);`);
                const expected = booleanUpdate ? 'boolean' : compound ? 'integer' : target.type ?? arrays.get(assignment.name)?.type;
                const value = emit(assignment.value, lines, expected);
                if (!value || value.type === 'text' || value.type === 'boolean' && !host.booleanArrays
                    || expected && value.type !== expected
                    || arrays.has(assignment.name) && arrays.get(assignment.name)!.type !== value.type) return undefined;
                target.type = value.type;
                let result = value.code;
                if (compound) {
                    const rhs = `operand${serial++}`, old = `old${serial++}`, out = `updated${serial++}`;
                    lines.push(`const ${rhs} = ${value.code}, ${old} = ${receiver}.items[${name}];`);
                    const op = assignment.operator.slice(0, -1);
                    if (booleanUpdate) lines.push(`const ${out} = ${old} ${op === 'and' ? '&&' : op === 'or' ? '||' : '!=='} ${rhs};`);
                    else if (['+', '-', '*'].includes(op)) lines.push(`const ${out} = ${old} ${op} ${rhs};`);
                    else {
                        const remainder = `remainder${serial++}`;
                        lines.push(`if (${rhs} === 0n) throw zero(); const ${remainder} = ${old} % ${rhs};`);
                        const adjust = `(${remainder} !== 0n && (${remainder} < 0n) !== (${rhs} < 0n))`;
                        lines.push(`const ${out} = ${op === '%' ? `${remainder} + (${adjust} ? ${rhs} : 0n)` : `${old} / ${rhs} - (${adjust} ? 1n : 0n)`};`);
                    }
                    result = out;
                    body.push(`location = ${location};`, ...lines,
                        `${receiver}.items[${name}] = ${result}; iterationResult = ${rhs};`);
                } else {
                    body.push(`location = ${location};`, ...lines, `if (${receiver}.kind === 'array') {
                        ${receiver}.items[${name}] = ${result}; iterationResult = ${value.code};
                    } else { ${receiver}.entries.set(${name}, ${value.code}); iterationResult = undefined; }`);
                }
                continue;
            }
            if (isIfStatement(assignment)) {
                const incoming = new Set(assigned);
                const outcomes: Set<string>[] = [];
                const branches = [
                    { condition: assignment.condition, statements: assignment.thenStatements },
                    ...assignment.elifClauses,
                ];
                body.push(`location = ${location}; iterationResult = undefined;`);
                for (const branch of branches) {
                    assigned.clear();
                    for (const name of incoming) assigned.add(name);
                    const lines: string[] = [];
                    const condition = emit(branch.condition, lines, 'boolean');
                    if (condition?.type !== 'boolean') return undefined;
                    body.push(`location = ${location};`, ...lines, `if (${condition.code}) {`);
                    const flow = statements(branch.statements, body);
                    if (flow === undefined) return undefined;
                    if (flow === 'next') outcomes.push(new Set(assigned));
                    body.push('} else {');
                }
                assigned.clear();
                for (const name of incoming) assigned.add(name);
                const flow = statements(assignment.elseStatements, body);
                if (flow === undefined) return undefined;
                if (flow === 'next') outcomes.push(new Set(assigned));
                body.push('}'.repeat(branches.length));
                if (!outcomes.length) return 'stop';
                assigned.clear();
                for (const name of outcomes[0]) {
                    if (outcomes.every(outcome => outcome.has(name))) assigned.add(name);
                }
                continue;
            }
            if (host.arrayLocals && isAssignmentStatement(assignment) && assignment.operator === '='
                && !assignment.name.includes('.')) {
                let expression = assignment.value;
                while (isParenthesizedExpression(expression)) expression = expression.value;
                const source = isNameExpression(expression) ? arrays.get(expression.name) : undefined;
                if (isArrayExpression(expression) || source) {
                    if (localTypes.has(assignment.name)) return undefined;
                    const lines: string[] = [];
                    let rank: number, type: Term['type'], value: string;
                    if (isArrayExpression(expression)) {
                        if (!expression.dimensions.length || !expression.fill || expression.rows.length) return undefined;
                        const dimensions: string[] = [];
                        for (const item of expression.dimensions) {
                            if (!item.value) return undefined;
                            const size = emit(item.value, lines, 'integer');
                            if (size?.type !== 'integer') return undefined;
                            const name = `dimension${serial++}`;
                            lines.push(`const ${name} = dimension(${item.sign === '-' ? `-(${size.code})` : size.code});`);
                            dimensions.push(name);
                        }
                        const shape = `shape${serial++}`, size = `size${serial++}`;
                        lines.push(`const ${shape} = [${dimensions.join(',')}];`,
                            `const ${size} = ${shape}.reduce((a,b) => a * BigInt(b), 1n);`);
                        const fill = emit(expression.fill, lines);
                        if (!fill || fill.type === 'text' || fill.type === 'boolean' && !host.booleanArrays) return undefined;
                        rank = dimensions.length; type = fill.type;
                        value = `created${serial++}`;
                        lines.push(`const ${value} = { kind: 'array', shape: ${shape}, items: Array(Number(${size})).fill(${fill.code}) };`);
                    } else {
                        if (!isNameExpression(expression) || !source) return undefined;
                        const name = expression.name;
                        if (!assigned.has(name)) arrayInputs.add(name);
                        aliases.push([assignment.name, name]);
                        rank = source.rank; type = source.type; value = `r${source.slot}`;
                    }
                    const old = arrays.get(assignment.name), target = destinations.get(assignment.name);
                    if (old && (old.rank !== rank || old.type !== type)
                        || target && (target.rank !== rank || target.type !== type)) return undefined;
                    const destination = slot(assignment.name), index = writers.length;
                    arrays.set(assignment.name, { slot: destination, rank, type });
                    arrayDefinitions.add(assignment.name);
                    written.add(assignment.name);
                    writers.push(host.writer(assignment.name)); writerNames.push(assignment.name);
                    body.push(`location = ${location};`, ...lines,
                        `writers[${index}](${value}); r${destination} = ${value}; iterationResult = ${value};`);
                    assigned.add(assignment.name);
                    continue;
                }
            }
            const index = writers.length;
            if (!isAssignmentStatement(assignment) || assignment.name.includes('.')) return undefined;
            if (arrays.has(assignment.name)) return undefined;
            const destination = slot(assignment.name);
            written.add(assignment.name);
            if (assignment.operator !== '=' && !assigned.has(assignment.name)) required.add(destination);
            const lines: string[] = [];
            const booleanUpdate = ['and=', 'or=', 'xor='].includes(assignment.operator);
            const value = emit(assignment.value, lines, booleanUpdate ? 'boolean' : undefined);
            if (!value || value.type === 'boolean' && !host.booleanLocals) return undefined;
            const previousType = localTypes.get(assignment.name);
            if (previousType && previousType !== value.type) return undefined;
            localTypes.set(assignment.name, value.type);
            let result = value.code;
            if (assignment.operator !== '=') {
                const op = assignment.operator.slice(0, -1);
                if (booleanUpdate && value.type === 'boolean') {
                    result = `(r${destination}) ${op === 'and' ? '&&' : op === 'or' ? '||' : '!=='} (${result})`;
                } else if (value.type !== 'integer') return undefined;
                else if (['+', '-', '*'].includes(op)) result = `(r${destination}) ${op} (${result})`;
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
            writerNames.push(assignment.name);
            body.push(`location = ${location};`, ...lines, `const out${index} = ${result};`,
                `writers[${index}](out${index}); r${destination} = out${index}; iterationResult = out${index};`);
            assigned.add(assignment.name);
        }
        return 'next';
    }
    const body: string[] = [];
    if (!statements(statement.statements, body)) return undefined;
    // Container bindings must remain stable throughout the compiled region.
    if ([...containers].some(([name, info]) => written.has(name) || required.has(info.slot))) return undefined;
    if ([...arrays].some(([name, info]) => written.has(name) && !arrayDefinitions.has(name) || required.has(info.slot) || containers.has(name))) return undefined;
    if ([...destinations].some(([name, info]) => written.has(name) && !arrayDefinitions.has(name) || required.has(info.slot))) return undefined;
    if ([...builtins.keys()].some(name => written.has(name))) return undefined;
    const writable = new Set(destinations.keys());
    for (let changed = true; changed;) {
        changed = false;
        for (const [target, source] of aliases) {
            if (writable.has(target) && !writable.has(source)) { writable.add(source); changed = true; }
        }
    }
    const source = `"use strict"; return function(input, writers, binders) {
        ${names.length ? `let ${names.map((_, index) => `r${index} = input[${index}]`).join(',')};` : ''}
        let result, location = -1;
        try { ${root.setup} ${root.header}
            let iterationResult;
            ${root.bindings} ${body.join('\n')}
            result = iterationResult; location = -1;
        } return result; } catch (error) { throw locate(error, location); }
    };`;
    let run: (values: (RankValue | undefined)[], writers: ((value: RankValue) => void)[], binders: ((value: RankValue) => void)[]) => RankValue | undefined;
    try { run = new Function('zero', 'badStep', 'locate', 'key', 'arrayRead', 'arrayOffset', 'iterators', 'dimension', 'leave', source)(
        () => new RankError('division by zero'), () => new RankError('range step must be a nonzero integer'),
        (error: unknown, index: number) => host.locate(error, index < 0 ? statement : locations[index]), indexKey, host.arrayRead, host.arrayOffset, iterators, host.dimension, host.returnValue); }
    catch { return undefined; }
    host.compiled?.(source);
    return { run: (insideFinally = false, insideGenerator = false) => {
        if (hasControl && insideFinally) return undefined;
        if (hasReturn && (insideGenerator || !host.canReturn())) return undefined;
        if (needsRanges && !host.ranges()) return undefined;
        if (needsAlgo && !host.module('algo')) return undefined;
        for (const [name, module] of builtins) if (!host.builtin(module, name)) return undefined;
        const values: (RankValue | undefined)[] = [];
        for (const index of required) {
            const value = host.read(names[index]);
            if (typeof value !== (localTypes.get(names[index]) === 'text' ? 'string' : localTypes.get(names[index]) === 'boolean' ? 'boolean' : 'bigint')) return undefined;
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
        for (const [name, info] of arrays) {
            if (!arrayInputs.has(name)) continue;
            const value = host.read(name);
            if (!value || !isRankArray(value) || value.shape.length !== info.rank) return undefined;
            if (writable.has(name) && (value.kind !== 'array' || value.itemAt !== undefined)) return undefined;
            const items = materializedArrayItems(value);
            if (!items || !items.every(item => typeof item === (info.type === 'boolean' ? 'boolean' : 'bigint'))) return undefined;
            values[info.slot] = value;
        }
        for (const [name, info] of destinations) {
            if (!arrayInputs.has(name)) {
                if (!host.arrayWrites) return undefined;
                continue;
            }
            const value = host.read(name);
            if (!value) return undefined;
            if (isRankIndex(value) && info.compound) return undefined;
            if (!isRankIndex(value)) {
                if (!host.arrayWrites || !isRankArray(value) || value.kind !== 'array'
                    || value.itemAt !== undefined || value.shape.length !== info.rank) return undefined;
                const items = materializedArrayItems(value);
                if (!items || !items.every(item => typeof item === (info.type === 'boolean' ? 'boolean' : 'bigint'))) return undefined;
            }
            values[info.slot] = value;
        }
        host.executed?.();
        const activeWriters = host.prepareWriter
            ? writers.map((checked, index) => host.prepareWriter!(writerNames[index], checked)) : writers;
        const activeBinders = host.prepareWriter
            ? binders.map((checked, index) => host.prepareWriter!(binderNames[index], checked)) : binders;
        return completed(run(values, activeWriters, activeBinders));
    } };
}
