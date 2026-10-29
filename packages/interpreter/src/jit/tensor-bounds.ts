import { findCompiledOperator } from '@arrrank/language';
import { binaryOperatorSource } from './operator-codegen.js';
import { ownedStorage, noteMutation } from '../array-storage-state.js';
import { hasPendingSelections, isSharedArray, typedArray } from '../array-storage.js';
import { currentDiagnostics } from '../diagnostics.js';
import { interruptsEnabled, privateLoopPolling } from '../interrupt.js';
import { isRankArray, type RankArray, type RankValue } from '../value.js';
import type { TensorCodeCache, TensorKernelHost, TensorNode } from './tensor-kernel.js';

type Cells = Float64Array | Int32Array | BigInt64Array;
type Run = (data: Cells[], scalars: (number | bigint)[], size: number, answer: Cells) => void;
const codeCaches = new WeakMap<TensorCodeCache, Map<string, Run>>();
type Bounds = { low: number; high: number; integer: false }
    | { low: bigint; high: bigint; integer: true };
const INT32_MIN = -2147483648n, INT32_MAX = 2147483647n;
const INT64_MIN = -(1n << 63n), INT64_MAX = (1n << 63n) - 1n;
const SAFE_MIN = BigInt(Number.MIN_SAFE_INTEGER), SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER);
interface Evidence { revision: number; cells: Cells; bounds: Bounds }
const evidence = new WeakMap<RankArray, Evidence>();
const finite = (bounds: Bounds) => bounds.integer || Number.isFinite(bounds.low) && Number.isFinite(bounds.high);
const safeInteger = (bounds: Bounds) => !bounds.integer || bounds.low >= SAFE_MIN && bounds.high <= SAFE_MAX;

function inputBounds(array: RankArray, cells: Cells): Bounds | undefined {
    const state = ownedStorage.get(array)!;
    const cached = evidence.get(array);
    if (cached?.revision === state.revision && cached.cells === cells) return cached.bounds;
    const diagnostics = currentDiagnostics();
    if (diagnostics) {
        diagnostics.tensorRangeScans++;
        diagnostics.tensorRangeScannedCells += cells.length;
    }
    let bounds: Bounds;
    if (cells instanceof BigInt64Array) {
        let low = INT64_MAX, high = INT64_MIN;
        for (let i = 0; i < cells.length; i++) {
            const value = cells[i];
            if (value < low) low = value;
            if (value > high) high = value;
        }
        bounds = { low, high, integer: true };
    } else {
        let low = Infinity, high = -Infinity;
        for (let i = 0; i < cells.length; i++) {
            const value = cells[i];
            if (!Number.isFinite(value)) return undefined;
            if (value < low) low = value;
            if (value > high) high = value;
        }
        bounds = cells instanceof Int32Array ? { low: BigInt(low), high: BigInt(high), integer: true }
            : { low, high, integer: false };
    }
    evidence.set(array, { revision: state.revision, cells, bounds });
    return bounds;
}

/** Prove every intermediate before writing any cell. Bounds survive only while
 * the same tracked storage revision survives. Completed output carries its new
 * bounds, so iterative updates need no repeated scan of the destination.
 * Opaque readers, selections and non-pointwise shapes retain the general kernel. */
