import { RankError } from '../errors.js';
import { prepareStoredScalarView } from './integer-view.js';
import { checkpoint, demandBudgetEnabled, inspectionEnabled, privateLoopPolling, InterruptedError } from '../interrupt.js';
import { collectArrayCells } from './array-read.js';
import { multiply, multiplyWide } from './modular-power.js';
import { integer32Cells, typedArray } from './owned-array.js';
import { isRankArray, type RankArray, type RankValue } from './value.js';

/** Largest modulus whose residues fit an Int32 cell. */
const MAX_MODULUS = 2 ** 31;

type Step = (acc: number, x: number) => number;

/** `+` and `*` on residues below `m`, with exact low-word multiplication. */
export function stepOf(op: '+' | '*', m: number): Step {
    if (op === '+') return (a, x) => { const s = a + x; return s >= m ? s - m : s; };
    if (m <= 2 ** 30) return (a, x) => multiply(a, x, m);
    return (a, x) => multiplyWide(a, x, m);
}

/** Cells reduced into [0, m), with their shape. */
export interface Residues { readonly cells: Int32Array; readonly shape: readonly number[] }

/** Residues of a constructor-proved finite arithmetic progression. */
export function rangeResidues(start: bigint, step: bigint, count: bigint, modulus: bigint): Residues | undefined {
    const m = modulusOf(modulus);
    if (m === undefined || count < 0n || count > 2n ** 31n) return undefined;
    const out = new Int32Array(Number(count));
    let r = Number((start % modulus + modulus) % modulus);
    const stride = Number((step % modulus + modulus) % modulus);
    for (let i = 0; i < out.length; i++) {
        out[i] = r;
        const next = r + stride;
        r = next >= m ? next - m : next;
    }
    return { cells: out, shape: [out.length] };
}

/** Array cells reduced into [0, m), or nothing if one is not a small integer. */
export function arrayResidues(value: RankArray, modulus: bigint): Residues | undefined {
    const m = modulusOf(modulus);
    if (m === undefined || value.columnNames) return undefined;
    const cells = residues(value, m);
    return cells && { cells, shape: value.shape };
}

function residues(value: RankArray, m: number): Int32Array | undefined {
    const stored = integer32Cells(value);
    const out = new Int32Array(value.shape.reduce((n, d) => n * d, 1));
    if (stored) {
        for (let i = 0; i < out.length; i++) { const r = stored[i] % m; out[i] = r < 0 ? r + m : r; }
        return out;
    }
    const items = collectArrayCells(value);
    for (let i = 0; i < out.length; i++) {
        const x = items[i];
        if (typeof x !== 'bigint') return undefined;
        const n = Number(x);
        if (!Number.isSafeInteger(n)) return undefined;
        const r = n % m;
        out[i] = r < 0 ? r + m : r;
    }
    return out;
}

function modulusOf(modulus: bigint): number | undefined {
    return modulus >= 1n && modulus <= BigInt(MAX_MODULUS) ? Number(modulus) : undefined;
}

function seedOf(seed: bigint, m: number): number {
    return Number(((seed % BigInt(m)) + BigInt(m)) % BigInt(m));
}

/** Prefix `+` or `*` along one axis with every step reduced modulo `modulus`,
 * so no partial result leaves the Int32 range. A seed grows the axis by one. */
