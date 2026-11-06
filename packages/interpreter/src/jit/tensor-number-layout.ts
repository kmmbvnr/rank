import type { CompiledAtomType } from '@arrrank/language';
import { booleanCells, filledArray, integer32Cells, typedArray } from '../array-storage.js';
import { currentDiagnostics } from '../diagnostics.js';
import { RankError } from '../errors.js';
import { prepareStoredScalarView } from '../integer-view.js';
import { privateLoopPolling, interruptsEnabled } from '../interrupt.js';
import { isRankArray, type RankArray, type RankValue } from '../value.js';
import type { TensorCodeCache, TensorNode } from './tensor-kernel.js';

const overflow = {};
const safe = (value: number): number => {
    if (!Number.isSafeInteger(value)) throw overflow;
    return value;
};
const divide = (a: number, b: number): number => {
    if (!b) throw overflow;
    const remainder = a % b;
    return safe(safe(safe(a - remainder) / b) - ((a < 0) !== (b < 0) && remainder !== 0 ? 1 : 0));
};
type Output = number | number[] | Int32Array | BigInt64Array | Uint32Array;
type Run = (data: ArrayLike<RankValue>[], scalars: (number | boolean)[], limits: number[],
    routes: ((index: number) => number)[], checks: ((cell: RankValue, index: number) => RankValue)[],
    count: number, indices: ArrayLike<number> | undefined, upper: number) => Output;
const caches = new WeakMap<TensorCodeCache, Map<string, Run>>();

/** Checked native recipes can traverse broadcast/view layouts directly.
 * The graph owner has already excluded opaque readers and non-replayable checks.
 * Numeric failures discard private output and resume the ordinary exact demand. */
