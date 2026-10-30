import { checkpoint } from '../interrupt.js';
import { collectArrayCells } from './array-read.js';
import { integer32Cells, typedArray } from './owned-array.js';
import type { RankArray } from './value.js';

/** Largest modulus whose residues fit an Int32 cell. */
const MAX_MODULUS = 2 ** 31;
/** Residues below this multiply exactly in a double. */
const EXACT_PRODUCT = 2 ** 26;

type Step = (acc: number, x: number) => number;

/** `+` and `*` on residues below `m`; the wide product is split in 16-bit halves. */
function stepOf(op: '+' | '*', m: number): Step {
    if (op === '+') return (a, x) => { const s = a + x; return s >= m ? s - m : s; };
    if (m <= EXACT_PRODUCT) return (a, x) => (a * x) % m;
    return (a, x) => ((a * (x >>> 16)) % m * 65536 + a * (x & 65535)) % m;
}

/** Cells reduced into [0, m), with their shape. */
export interface Residues { readonly cells: Int32Array; readonly shape: readonly number[] }

/** The integers `start` to `end` of an arithmetic range, reduced into [0, m). */
export function rangeResidues(start: bigint, end: bigint, inclusive: boolean, modulus: bigint): Residues | undefined {
    const m = modulusOf(modulus);
    const count = end - start + (inclusive ? 1n : 0n);
    if (m === undefined || count < 0n || count > 2n ** 31n || !Number.isSafeInteger(Number(start)) || !Number.isSafeInteger(Number(end))) return undefined;
    const first = Number(start);
    const out = new Int32Array(Number(count));
    let r = first % m;
    if (r < 0) r += m;
    for (let i = 0; i < out.length; i++) { out[i] = r; r = r + 1 === m ? 0 : r + 1; }
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
