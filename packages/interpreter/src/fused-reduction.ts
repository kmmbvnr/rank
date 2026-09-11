import {
    isBinaryExpression, isNameExpression, isNumberLiteral, isParenthesizedExpression,
    isUnaryExpression, type Expression,
} from 'rank-language';
import { numericKernel } from './numeric-kernels.js';
import { isRankArray, type RankValue } from './value.js';

type Operation = (left: RankValue, right: RankValue) => RankValue;
type Reader = (index: number) => RankValue;
type Instruction = { readonly read: () => RankValue } | {
    readonly operator: string;
    readonly left: number;
    readonly right: number;
    readonly operation: Operation;
};

interface Context {
    readonly prepareLeaf: (expression: Expression) => () => RankValue;
    readonly binary: (operator: string, left: RankValue, right: RankValue) => RankValue;
    readonly reduce: (value: RankValue) => RankValue;
}

/** Only inline arithmetic is transient. Named arrays retain their own readers/caches. */
export function compileFusedReduction(
    source: Expression,
    reducer: string,
    context: Context,
): (() => RankValue) | undefined {
    if (!['+', '-', '*'].includes(reducer)) return undefined;
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
            instructions.push({ read: context.prepareLeaf(expression) });
        } else return undefined;
        return instructions.length - 1;
    };
    const root = visit(source);
    if (root === undefined || 'read' in instructions[root]) return undefined;
    const reduce = numericKernel(reducer, (a, b) => context.binary(reducer, a, b));

    return () => {
        const values: RankValue[] = [];
        const readers: Reader[] = [];
        let eligible = true;
        for (let slot = 0; slot < instructions.length; slot += 1) {
            const instruction = instructions[slot];
            if ('read' in instruction) {
                const value = instruction.read();
                values.push(value);
                if (isRankArray(value)) {
                    // Do not probe a lazy reader or force its items while deciding.
                    const items = Object.getOwnPropertyDescriptor(value, 'items');
                    if ('itemAt' in value || !items || !Array.isArray(items.value)) eligible = false;
                    readers.push(index => value.itemAt?.(index) ?? value.items[index]);
                } else {
                    if (typeof value !== 'bigint' && typeof value !== 'number') eligible = false;
                    readers.push(() => value);
                }
                continue;
            }
            const left = values[instruction.left];
            const right = values[instruction.right];
            // Build the ordinary lazy values first: scalar errors, name reads and
            // shape validation must occur in exactly the original tree order.
            const value = context.binary(instruction.operator, left, right);
            values.push(value);
            if (isRankArray(value)) {
                if (isRankArray(left) && isRankArray(right)
                    && (left.shape.length !== right.shape.length
                        || left.shape.some((dimension, axis) => dimension !== right.shape[axis]))) {
                    // Broadcasting can revisit an intermediate cached index.
                    eligible = false;
                }
                const readLeft = readers[instruction.left];
                const readRight = readers[instruction.right];
                // Read the left operand before entering the right subtree, even
                // when host array elements have observable getters.
                readers.push(index => instruction.operation(readLeft(index), readRight(index)));
            } else readers.push(() => value);
        }
        const result = values[root];
        if (!eligible || !isRankArray(result)) return context.reduce(result);
        const size = result.shape.reduce((product, dimension) => product * dimension, 1);
        if (size === 0) return context.reduce(result);
        let accumulated: RankValue = 0n;
        for (let index = 0; index < size; index += 1) {
            const value = readers[root](index);
            accumulated = index === 0 ? value : reduce(accumulated, value);
        }
        return accumulated;
    };
}