export function prepareLayoutNumberTensor(root: TensorNode,
    domains: ReadonlyMap<TensorNode, readonly CompiledAtomType[]>, operation: 'sum' | 'positions' | 'copy' | 'indices',
    code: TensorCodeCache, valid: () => boolean, indices?: ArrayLike<number>, upper = 0, compiled?: (source: string) => void):
    (() => bigint | number[] | RankArray | undefined) | undefined {
    const type = domains.get(root)?.join();
    if (!privateLoopPolling() || interruptsEnabled() || (operation === 'positions' ? type !== 'boolean'
        : operation === 'sum' || operation === 'indices' ? type !== 'integer' : type !== 'integer' && type !== 'boolean')) return undefined;
    const data: ArrayLike<RankValue>[] = [], scalars: (number | boolean)[] = [], limits: number[] = [];
    const routes: ((index: number) => number)[] = [], checks: ((cell: RankValue, index: number) => RankValue)[] = [];
    const shapes = new Map<TensorNode, readonly number[]>(), slots = new Map<TensorNode, number>();
    const sizes = new Map<TensorNode, number>();
    const visiting = new Set<TensorNode>();
    let remaining = 1024;
    function size(node: TensorNode) {
        return shapes.get(node)!.reduce((a, b) => safe(a * b), 1);
    }
    function bind(node: TensorNode): boolean {
        if (shapes.has(node)) return true;
        if (--remaining < 0 || visiting.has(node) || !['integer', 'boolean'].includes(domains.get(node)?.join() ?? '')) return false;
        visiting.add(node);
        let shape: readonly number[] | undefined;
        if (node.kind === 'input') {
            if (typeof node.value === 'bigint' || typeof node.value === 'boolean') {
                const value = typeof node.value === 'bigint' ? safe(Number(node.value)) : node.value;
                slots.set(node, scalars.push(value) - 1); shape = [];
            } else if (node.value !== undefined && isRankArray(node.value)) {
                const cells = integer32Cells(node.value), stored = cells ? undefined : prepareStoredScalarView(node.value, true);
                // Bound eager conversion for speculative sums: wide inputs can
                // overflow after paying for a full copy. Small inputs and
                // compact Int32 sources retain the numeric path.
                if (!cells && (!stored || stored.validate || stored.linear?.offset !== 0 || stored.linear.stride !== 1
                    || stored.kinds?.join() !== domains.get(node)?.join())) return false;
                const items = cells ?? stored!.compact ?? stored!.items;
                if (operation === 'sum' && !cells && items.length > 64
                    && domains.get(node)?.join() === 'integer') return false;
                shape = [...node.value.shape];
                if (shape.some(n => !Number.isSafeInteger(n) || n < 0)
                    || shape.reduce((a, b) => safe(a * b), 1) !== items.length) return false;
                slots.set(node, data.push(items) - 1);
            }
        } else if (node.kind === 'unary' && ['+', '-', 'not'].includes(node.op) && bind(node.operand)) shape = shapes.get(node.operand);
        else if (node.kind === 'check' && bind(node.source)) {
            slots.set(node, checks.push(node.validate) - 1); shape = shapes.get(node.source);
        } else if (node.kind === 'view' && bind(node.source)) {
            slots.set(node, routes.push(node.offset) - 1); shape = node.shape;
        } else if (node.kind === 'binary' && (!node.native || node.native === 'min' || node.native === 'max') && !node.ranks
            && bind(node.left) && bind(node.right)) {
            const a = shapes.get(node.left)!, b = shapes.get(node.right)!, rank = Math.max(a.length, b.length);
            const result: number[] = [];
            for (let axis = 0; axis < rank; axis++) {
                const left = a[axis - rank + a.length] ?? 1, right = b[axis - rank + b.length] ?? 1;
                if (left !== right && left !== 1 && right !== 1) return false;
                result.push(left === 1 ? right : left);
            }
            shape = result;
        }
        else if (node.kind === 'select' && bind(node.source) && bind(node.selector)
            && shapes.get(node.source)!.length === 1 && domains.get(node.selector)?.join() === 'integer') shape = shapes.get(node.selector);
        if (!shape) return false;
        shapes.set(node, shape); sizes.set(node, limits.push(size(node)) - 1); visiting.delete(node);
        return true;
    }
    try { if (!bind(root) || !shapes.get(root)!.length) return undefined; }
    catch (error) { if (error !== overflow) throw error; return undefined; }
    const loads: { slot: number; at: string; name: string; line: number }[] = [];
    const lines: string[] = [], emitted = new Map<TensorNode, Map<string, string>>();
    let serial = 0;
    function offset(parent: TensorNode, child: TensorNode, at: string): string {
        const a = shapes.get(parent)!, b = shapes.get(child)!;
        if (!b.length || size(child) === 1) return '0';
        if (a.length === b.length && a.every((n, i) => n === b[i])) return at;
        let sourceStride = 1, targetStride = 1;
        const terms: string[] = [];
        for (let axis = a.length - 1; axis >= 0; axis--) {
            const dimension = b[axis - a.length + b.length] ?? 1;
            if (dimension !== 1) {
                const coordinate = targetStride === 1 ? at : `Math.floor((${at}) / ${targetStride})`;
                const clipped = axis ? `((${coordinate}) % ${a[axis]})` : coordinate;
                terms.push(sourceStride === 1 ? clipped : `(${clipped}) * ${sourceStride}`);
            }
            sourceStride *= dimension; targetStride *= a[axis];
        }
        return `(${terms.join(' + ') || '0'})`;
    }
    function emit(node: TensorNode, at: string): string | undefined {
        const prior = emitted.get(node)?.get(at);
        if (prior) return prior;
        const name = `value${serial++}`, type = domains.get(node)!.join();
        let value: string | undefined;
        if (node.kind === 'input') {
            if (!shapes.get(node)!.length) value = `scalars[${slots.get(node)}]`;
            else {
                lines.push(`if (${at} < 0 || ${at} >= limits[${sizes.get(node)}]) throw overflow;`);
                const read = `data[${slots.get(node)}][${at}]`;
                value = type === 'boolean' ? `Boolean(${read})` : `safe(Number(${read}))`;
            }
        } else if (node.kind === 'view') {
            const index = `index${serial++}`;
            lines.push(`const ${index} = safe(${node.linear ? `${node.linear.offset} + (${at}) * ${node.linear.stride}` : `routes[${slots.get(node)}](${at})`});`);
            value = emit(node.source, index);
        } else if (node.kind === 'check') {
            const source = emit(node.source, at);
            if (!source) return undefined;
            const checked = `checked${serial++}`, raw = type === 'integer' ? `BigInt(${source})` : source;
            lines.push(`${node.uniform ? `if (!validated[${slots.get(node)}]) {` : ''} const ${checked} = checks[${slots.get(node)}](${raw}, ${at});
                if (${checked} !== ${raw}) throw overflow; ${node.uniform ? `validated[${slots.get(node)}] = true; }` : ''}`);
            value = source;
        } else if (node.kind === 'select') {
            const key = emit(node.selector, at);
            if (!key) return undefined;
            const index = `index${serial++}`;
            lines.push(`const ${index} = safe(${key}); if (${index} < 0 || ${index} >= limits[${sizes.get(node.source)}]) throw overflow;`);
            value = emit(node.source, index);
        } else if (node.kind === 'unary') {
            const a = emit(node.operand, at);
            if (!a) return undefined;
            value = node.op === 'not' ? `!${a}` : `safe(${node.op}${a})`;
        } else if (node.kind === 'binary') {
            const a = emit(node.left, offset(node, node.left, at)), b = emit(node.right, offset(node, node.right, at));
            if (!a || !b) return undefined;
            if (['+', '-', '*'].includes(node.op)) value = `safe(${a} ${node.op} ${b})`;
            else if (node.op === '//') value = `divide(${a}, ${b})`;
            else if (node.op === 'mod') value = `remainder(${a}, ${b})`;
            else if (node.op === 'min' || node.op === 'max') value = `Math.${node.op}(${a}, ${b})`;
            else {
                const token = { and: '&&', or: '||', xor: '!==', equal: '===', notequal: '!==', less: '<', greater: '>', atmost: '<=', atleast: '>=' }[node.op];
                if (token) value = `${a} ${token} ${b}`;
            }
        }
        if (!value) return undefined;
        if (node.kind === 'input' && shapes.get(node)!.length && type === 'integer') loads.push({ slot: slots.get(node)!, at, name, line: lines.length });
        lines.push(`const ${name} = ${value};`);
        if (!emitted.has(node)) emitted.set(node, new Map());
        emitted.get(node)!.set(at, name);
        return name;
    }
    const result = emit(root, 'i');
    if (!result) return undefined;
    // A completed input can be unboxed once when the emitted traversal has
    // at least as many loads as input cells. Sparse reads keep their direct
    // exact loads. The numeric copy belongs only to this demand.
    const count = indices?.length ?? size(root), fast = new Set<number>();
    const conversions: { input: ArrayLike<RankValue>; output: Float64Array }[] = [];
    for (let slot = 0; slot < data.length; slot++) {
        const cells = data[slot];
        if (cells instanceof Int32Array) { fast.add(slot); continue; }
        const uses = loads.filter(load => load.slot === slot).length;
        if (!uses || count * uses < cells.length || typeof SharedArrayBuffer !== 'undefined'
            && ArrayBuffer.isView(cells) && cells.buffer instanceof SharedArrayBuffer) continue;
        const numeric = new Float64Array(cells.length);
        conversions.push({ input: cells, output: numeric });
        data[slot] = numeric; fast.add(slot);
    }
    for (const load of loads) if (fast.has(load.slot)) lines[load.line] = `const ${load.name} = data[${load.slot}][${load.at}];`;
    const source = `return function(data, scalars, limits, routes, checks, count, indices, upper) {
        const validated = [];
        let result = ${operation === 'sum' || operation === 'indices' ? '0' : operation === 'positions' ? '[]' : type === 'boolean' ? 'new Uint32Array(Math.ceil(count / 32))' : 'new Int32Array(count)'};
        for (let at = 0; at < count; at++) {
            const i = indices ? safe(indices[at]) : at;
            ${lines.join('\n')}
            ${operation === 'indices' ? `if (${result} < 0 || ${result} >= upper) throw overflow;` : operation === 'sum' ? `result = safe(result + ${result});` : operation === 'positions' ? `if (${result}) result.push(i);`
                : type === 'boolean' ? `if (${result}) result[at >>> 5] |= 1 << (at & 31);`
                : `if (result instanceof Int32Array && ${result} !== (${result} | 0)) result = widen(result);
                    result[at] = result instanceof Int32Array ? ${result} : BigInt(${result});`}
        }
        return result;
    }`;
    let cache = caches.get(code);
    if (!cache) caches.set(code, cache = new Map());
    let run = cache.get(source);
    if (!run) {
        try { run = new Function('safe', 'divide', 'remainder', 'widen', 'overflow', source)(safe, divide,
            (a: number, b: number) => { if (!b) throw overflow; const r = a % b; return r && (r < 0) !== (b < 0) ? safe(r + b) : r; },
            (cells: Int32Array) => { const wide = new BigInt64Array(cells.length); for (let i = 0; i < cells.length; i++) wide[i] = BigInt(cells[i]); return wide; }, overflow) as Run; } catch { return undefined; }
        if (cache.size >= 128) cache.delete(cache.keys().next().value!);
        cache.set(source, run);
        compiled?.(source);
    }
    return () => {
        if (!privateLoopPolling() || interruptsEnabled() || !valid()) return undefined;
        try {
            for (const { input, output } of conversions) {
                for (let at = 0; at < input.length; at++) output[at] = safe(Number(input[at]));
                const cost = currentDiagnostics()?.cost('number-tensor.read-buffer');
                if (cost) { cost.calls++; cost.allocatedBytes += output.byteLength; cost.unboxedCells += input.length; }
            }
            const value = run!(data, scalars, limits, routes, checks, indices?.length ?? size(root), indices, upper);
            if (operation === 'sum' || operation === 'indices') return BigInt(value as number);
            if (operation === 'positions') return value as number[];
            const shape = indices ? [indices.length] : [...shapes.get(root)!];
            if (type === 'integer') return typedArray(value as Int32Array | BigInt64Array, shape);
            const out = filledArray(false, shape); booleanCells(out)!.words.set(value as Uint32Array); return out;
        } catch (error) {
            if (error === overflow || error instanceof RankError) return undefined;
            throw error;
        }
    };
}
