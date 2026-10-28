import { binaryOperatorSource, scalarExtremeSource, zeroTestSource } from './operator-codegen.js';
import { loopValueType, type LoopHost, type LoopTerm } from './integer-loop-plan.js';
import { compiledIntegerMembership } from './integer-membership.js';
import { type CompiledCalleeType } from './compiled-callee-type.js';
import { ResourceMap } from './resource-summary.js';
import { IntegerEntries } from './integer-entries.js';
import { IndexEntries } from './index-storage.js';
import { compiledArgumentType, hasNativeDeque } from './compiled-argument-type.js';
import {
    applicationExpression, rangeSliceOperands, flattenApplication, expressionFacts, findOperation, findCompiledOperator, inferCompiledExpression,
    loopOperatorSignature, isApplicationExpression, isBinaryExpression, isUnaryExpression, isStringLiteral,
    isParenthesizedExpression, isNumberLiteral, isNameExpression, isArrayExpression, type Expression, type CompiledLoopType,
    type CompiledExpression, type Operation, type CompiledArrayType,
} from '@arrrank/language';
import { isRankArray, isRankIndex, isRankSet } from './value.js';
import { RankDeque } from './containers.js';
import { denseScalarItems, materializedArrayItems, arrayRevision, storedScalarKinds } from './array-storage.js';

import { describeCompilerRejection, recordCompilerRejection } from './compiler-rejection.js';
import type { LoopCompilationState } from './integer-loop-state.js';

/** Pure builtins inlined as `Value name`; runtime entry rechecks their bindings. */
interface InlineBuiltin {
    readonly module: string;
    readonly types: Partial<Record<LoopTerm['type'], LoopTerm['type']>>;
    readonly enabled?: (host: LoopHost) => boolean;
    /** The interpreter's DomainError for operands outside the domain. */
    readonly domain?: { test(value: string, type: LoopTerm['type']): string | undefined; message: string };
    code(value: string, type: LoopTerm['type'], numberMode: boolean): string;
}
const parity = (even: boolean): InlineBuiltin => ({ module: 'numbers', types: { integer: 'boolean' },
    code: (value, _, numberMode) => numberMode ? `((${value}) % 2 ${even ? '===' : '!=='} 0)`
        : `(BigInt.asUintN(1, ${value}) ${even ? '===' : '!=='} 0n)` });
const bound = (name: 'floor' | 'ceil'): InlineBuiltin => ({ module: 'numbers', types: { integer: 'integer', real: 'integer' },
    enabled: host => host.reals,
    domain: { test: (value, type) => type === 'real' ? `!Number.isFinite(${value})` : undefined, message: `${name} expects a finite number` },
    code: (value, type, numberMode) => type === 'real' ? numberMode ? `safe(Math.${name}(${value}))` : `BigInt(Math.${name}(${value}))` : value });
const inlineBuiltins = new Map<string, InlineBuiltin>([
    ['abs', { module: 'numbers', types: { integer: 'integer', real: 'real' }, enabled: host => host.absolute,
        code: (value, type, numberMode) => type === 'real' ? `Math.abs(${value})`
            : `(${value}) < ${numberMode ? '0' : '0n'} ? -(${value}) : (${value})` }],
    ['even', parity(true)],
    ['odd', parity(false)],
    ['sqrt', { module: 'numbers', types: { integer: 'real', real: 'real' }, enabled: host => host.reals,
        domain: { test: value => `(${value}) < 0`, message: 'sqrt expects a nonnegative value' },
        code: (value, type) => `Math.sqrt(${type === 'integer' ? `Number(${value})` : value})` }],
    ['isqrt', { module: 'numbers', types: { integer: 'integer' },
        domain: { test: value => `(${value}) < 0`, message: 'isqrt expects a nonnegative integer' },
        code: value => `isqrt(${value})` }],
    ['acos', { module: 'numbers', types: { integer: 'real', real: 'real' }, enabled: host => host.reals,
        domain: { test: value => `!((${value}) >= -1 && (${value}) <= 1)`, message: 'acos input is outside its domain' },
        code: value => `Math.acos(Number(${value}))` }],
    ['floor', bound('floor')],
    ['ceil', bound('ceil')],
]);

// Code-size budget, not a numeric precision or array-size limit. Number array
// accesses spend IDs on coordinate/bounds checks too; bounded-Y Euler 212
// exhausted the old 256-ID budget. Fresh-process probes (see
// benchmarks/euler212-compiler-budget-results.md) found that 1024 admits useful
// medium regions while retaining fallback for a ~559 KB exact+Number expansion
// whose preparation and short-run cost increased without a cap. This is a
// conservative heuristic, not a universal optimum; the separate 128-statement
// and per-expression inference budgets still apply.
const MAX_LOOP_TEMPORARIES = 1024;