export function modularScan(op: '+' | '*', source: Residues, axis: number, seed: bigint | undefined, modulus: bigint): RankArray | undefined {
    const m = modulusOf(modulus);
    const { cells, shape } = source;
    if (m === undefined || cells.length === 0 || axis < 0 || axis >= shape.length) return undefined;
    const length = shape[axis];
    const step = stepOf(op, m);
    let inner = 1;
    for (let d = axis + 1; d < shape.length; d++) inner *= shape[d];
    const outer = cells.length / (length * inner);
    const grow = seed === undefined ? 0 : 1;
    const outShape = shape.slice();
    outShape[axis] += grow;
    const out = new Int32Array(outer * (length + grow) * inner);
    const start = seed === undefined ? undefined : seedOf(seed, m);
    for (let block = 0; block < outer; block++) {
        checkpoint('scanning', length * inner);
        const from = block * length * inner;
        const to = block * (length + grow) * inner;
        if (start !== undefined) {
            for (let i = 0; i < inner; i++) out[to + i] = start;
            for (let at = 0; at < length * inner; at++) out[to + inner + at] = step(out[to + at], cells[from + at]);
        } else {
            for (let i = 0; i < inner; i++) out[to + i] = cells[from + i];
            for (let at = inner; at < length * inner; at++) out[to + at] = step(out[to + at - inner], cells[from + at]);
        }
    }
    return typedArray(out, outShape);
}

/** Fold every cell with `+` or `*`, reduced modulo `modulus` at each step. */
export function modularReduce(op: '+' | '*', source: Residues, seed: bigint | undefined, modulus: bigint): bigint | undefined {
    const m = modulusOf(modulus);
    const { cells } = source;
    if (m === undefined || cells.length === 0 && seed === undefined) return undefined;
    const step = stepOf(op, m);
    checkpoint('reducing', cells.length);
    let acc = seed === undefined ? cells[0] : seedOf(seed, m);
    for (let i = seed === undefined ? 1 : 0; i < cells.length; i++) acc = step(acc, cells[i]);
    return BigInt(acc);
}

/** Stored identity/linear views can skip boxed products just like their buffers.
 * Pure uniform contracts are validated once; opaque offsets stay ordinary. */
function storedInt32View(value: RankArray) {
    if (!privateLoopPolling() || demandBudgetEnabled() || inspectionEnabled()
        || value.columnNames || value.tableScopes || value.sortKeys
        || Object.getOwnPropertyDescriptor(value, 'itemAt')?.get
        || Object.getOwnPropertyDescriptor(value, 'shape')?.get) return undefined;
    const view = prepareStoredScalarView(value, true);
    if (!view?.compact || !view.linear || view.validate && !view.validateUniform
        || view.source.columnNames || view.source.tableScopes || view.source.sortKeys
        || typeof SharedArrayBuffer !== 'undefined' && view.compact.buffer instanceof SharedArrayBuffer) return undefined;
    return view;
}

export function hasStoredInt32View(value: RankArray): boolean {
    const view = storedInt32View(value);
    if (!view) return false;
    try {
        if (!value.shape.includes(0)) view.validateUniform?.(BigInt(view.compact![view.linear!.offset]));
        return true;
    } catch (error) {
        if (error instanceof InterruptedError) throw error;
        if (error instanceof RankError) return false;
        throw error;
    }
}

/** Preserve product-before-modulus evaluation when operands are not proved
 * inert. Matching stored integer arrays can defer the private product itself. */
export function fusedModularProduct(left: RankValue, right: RankValue, modulus: () => RankValue,
    binary: (operator: string, a: RankValue, b: RankValue) => RankValue): RankValue {
    if (isRankArray(left) && isRankArray(right)
        && hasStoredInt32View(left) && hasStoredInt32View(right)
        && left.shape.length === right.shape.length && left.shape.every((n, axis) => n === right.shape[axis])) {
        const m = modulus();
        return (typeof m === 'bigint' ? modularProduct(left, right, m) : undefined)
            ?? binary('mod', binary('*', left, right), m);
    }
    const product = binary('*', left, right);
    return binary('mod', product, modulus());
}

/** `A * B mod M` for equal-shape integer arrays and M up to 2^31: each product is
 * reduced as it forms, so no cell leaves the Int32 range. */
