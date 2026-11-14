import { declineCompiler, compilerSource, observeCompilerSource, observedSourceRun } from '../compiler-observation.js';
import { checkedIntegerSumStep } from './tensor-reduction-codegen.js';
import { arithmeticRange, arrayRange } from '../range-plan.js';
import { safeIntegerSquareRoot } from '../integer-square-root.js';
import type { CompiledAtomType } from '@arrrank/language';
import { integer32Cells } from '../array-storage.js';
import { prepareStoredScalarView } from '../integer-view.js';
import { checkpoint, privateLoopPolling, interruptsEnabled } from '../interrupt.js';
import type { TensorCodeCache, TensorNode } from './tensor-kernel.js';
import { isRankArray, isRankSequence } from '../value.js';
import type { RankValue } from '../value.js';

const overflow = {}, zeroDivisor = {}, negativeRoot = {};
const LOW = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1 ? 0 : 1;
function safe(value: number): number {
    if (!Number.isSafeInteger(value)) throw overflow;
    return value;
}
function divide(a: number, b: number): number {
    if (!b) throw zeroDivisor;
    const remainder = a % b;
    return safe(safe(safe(a - remainder) / b) - ((a < 0) !== (b < 0) && remainder !== 0 ? 1 : 0));
}
type Cells = ArrayLike<number | bigint>;
type Check = (cell: RankValue, index: number) => RankValue;
type Run = (data: Cells[], scalars: (number | boolean)[], size: number, indices: ArrayLike<number> | undefined, checks: Check[]) => bigint | number | number[];
const caches = new WeakMap<TensorCodeCache, Map<string, Run>>();

/** Private, checked Number registers for integer/boolean native recipes. Only
 * completed integer leaves and uniform scalar-kind checks qualify; those checks
 * run at their first actual cell. Other readers/callbacks retain exact demand.
 * Overflow discards private consumer state before the ordinary exact demand. */
export function prepareNumberTensor(root: TensorNode, domains: ReadonlyMap<TensorNode, readonly CompiledAtomType[]>,
    operation: 'sum' | 'positions', code: TensorCodeCache, valid: () => boolean,
    indices?: ArrayLike<number>, compiled?: (source: string) => void): (() => bigint | number[] | undefined) | undefined {
    const sourceSite = compilerSource();
    const provenTypes = { result: domains.get(root)?.join(' | ') ?? 'unknown' };
    const candidate = observeCompilerSource(sourceSite, 'number-tensor', 'prepare', () => prepareNumberTensorObservedImplementation(root, domains, operation, code, valid, indices, compiled), provenTypes);
    return candidate && observedSourceRun(sourceSite, 'number-tensor', candidate, provenTypes);
}

