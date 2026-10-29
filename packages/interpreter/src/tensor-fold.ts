import { DENSE_MIN_CELLS } from './tensor-operands.js';
import { prepareStoredScalarView } from './integer-view.js';
import { reduceTensorMap } from './tensor-map.js';
import { inlineTensorEmitter } from './tensor-inline.js';
import type { TensorNode } from './tensor-ir.js';
import { checkpoint } from './interrupt.js';
import {
    isBinaryExpression, isNameExpression, isNumberLiteral, isParenthesizedExpression,
    isUnaryExpression, type Expression,
} from '@arrrank/language';
import { numericKernel } from './numeric-kernels.js';
import { eagerArrayStorage } from './array-storage.js';
import { expectNumeric } from './modules/shared.js';
import { isRankArray, type RankValue } from './value.js';

type Operation = (left: RankValue, right: RankValue) => RankValue;
type Reader = (index: number) => RankValue;
type Instruction = { readonly read: () => RankValue } | {
    readonly operator: string;
    readonly left: number;
    readonly right: number;
    readonly operation: Operation;
};

interface ArithmeticContext {
    readonly compilation?: () => boolean;
    readonly tensorBinary?: (operator: string, left: RankValue, right: RankValue) => RankValue;
    readonly prepareLeaf: (expression: Expression) => (() => RankValue) | undefined;
    readonly binary: (operator: string, left: RankValue, right: RankValue) => RankValue;
}

interface Context extends ArithmeticContext {
    readonly reduce: (value: RankValue) => RankValue;
}

/** Only inline arithmetic is transient. Named arrays retain their own readers/caches. */
export function compileFusedReduction(
    source: Expression,
    reducer: string,
    context: Context,
): (() => RankValue) | undefined {
    if (!['+', '-', '*'].includes(reducer)) return undefined;
    const reduce = numericKernel(reducer, (a, b) => context.binary(reducer, a, b));
    return compileArithmeticFold(source, context, (result, read, size) => {
        if (isRankArray(result)) {
            const native = reduceTensorMap(result, `reduce${reducer}`);
            if (native !== undefined) return native;
        }
        if (!read || size === 0) return context.reduce(result);
        let accumulated = read(0);
        for (let index = 1; index < size; index += 1) {
            checkpoint('reducing array');
            accumulated = reduce(accumulated, read(index));
        }
        return accumulated;
    });
}

export function compileFusedSum<T>(
    source: Expression,
    context: ArithmeticContext,
    consume: (value: RankValue, sum: (() => RankValue) | undefined) => T,
): (() => T) | undefined {
    return compileArithmeticFold(source, context, (value, read, size) => consume(value, read ? () => {
        if (isRankArray(value)) {
            const native = reduceTensorMap(value, 'sum');
            if (native !== undefined) return native;
        }
        let total: bigint | number = 0n;
        let invalid: unknown;
        for (let index = 0; index < size; index += 1) {
            checkpoint('reducing array');
            // Sum validates only after the ordinary arithmetic array is forced.
            const item = read(index);
            if (invalid !== undefined) continue;
            try {
                const numeric = expectNumeric(item);
                total = typeof total === 'bigint' && typeof numeric === 'bigint'
                    ? total + numeric : Number(total) + Number(numeric);
            } catch (error) { invalid = error; }
        }
        if (invalid !== undefined) throw invalid;
        return total;
    } : undefined));
}