export function modularProduct(a: RankArray, b: RankArray, modulus: bigint): RankArray | undefined {
    const m = modulusOf(modulus);
    if (m === undefined || a.shape.length !== b.shape.length || a.shape.some((n, i) => n !== b.shape[i])) return undefined;
    const product = m <= 2 ** 30 ? multiply : multiplyWide;
    // Stable Int32 inputs need only the result buffer. Reduce cells in place
    // in the arithmetic expression, rather than allocating two residue copies.
    const left = storedInt32View(a), right = storedInt32View(b);
    if (left && right) {
        const count = a.shape.reduce((n, d) => n * d, 1);
        if (count) {
            left.validateUniform?.(BigInt(left.compact![left.linear!.offset]));
            right.validateUniform?.(BigInt(right.compact![right.linear!.offset]));
        }
        checkpoint('computing integer array', count);
        const out = new Int32Array(count);
        for (let i = 0; i < out.length; i++) {
            const x = left.compact![left.linear!.offset + i * left.linear!.stride] % m;
            const y = right.compact![right.linear!.offset + i * right.linear!.stride] % m;
            out[i] = product(x < 0 ? x + m : x, y < 0 ? y + m : y, m);
        }
        return typedArray(out, a.shape);
    }
    const x = arrayResidues(a, modulus), y = arrayResidues(b, modulus);
    if (!x || !y) return undefined;
    checkpoint('computing integer array', x.cells.length);
    const out = new Int32Array(x.cells.length);
    for (let i = 0; i < out.length; i++) out[i] = product(x.cells[i], y.cells[i], m);
    return typedArray(out, x.shape);
}

/** Dense modular keyed folds over trusted Int32 cells. Scratch space stays
 * proportional to the input; sparse key domains retain the ordinary fold. */
export function modularKeyed(kind: 'reduce' | 'scan', op: '+' | '*', source: RankArray,
    keys: RankArray, seed: bigint | undefined, size: bigint | undefined, modulus: bigint): RankArray | undefined {
    if (!privateLoopPolling() || demandBudgetEnabled() || inspectionEnabled()) return undefined;
    const m = modulusOf(modulus);
    const values = integer32Cells(source), indices = integer32Cells(keys);
    if (m === undefined || m > 2 ** 30 || !values || !indices
        || source.shape.length !== keys.shape.length || source.shape.some((n, i) => n !== keys.shape[i])
        || source.columnNames || source.tableScopes || source.sortKeys
        || keys.columnNames || keys.tableScopes || keys.sortKeys) return undefined;
    if (typeof SharedArrayBuffer !== 'undefined'
        && (values.buffer instanceof SharedArrayBuffer || indices.buffer instanceof SharedArrayBuffer)) return undefined;
    const count = values.length;
    let length = size === undefined ? 0 : Number(size);
    if (!Number.isSafeInteger(length) || length < 0 || length >= 0xffffffff) return undefined;
    for (let start = 0; start < count; start += 4096) {
        const end = Math.min(count, start + 4096);
        checkpoint('modular keyed fold', end - start);
        for (let i = start; i < end; i++) {
            const key = indices[i];
            if (key < 0 || size !== undefined && key >= length) return undefined;
            if (size === undefined) length = Math.max(length, key + 1);
        }
    }
    // In particular a sparse scan need not allocate every intervening group.
    if (length > 2 * count + 4096) return undefined;
    const initial = seed === undefined ? op === '+' ? 0 : 1 % m : seedOf(seed, m);
    checkpoint('modular keyed fold', length);
    const states = new Int32Array(length).fill(initial);
    const out = kind === 'scan' ? new Int32Array(count) : states;
    const step = stepOf(op, m);
    for (let start = 0; start < count; start += 4096) {
        const end = Math.min(count, start + 4096);
        checkpoint('modular keyed fold', end - start);
        for (let i = start; i < end; i++) {
            const key = indices[i], residue = values[i] % m;
            const next = step(states[key], residue < 0 ? residue + m : residue);
            states[key] = next;
            if (kind === 'scan') out[i] = next;
        }
    }
    return typedArray(out, kind === 'scan' ? source.shape : [length]);
}