function prepareNumberTensorObservedImplementation(root: TensorNode, domains: ReadonlyMap<TensorNode, readonly CompiledAtomType[]>,
    operation: 'sum' | 'positions', code: TensorCodeCache, valid: () => boolean,
    indices?: ArrayLike<number>, compiled?: (source: string) => void): (() => bigint | number[] | undefined) | undefined {
    const expected = operation === 'sum' ? 'integer' : 'boolean';
    if (!privateLoopPolling()) return declineCompiler('observable-polling');
    if (domains.get(root)?.join() !== expected) return declineCompiler('result-domain-guard');
    const data: Cells[] = [], scalars: (number | boolean)[] = [], lines: string[] = [];
    const checks: Check[] = [];
    const emitted = new Map<TensorNode, { name: string; type: string }>();
    const bounds = new Map<TensorNode, readonly [bigint, bigint]>();
    const checked = (value: string, range: readonly [bigint, bigint] | undefined) => range
        && range[0] >= -9007199254740991n && range[1] <= 9007199254740991n ? value : `safe(${value})`;
    let size: number | undefined;
    function emit(node: TensorNode): { name: string; type: string } | undefined {
        const known = emitted.get(node);
        if (known) return known;
        const type = domains.get(node)?.join();
        if (type !== 'integer' && type !== 'boolean') return declineCompiler('operand-domain-guard');
        const name = `v${emitted.size}`;
        // Reserve before walking children, preserving unique names and DAG sharing.
        const result = { name, type };
        emitted.set(node, result);
        let value: string, range: readonly [bigint, bigint] | undefined;
        if (node.kind === 'input') {
            if (typeof node.value === 'bigint') {
                const value = Number(node.value);
                if (!Number.isSafeInteger(value)) return declineCompiler('integer-exactness-guard');
                lines.push(`const ${name} = scalars[${scalars.push(value) - 1}];`);
                bounds.set(node, [node.value, node.value]);
                return result;
            }
            if (typeof node.value === 'boolean') {
                lines.push(`const ${name} = scalars[${scalars.push(node.value) - 1}];`);
                return result;
            }
            if (node.value !== undefined && isRankSequence(node.value)) {
                const progression = arithmeticRange(node.value.plan, true);
                if (!progression || progression.count < 0n || progression.count > 9007199254740991n) return undefined;
                const count = Number(progression.count);
                if (size !== undefined && size !== count) return declineCompiler('input-shape-guard');
                size = count;
                const last = progression.start + (progression.count > 0n ? progression.count - 1n : 0n) * progression.step;
                const product = (progression.count > 0n ? progression.count - 1n : 0n) * progression.step;
                if ([progression.start, progression.step, last, product].some(value => value < -9007199254740991n || value > 9007199254740991n)) return undefined;
                const start = scalars.push(Number(progression.start)) - 1;
                const step = scalars.push(Number(progression.step)) - 1;
                lines.push(`const ${name} = scalars[${start}] + i * scalars[${step}];`);
                bounds.set(node, progression.start <= last ? [progression.start, last] : [last, progression.start]);
                return result;
            }
            if (node.value === undefined || !isRankArray(node.value) || node.value.shape.length !== 1) return declineCompiler('vector-input-required');
            const cells = integer32Cells(node.value);
            const stored = cells ? undefined : prepareStoredScalarView(node.value, true);
            if (!cells && (!stored || stored.validate || stored.kinds?.join() !== 'integer'
                || stored.linear?.offset !== 0 || stored.linear.stride !== 1)) return declineCompiler('linear-integer-storage-required');
            const items = cells ?? stored!.items as Cells;
            if (items.length !== node.value.shape[0]) return declineCompiler('storage-size-guard');
            if (size !== undefined && size !== items.length) return declineCompiler('input-shape-guard');
            size = items.length;
            if (items instanceof BigInt64Array && items.buffer instanceof ArrayBuffer) {
                // A numeric register needs no allocated BigInt load or buffer copy.
                const words = new Int32Array(items.buffer, items.byteOffset, items.length * 2);
                const slot = data.push(words) - 1;
                value = `safe(data[${slot}][i * 2 + ${1 - LOW}] * 4294967296 + (data[${slot}][i * 2 + ${LOW}] >>> 0))`;
            } else {
                const read = `data[${data.push(items) - 1}][i]`;
                value = cells ? read : `safe(Number(${read}))`;
            }
            const progression = arrayRange(node.value);
            if (progression && progression.count > 0n) {
                const last = progression.start + (progression.count - 1n) * progression.step;
                range = progression.start <= last ? [progression.start, last] : [last, progression.start];
            } else if (cells) range = [-2147483648n, 2147483647n];
        } else if (node.kind === 'select' && node === root && domains.get(node.selector)?.join() === 'boolean') {
            const mask = emit(node.selector);
            if (!mask) return undefined;
            lines.push(`if (!${mask.name}) continue;`);
            const source = emit(node.source);
            if (!source) return undefined;
            value = source.name; range = bounds.get(node.source);
        } else if (node.kind === 'check' && node.uniform) {
            const a = emit(node.source);
            if (!a) return undefined;
            const slot = checks.push(node.validate) - 1;
            lines.push(`if (!checked[${slot}]) { checks[${slot}](${a.type === 'integer' ? `BigInt(${a.name})` : a.name}, i); checked[${slot}] = true; }`);
            value = a.name; range = bounds.get(node.source);
        } else if (node.kind === 'call' && (node.intrinsic === 'isqrt' || node.intrinsic === 'integer')) {
            const a = emit(node.source);
            if (!a) return undefined;
            if (node.intrinsic === 'isqrt' && a.type !== 'integer') return declineCompiler('isqrt-integer-required');
            value = node.intrinsic === 'isqrt' ? `isqrt(${a.name})` : a.type === 'boolean' ? `(${a.name} ? 1 : 0)` : a.name;
            const input = bounds.get(node.source);
            if (node.intrinsic === 'integer') range = a.type === 'boolean' ? [0n, 1n] : input;
            else if (input && input[0] >= 0n && input[1] <= 9007199254740991n) range =
                [BigInt(safeIntegerSquareRoot(Number(input[0]))), BigInt(safeIntegerSquareRoot(Number(input[1])))];
        } else if (node.kind === 'unary') {
            const a = emit(node.operand);
            if (!a) return undefined;
            if (node.op === 'not' && a.type === 'boolean') value = `!${a.name}`;
            else if ((node.op === '+' || node.op === '-') && a.type === 'integer') {
                value = `${node.op}${a.name}`;
                const input = bounds.get(node.operand);
                range = input && (node.op === '-' ? [-input[1], -input[0]] : input);
            }
            else return declineCompiler('operator-domain-guard');
        } else if (node.kind === 'binary' && (!node.native || node.native === 'min' || node.native === 'max') && !node.ranks) {
            const a = emit(node.left), b = emit(node.right);
            if (!a || !b) return undefined;
            if (a.type === 'integer' && b.type === 'integer') {
                const x = bounds.get(node.left), y = bounds.get(node.right);
                if (x && y) {
                    if (node.op === '+') range = [x[0] + y[0], x[1] + y[1]];
                    if (node.op === '-') range = [x[0] - y[1], x[1] - y[0]];
                    if (node.op === '*') {
                        const products = [x[0] * y[0], x[0] * y[1], x[1] * y[0], x[1] * y[1]];
                        range = [products.reduce((a, b) => a < b ? a : b), products.reduce((a, b) => a > b ? a : b)];
                    }
                    if (node.op === 'min') range = [x[0] < y[0] ? x[0] : y[0], x[1] < y[1] ? x[1] : y[1]];
                    if (node.op === 'max') range = [x[0] > y[0] ? x[0] : y[0], x[1] > y[1] ? x[1] : y[1]];
                }
                if (['+', '-', '*'].includes(node.op)) value = checked(`${a.name} ${node.op} ${b.name}`, range);
                else if (node.op === 'min' || node.op === 'max') value = `Math.${node.op}(${a.name}, ${b.name})`;
                else if (node.op === '//') value = `divide(${a.name}, ${b.name})`;
                else if (node.op === 'mod') value = `remainder(${a.name}, ${b.name})`;
                else {
                    const op = { equal: '===', notequal: '!==', less: '<', greater: '>', atmost: '<=', atleast: '>=' }[node.op];
                    if (!op) return declineCompiler(`unsupported-operator:${node.op}`);
                    value = `${a.name} ${op} ${b.name}`;
                }
            } else if (a.type === 'boolean' && b.type === 'boolean') {
                const op = { and: '&&', or: '||', xor: '!==', equal: '===', notequal: '!==' }[node.op];
                if (!op) return declineCompiler(`unsupported-operator:${node.op}`);
                value = `${a.name} ${op} ${b.name}`;
            } else return declineCompiler('operator-domain-guard');
        } else return declineCompiler(`unsupported-ir:${node.kind}`);
        // Forget unsafe intervals: repeated squaring must not grow giant
        // BigInts during preparation of a path that will replay exactly.
        if (range && range[0] >= -9007199254740991n && range[1] <= 9007199254740991n) bounds.set(node, range);
        lines.push(`const ${name} = ${value};`);
        return result;
    }
    const result = emit(root);
    if (!result) return undefined;
    if (size === undefined) return declineCompiler('array-input-required');
    const interruptible = interruptsEnabled();
    const source = `return function(data, scalars, size, indices, checks) {
        const checked = [];
        ${operation === 'sum' ? 'let total = 0n;' : ''}
        let result = ${operation === 'sum' ? '0' : '[]'};
        const count = indices ? indices.length : size;
        for (let at = 0; at < count; at++) {
            ${interruptible ? "if ((at & 4095) === 0) checkpoint('computing tensor', Math.min(4096, count - at));" : ''}
            const i = indices ? indices[at] : at;
            ${lines.join('\n')}
            ${operation === 'sum' ? checkedIntegerSumStep(result.name) : `if (${result.name}) result.push(i);`}
        }
        return ${operation === 'sum' ? 'total + BigInt(result)' : 'result'};
    }`;
    let cache = caches.get(code);
    if (!cache) caches.set(code, cache = new Map());
    let run = cache.get(source);
    if (!run) {
        try {
            run = new Function('safe', 'divide', 'remainder', 'checkpoint', 'isqrt', source)(safe, divide,
                (a: number, b: number) => {
                    if (!b) throw zeroDivisor;
                    const r = a % b;
                    return r !== 0 && (r < 0) !== (b < 0) ? safe(r + b) : r;
                }, checkpoint, (value: number) => { if (value < 0) throw negativeRoot; return safeIntegerSquareRoot(value); }) as Run;
        } catch { return declineCompiler('dynamic-code-unavailable'); }
        if (cache.size < 128) cache.set(source, run);
        compiled?.(source);
    }
    return () => {
        if (!privateLoopPolling()) return declineCompiler('observable-polling');
        if (interruptsEnabled() !== interruptible) return declineCompiler('interrupt-mode-changed');
        if (!valid()) return declineCompiler('input-revision-guard');
        try {
            const value = run(data, scalars, size!, indices, checks);
            return typeof value === 'number' ? BigInt(value) : value;
        } catch (error) {
            if (error === overflow) return declineCompiler('integer-exactness-guard');
            if (error === zeroDivisor) return declineCompiler('zero-divisor-guard');
            if (error === negativeRoot) return declineCompiler('negative-root-guard');
            throw error;
        }
    };
}
