import type { CompiledAtomType } from '@arrrank/language';
import { integer32Cells } from './array-storage.js';
import { prepareStoredScalarView } from './integer-view.js';
import { checkpoint, privateLoopPolling } from './interrupt.js';
import type { TensorCodeCache, TensorNode } from './tensor-kernel.js';
import { isRankArray } from './value.js';
import type { RankValue } from './value.js';

const overflow = {};
function safe(value: number): number {
    if (!Number.isSafeInteger(value)) throw overflow;
    return value;
}
function divide(a: number, b: number): number {
    if (!b) throw overflow;
    const remainder = a % b;
    return safe(safe(safe(a - remainder) / b) - ((a < 0) !== (b < 0) && remainder !== 0 ? 1 : 0));
}
type Cells = ArrayLike<number | bigint>;
type Check = (cell: RankValue, index: number) => RankValue;
type Run = (data: Cells[], scalars: (number | boolean)[], size: number, indices: readonly number[] | undefined, checks: Check[]) => number | number[];
const caches = new WeakMap<TensorCodeCache, Map<string, Run>>();

/** Private, checked Number registers for integer/boolean native recipes. Only
 * completed integer leaves and uniform scalar-kind checks qualify; those checks
 * run at their first actual cell. Other readers/callbacks retain exact demand.
 * Overflow discards private consumer state before the ordinary exact demand. */
export function prepareNumberTensor(root: TensorNode, domains: ReadonlyMap<TensorNode, readonly CompiledAtomType[]>,
    operation: 'sum' | 'positions', code: TensorCodeCache, valid: () => boolean,
    indices?: readonly number[]): (() => bigint | number[] | undefined) | undefined {
    const expected = operation === 'sum' ? 'integer' : 'boolean';
    if (!privateLoopPolling() || domains.get(root)?.join() !== expected) return undefined;
    const data: Cells[] = [], scalars: (number | boolean)[] = [], lines: string[] = [];
    const checks: Check[] = [];
    const emitted = new Map<TensorNode, { name: string; type: string }>();
    let size: number | undefined;
    function emit(node: TensorNode): { name: string; type: string } | undefined {
        const known = emitted.get(node);
        if (known) return known;
        const type = domains.get(node)?.join();
        if (type !== 'integer' && type !== 'boolean') return undefined;
        const name = `v${emitted.size}`;
        // Reserve before walking children, preserving unique names and DAG sharing.
        const result = { name, type };
        emitted.set(node, result);
        let value: string;
        if (node.kind === 'input') {
            if (typeof node.value === 'bigint') {
                const value = Number(node.value);
                if (!Number.isSafeInteger(value)) return undefined;
                lines.push(`const ${name} = scalars[${scalars.push(value) - 1}];`);
                return result;
            }
            if (typeof node.value === 'boolean') {
                lines.push(`const ${name} = scalars[${scalars.push(node.value) - 1}];`);
                return result;
            }
            if (node.value === undefined || !isRankArray(node.value) || node.value.shape.length !== 1) return undefined;
            const cells = integer32Cells(node.value);
            const stored = cells ? undefined : prepareStoredScalarView(node.value, true);
            if (!cells && (!stored || stored.validate || stored.kinds?.join() !== 'integer'
                || stored.linear?.offset !== 0 || stored.linear.stride !== 1)) return undefined;
            const items = cells ?? stored!.items as Cells;
            if (items.length !== node.value.shape[0]) return undefined;
            if (size !== undefined && size !== items.length) return undefined;
            size = items.length;
            const read = `data[${data.push(items) - 1}][i]`;
            value = cells ? read : `safe(Number(${read}))`;
        } else if (node.kind === 'check' && node.uniform) {
            const a = emit(node.source);
            if (!a) return undefined;
            const slot = checks.push(node.validate) - 1;
            lines.push(`if (!checked[${slot}]) { checks[${slot}](${a.type === 'integer' ? `BigInt(${a.name})` : a.name}, i); checked[${slot}] = true; }`);
            value = a.name;
        } else if (node.kind === 'unary') {
            const a = emit(node.operand);
            if (!a) return undefined;
            if (node.op === 'not' && a.type === 'boolean') value = `!${a.name}`;
            else if ((node.op === '+' || node.op === '-') && a.type === 'integer') value = `${node.op}${a.name}`;
            else return undefined;
        } else if (node.kind === 'binary' && !node.native && !node.ranks) {
            const a = emit(node.left), b = emit(node.right);
            if (!a || !b) return undefined;
            if (a.type === 'integer' && b.type === 'integer') {
                if (['+', '-', '*'].includes(node.op)) value = `safe(${a.name} ${node.op} ${b.name})`;
                else if (node.op === '//') value = `divide(${a.name}, ${b.name})`;
                else if (node.op === 'mod') value = `remainder(${a.name}, ${b.name})`;
                else {
                    const op = { equal: '===', notequal: '!==', less: '<', greater: '>', atmost: '<=', atleast: '>=' }[node.op];
                    if (!op) return undefined;
                    value = `${a.name} ${op} ${b.name}`;
                }
            } else if (a.type === 'boolean' && b.type === 'boolean') {
                const op = { and: '&&', or: '||', xor: '!==', equal: '===', notequal: '!==' }[node.op];
                if (!op) return undefined;
                value = `${a.name} ${op} ${b.name}`;
            } else return undefined;
        } else return undefined;
        lines.push(`const ${name} = ${value};`);
        return result;
    }
    const result = emit(root);
    if (!result || size === undefined) return undefined;
    const source = `return function(data, scalars, size, indices, checks) {
        const checked = [];
        let result = ${operation === 'sum' ? '0' : '[]'};
        const count = indices ? indices.length : size;
        for (let at = 0; at < count; at++) {
            if ((at & 4095) === 0) checkpoint('consuming integer tensor', Math.min(4096, count - at));
            const i = indices ? indices[at] : at;
            ${lines.join('\n')}
            ${operation === 'sum' ? `result = safe(result + ${result.name});` : `if (${result.name}) result.push(i);`}
        }
        return result;
    }`;
    let cache = caches.get(code);
    if (!cache) caches.set(code, cache = new Map());
    let run = cache.get(source);
    if (!run) {
        run = new Function('safe', 'divide', 'remainder', 'checkpoint', source)(safe, divide,
            (a: number, b: number) => {
                if (!b) throw overflow;
                const r = a % b;
                return r !== 0 && (r < 0) !== (b < 0) ? safe(r + b) : r;
            }, checkpoint) as Run;
        if (cache.size < 128) cache.set(source, run);
    }
    return () => {
        if (!privateLoopPolling() || !valid()) return undefined;
        try {
            const value = run(data, scalars, size!, indices, checks);
            return typeof value === 'number' ? BigInt(value) : value;
        } catch (error) {
            if (error === overflow) return undefined;
            throw error;
        }
    };
}
