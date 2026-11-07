import { isBinaryExpression, isNameExpression, isNumberLiteral, isParenthesizedExpression, isUnaryExpression, type Expression } from '@arrrank/language';
import { denseScalarItems, integer32Cells, integer64Cells, storedScalarKinds } from './array-storage.js';
import { checkpoint, privateLoopPolling, demandBudgetEnabled, inspectionEnabled } from './interrupt.js';
import { currentDiagnostics } from './diagnostics.js';
import type { RankArray, RankValue } from './value.js';

type Node = { readonly name: string } | { readonly value: bigint } | {
    readonly operator: string; readonly left: number; readonly right: number;
};
const LOW = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1 ? 0 : 1;
const WORD = 4294967296;

function arithmetic(operator: string, left: number, right: number): number | undefined {
    let value: number;
    switch (operator) {
        case '+': value = left + right; break;
        case '-': value = left - right; break;
        case '*': value = left * right; break;
        default:
            // Below 2^52 the rounded quotient cannot cross an integer boundary.
            // Larger numerators and zero retain ordinary exact/error behavior.
            if (right === 0 || Math.abs(left) >= 2 ** 52) return undefined;
            value = Math.floor(left / right);
    }
    return Number.isSafeInteger(value) ? value : undefined;
}

/** Only completed owned storage can be inspected ahead of expression evaluation.
 * Foreign getters, plans and contract views retain their ordinary path. */
function ready(value: RankValue | undefined): { shape: readonly number[]; read(index: number): number } | undefined {
    if (typeof value !== 'object' || value === null) return undefined;
    const array = value as RankArray, items = denseScalarItems(array);
    if (!items || Object.getOwnPropertyDescriptor(array, 'itemAt')
        || Object.getOwnPropertyDescriptor(array, 'kind')?.value !== 'array') return undefined;
    const shape = Object.getOwnPropertyDescriptor(array, 'shape')?.value as readonly number[] | undefined;
    if (!Array.isArray(shape)) return undefined;
    const compact = integer32Cells(array);
    if (compact) return compact.buffer instanceof ArrayBuffer ? { shape, read: index => compact[index] } : undefined;
    const wide = integer64Cells(array);
    if (wide) {
        if (!(wide.buffer instanceof ArrayBuffer)) return undefined;
        const words = new Int32Array(wide.buffer, wide.byteOffset, wide.length * 2);
        return { shape, read: index => words[2 * index + 1 - LOW] * WORD + (words[2 * index + LOW] >>> 0) };
    }
    if (!Array.isArray(items) || storedScalarKinds(array)?.join() !== 'integer') return undefined;
    return { shape, read: index => Number(items[index]) };
}

/** A native interpreter for transient integer arithmetic feeding sum. No code
 * is generated and no named binding is crossed or intermediate array retained.
 * Any failed proof returns to ordinary eager evaluation before publishing. */
export function prepareNativeIntegerSum(source: Expression, lookup: (name: string) => RankValue | undefined): (() => bigint | undefined) | undefined {
    const nodes: Node[] = [], names = new Map<string, number>();
    const visit = (expression: Expression): number | undefined => {
        if (isParenthesizedExpression(expression)) return visit(expression.value);
        if (isNameExpression(expression)) {
            const old = names.get(expression.name);
            if (old !== undefined) return old;
            names.set(expression.name, nodes.length);
            nodes.push({ name: expression.name });
        } else if (isNumberLiteral(expression) && typeof expression.value === 'bigint') {
            nodes.push({ value: expression.value });
        } else if (isUnaryExpression(expression) && ['+', '-'].includes(expression.operator)
            && isNumberLiteral(expression.operand) && typeof expression.operand.value === 'bigint') {
            nodes.push({ value: expression.operator === '-' ? -expression.operand.value : expression.operand.value });
        } else if (isBinaryExpression(expression) && ['+', '-', '*', '//'].includes(expression.operator) && !expression.step) {
            const left = visit(expression.left), right = visit(expression.right);
            if (left === undefined || right === undefined) return undefined;
            nodes.push({ operator: expression.operator, left, right });
        } else return undefined;
        return nodes.length - 1;
    };
    const root = visit(source);
    if (root === undefined || !('operator' in nodes[root])) return undefined;
    return () => {
        if (!privateLoopPolling() || demandBudgetEnabled() || inspectionEnabled()) return undefined;
        const registers = new Float64Array(nodes.length), vectors: boolean[] = [];
        const inputs: { slot: number; read(index: number): number }[] = [], operations: number[] = [];
        let shape: readonly number[] | undefined;
        for (let slot = 0; slot < nodes.length; slot++) {
            const node = nodes[slot];
            if ('operator' in node) {
                vectors[slot] = vectors[node.left] || vectors[node.right];
                if (vectors[slot]) operations.push(slot);
                else {
                    const value = arithmetic(node.operator, registers[node.left], registers[node.right]);
                    if (value === undefined) return undefined;
                    registers[slot] = value;
                }
                continue;
            }
            const value = 'value' in node ? node.value : lookup(node.name);
            if (typeof value === 'bigint') {
                const number = Number(value);
                if (!Number.isSafeInteger(number)) return undefined;
                registers[slot] = number;
                vectors[slot] = false;
            } else {
                const array = ready(value);
                if (!array || shape && (shape.length !== array.shape.length || shape.some((n, axis) => n !== array.shape[axis]))) return undefined;
                shape = array.shape;
                vectors[slot] = true;
                inputs.push({ slot, read: array.read });
            }
        }
        if (!shape || !vectors[root]) return undefined;
        const size = shape.reduce((n, dimension) => n * dimension, 1);
        let total = 0n, subtotal = 0;
        for (let start = 0; start < size; start += 4096) {
            const end = Math.min(size, start + 4096);
            checkpoint('summing integer expression', end - start);
            for (let index = start; index < end; index++) {
                for (const input of inputs) {
                    const value = input.read(index);
                    if (!Number.isSafeInteger(value)) return undefined;
                    registers[input.slot] = value;
                }
                for (const slot of operations) {
                    const node = nodes[slot] as Extract<Node, { operator: string }>;
                    const value = arithmetic(node.operator, registers[node.left], registers[node.right]);
                    if (value === undefined) return undefined;
                    registers[slot] = value;
                }
                const value = registers[root], next = subtotal + value;
                if (Number.isSafeInteger(next)) subtotal = next;
                else { total += BigInt(subtotal); subtotal = value; }
            }
        }
        const diagnostics = currentDiagnostics();
        if (diagnostics) { diagnostics.nativeIntegerSums++; diagnostics.nativeIntegerSumCells += size; }
        return total + BigInt(subtotal);
    };
}