function compileArithmeticFold<T>(
    source: Expression,
    context: ArithmeticContext,
    finish: (value: RankValue, read: Reader | undefined, size: number) => T,
): (() => T) | undefined {
    const instructions: Instruction[] = [];
    const visit = (expression: Expression): number | undefined => {
        if (isParenthesizedExpression(expression)) return visit(expression.value);
        if (isBinaryExpression(expression) && ['+', '-', '*'].includes(expression.operator)
            && !expression.step) {
            // These spellings are modifiers, not ordinary name operands.
            if (isNameExpression(expression.right)
                && ['reduce', 'scan', 'outer'].includes(expression.right.name)) return undefined;
            const left = visit(expression.left);
            const right = visit(expression.right);
            if (left === undefined || right === undefined) return undefined;
            const operator = expression.operator;
            instructions.push({ operator, left, right,
                operation: numericKernel(operator, (a, b) => context.binary(operator, a, b)) });
        } else if (isNameExpression(expression) || isNumberLiteral(expression)
            || (isUnaryExpression(expression) && ['+', '-'].includes(expression.operator)
                && isNumberLiteral(expression.operand))) {
            const read = context.prepareLeaf(expression);
            if (!read) return undefined;
            instructions.push({ read });
        } else return undefined;
        return instructions.length - 1;
    };
    const root = visit(source);
    if (root === undefined || 'read' in instructions[root]) return undefined;

    const operations = instructions.map(instruction => 'operation' in instruction ? instruction.operation : undefined) as Operation[];
    const readerCache = new Map<string, ((readers: Reader[], operations: Operation[]) => Reader) | null>();
    return () => {
        const values: RankValue[] = [];
        const readers: Reader[] = [];
        let eligible = true;
        for (let slot = 0; slot < instructions.length; slot += 1) {
            checkpoint('reducing array');
            const instruction = instructions[slot];
            if ('read' in instruction) {
                const value = instruction.read();
                values.push(value);
                if (typeof value === 'bigint' || typeof value === 'number') {
                    readers[slot] = () => value;
                } else {
                    const storage = eagerArrayStorage(value);
                    if (!storage) eligible = false;
                    if (eligible) readers[slot] = storage!.read;
                }
                continue;
            }
            const left = values[instruction.left];
            const right = values[instruction.right];
            // Build the ordinary lazy values first: scalar errors, name reads and
            // shape validation must occur in exactly the original tree order.
            // Native graph setup pays off for large integer folds. Small folds
            // and stored real arithmetic retain the inline/dense path instead.
            const native = context.tensorBinary && context.compilation?.() !== false
                && [left, right].some(value => isRankArray(value) && value.shape.reduce((a, b) => a * b, 1) >= DENSE_MIN_CELLS)
                && [left, right].every(value => typeof value === 'bigint'
                    || isRankArray(value) && prepareStoredScalarView(value, true)?.kinds?.join() === 'integer');
            const value = (native ? context.tensorBinary! : context.binary)(instruction.operator, left, right);
            values.push(value);
            // A rejected leaf may be a lazy Rank value; retain its ordinary path.
            if (!eligible) continue;
            if (isRankArray(value)) {
                if (isRankArray(left) && isRankArray(right)
                    && (left.shape.length !== right.shape.length
                        || left.shape.some((dimension, axis) => dimension !== right.shape[axis]))) {
                    // Broadcasting can revisit an intermediate cached index.
                    eligible = false;
                }
            } else readers[slot] = () => value;
        }
        const result = values[root];
        if (!eligible || !isRankArray(result) || context.compilation?.() === false) return finish(result, undefined, 0);
        const size = result.shape.reduce((product, dimension) => product * dimension, 1);
        const key = values.map((value, slot) => isRankArray(value) ? 'read' in instructions[slot] ? 'a' : 'b' : 's').join('');
        let factory = readerCache.get(key);
        if (factory === undefined) {
            const nodes: TensorNode[] = [];
            const inputs = new Map<TensorNode, number>();
            const operationSlots: number[] = [];
            for (let slot = 0; slot < instructions.length; slot++) {
                const instruction = instructions[slot];
                if ('read' in instruction || !isRankArray(values[slot])) {
                    const node: TensorNode = { kind: 'input' };
                    inputs.set(node, slot);
                    nodes.push(node);
                } else {
                    nodes.push({ kind: 'binary', op: instruction.operator, left: nodes[instruction.left], right: nodes[instruction.right] });
                    operationSlots.push(slot);
                }
            }
            const lines: string[] = [], body: string[] = [];
            let serial = 0;
            const emit = inlineTensorEmitter(lines, {
                variable: () => `v${serial++}`,
                input: node => {
                    const slot = inputs.get(node)!;
                    return { size: isRankArray(values[slot]) ? 'size' : undefined, read: index => `readers[${slot}](${index})` };
                },
                element: () => 'integer', // The operation adapter owns dynamic numeric dispatch.
                locate: () => {},
                binary: (_op, left, right, output) => {
                    const name = `v${serial++}`;
                    const slot = operationSlots[emittedOperations++];
                    output.push(`const ${name} = operations[${slot}](${left}, ${right});`);
                    return name;
                },
            });
            // The instruction and emitter orders are both left-to-right postorder.
            let emittedOperations = 0;
            const value = emit(nodes[root]).read('index', body);
            try { factory = new Function('readers', 'operations', `${lines.join('\n')} return index => { ${body.join('\n')} return ${value}; };`) as (readers: Reader[], operations: Operation[]) => Reader; }
            catch { factory = null; }
            if (readerCache.size >= 16) readerCache.delete(readerCache.keys().next().value!);
            readerCache.set(key, factory);
        }
        return finish(result, factory ? factory(readers, operations) : undefined, size);
    };
}