export function prepareBoundedTensor(root: TensorNode, host: TensorKernelHost, destinationName?: string, code?: TensorCodeCache) {
    const nodes: TensorNode[] = [];
    const slots = new Map<TensorNode, number>();
    function visit(node: TensorNode): boolean {
        if (slots.has(node)) return true;
        if (node.kind === 'binary' && !node.native && !node.ranks && ['+', '-', '*', '/'].includes(node.op)) {
            if (!visit(node.left) || !visit(node.right)) return false;
        } else if (node.kind === 'unary' && ['+', '-'].includes(node.op)) {
            if (!visit(node.operand)) return false;
        } else if (node.kind !== 'input') return false;
        slots.set(node, nodes.length);
        nodes.push(node);
        return true;
    }
    if (!visit(root) || root.kind === 'input') return undefined;
    let shared = code && codeCaches.get(code);
    if (code && !shared) codeCaches.set(code, shared = new Map());
    const variants = new Map<string, { run: Run; source: string }>();
    let source = '';
    return { get source() { return source; }, run(): RankArray | undefined {
        // No speculative visible writes when interruption or demand callbacks
        // can observe partial progress. The general kernel owns those contracts.
        if (interruptsEnabled() || !privateLoopPolling()) return undefined;
        const ranges: Bounds[] = [], data: Cells[] = [], scalars: (number | bigint)[] = [];
        const inputs = new Map<TensorNode, { slot: number; value: RankValue; cells?: Cells; revision?: number }>();
        let shape: readonly number[] | undefined, size = 0;
        let destination: RankArray | undefined;
        let numberExact = true;
        for (const node of nodes) {
            let bounds: Bounds;
            if (node.kind === 'input') {
                const value = node.name === undefined ? node.value : host.lookup(node.name);
                if (typeof value === 'number' || typeof value === 'bigint') {
                    bounds = typeof value === 'bigint' ? { low: value, high: value, integer: true }
                        : { low: value, high: value, integer: false };
                    if (!finite(bounds)) return undefined;
                    inputs.set(node, { slot: scalars.push(value) - 1, value });
                } else {
                    if (!value || !isRankArray(value) || value.itemAt !== undefined || value.columnNames
                        || value.tableScopes || value.sortKeys) return undefined;
                    const state = ownedStorage.get(value);
                    const cells = state?.typed;
                    if (!state?.stable || state.validity || !cells
                        || typeof SharedArrayBuffer !== 'undefined' && cells.buffer instanceof SharedArrayBuffer) return undefined;
                    if (shape && (shape.length !== value.shape.length || shape.some((n, i) => n !== value.shape[i]))) return undefined;
                    if (!value.shape.every(n => Number.isSafeInteger(n) && n >= 0)) return undefined;
                    shape = value.shape;
                    size = shape.reduce((a, b) => a * b, 1);
                    if (size === 0 || size !== cells.length) return undefined;
                    const found = inputBounds(value, cells);
                    if (!found) return undefined;
                    bounds = found;
                    inputs.set(node, { slot: data.push(cells) - 1, value, cells, revision: state.revision });
                    if (node.name === destinationName) destination = value;
                }
            } else if (node.kind === 'unary') {
                const a = ranges[slots.get(node.operand)!];
                numberExact &&= safeInteger(a);
                bounds = node.op === '-' ? a.integer ? { low: -a.high, high: -a.low, integer: true }
                    : { low: -a.high, high: -a.low, integer: false } : a;
            } else if (node.kind === 'binary') {
                const a = ranges[slots.get(node.left)!], b = ranges[slots.get(node.right)!];
                if (node.op !== '/' && a.integer && b.integer) {
                    numberExact &&= safeInteger(a) && safeInteger(b);
                    if (node.op === '+') bounds = { low: a.low + b.low, high: a.high + b.high, integer: true };
                    else if (node.op === '-') bounds = { low: a.low - b.high, high: a.high - b.low, integer: true };
                    else {
                        const endpoints = [a.low * b.low, a.low * b.high, a.high * b.low, a.high * b.high];
                        bounds = { low: endpoints.reduce((x, y) => x < y ? x : y),
                            high: endpoints.reduce((x, y) => x > y ? x : y), integer: true };
                    }
                } else {
                    const al = Number(a.low), ah = Number(a.high), bl = Number(b.low), bh = Number(b.high);
                    if (node.op === '+') bounds = { low: al + bl, high: ah + bh, integer: false };
                    else if (node.op === '-') bounds = { low: al - bh, high: ah - bl, integer: false };
                    else {
                        if (node.op === '/' && bl <= 0 && bh >= 0) return undefined;
                        const endpoints = node.op === '*'
                            ? [al * bl, al * bh, ah * bl, ah * bh]
                            : [al / bl, al / bh, ah / bl, ah / bh];
                        bounds = { low: Math.min(...endpoints), high: Math.max(...endpoints), integer: false };
                    }
                }
            } else return undefined;
            if (!finite(bounds)) return undefined;
            if (node.kind !== 'input') numberExact &&= safeInteger(bounds);
            ranges.push(bounds);
        }
        if (!shape || host.valid?.() === false) return undefined;
        const result = ranges[slots.get(root)!];
        const allSafe = ranges.every(safeInteger);
        // Mixed arithmetic needs exact Number registers for integer subtrees.
        // An all-integer tree can instead keep arbitrary precision registers.
        if (!result.integer && !numberExact) return undefined;
        if (result.integer && (result.low < INT64_MIN || result.high > INT64_MAX)) return undefined;
        const state = destination && ownedStorage.get(destination);
        const int32 = result.integer && result.low >= INT32_MIN && result.high <= INT32_MAX;
        const reuse = destination && state?.owners === 1 && !state.readOnlyCells
            && !isSharedArray(destination) && !hasPendingSelections(destination)
            && (result.integer ? state.typed instanceof BigInt64Array || int32 && state.typed instanceof Int32Array
                : state.typed instanceof Float64Array);
        // Fresh small integer results stay boxed; an existing typed destination
        // may still be reused, matching IntegerCells in the general emitter.
        if (result.integer && size < 4096 && !reuse) return undefined;
        const kind = reuse ? state!.typed instanceof Float64Array ? 'float64'
            : state!.typed instanceof Int32Array ? 'int32' : 'int64'
            : result.integer ? int32 ? 'int32' : 'int64' : 'float64';
        // BigInt64 loads/stores stay in BigInt registers: converting every
        // cell through Number is slower than direct BigInt arithmetic in V8.
        const integerRegisters = result.integer && (kind === 'int64' || !allSafe);
        const backing = (cells: Cells) => cells instanceof Float64Array ? 'float64' : cells instanceof Int32Array ? 'int32' : 'int64';
        const key = [...inputs.values()].map(input => input.cells ? backing(input.cells) : `scalar:${typeof scalars[input.slot]}`).join(',') + ':' + kind + ':' + integerRegisters;
        let variant = variants.get(key);
        if (!variant) {
            const prelude: string[] = [], lines: string[] = [];
            for (const node of nodes) {
                const at = slots.get(node)!;
                const name = `v${at}`;
                const input = inputs.get(node);
                if (input) {
                    if (input.cells) {
                        prelude.push(`const data${input.slot} = data[${input.slot}];`);
                        const read = `data${input.slot}[i]`;
                        lines.push(`const ${name} = ${integerRegisters
                            ? input.cells instanceof BigInt64Array ? read : `BigInt(${read})`
                            : input.cells instanceof BigInt64Array ? `Number(${read})` : read};`);
                    } else prelude.push(`const ${name} = scalars[${input.slot}];`);
                } else {
                    const expression = node.kind === 'binary' ? binaryOperatorSource(findCompiledOperator(node.op)!,
                        `v${slots.get(node.left)}`, `v${slots.get(node.right)}`)
                        : node.kind === 'unary' ? `${node.op === '+' ? '' : '-'}v${slots.get(node.operand)}` : '';
                    // Integer zero has no sign. A Number register must discard
                    // -0 before that integer subtree is promoted to real.
                    const normalized = !result.integer && ranges[at].integer ? `(${expression}) || 0` : expression;
                    lines.push(`const ${name} = ${normalized};`);
                }
            }
            const value = `v${slots.get(root)}`;
            lines.push(`answer[i] = ${integerRegisters && kind === 'int32' ? `Number(${value})` : value};`);
            source = `"use strict"; /* ${data.map(backing).join(',')} */ /* bounded tensor */ return function(data, scalars, size, answer) {
${prelude.join('\n')}
for (let i = 0; i < size; i++) {
${lines.join('\n')}
}};`;
            let run = shared?.get(source);
            const compiled = !run;
            if (!run) {
                try { run = new Function(source)() as Run; }
                catch { return undefined; }
                if (shared) {
                    if (shared.size >= 32) shared.delete(shared.keys().next().value!);
                    shared.set(source, run);
                }
            }
            variant = { run, source };
            if (variants.size >= 32) variants.delete(variants.keys().next().value!);
            variants.set(key, variant);
            if (compiled && host.compiled) {
                host.compiled(source);
                // Observers may expose/box storage or retain an alias. A proof
                // obtained before the callback must not authorize later writes.
                for (const [node, input] of inputs) {
                    if (node.kind === 'input' && node.name !== undefined && !Object.is(host.lookup(node.name), input.value)) return undefined;
                    if (input.cells) {
                        const current = ownedStorage.get(input.value as RankArray);
                        if (!current?.stable || current.typed !== input.cells || current.revision !== input.revision) return undefined;
                    }
                }
                if (reuse && (state!.owners !== 1 || state!.readOnlyCells || isSharedArray(destination!)
                    || hasPendingSelections(destination!))) return undefined;
                if (host.valid?.() === false) return undefined;
            }
        }
        source = variant.source;
        const answer = reuse ? state!.typed! : kind === 'float64' ? new Float64Array(size)
            : kind === 'int32' ? new Int32Array(size) : new BigInt64Array(size);
        variant.run(data, integerRegisters ? scalars.map(BigInt) : scalars.map(Number), size, answer);
        if (reuse) {
            state!.revision = noteMutation(state!.birth);
            const diagnostics = currentDiagnostics();
            if (diagnostics) {
                diagnostics.reusedTensorBuffers++;
                diagnostics.reusedTensorBufferCells += size;
            }
        }
        const array = typedArray(answer, shape, undefined, result.integer ? 'integer' : 'real');
        evidence.set(array, { revision: ownedStorage.get(array)!.revision, cells: answer, bounds: result });
        return array;
    } };
}