/** Expression lowering records its required bindings on the current plan. */
export function createLoopExpressions(state: LoopCompilationState, wide = false) {
    const {
        host, textSources, localTypes, names, required, assigned, containers, builtins,
        calls, arrays, calleeArrays, arrayInputs, destinations, reject,
    } = state;
    const numberMode = state.numberMode && !wide;
    const safe = wide ? (code: string) => code : state.safe;

    function temporaryBudget(source: Expression): boolean {
        if (state.serial <= MAX_LOOP_TEMPORARIES) return true;
        recordCompilerRejection(describeCompilerRejection(state.numberMode ? 'number-loop' : 'loop', source, 'temporary-budget'));
        return false;
    }
    function container(name: string, kind: 'index' | 'deque' | 'set', integers = false): string | undefined {
        if (name.includes('.')) return undefined;
        const old = containers.get(name);
        if (old && (old.kind !== kind || integers && old.array)) return undefined;
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
    /** Scalar coordinates share axis checks and row-major addressing for reads and writes. */
    function numberOffset(info: { slot: number; rank: number }, indices: readonly string[], lines: string[], write = false): string {
        let offset = '0';
        indices.forEach((index, axis) => {
            const coordinate = `index${state.serial++}`;
            const size = info.rank === 1 ? `cells${info.slot}.length` : `size${info.slot}_${axis}`;
            lines.push(`const ${coordinate} = ${index};
                if (${coordinate} < 0 || ${coordinate} >= ${size}) throw ${write ? 'badWriteIndex' : 'badIndex'}(${coordinate}, ${axis});`);
            const value = wide ? `Number(${coordinate})` : coordinate;
            offset = axis === 0 ? value : `(${offset} * ${size} + ${value})`;
        });
        const key = `key${state.serial++}`;
        lines.push(`const ${key} = ${offset};`);
        return key;
    }
    function knownType(expression: Expression): LoopTerm['type'] | undefined {
        const fact = expressionFacts(expression, name => {
            const local = localTypes.get(name);
            if (local) return { types: [local] };
            // This only selects a specialization; required inputs are guarded
            // again on every entry. Never retain a value or invocation frame.
            const type = loopValueType(host.read(name));
            return type && { types: [type] };
        });
        const type = fact.types.length === 1 ? fact.types[0] : undefined;
        return type === 'integer' || type === 'boolean' || type === 'text' || type === 'bytes'
            || type === 'real' && host.reals ? type : undefined;
    }
    /** Real bindings and arrays of reals select real registers. This only
     * chooses a specialization; entry guards check every input and cell. */
    function realInput(name: string): 'real' | undefined {
        if (!host.reals) return undefined;
        const value = host.read(name);
        const first = value && isRankArray(value)
            ? arrayRevision(value) === undefined ? undefined
                : (denseScalarItems(value) ?? materializedArrayItems(value))?.[0] : value;
        return typeof first === 'number' ? 'real' : undefined;
    }
    type LoopValue = LoopTerm | { readonly code: string; readonly type: CompiledArrayType; readonly deque?: boolean };
    function isScalar(value: LoopValue): value is LoopTerm { return typeof value.type === 'string'; }
    interface LoopInput { readonly term: LoopTerm; readonly lines: readonly string[] }
    function emit(e: Expression, lines: string[], hint?: LoopTerm['type'], tail = false): LoopTerm | undefined {
        let tailSource = e;
        while (isParenthesizedExpression(tailSource)) tailSource = tailSource.value;
        const booleanPairs = new Map<Expression, boolean>();
        const types: readonly CompiledLoopType[] = ['integer', 'boolean', 'bytes',
            ...host.textLoops ? ['text' as const] : [], ...host.reals ? ['real' as const] : []];
        const inferred = inferCompiledExpression<CompiledLoopType, LoopInput>(e, {
            atom: type => types.find(candidate => candidate === type),
            read: (source, expected) => {
                // Scalar operators use the shared inference. Loop-specific cell
                // reads, calls and literal powers retain their guarded lowering.
                if (isUnaryExpression(source) || isBinaryExpression(source)
                    && source.operator !== '**' && source.operator !== 'in' && source.operator !== 'notin') return undefined;
                const inputLines: string[] = [];
                const term = emitInput(source, inputLines, expected, tail && source === tailSource);
                return term && isScalar(term) ? { type: term.type, input: { term, lines: inputLines } } : undefined;
            },
            isBound: name => localTypes.has(name) || arrays.has(name) || containers.has(name),
            // Name inputs are registers or entry-guarded values, never calls.
            scalarSlot: () => true,
            extreme: host.extrema ? (name, inputs) => {
                const type = inputs[0];
                if (type !== 'integer' && type !== 'real' || inputs.some(input => input !== type)) return undefined;
                builtins.set(name, 'core');
                return type;
            } : undefined,
            operandHint: (source, index, left) => {
                if (isUnaryExpression(source)) return source.operator === 'not' ? 'boolean' : undefined;
                if (!isBinaryExpression(source)) return undefined;
                if (index === 1) return left === 'text' ? 'text'
                    : booleanPairs.get(source) || left === 'boolean' ? 'boolean' : undefined;
                const text = loopOperatorSignature(source.operator, ['text', 'text'], host.nativeCalls);
                const boolean = loopOperatorSignature(source.operator, ['boolean', 'boolean'], host.nativeCalls);
                const textPair = text && knownType(source.right) === 'text';
                const booleanPair = !!boolean && (!loopOperatorSignature(source.operator, ['integer', 'integer'], host.nativeCalls)
                    || knownType(source.right) === 'boolean');
                booleanPairs.set(source, booleanPair);
                return textPair || text?.result === 'text' && knownType(source.left) === 'text'
                    ? 'text' : booleanPair ? 'boolean' : undefined;
            },
            // Literal powers are handled by the guarded input path. Accepting
            // the generic overload here would bypass guarded runtime lowering.
            operator: (operation, inputs) => {
                if (operation.name === '**') return undefined;
                const signature = loopOperatorSignature(operation.name, inputs, host.nativeCalls);
                return signature?.result === 'real' && !host.reals ? undefined : signature;
            },
            budget: { remaining: 1024 },
        }, hint);
        if (inferred.failure) return reject(inferred.failure.source, inferred.failure.detail);
        return lower(inferred.expression, lines) ?? reject(e);
    }
    function lower(node: CompiledExpression<CompiledLoopType, LoopInput>, lines: string[], selection?: { name: string; count: number }): LoopTerm | undefined {
        if (!temporaryBudget(node.source)) return undefined;
        if (node.kind === 'group') return lower(node.operand, lines);
        if (node.kind === 'literal') {
            const value = node.value;
            if (numberMode && typeof value === 'bigint' && !Number.isSafeInteger(Number(value))) return undefined;
            return { type: node.type, code: typeof value === 'bigint' ? `${value}${numberMode ? '' : 'n'}`
                : typeof value === 'number' ? Object.is(value, -0) ? '-0' : String(value) : JSON.stringify(value) };
        }
        if (node.kind === 'input') {
            const input = node.input;
            if (selection && input.term.selection) {
                // Only the final read belongs to argument preparation; index
                // expressions keep their own errors and evaluation order.
                lines.push(...input.lines.slice(0, -1), `let ${input.term.code}; try {
                    ${input.lines.at(-1)!.replace(`const ${input.term.code} =`, `${input.term.code} =`)}
                } catch (error) { throw argumentSelectionError(error, ${JSON.stringify(selection.name)}, ${selection.count}); }`);
            } else lines.push(...input.lines);
            return node.input.term;
        }
        if (node.kind === 'call') return undefined; // Calls are guarded loop inputs above.
        if (node.kind === 'extreme') {
            const left = lower(node.left, lines, node.selected ? { name: node.name, count: node.selected } : undefined);
            if (!left || !node.right) return left;
            // Cell reads may be accessor expressions. Freeze the left value
            // before lowering the right and use each operand only once.
            const first = `v${state.serial++}`;
            lines.push(`const ${first} = ${left.code};`);
            const right = lower(node.right, lines);
            if (!right) return undefined;
            const second = `v${state.serial++}`, result = `v${state.serial++}`;
            lines.push(`const ${second} = ${right.code};`, `const ${result} = ${scalarExtremeSource(node.name, first, second)};`);
            return { code: result, type: node.type };
        }
        if (node.kind === 'unary') {
            const value = lower(node.operand, lines), token = node.operation.unary;
            if (!value || token === undefined) return undefined;
            return { code: token === '' ? value.code : node.type === 'integer' ? safe(`${token}(${value.code})`) : `${token}(${value.code})`, type: node.type };
        }
        const left = lower(node.left, lines);
        const token = node.operation.binary;
        const guard = token === '&&' || token === '||';
        const rightLines: string[] = guard ? [] : lines;
        const right = lower(node.right, rightLines);
        if (!left || !right || !token) return undefined;
        if (guard) {
            const name = `v${state.serial++}`;
            lines.push(`let ${name} = ${left.code}; if (${node.operation.name === 'and' ? '' : '!'}${name}) { ${rightLines.join('\n')} ${name} = ${right.code}; }`);
            return { code: name, type: node.type };
        }
        const code = arithmetic(node.operation.name, left, right, node.type, lines);
        return code === undefined ? undefined : { code, type: node.type };
    }
    /** One checked binary operator. Compound assignments lower through it
     * too, so division by zero and floor rounding are written once. */
    function arithmetic(op: string, left: LoopTerm, right: LoopTerm, type: LoopTerm['type'], lines: string[]): string | undefined {
        const operation = findCompiledOperator(op);
        const token = operation?.binary;
        if (!operation || !token) return undefined;
        const a = left.code, b = right.code, name = `v${state.serial++}`;
        if (op === '/' || left.type === 'real' || right.type === 'real') {
            // The interpreter's coercions: Number for arithmetic, exact
            // bigint/number relations, and `==` for integral equality.
            if (token === '//' || token === '%') return undefined;
            const real = (term: LoopTerm) => term.type === 'integer' ? `Number(${term.code})` : `(${term.code})`;
            const mixed = left.type !== right.type;
            if (op === '/') lines.push(`if (${zeroTestSource(b, right.type === 'integer' && !numberMode ? 'integer' : 'real')}) throw zero();`);
            if (op === '**') lines.push(`if (${zeroTestSource(a, left.type === 'integer' && !numberMode ? 'integer' : 'real')} && (${b}) < 0) throw powerZero();`);
            lines.push(`const ${name} = ${type === 'boolean' ? binaryOperatorSource(operation, a, b, { mixed }) : binaryOperatorSource(operation, real(left), real(right))};`);
            if (op === '**') lines.push(`if (Number.isNaN(${name})) throw powerDomain();`);
            return name;
        }
        if (token !== '//' && token !== '%') {
            lines.push(`const ${name} = ${type === 'integer' ? safe(binaryOperatorSource(operation, a, b)) : binaryOperatorSource(operation, a, b)};`);
            return name;
        }
        lines.push(`if (${zeroTestSource(b, numberMode ? 'real' : 'integer')}) throw zero();`);
        if (numberMode && op === '//') {
            // Inline the bounded case so loop-invariant numerators can hoist
            // its guard and V8 need not inline a helper at every quotient.
            lines.push(`const ${name} = Math.abs(${a}) < 4503599627370496 ? Math.floor((${a}) / (${b})) || 0 : divide(${a}, ${b});`);
            return name;
        }
        const remainder = numberMode || op === 'mod' ? `m${state.serial++}` : undefined;
        if (remainder) lines.push(`const ${remainder} = (${a}) % (${b});`);
        lines.push(`const ${name} = ${binaryOperatorSource(operation, a, b, { remainder, number: numberMode, safe })};`);
        return name;
    }
    /** Lower an audited catalogue call. Argument reads remain in source order;
     * runtime binding still checks the module and current builtin on every entry. */
    function emitBuiltinCall(operation: Operation, operands: readonly Expression[], lines: string[]): LoopTerm | undefined {
        if (numberMode && operation.module === 'bits' && ['band', 'bor', 'bxor', 'bit', 'shl'].includes(operation.name)) {
            const arguments_: string[] = [];
            for (const operand of operands) {
                const value = emit(operand, lines, 'integer');
                if (value?.type !== 'integer') return undefined;
                const name = `v${state.serial++}`;
                // Number bitwise operators truncate to signed Int32. Wider
                // integers must discard the private attempt and replay exactly.
                lines.push(`const ${name} = int32(${value.code});`);
                arguments_.push(name);
            }
            builtins.set(operation.name, operation.module);
            const name = `v${state.serial++}`;
            const [left, right] = arguments_;
            if (operation.name === 'bit' || operation.name === 'shl') {
                // JS masks shift counts modulo 32. Unsupported domains replay
                // the exact backend, including its ordinary negative errors.
                lines.push(`if (${right} < 0 || ${right} > 30${operation.name === 'bit' ? ` || ${left} < 0` : ''}) throw overflow;`);
                lines.push(`const ${name} = ${operation.name === 'bit'
                    ? `((${left} & (1 << ${right})) !== 0)` : `safe(${left} * (2 ** ${right}))`};`);
            } else {
                lines.push(`const ${name} = ${left} ${operation.name === 'band' ? '&' : operation.name === 'bor' ? '|' : '^'} ${right};`);
            }
            return { code: name, type: operation.name === 'bit' ? 'boolean' : 'integer' };
        }
        const signature = operation.compiledCall!;
        if (numberMode && (signature.callbacks !== 'none' || signature.hostFunction
            || !['integer', 'real', 'boolean'].includes(signature.result)
            || signature.inputs.some(type => !['integer', 'real', 'boolean', 'number'].includes(type)))) return undefined;
        const arguments_: string[] = [];
        const types: string[] = [];
        let firstType: LoopTerm['type'] | undefined;
        for (const [index, input] of signature.inputs.entries()) {
            let part = operands[index];
            while (isParenthesizedExpression(part)) part = part.value;
            if (input === 'text-array' || input === 'integer-array') {
                const type = input === 'text-array' ? 'text' : 'integer';
                if (type === 'text' && !host.textArrayLoops || !isNameExpression(part) || part.name.includes('.')) return undefined;
                const previous = arrays.get(part.name);
                if (previous && (previous.rank !== 1 || previous.type !== type)
                    || localTypes.has(part.name)) return undefined;
                const info = previous ?? { slot: slot(part.name), rank: 1, type };
                arrays.set(part.name, info);
                if (!assigned.has(part.name)) arrayInputs.add(part.name);
                arguments_.push(`r${info.slot}`);
                types.push(input);
                continue;
            }
            const expected = input === 'number' || input === 'scalar' ? undefined : input === 'text-or-array' ? 'text' : input === 'same' ? firstType
                : input === 'text-or-bytes' ? knownType(part) ?? (isNameExpression(part) ? 'text' : undefined) : input;
            const value = emit(operands[index], lines, expected);
            if (!value || expected && value.type !== expected
                || input === 'number' && value.type !== 'integer' && value.type !== 'real'
                || input === 'scalar' && !['integer', 'real', 'boolean', 'text'].includes(value.type)
                || input === 'text-or-bytes' && !['text', 'bytes'].includes(value.type)) return undefined;
            firstType ??= value.type;
            arguments_.push(value.code);
            types.push(value.type);
        }
        const name = `v${state.serial++}`, index = calls.length;
        // Catalogue compiled calls are synchronous operations with
        // no Rank callbacks; bind() checks the current builtin.
        calls.push({ name: operation.name, locals: [], stableArrayReads: true, numberSafe: numberMode,
            bind: host.prepareBuiltinCall(operation.module, operation.name, types, numberMode) });
        const code = `calls[${index}]([${arguments_.join(',')}])`;
        lines.push(`const ${name} = ${numberMode && signature.result === 'integer' ? safe(code) : code};`);
        return { code: name, type: signature.result };
    }
    // Array operands use the same concrete range/selection operations as the
    // evaluator, without re-entering expression evaluation on every iteration.
    function arrayType(e: Expression): CompiledArrayType | undefined {
        while (isParenthesizedExpression(e)) e = e.value;
        if (isNameExpression(e) && !e.name.includes('.') && !localTypes.has(e.name)) {
            const previous = arrays.get(e.name);
            if (previous && previous.type !== 'bytes') return { kind: 'array', element: previous.type, rank: previous.rank };
            const current = host.read(e.name);
            if (current && isRankArray(current) && storedScalarKinds(current)?.join() === 'integer') {
                return { kind: 'array', element: 'integer', rank: current.shape.length };
            }
        }
        if (isBinaryExpression(e) && ['to', 'till'].includes(e.operator)) {
            return { kind: 'array', element: 'integer', rank: 1 };
        }
        if (isBinaryExpression(e) && ['+', '-', '*', '//', 'mod'].includes(e.operator)) {
            const left = arrayType(e.left), right = arrayType(e.right);
            if ((left || right) && (!left || left.element === 'integer') && (!right || right.element === 'integer')) {
                return { kind: 'array', element: 'integer', rank: Math.max(left?.rank ?? 0, right?.rank ?? 0) };
            }
        }
        if (isApplicationExpression(e)) {
            const parts = flattenApplication(e), last = parts.at(-1)!;
            if (parts.length >= 2 && isNameExpression(last) && last.name === 'copy'
                && host.nativeCalls && !localTypes.has('copy') && !arrays.has('copy') && !containers.has('copy')) {
                return arrayType(applicationExpression(parts.slice(0, -1), e));
            }
            if (parts.length === 2) {
                const source = arrayType(parts[0]), selector = arrayType(last);
                if (source && selector?.element === 'integer') return { ...source, rank: source.rank + selector.rank - 1 };
            }
        }
        return undefined;
    }
    function emitArrayValue(e: Expression, lines: string[]): LoopValue | undefined {
        while (isParenthesizedExpression(e)) e = e.value;
        const type = arrayType(e);
        if (!type) return undefined;
        if (isNameExpression(e)) {
            const info = arrays.get(e.name) ?? { slot: slot(e.name), rank: type.rank, type: type.element };
            arrays.set(e.name, info);
            if (!assigned.has(e.name)) arrayInputs.add(e.name);
            return { code: `r${info.slot}`, type };
        }
        let code: string;
        if (isBinaryExpression(e) && ['to', 'till'].includes(e.operator)) {
            const start = emit(e.left, lines, 'integer'), end = emit(e.right, lines, 'integer');
            const step = e.step ? emit(e.step, lines, 'integer') : undefined;
            if (start?.type !== 'integer' || end?.type !== 'integer' || e.step && step?.type !== 'integer') return undefined;
            code = `arrayValues.range(${start.code}, ${end.code}, ${e.operator === 'to'}, ${step?.code ?? 'undefined'})`;
        } else if (isBinaryExpression(e)) {
            const left = emitValue(e.left, lines, 'integer'), right = emitValue(e.right, lines, 'integer');
            if (!left || !right || (typeof left.type === 'string' ? left.type : left.type.element) !== 'integer'
                || (typeof right.type === 'string' ? right.type : right.type.element) !== 'integer') return undefined;
            code = `arrayValues.binary(${JSON.stringify(e.operator)}, ${left.code}, ${right.code})`;
        } else if (isApplicationExpression(e)) {
            const parts = flattenApplication(e), last = parts.at(-1)!;
            const copied = isNameExpression(last) && last.name === 'copy';
            const source = copied ? applicationExpression(parts.slice(0, -1), e) : parts[0];
            const selector = last;
            const inputLines: string[] = [];
            const input = emitValue(source, inputLines);
            if (!input || typeof input.type === 'string') return undefined;
            let inputCode = input.code;
            if (copied && parts.length > 2) {
                inputCode = `receiver${state.serial++}`;
                lines.push(`let ${inputCode}; try { ${inputLines.join('\n')} ${inputCode} = ${input.code}; }
                    catch (error) { throw argumentSelectionError(error, 'copy', ${parts.length - 1}); }`);
            } else lines.push(...inputLines);
            if (copied) {
                builtins.set('copy', 'sequences');
                code = `arrayValues.copy(${inputCode})`;
            } else {
                const index = emitValue(selector, lines);
                if (!index || typeof index.type === 'string' || index.type.element !== 'integer') return undefined;
                code = `arrayValues.select(${input.code}, ${index.code})`;
            }
        } else return undefined;
        const name = `v${state.serial++}`;
        lines.push(`const ${name} = ${code};`);
        return { code: name, type };
    }
    function emitValue(e: Expression, lines: string[], hint?: LoopTerm['type'], tail = false): LoopValue | undefined {
        let source = e;
        while (isParenthesizedExpression(source)) source = source.value;
        if (!state.numberMode && host.arrayLocals && host.arrayReads) {
            if (isArrayExpression(source) && !source.dimensions.length && !source.range && !source.fill && !source.rows.length && source.items.length) {
                const cells: string[] = [];
                let type: CompiledArrayType['element'] | undefined;
                for (const item of source.items) {
                    const value = emit(item.value, lines);
                    if (!value || value.type === 'bytes' || type && type !== value.type
                        || item.sign && !['integer', 'real'].includes(value.type)) return undefined;
                    type = value.type;
                    const cell = `cell${state.serial++}`;
                    lines.push(`const ${cell} = ${item.sign === '-' ? `-(${value.code})` : value.code};`);
                    cells.push(cell);
                }
                const name = `v${state.serial++}`;
                lines.push(`const ${name} = ownedArray([${cells.join(',')}], [${cells.length}], true);`);
                return { code: name, type: { kind: 'array', element: type!, rank: 1 } };
            }
            if (isApplicationExpression(source) && source.arguments.length === 1
                && isNameExpression(source.head) && isNameExpression(source.arguments[0]) && source.arguments[0].name === 'pop') {
                const name = source.head.name, current = host.read(name);
                const first = current && hasNativeDeque(current) && current.size ? current.at(0) : undefined;
                const type = first && compiledArgumentType(first);
                if (type && typeof type !== 'string' && type.kind === 'array' && type.element === 'integer') {
                    const receiver = container(name, 'deque');
                    const info = containers.get(name);
                    if (!receiver || !info || info.integers || info.array && (info.array.rank !== type.rank || info.array.type !== type.element)) return undefined;
                    info.array = { rank: type.rank, type: type.element };
                    builtins.set('pop', 'algo');
                    const result = `v${state.serial++}`;
                    lines.push(`const ${result} = ${receiver}.pop();`);
                    return { code: result, type, deque: true };
                }
            }
        }
        if (!state.numberMode && host.arrayLocals && host.arrayReads) {
            let selection = source, copied = false, selectedArguments = 0;
            if (isApplicationExpression(selection)) {
                const parts = flattenApplication(selection), last = parts.at(-1);
                if (last && isNameExpression(last) && last.name === 'copy' && host.nativeCalls
                    && !localTypes.has('copy') && !arrays.has('copy') && !containers.has('copy')) {
                    copied = true;
                    selectedArguments = parts.length - 1;
                    selection = applicationExpression(parts.slice(0, -1), selection);
                    while (isParenthesizedExpression(selection)) selection = selection.value;
                }
            }
            const range = rangeSliceOperands(selection);
            if (range && isNameExpression(range.source) && !range.source.name.includes('.')
                && !localTypes.has(range.source.name)) {
                const name = range.source.name, previous = arrays.get(name);
                const current = previous ? undefined : host.read(name);
                const kinds = current && isRankArray(current) ? storedScalarKinds(current) : undefined;
                const type = previous?.type ?? (kinds?.length === 1 ? kinds[0] : undefined);
                const rank = previous?.rank ?? (current && isRankArray(current) ? current.shape.length : undefined);
                if (rank !== undefined && range.axis < BigInt(rank) && (type === 'integer'
                    || type === 'real' && host.reals || type === 'boolean' && host.booleanArrays
                    || type === 'text' && host.textArrayLoops)) {
                    const start = emit(range.start, lines, 'integer'), end = emit(range.end, lines, 'integer');
                    if (start?.type !== 'integer' || end?.type !== 'integer') return undefined;
                    const info = previous ?? { slot: slot(name), rank, type };
                    arrays.set(name, info);
                    if (!assigned.has(name)) arrayInputs.add(name);
                    if (copied) builtins.set('copy', 'sequences');
                    // A region writes directly into owned storage. Complete the
                    // selection now so later stores cannot change its snapshot.
                    const result = `v${state.serial++}`;
                    const call = `copySlice(r${info.slot}, ${start.code}, ${end.code}, ${range.axis}, ${range.inclusive})`;
                    lines.push(selectedArguments > 1
                        ? `let ${result}; try { ${result} = ${call}; } catch (error) { throw argumentSelectionError(error, 'copy', ${selectedArguments}); }`
                        : `const ${result} = ${call};`);
                    return { code: result, type: { kind: 'array', element: type, rank } };
                }
            }
        }
        if (!state.numberMode && host.arrayLocals && host.arrayReads && host.arrayValues && arrayType(source)) {
            return emitArrayValue(source, lines);
        }
        if (isApplicationExpression(source)) {
            // Whole-value stores/returns may accept an array call. Other forms
            // keep the shared scalar inference, including min/max grouping.
            const parts = flattenApplication(source), last = parts.at(-1);
            if (last && isNameExpression(last) && host.scalarFunction(last.name, parts.length - 1)) {
                return emitInput(source, lines, hint, tail);
            }
        }
        return emit(e, lines, hint, tail);
    }
    function emitInput(e: Expression, lines: string[], hint?: LoopTerm['type'], tail = false): LoopValue | undefined {
        if (!temporaryBudget(e)) return undefined;
        if (isNameExpression(e) && !e.name.includes('.')) {
            if (arrays.has(e.name)) return undefined;
            const type = localTypes.get(e.name) ?? (textSources.has(e.name) ? 'text' : hint ?? realInput(e.name) ?? 'integer');
            if (hint && type !== hint || type === 'boolean' && !host.booleanLocals) return undefined;
            localTypes.set(e.name, type);
            const index = slot(e.name);
            if (!assigned.has(e.name)) required.add(index);
            return { code: wide && type === 'integer' && !state.wideScalars.has(e.name) ? `BigInt(r${index})` : `r${index}`, type };
        }
        if (isApplicationExpression(e) && e.arguments.length === 1 && isNameExpression(e.arguments[0])) {
            const op = e.arguments[0].name;
            if (!numberMode && op === 'text' && host.scalarText) {
                const value = emit(e.head, lines);
                if (value?.type !== 'integer') return undefined;
                builtins.set(op, 'core');
                const name = `v${state.serial++}`;
                lines.push(`const ${name} = (${value.code}).toString();`);
                // Decimal integer rendering has one UTF-16 unit per code point.
                return { code: name, type: 'text', ascii: true };
            }
            if (op === 'len') {
                let array = isNameExpression(e.head) ? arrays.get(e.head.name) : undefined;
                // A range header is lowered before its body. Discover an input
                // array here even when its first indexed read comes later.
                if (!array && host.arrayReads && isNameExpression(e.head) && !e.head.name.includes('.')
                    && !localTypes.has(e.head.name) && !containers.has(e.head.name)) {
                    const value = host.read(e.head.name);
                    const kinds = value && isRankArray(value) ? storedScalarKinds(value) : undefined;
                    const type = kinds?.length === 0 ? 'integer' : kinds?.length === 1 ? kinds[0] : undefined;
                    if (value && isRankArray(value) && (type === 'integer' || type === 'real' && host.reals
                        || type === 'text' && host.textArrayLoops || type === 'boolean' && host.booleanArrays)) {
                        array = { slot: slot(e.head.name), rank: value.shape.length, type };
                        arrays.set(e.head.name, array);
                    }
                }
                if (array && isNameExpression(e.head)) {
                    if (!assigned.has(e.head.name)) arrayInputs.add(e.head.name);
                    builtins.set(op, 'core');
                    const length = `r${array.slot}.shape[0] ?? 0`;
                    return { code: numberMode ? safe(length) : `BigInt(${length})`, type: 'integer' };
                }
            }
            if (!numberMode && op === 'len' && host.scalarText) {
                if (host.nativeCalls && knownType(e.head) === 'bytes') {
                    const value = emit(e.head, lines, 'bytes');
                    if (!value) return undefined;
                    builtins.set(op, 'core');
                    return { code: `BigInt(${value.code}.shape[0])`, type: 'integer' };
                }
                const knownText = isStringLiteral(e.head) || isApplicationExpression(e.head)
                    || isParenthesizedExpression(e.head)
                    || isNameExpression(e.head) && (localTypes.get(e.head.name) === 'text' || textSources.has(e.head.name));
                if (knownText) {
                    const value = emit(e.head, lines);
                    if (value?.type !== 'text') return undefined;
                    builtins.set(op, 'core');
                    const name = `v${state.serial++}`;
                    lines.push(`const ${name} = BigInt(${value.ascii ? `(${value.code}).length` : `textLength(${value.code})`});`);
                    return { code: name, type: 'integer' };
                }
            }
            const builtin = inlineBuiltins.get(op);
            if (builtin && (host.module(builtin.module) || !host.scalarFunction(op, 1))
                && (builtin.enabled?.(host) ?? true) && flattenApplication(e).length === 2) {
                // Numeric-runtime helpers expect Number operands. Keep these
                // uncommon exact expressions on the existing exact backend.
                if (wide) return undefined;
                const value = emit(e.head, lines);
                const type = value && builtin.types[value.type];
                if (!value || !type) return undefined;
                builtins.set(op, builtin.module);
                const test = builtin.domain?.test(value.code, value.type);
                if (test) lines.push(`if (${test}) throw domain(${JSON.stringify(builtin.domain!.message)});`);
                const name = `v${state.serial++}`;
                lines.push(`const ${name} = ${builtin.code(value.code, value.type, numberMode)};`);
                return { code: name, type };
            }
            if (!numberMode && (op === 'len' || op === 'pop') && isNameExpression(e.head)) {
                const receiver = container(e.head.name, 'deque', op === 'pop');
                if (!receiver) return undefined;
                builtins.set(op, op === 'len' ? 'core' : 'algo');
                const name = `v${state.serial++}`;
                lines.push(`const ${name} = ${op === 'len' ? `BigInt(${receiver}.size)` : `${receiver}.pop()`};`);
                return { code: name, type: 'integer' };
            }
        }
        if (isApplicationExpression(e)) {
            const parts = flattenApplication(e), last = parts.at(-1);
            if (last && isNameExpression(last) && !last.name.includes('.')) {
                const operation = host.nativeCalls ? findOperation(last.name) : undefined;
                const signature = operation?.compiledCall;
                const prepareCallee = host.scalarFunction(last.name, parts.length - 1);
                // Prefer a known user function while its namesake module is unopened.
                // An unresolved name can still bind the builtin after a later import.
                if (operation && signature && signature.inputs.length === parts.length - 1
                    && (host.module(operation.module) || !prepareCallee)) {
                    return emitBuiltinCall(operation, parts.slice(0, -1), lines);
                }
                if (prepareCallee && !numberMode) {
                    const arguments_: string[] = [];
                    const types: CompiledCalleeType[] = [];
                    for (let part of parts.slice(0, -1)) {
                        while (isParenthesizedExpression(part)) part = part.value;
                        const existing = isNameExpression(part) ? arrays.get(part.name) : undefined;
                        const current = isNameExpression(part) && !localTypes.has(part.name) ? host.read(part.name) : undefined;
                        if (current && isNameExpression(part) && (current instanceof RankDeque
                            || isRankIndex(current) && current.entries instanceof ResourceMap
                            || isRankSet(current) && current.entries instanceof IntegerEntries && current.entries.integers)) {
                            const kind = current instanceof RankDeque ? 'deque' : isRankSet(current) ? 'set' : 'index';
                            const receiver = container(part.name, kind);
                            if (!receiver) return undefined;
                            containers.get(part.name)!.integers = true;
                            arguments_.push(receiver);
                            if (current instanceof RankDeque) {
                                containers.get(part.name)!.mode = current.mode;
                                types.push({ kind: 'deque', mode: current.mode });
                            } else types.push({ kind: isRankSet(current) ? 'set' : 'index' });
                            continue;
                        }
                        const type = existing ? { kind: 'array' as const, element: existing.type, rank: existing.rank }
                            : current === undefined ? undefined : compiledArgumentType(current);
                        if (type && typeof type !== 'string' && isNameExpression(part)) {
                            if (!host.arrayReads || type.element === 'real' || type.element === 'bytes'
                                || type.element === 'text' && !host.textArrayLoops
                                || type.element === 'boolean' && !host.booleanArrays) return undefined;
                            const info = existing ?? { slot: slot(part.name), rank: type.rank, type: type.element };
                            arrays.set(part.name, info);
                            calleeArrays.add(part.name);
                            if (!assigned.has(part.name)) arrayInputs.add(part.name);
                            arguments_.push(`r${info.slot}`);
                            types.push({ kind: 'array', element: type.element, rank: type.rank });
                        } else {
                            const value = emit(part, lines, knownType(part));
                            if (!value || value.type === 'bytes' || value.type === 'real' && !host.reals) return undefined;
                            arguments_.push(value.code);
                            types.push(value.type);
                        }
                    }
                    const callable = prepareCallee(types);
                    if (callable?.type === 'real' && !host.reals) return reject(e, 'unsupported-type:real');
                    if (callable) {
                        if (typeof callable.type !== 'string') {
                            if (!host.arrayLocals || callable.type.element === 'real'
                                || callable.type.element === 'boolean' && !host.booleanArrays
                                || callable.type.element === 'text' && !host.textArrayLoops) return undefined;
                            state.hasArrayCall = true;
                        }
                        const name = `v${state.serial++}`, index = calls.length;
                        // The proof fixes input domains and permitted mutations.
                        // Binding identity is rechecked at every region entry.
                        calls.push({ name: last.name, locals: callable.locals, stableArrayReads: callable.effects.stableArrayReads, bind: callable.bind });
                        lines.push(`const ${name} = calls[${index}]([${arguments_.join(',')}]${tail ? ', tailCallsAllowed' : ''});`);
                        return { code: name, type: callable.type };
                    }
                }
            }
        }
        if (isApplicationExpression(e)) {
            if (!host.arrayReads) return undefined;
            const [head, ...arguments_] = flattenApplication(e);
            if (!isNameExpression(head) || head.name.includes('.')) return undefined;
            const current = !localTypes.has(head.name) && !arrays.has(head.name) ? host.read(head.name) : undefined;
            if (!numberMode && current && isRankIndex(current) && current.entries instanceof IndexEntries) {
                if (hint && hint !== 'integer' || !arguments_.length) return undefined;
                const receiver = container(head.name, 'index', true);
                if (!receiver) return undefined;
                const keys: string[] = [];
                for (const argument of arguments_) {
                    const key = emit(argument, lines, 'integer');
                    if (key?.type !== 'integer') return undefined;
                    keys.push(key.code);
                }
                const name = `v${state.serial++}`;
                lines.push(`const ${name} = indexRead(${receiver}, key([${keys.join(',')}]));`);
                return { code: name, type: 'integer', selection: true };
            }
            if (!numberMode && host.nativeCalls && host.textLoops && knownType(head) === 'text') {
                if (arguments_.length !== 1) return undefined;
                const receiver = emit(head, lines, 'text'), index = emit(arguments_[0], lines, 'integer');
                if (!receiver || index?.type !== 'integer') return undefined;
                const name = `v${state.serial++}`;
                lines.push(`const ${name} = textRead(${receiver.code}, ${index.code});`);
                return { code: name, type: 'text' };
            }
            if (!numberMode && host.nativeCalls && knownType(head) === 'bytes') {
                if (arguments_.length !== 1) return undefined;
                const receiver = emit(head, lines, 'bytes'), index = emit(arguments_[0], lines, 'integer');
                if (!receiver || index?.type !== 'integer') return undefined;
                const name = `v${state.serial++}`;
                lines.push(`const ${name} = arrayRead(${receiver.code}, [${index.code}]);`);
                return { code: name, type: 'integer', selection: true };
            }
            const previous = arrays.get(head.name);
            const type = previous?.type ?? destinations.get(head.name)?.type ?? hint ?? realInput(head.name) ?? 'integer';
            if (type === 'text' && (!host.nativeCalls || !host.textArrayLoops) || type === 'bytes') return undefined;
            if (hint && hint !== type || type === 'boolean' && !host.booleanArrays) return undefined;
            if (previous && previous.rank !== arguments_.length
                || destinations.has(head.name) && destinations.get(head.name)!.rank !== arguments_.length) return undefined;
            const indices: string[] = [];
            for (const argument of arguments_) {
                const value = emit(argument, lines);
                if (value?.type !== 'integer') return undefined;
                indices.push(value.code);
            }
            const info = previous ?? { slot: slot(head.name), rank: indices.length, type };
            arrays.set(head.name, info);
            if (!assigned.has(head.name)) arrayInputs.add(head.name);
            const name = `v${state.serial++}`;
            if (state.numberMode) {
                const argument = arguments_[0];
                state.indexedReads.set(head.name, info.rank === 1 && !state.indexedReads.has(head.name) && isNameExpression(argument) ? argument.name : undefined);
                const offset = numberOffset(info, indices, lines);
                const cell = `cells${info.slot}[${offset}]`;
                const load = type === 'integer' ? wide ? `BigInt(${cell})` : `safe(Number(${cell}))`
                    : type === 'boolean' ? `Boolean(${cell})` : cell;
                lines.push(`const ${name} = ${load};`);
            } else {
                lines.push(`const ${name} = reader${info.slot}(${info.rank <= 2 ? indices.join(',') : `[${indices.join(',')}]`});`);
            }
            return { code: name, type, selection: true };
        }
        if (!isBinaryExpression(e) || e.step) return undefined;
        if (!numberMode && ['in', 'notin'].includes(e.operator) && isNameExpression(e.right)) {
            const name = e.right.name;
            const key = emit(e.left, lines);
            if (key?.type !== 'integer') return undefined;
            const negate = e.operator === 'notin' ? '!' : '';
            if (host.sequenceMembership && !localTypes.has(name) && !arrays.has(name)
                && compiledIntegerMembership(host.read(name))) {
                const index = calls.length;
                calls.push({ name, locals: [], stableArrayReads: true, bind: () => {
                    const domain = host.read(name);
                    if (domain && isRankArray(domain) && (destinations.size || calls.some(call => !call.stableArrayReads))) return undefined;
                    const contains = compiledIntegerMembership(domain);
                    return contains ? arguments_ => contains(arguments_[0] as bigint) : undefined;
                } });
                return { code: `${negate}calls[${index}]([${key.code}])`, type: 'boolean' };
            }
            if (isRankSet(host.read(name)!)) {
                const receiver = container(name, 'set');
                if (!receiver) return undefined;
                return { code: `${negate}setHas(${receiver}, ${key.code})`, type: 'boolean' };
            }
            const receiver = container(name, 'index');
            if (!receiver) return undefined;
            return { code: `${negate}indexHas(${receiver}, key([${key.code}]))`, type: 'boolean' };
        }
        if (isNameExpression(e.right) && ['reduce', 'scan', 'outer', 'segment'].includes(e.right.name)) return undefined;
        if (e.operator === '**') {
            let exponent = e.right;
            while (isParenthesizedExpression(exponent)) exponent = exponent.value;
            // Power binds before an unparenthesized sign, as in the evaluator.
            const signed = isUnaryExpression(e.left) && ['+', '-'].includes(e.left.operator) ? e.left : undefined;
            const base = emit(signed ? signed.operand : e.left, lines);
            if (!base) return undefined;
            // Publishing exact loops require nonnegative literals. Private
            // loops can guard computed exponents and replay negative ones.
            // Real powers have the evaluator's Number coercion and NaN check;
            // infinity is a valid result, and floor/ceil check it themselves.
            const exact = base.type === 'integer' && isNumberLiteral(exponent)
                && typeof exponent.value === 'bigint' && exponent.value >= 0n;
            const right = exact ? undefined : emit(e.right, lines);
            if (!exact && base.type === 'integer' && right?.type === 'integer' && (numberMode || wide)) {
                const name = `v${state.serial++}`;
                lines.push(`const ${name} = ${signed?.operator === '-' ? '-' : ''}${wide ? 'widePower' : 'power'}(${base.code}, ${right.code});`);
                return { code: name, type: 'integer' };
            }
            if (!exact && (!host.reals || !right || !loopOperatorSignature('**', [base.type, right.type], host.nativeCalls)
                || base.type === 'integer' && right.type === 'integer')) return undefined;
            const name = `v${state.serial++}`;
            const negative = signed?.operator === '-' ? '-' : '';
            if (exact && isNumberLiteral(exponent)) {
                const literal = exponent.value;
                // Keep trivial powers and squares inline; larger powers use
                // checked repeated squaring rather than approximate JS power.
                if (numberMode && literal > 2n) {
                    if (!Number.isSafeInteger(Number(literal))) return undefined;
                    lines.push(`const ${name} = ${negative}power(${base.code}, ${literal});`);
                    return { code: name, type: 'integer' };
                }
                const code = numberMode ? literal === 0n ? '1' : literal === 1n ? base.code : `(${base.code}) * (${base.code})`
                    : `(${base.code}) ** ${literal}n`;
                lines.push(`const ${name} = ${negative}(${safe(code)});`);
                return { code: name, type: 'integer' };
            }
            const power = arithmetic('**', base, right!, 'real', lines);
            if (power === undefined) return undefined;
            return { code: `${negative}(${power})`, type: 'real' };
        }
        return undefined;
    }
    return { container, slot, knownType, realInput, emit, emitValue, arithmetic, numberOffset };
}

export type LoopExpressions = ReturnType<typeof createLoopExpressions>;
