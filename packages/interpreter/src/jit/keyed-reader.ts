import { RankError } from '../errors.js';
import { prepareIntegerView } from '../integer-view.js';
import { floorDivide, floorRemainder } from '../numeric-division.js';
import type { CompiledAtomType } from '@arrrank/language';
import type { TensorNode } from './tensor-ir.js';

interface Reader {
    readonly shape: readonly number[];
    read(index: number): bigint;
}
const size = (shape: readonly number[]) => shape.reduce((a, b) => a * b, 1);

/** Prepare pure native integer producers for an indexed consumer without buffers. */
export function keyedIntegerReader(root: TensorNode,
    domains: ReadonlyMap<TensorNode, readonly CompiledAtomType[]>): Reader | undefined {
    const known = new Map<TensorNode, Reader>();
    function lower(node: TensorNode): Reader | undefined {
        const cached = known.get(node);
        if (cached) return cached;
        if (domains.get(node)?.join() !== 'integer') return undefined;
        let result: Reader | undefined;
        if (node.kind === 'input') {
            result = typeof node.value === 'bigint' ? { shape: [], read: () => node.value as bigint }
                : node.value === undefined ? undefined : prepareIntegerView(node.value);
        } else if (node.kind === 'check') {
            const source = lower(node.source);
            if (source) result = { shape: source.shape, read: index => node.validate(source.read(index), index) as bigint };
        } else if (node.kind === 'view') {
            const source = lower(node.source);
            if (source) result = { shape: node.shape, read: index => source.read(node.offset(index)) };
        } else if (node.kind === 'unary' && (node.op === '+' || node.op === '-')) {
            const source = lower(node.operand);
            if (source) result = { shape: source.shape, read: index => node.op === '-' ? -source.read(index) : source.read(index) };
        } else if ((node.kind === 'outer' || node.kind === 'binary') && !('ranks' in node && node.ranks)
            && ['+', '-', '*', '//', 'mod', 'min', 'max'].includes(node.op)) {
            const left = lower(node.left), right = lower(node.right);
            if (!left || !right) return undefined;
            const combine = (a: bigint, b: bigint): bigint => {
                if ((node.op === '//' || node.op === 'mod') && b === 0n) {
                    throw new RankError('division by zero');
                }
                switch (node.op) {
                    case '+': return a + b;
                    case '-': return a - b;
                    case '*': return a * b;
                    case '//': return floorDivide(a, b);
                    case 'mod': return floorRemainder(a, b);
                    case 'min': return a < b ? a : b;
                    default: return a > b ? a : b;
                }
            };
            if (node.kind === 'outer') {
                const width = size(right.shape);
                result = { shape: [...left.shape, ...right.shape], read: index =>
                    combine(left.read(Math.floor(index / width)), right.read(index % width)) };
            } else {
                const rank = Math.max(left.shape.length, right.shape.length);
                const shape = Array.from({ length: rank }, (_, axis) => {
                    const a = left.shape[axis - rank + left.shape.length] ?? 1;
                    const b = right.shape[axis - rank + right.shape.length] ?? 1;
                    return a === 1 ? b : a;
                });
                const route = (input: Reader) => {
                    if (input.shape.length === 0) return () => 0;
                    if (input.shape.length === shape.length
                        && input.shape.every((length, axis) => length === shape[axis])) {
                        return (index: number) => index;
                    }
                    const strides = Array(rank).fill(0) as number[];
                    let stride = 1;
                    for (let axis = rank - 1; axis >= rank - input.shape.length; axis--) {
                        const length = input.shape[axis - rank + input.shape.length];
                        if (length !== 1) strides[axis] = stride;
                        stride *= length;
                    }
                    return (index: number): number => {
                        let offset = 0;
                        for (let axis = rank - 1; axis >= 0; axis--) {
                            offset += index % shape[axis] * strides[axis];
                            index = Math.floor(index / shape[axis]);
                        }
                        return offset;
                    };
                };
                const a = route(left), b = route(right);
                result = { shape, read: index => combine(left.read(a(index)), right.read(b(index))) };
            }
        }
        if (result) known.set(node, result);
        return result;
    }
    return lower(root);
}
