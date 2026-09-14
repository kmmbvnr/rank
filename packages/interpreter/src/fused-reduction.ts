import { checkpoint } from './interrupt.js';
import {
    isBinaryExpression, isNameExpression, isNumberLiteral, isParenthesizedExpression,
    isUnaryExpression, type Expression,
} from '@rank/language';
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

    // A single binary operation is common in dot products and lazy fallback
    // paths. Bind it without allocating instruction-value and reader arrays.
    const first = instructions[0];
    const second = instructions[1];
    const binary = instructions[root];
    if (instructions.length === 3 && 'read' in first && 'read' in second && !('read' in binary)) {
        return () => {
            const left = first.read(), right = second.read();
            const value = context.binary(binary.operator, left, right);
            const a = eagerArrayStorage(left), b = eagerArrayStorage(right);
            if ((!a && typeof left !== 'number' && typeof left !== 'bigint')
                || (!b && typeof right !== 'number' && typeof right !== 'bigint')
                || (a && b && (a.shape.length !== b.shape.length
                    || a.shape.some((dimension, axis) => dimension !== b.shape[axis])))
                || !isRankArray(value)) return finish(value, undefined, 0);
            return finish(value, index => binary.operation(a ? a.read(index) : left, b ? b.read(index) : right),
                value.shape.reduce((size, dimension) => size * dimension, 1));
        };
    }

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
                    readers.push(() => value);
                } else {
                    const storage = eagerArrayStorage(value);
                    if (!storage) eligible = false;
                    if (eligible) readers.push(storage!.read);
                }
                continue;
            }
            const left = values[instruction.left];
            const right = values[instruction.right];
            // Build the ordinary lazy values first: scalar errors, name reads and
            // shape validation must occur in exactly the original tree order.
            const value = context.binary(instruction.operator, left, right);
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
                const readLeft = readers[instruction.left];
                const readRight = readers[instruction.right];
                // Preserve arithmetic tree order and floating-point rounding.
                readers.push(index => instruction.operation(readLeft(index), readRight(index)));
            } else readers.push(() => value);
        }
        const result = values[root];
        if (!eligible || !isRankArray(result)) return finish(result, undefined, 0);
        const size = result.shape.reduce((product, dimension) => product * dimension, 1);
        return finish(result, readers[root], size);
    };
}
