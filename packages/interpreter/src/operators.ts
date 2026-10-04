import { mapResult, runExecution } from './execution.js';
import { binaryArrayType, setSemanticArrayType } from './semantic-array-type.js';
import { RUNTIME_TYPE_NAMES, type ApplicationForm } from '@arrrank/language';
import { arrayMaskSource, markArrayMask } from './array-mask.js';
import { evaluateArrayItem, derivedArray, materializeCells, ownedArray, readArrayItem } from './array-storage.js';
import { applyBound, valueBound } from './clause-expression.js';
import { MissingValueError, RankError } from './errors.js';
import { indexKey } from './index-key.js';
import { checkpoint } from './interrupt.js';
import { missingBinary } from './missing.js';
import { mapMaskedArrays } from './masked-kernels.js';
import { requireModule } from './modules/shared.js';
import { binarySqlite, inSqlite } from './modules/sqlite.js';
import { numericKernel } from './numeric-kernels.js';
import { compareOrderedValues, orderedKind } from './ordered.js';
import { dyadicCells, tensorCells, tensorFrameAxes, type OuterCells } from './rank-application.js';
import { reductionValues } from './reduction.js';
import {
    isPositionalMask, mapSequence, positionalMask, sequence, sequenceMask, sequenceValues, zipSequences,
} from './sequence.js';
import { setValueKey } from './set.js';
import { safeDimension } from './tensor-index.js';
import { REAL_CODES, mapBroadcastArrays, mapDenseArrays } from './tensor.js';
import { compareCells, equalValues } from './value-comparison.js';
import {
    addDateTimeDuration, expectBoolean, isRankArray, isRankCounter, isRankDate, isRankDuration, isRankIndex,
    isRankLabel, isRankMultiset, isRankObject, isRankQueue, isRankSequence, isRankSequenceMask, isRankSet,
    isRankSqliteExpression, isRankSqliteTable, MISSING, subtractDateTimes, typeName, valueRank,
    type IntrinsicRank, type NativeFunction, type RankArray, type RankSequence, type RankValue, type SequencePredicate,
} from './value.js';

/**
 * What the operator words mean on concrete values: arithmetic, comparison,
 * logic, ranges, membership and the outer products. Operators never call a
 * Rank function, except `outer` with a named operation, whose result files
 * the caller's scope must own. The only other capability they need is the set
 * of open modules, because `multiple by` belongs to `numbers`.
 */
export class Operators {
    constructor(
        private readonly modules: ReadonlySet<string>,
        private readonly ownFiles: (value: RankValue) => void,
        private readonly scalarCallback: (fn: NativeFunction) => ((arguments_: RankValue[]) => RankValue) | undefined,
    ) {}

    compareAtRank(left: RankValue, right: RankValue, spec: Extract<ApplicationForm, { kind: 'comparison-rank' }>): RankValue {
        if (isRankSqliteExpression(left) || isRankSqliteExpression(right)) {
            if (spec.rank !== 0 || spec.axes !== undefined) {
                throw new RankError('SQLite comparisons support rank 0 without axis', 'TypeError');
            }
            return this.evaluateBinary(spec.operator, left, right);
        }
        if (spec.axes === undefined && spec.rank === 0
            && (isRankSequence(left) || isRankSequence(right))) {
            if (isRankSequence(left) && isRankSequence(right)) {
                return mapBinary(left, right, spec.operator,
                    (a, b) => compareCells(spec.operator, a, b));
            }
            return this.sequenceComparison(spec.operator, left, right);
        }
        const cells = (value: RankValue): OuterCells => {
            if (isRankSequence(value)) {
                if (value.plan.size.kind === 'infinite') {
                    throw new RankError('rank comparison requires a bounded sequence');
                }
                const items: RankValue[] = [];
                for (const item of value.plan.iterate()) {
                    checkpoint('comparing sequence cells');
                    items.push(item);
                }
                value = ownedArray(items, [items.length]);
            }
            if (isRankQueue(value)) value = asRankArray(value)!;
            if (spec.axes !== undefined) {
                if (!isRankArray(value)) throw new RankError('axis rank expects arrays');
                return tensorCells(value, tensorFrameAxes(value.shape, spec.axes, spec.rank));
            }
            return dyadicCells(value, spec.rank);
        };
        const a = cells(left), b = cells(right);
        if (a.frameShape.length === 0 && b.frameShape.length === 0) {
            return compareCells(spec.operator, a.cellAt(0), b.cellAt(0));
        }
        return mapBroadcastArrays(
            derivedArray(a.frameShape, [left].filter(isRankArray), a.cellAt),
            derivedArray(b.frameShape, [right].filter(isRankArray), b.cellAt),
            (x, y) => compareCells(spec.operator, x, y),
        );
    }

    evaluateOuter(operator: string, left: RankValue, right: RankValue): RankValue {
        const a = outerOperand(left, 'left');
        const b = outerOperand(right, 'right');
        const rightSize = arraySize(b.shape);
        requireIndexable([...a.shape, ...b.shape]);
        return derivedArray([...a.shape, ...b.shape], [a, b], index => {
            const leftIndex = Math.floor(index / rightSize);
            const rightIndex = index % rightSize;
            return this.evaluateBinary(
                operator,
                readArrayItem(a, leftIndex),
                readArrayItem(b, rightIndex),
            );
        }, true);
    }

    evaluateNamedOuter(
        operation: NativeFunction,
        left: RankValue,
        right: RankValue,
    ): RankValue {
        if (!operation.arities.includes(2)) {
            throw new RankError(`outer operation ${operation.name} must accept 2 arguments`);
        }
        const [leftRank, rightRank] = operation.dyadicRanks ?? ['all', 'all'];
        const a = outerCells(left, leftRank, 'left');
        const b = outerCells(right, rightRank, 'right');
        const rightFrames = arraySize(b.frameShape);
        const scalar = this.scalarCallback(operation);
        requireIndexable([...a.frameShape, ...b.frameShape]);
        return lazyArray([...a.frameShape, ...b.frameShape], index => {
            const arguments_ = [
                a.cellAt(Math.floor(index / rightFrames)),
                b.cellAt(index % rightFrames),
            ];
            const result = scalar ? scalar(arguments_) : operation.call(arguments_);
            if (valueRank(result) !== 0) {
                throw new RankError(`outer operation ${operation.name} must return a scalar`);
            }
            this.ownFiles(result);
            return result;
        });
    }

    evaluateUnary(operator: string, value: RankValue): RankValue {
        const source = operator === 'not' ? arrayMaskSource(value) : undefined;
        if (source) return markArrayMask(this.evaluateUnaryValue(operator, value), source);
        return this.evaluateUnaryValue(operator, value);
    }

    private evaluateUnaryValue(operator: string, value: RankValue): RankValue {
        if (operator === 'not' && isPositionalMask(value)) {
            return positionalMask(mapSequence(value, 'not', item => item !== true).plan);
        }
        if (operator === 'not' && isRankSequenceMask(value)) {
            return sequenceMask(value.source, {
                name: `not ${value.predicate.name}`,
                expression: {
                    kind: 'not',
                    operand: value.predicate.expression,
                },
                test: item => !value.predicate.test(item),
            });
        }
        if (isRankArray(value)) {
            return ownedArray(value.items.map(item => this.evaluateUnary(operator, item)), value.shape);
        }
        if (value === MISSING && (operator === 'not' || operator === '+' || operator === '-')) return MISSING;
        if (operator === 'not' && typeof value === 'boolean') {
            return !value;
        }
        if ((operator === '+' || operator === '-')
            && (typeof value === 'bigint' || typeof value === 'number')) {
            return operator === '+' ? value : -value;
        }
        throw new RankError(`operator ${operator} does not accept ${typeName(value)}`);
    }

    evaluateBinary(
        operator: string,
        left: RankValue,
        right: RankValue,
        rangeStep?: RankValue,
    ): RankValue {
        const result = this.evaluateBinaryValue(operator, left, right, rangeStep);
        if (!isRankArray(result)) return result;
        const type = binaryArrayType(operator, left, right);
        if (type) setSemanticArrayType(result, type);
        return markBinaryMask(operator, left, right, result);
    }

    /** `and` and `or` after a single boolean are guards: the right side runs only
     * when the left does not decide, so it must be a single boolean too. */
    evaluateGuard(operator: string, left: RankValue, right: RankValue): RankValue {
        if (typeof left === 'boolean'
            && (isRankArray(right) || isRankSequence(right) || isRankQueue(right))) {
            throw new RankError(`${operator} after a single boolean expects a single boolean. `
                + `Write \`Mask ${operator} Flag\` to combine a mask with a flag.`);
        }
        return this.evaluateBinary(operator, left, right);
    }

    decidesGuard(operator: string, left: RankValue): boolean {
        return left === (operator === 'or');
    }

    private evaluateBinaryValue(
        operator: string,
        left: RankValue,
        right: RankValue,
        rangeStep?: RankValue,
    ): RankValue {
        if ((operator === 'in' || operator === 'notin')
            && isRankSqliteExpression(left) && isRankSqliteTable(right)) {
            return inSqlite(left, right, operator === 'notin');
        }
        if (operator === 'notin') {
            const result = this.evaluateBinary('in', left, right);
            return isRankSequence(result) && !isRankSequenceMask(result)
                ? mapSequence(result, 'not in', item => this.evaluateUnary('not', item))
                : this.evaluateUnary('not', result);
        }
        if (isRankSqliteExpression(left) || isRankSqliteExpression(right)) {
            return binarySqlite(operator, left, right);
        }
        // Integer arithmetic and integer comparison are what programs spend
        // their time on, and every one of them used to walk twenty operator
        // tests, a numeric coercion and a three-way ordering helper to reach
        // an answer the operands already determine.
        if (typeof left === 'bigint' && typeof right === 'bigint') {
            switch (operator) {
                case '+': return left + right;
                case '-': return left - right;
                case '*': return left * right;
                case 'less': return left < right;
                case 'greater': return left > right;
                case 'atleast': return left >= right;
                case 'atmost': return left <= right;
                case 'equal': return left === right;
                case 'notequal': return left !== right;
                case 'min': return left < right ? left : right;
                case 'max': return left > right ? left : right;
                case '%': {
                    if (right === 0n) throw new RankError('division by zero');
                    const remainder = left % right;
                    return remainder !== 0n && (remainder < 0n) !== (right < 0n)
                        ? remainder + right
                        : remainder;
                }
                case '//': {
                    if (right === 0n) throw new RankError('division by zero');
                    return floorDivide(left, right);
                }
                default: break;
            }
        }
        if (operator === 'is') {
            if (!isRankLabel(right)) {
                throw new RankError('is expects a type symbol on the right');
            }
            if (!RUNTIME_TYPE_NAMES.has(right.name)) {
                throw new RankError(`unknown type symbol: .${right.name}`);
            }
            return typeName(left) === right.name;
        }
        if (operator === '+' && typeof left === 'string' && typeof right === 'string') {
            return left + right;
        }
        if (operator === 'until') throw new RankError('until is not a Rank word: write `till` for a bound it excludes');
        if (operator === 'to' || operator === 'till') {
            // After a number the words build a range; after values they bound them.
            if (typeof left !== 'bigint' && typeof left !== 'number') {
                if (rangeStep !== undefined) throw new RankError('by applies only to numeric ranges');
                return applyBound(left, valueBound(right, operator, (op, a, b) => this.evaluateBinary(op, a, b)), operator);
            }
            return makeRange(
                expectInteger(left),
                expectInteger(right),
                operator === 'to',
                rangeStep === undefined ? undefined : expectInteger(rangeStep),
            );
        }
        if ((isRankSequenceMask(left) || isRankSequenceMask(right) || isPositionalMask(left) || isPositionalMask(right))
            && ['and', 'or', 'xor'].includes(operator)) {
            return this.combineSequenceMasks(operator, left, right);
        }
        if (operator === 'in') {
            const source = asRankArray(left);
            const contains = membershipTest(right, !!source || isRankSequence(left));
            if (source) {
                const items: RankValue[] = [];
                for (let index = 0; index < arraySize(source.shape); index += 1) {
                    checkpoint('testing membership');
                    items.push(contains(readArrayItem(source, index)));
                }
                return ownedArray(items, source.shape, true);
            }
            // A membership test over a sequence is a mask, so it can select from that sequence.
            if (isRankSequence(left)) return sequenceMask(left, { name: 'in', test: item => expectBoolean(contains(item)) });
            return contains(left);
        }
        if (isRankSequence(left) || isRankSequence(right)) {
            if (isPredicateOperator(operator)) {
                return this.sequenceComparison(operator, left, right);
            }
            return mapBinary(left, right, operator, (a, b) => this.evaluateBinary(operator, a, b));
        }
        if (isRankArray(left) || isRankArray(right) || isRankQueue(left) || isRankQueue(right)) {
            return mapBinary(left, right, operator, (a, b) => this.evaluateBinary(operator, a, b));
        }
        if (left === MISSING || right === MISSING) {
            const result = missingBinary(operator, left, right);
            if (result !== undefined) return result;
        }
        if (operator === 'equal' || operator === 'notequal') {
            const equal = equalValues(left, right);
            return operator === 'equal' ? equal : !equal;
        }
        if (operator === 'and' || operator === 'or' || operator === 'xor') {
            const a = expectBoolean(left);
            const b = expectBoolean(right);
            if (operator === 'and') return a && b;
            if (operator === 'or') return a || b;
            return a !== b;
        }
        if (operator === '+' && (typeof left === 'string' || typeof right === 'string')) {
            throw new RankError('+ expects two numeric or two text values');
        }
        if (operator === 'multipleby') {
            requireModule(this.modules, 'numbers', 'multiple by');
            const dividend = expectInteger(left);
            const divisor = expectInteger(right);
            if (divisor === 0n) throw new RankError('division by zero');
            return dividend % divisor === 0n;
        }
        if (operator === 'less' || operator === 'greater'
            || operator === 'atleast' || operator === 'atmost') {
            // IEEE: nan is unordered, so every comparison with it is false,
            // as in the compiled scalar and tensor kernels.
            if (Number.isNaN(left) || Number.isNaN(right)) return false;
            const order = compareOrderedValues(left, right, orderedKind(left));
            if (operator === 'less') return order < 0;
            if (operator === 'greater') return order > 0;
            if (operator === 'atleast') return order >= 0;
            return order <= 0;
        }

        if (operator === '+' && (isRankDate(left) || isRankDate(right)
            || isRankDuration(left) || isRankDuration(right))) {
            const moment = isRankDate(left) ? left : isRankDate(right) ? right : undefined;
            const span = isRankDuration(left) ? left : isRankDuration(right) ? right : undefined;
            if (moment?.kind !== 'datetime' || !span) {
                throw new RankError('+ expects a datetime and duration', 'TypeError');
            }
            return addDateTimeDuration(moment, span);
        }
        if (operator === '*' && (isRankDuration(left) || isRankDuration(right))) {
            const span = isRankDuration(left) ? left : right;
            const factor = isRankDuration(left) ? right : left;
            if (!isRankDuration(span) || (typeof factor !== 'bigint' && typeof factor !== 'number')) {
                throw new RankError('* expects a duration and number', 'TypeError');
            }
            if (typeof factor === 'bigint') {
                return { kind: 'duration', seconds: span.seconds * factor };
            }
            const scaled = Number(span.seconds) * factor;
            if (!Number.isSafeInteger(Number(span.seconds)) || !Number.isSafeInteger(scaled)) {
                throw new RankError('* needs exact integer seconds', 'TypeError');
            }
            return { kind: 'duration', seconds: BigInt(scaled) };
        }
        if (operator === '-' && (isRankDate(left) || isRankDate(right))) {
            if (!isRankDate(left) || left.kind !== 'datetime'
                || !isRankDate(right) || right.kind !== 'datetime') {
                throw new RankError('- expects two datetimes', 'TypeError');
            }
            return subtractDateTimes(left, right);
        }

        const a = expectNumeric(left);
        const b = expectNumeric(right);
        if ((operator === '/' || operator === '//' || operator === '%') && isZero(b)) {
            throw new RankError('division by zero');
        }
        const bothIntegers = typeof a === 'bigint' && typeof b === 'bigint';
        switch (operator) {
            case '+': return bothIntegers ? a + b : Number(a) + Number(b);
            case '-': return bothIntegers ? a - b : Number(a) - Number(b);
            case '*': return bothIntegers ? a * b : Number(a) * Number(b);
            case '**': return power(a, b);
            case '/': return Number(a) / Number(b);
            case '//': return bothIntegers ? floorDivide(a, b) : floorDivideReal(Number(a), Number(b));
            case '%': {
                if (bothIntegers) {
                    const remainder = a % b;
                    return remainder !== 0n && (remainder < 0n) !== (b < 0n)
                        ? remainder + b
                        : remainder;
                }
                const divisor = Number(b);
                const remainder = Number(a) % divisor;
                if (remainder === 0) return divisor < 0 ? -0 : 0;
                return (remainder < 0) !== (divisor < 0) ? remainder + divisor : remainder;
            }
            case 'min': return a < b ? a : b;
            case 'max': return a > b ? a : b;
            default: throw new RankError(`unknown operator: ${operator}`);
        }
    }

    private sequenceComparison(operator: string, left: RankValue, right: RankValue): RankValue {
        if (isRankSequence(left) && isRankSequence(right)) {
            throw new RankError('comparison between two sequences is not implemented');
        }
        const source = isRankSequence(left) ? left : right as RankSequence;
        const scalar = isRankSequence(left) ? right : left;
        const predicate: SequencePredicate = {
            name: operator,
            expression: {
                kind: 'comparison',
                operator,
                scalar,
                sourceOnLeft: isRankSequence(left),
            },
            test: item => expectBoolean(isRankSequence(left)
                ? this.evaluateBinary(operator, item, scalar)
                : this.evaluateBinary(operator, scalar, item)),
        };
        return sequenceMask(source, predicate);
    }

    private combineSequenceMasks(operator: string, left: RankValue, right: RankValue): RankValue {
        const combine = (a: boolean, b: boolean) => operator === 'and' ? a && b : operator === 'or' ? a || b : a !== b;
        if (!['and', 'or', 'xor'].includes(operator)) {
            throw new RankError(`operator ${operator} does not accept sequence masks`);
        }
        if (!isRankSequenceMask(left) || !isRankSequenceMask(right) || left.source !== right.source) {
            // Masks of different values combine flag by flag, as positions.
            if (!isRankSequence(left) || !isRankSequence(right)) {
                throw new RankError(`operator ${operator} combines a sequence mask only with another mask`);
            }
            const zipped = zipSequences(left, right, operator, (a, b) => {
                if (typeof a !== 'boolean' || typeof b !== 'boolean') throw new RankError(`${operator} expects boolean masks`);
                return combine(a, b);
            });
            return positionalMask(zipped.plan);
        }
        return sequenceMask(left.source, {
            name: `${left.predicate.name} ${operator} ${right.predicate.name}`,
            expression: {
                kind: 'logical',
                operator: operator as 'and' | 'or' | 'xor',
                left: left.predicate.expression,
                right: right.predicate.expression,
            },
            test: value => {
                const a = left.predicate.test(value);
                const b = right.predicate.test(value);
                if (operator === 'and') return a && b;
                if (operator === 'or') return a || b;
                return a !== b;
            },
        });
    }
}

/** An outer result addresses its cells by number, so its cell count must be exact in a double. */
function requireIndexable(shape: readonly number[]): void {
    const cells = shape.reduce((product, dimension) => product * BigInt(dimension), 1n);
    if (cells > BigInt(Number.MAX_SAFE_INTEGER)) throw new RankError(`outer result is too large: ${cells} cells`);
}

export function arraySize(shape: readonly number[]): number {
    return shape.reduce((product, dimension) => product * dimension, 1);
}

function outerOperand(value: RankValue, side: 'left' | 'right'): RankArray {
    if (isRankArray(value)) return value;
    if (isRankQueue(value)) {
        return { kind: 'array', items: value.items, shape: [value.items.length] };
    }
    if (!isRankSequence(value)) {
        throw new RankError(`outer ${side} operand must be a finite sequence or array`);
    }
    if (value.plan.size.kind === 'infinite') {
        throw new RankError(`outer ${side} operand must be finite`);
    }

    // A range is arithmetic: element i is start + i * step, so nothing is read to know it.
    const range = rangeLayouts.get(value);
    if (range) {
        return lazyArray([safeDimension(range.size, 'outer operand size')], index => range.start + BigInt(index) * range.step, true);
    }
    if (value.plan.size.kind === 'exact') {
        // The size is promised, so values are read only as far as a cell asks, and kept.
        const size = safeDimension(value.plan.size.value, 'outer operand size');
        const read: RankValue[] = [];
        let source: Iterator<RankValue> | undefined;
        return lazyArray([size], index => {
            source ??= sequenceValues(value, 'outer')[Symbol.iterator]();
            while (read.length <= index) {
                const next = source.next();
                if (next.done) throw new RankError(`outer operand ended after ${read.length} values, not ${size}`);
                read.push(next.value);
            }
            return read[index];
        });
    }
    let items: RankValue[] | undefined;
    const values = () => items ??= [...sequenceValues(value, 'outer')];
    return lazyArray([values().length], index => values()[index]);
}

function outerCells(
    value: RankValue,
    rank: IntrinsicRank,
    side: 'left' | 'right',
): OuterCells {
    const source = outerOperand(value, side);
    const receivesWhole = rank === 'all' || rank >= source.shape.length;
    const cellRank = rank === 'all' ? source.shape.length : Math.min(rank, source.shape.length);
    const frameShape = source.shape.slice(0, source.shape.length - cellRank);
    const cellShape = source.shape.slice(source.shape.length - cellRank);
    const cellSize = arraySize(cellShape);
    return {
        frameShape,
        cellAt(frameIndex) {
            if (receivesWhole) return value;
            const start = frameIndex * cellSize;
            if (cellRank === 0) return readArrayItem(source, start);
            return derivedArray(cellShape, [source], index => readArrayItem(source, start + index));
        },
    };
}

function lazyArray(
    shape: readonly number[],
    itemAt: (index: number) => RankValue,
    fileFree = false,
): RankArray {
    let materialized: RankValue[] | undefined;
    return {
        kind: 'array',
        shape,
        itemAt,
        containsFiles: fileFree ? false : undefined,
        get items() {
            materialized ??= materializeCells(arraySize(shape), itemAt);
            return materialized;
        },
    };
}

/** A range's own bounds, so selecting with it can reach SQL as LIMIT and OFFSET or substr. */
const rangeBoundsBySequence = new WeakMap<RankSequence, { start: bigint; end: bigint; inclusive: boolean }>();

function makeRange(start: bigint, end: bigint, inclusive: boolean, stride?: bigint): RankSequence {
    const range = rangeSequence(start, end, inclusive, stride);
    if (stride === undefined || stride === 1n) rangeBoundsBySequence.set(range, { start, end, inclusive });
    return range;
}

/** Where a range starts, how it steps and how many values it holds, for readers that index into it. */
const rangeLayouts = new WeakMap<RankSequence, { start: bigint; step: bigint; size: bigint }>();

function rangeSequence(start: bigint, end: bigint, inclusive: boolean, stride?: bigint): RankSequence {
    const range = buildRange(start, end, inclusive, stride);
    const step = stride ?? 1n;
    if (range.plan.size.kind === 'exact') rangeLayouts.set(range, { start, step, size: range.plan.size.value });
    return range;
}

function buildRange(start: bigint, end: bigint, inclusive: boolean, stride?: bigint): RankSequence {
    const step = stride ?? 1n;
    if (step === 0n) throw new RankError('range step must be a nonzero integer');

    const ascending = step > 0n;
    const magnitude = absolute(step);
    const distance = ascending ? end - start : start - end;
    const size = distance < 0n ? 0n : inclusive
        ? distance / magnitude + 1n
        : (distance + magnitude - 1n) / magnitude;
    const within = ascending
        ? (value: bigint) => inclusive ? value <= end : value < end
        : (value: bigint) => inclusive ? value >= end : value > end;
    return sequence({
        name: `${start} ${inclusive ? 'to' : 'till'} ${end}${stride === undefined ? '' : ` by ${stride}`}`,
        size: {
            kind: 'exact',
            value: size,
        },
        *iterate() {
            for (let value = start; within(value); value += step) yield value;
        },
    });
}

/** The bounds of a plain range, which SQLite selection can turn into LIMIT and OFFSET or substr. */
export function rangeBounds(value: RankSequence): { start: bigint; end: bigint; inclusive: boolean } | undefined {
    return rangeBoundsBySequence.get(value);
}

function absolute(value: bigint): bigint {
    return value < 0n ? -value : value;
}

function membershipTest(right: RankValue, indexed: boolean): (value: RankValue) => boolean {
    if (typeof right === 'string' || isRankObject(right)) return value => {
        if (typeof value !== 'string') throw new RankError('in expects text on the left for text or object membership');
        return typeof right === 'string' ? right.includes(value) : right.entries.has(value);
    };
    if (isRankIndex(right)) return value => right.entries.has(indexKey([value]));
    if (isRankSet(right) || isRankCounter(right)) return value => right.entries.has(setValueKey(value));
    if (isRankMultiset(right)) return value => right.has(value);
    const source = asRankArray(right);
    if (source) return membershipLookup(reductionValues(source, 'in'));
    if (isRankSequence(right)) {
        if (!right.plan.contains && right.plan.size.kind !== 'infinite' && indexed) {
            return membershipLookup(right.plan.iterate());
        }
        return value => {
            const planned = right.plan.contains?.(value);
            if (planned !== undefined) return planned;
            if (right.plan.size.kind === 'infinite') {
                throw new RankError('in requires bounded sequence or membership support');
            }
            for (const item of right.plan.iterate()) {
                if (equalValues(value, item)) return true;
            }
            return false;
        };
    }
    throw new RankError('in expects text, an object, index, set, multiset, array, queue or sequence on the right');
}

// Hash scalar values once; retain structural equality for composite values.
function membershipLookup(values: Iterable<RankValue>): (value: RankValue) => boolean {
    const scalars = new Set<RankValue>();
    const composite: RankValue[] = [];
    const key = (value: RankValue): RankValue => typeof value === 'number'
        && Number.isFinite(value) && Number.isInteger(value) ? BigInt(value) : value;
    for (const value of values) {
        checkpoint('indexing membership');
        if (typeof value === 'object') composite.push(value);
        else if (!(typeof value === 'number' && Number.isNaN(value))) scalars.add(key(value));
    }
    return value => typeof value === 'object'
        ? composite.some(item => equalValues(value, item))
        : scalars.has(key(value));
}

const DENSE_OPERATORS = new Set(['+', '-', '*', '/', '**', 'less', 'greater', 'atmost', 'atleast', 'equal', 'notequal']);

function mapBinary(
    left: RankValue,
    right: RankValue,
    name: string,
    operation: (left: RankValue, right: RankValue) => RankValue,
): RankValue {
    const scalarOperation = numericKernel(name, operation);
    if (isRankSequence(left) && isRankSequence(right)) {
        return zipSequences(left, right, name, scalarOperation);
    }
    if (isRankSequence(left)) {
        return mapSequence(left, name, item => scalarOperation(item, right));
    }
    if (isRankSequence(right)) {
        return mapSequence(right, name, item => scalarOperation(left, item));
    }
    const leftArray = asRankArray(left);
    const rightArray = asRankArray(right);
    if ((leftArray || rightArray) && REAL_CODES[name] !== undefined) {
        const masked = mapMaskedArrays(left, right, REAL_CODES[name]);
        if (masked) return masked;
    }
    if ((leftArray || rightArray) && DENSE_OPERATORS.has(name)) {
        const dense = mapDenseArrays(leftArray ?? left, rightArray ?? right, scalarOperation, REAL_CODES[name]);
        if (dense) return dense;
    }
    if (leftArray && rightArray) {
        return mapBroadcastArrays(leftArray, rightArray, scalarOperation);
    }
    const source = leftArray ?? rightArray!;
    const evaluate = (index: number) => mapResult(evaluateArrayItem(source, index), item =>
        leftArray ? scalarOperation(item, right) : scalarOperation(left, item));
    return derivedArray(source.shape, [source], index => runExecution(evaluate(index)), true, evaluate);
}

function asRankArray(value: RankValue): RankArray | undefined {
    if (isRankArray(value)) return value;
    if (isRankQueue(value)) return { kind: 'array', items: value.items, shape: [value.items.length] };
    return undefined;
}

/** A comparison of an array with a scalar, or a logical join of two masks of the
 * same array, yields a mask that numeric operations can select through. */
function markBinaryMask(operator: string, left: RankValue, right: RankValue, result: RankArray): RankValue {
    if (isPredicateOperator(operator)) {
        if (isRankArray(left) && typeof right !== 'object') return markArrayMask(result, left);
        if (isRankArray(right) && typeof left !== 'object') return markArrayMask(result, right);
        return result;
    }
    if (operator === 'and' || operator === 'or' || operator === 'xor') {
        const source = arrayMaskSource(left);
        if (source && source === arrayMaskSource(right)) return markArrayMask(result, source);
    }
    return result;
}

function isPredicateOperator(operator: string): boolean {
    return ['equal', 'notequal', 'less', 'greater', 'atleast', 'atmost', 'multipleby']
        .includes(operator);
}

export function expectInteger(value: RankValue): bigint {
    if (typeof value !== 'bigint') {
        if (value === MISSING) throw new MissingValueError('missing value where an integer is needed');
        throw new RankError(`expected integer, got ${typeName(value)}`);
    }
    return value;
}

function expectNumeric(value: RankValue): bigint | number {
    if (typeof value !== 'bigint' && typeof value !== 'number') {
        if (value === MISSING) throw new MissingValueError('missing value where a number is needed');
        throw new RankError(`expected number, got ${typeName(value)}`);
    }
    return value;
}

function isZero(value: bigint | number): boolean {
    return value === 0n || value === 0;
}

function power(base: bigint | number, exponent: bigint | number): bigint | number {
    if (isZero(base) && exponent < 0) {
        throw new RankError('zero cannot be raised to a negative power');
    }
    if (typeof base === 'bigint' && typeof exponent === 'bigint' && exponent >= 0n) {
        return base ** exponent;
    }
    const result = Number(base) ** Number(exponent);
    if (Number.isNaN(result)) throw new RankError('power result is not real');
    return result;
}

function floorDivideReal(left: number, right: number): number {
    const remainder = left % right;
    // Derive the quotient from the remainder so rounding near an integer
    // boundary cannot make // disagree with %.
    let quotient = (left - remainder) / right;
    if (remainder !== 0 && (remainder < 0) !== (right < 0)) quotient -= 1;
    if (quotient === 0) {
        const ratio = left / right;
        return ratio < 0 || Object.is(ratio, -0) ? -0 : 0;
    }
    const floor = Math.floor(quotient);
    return quotient - floor > 0.5 ? floor + 1 : floor;
}

function floorDivide(left: bigint, right: bigint): bigint {
    const quotient = left / right;
    const remainder = left % right;
    return remainder !== 0n && (left < 0n) !== (right < 0n)
        ? quotient - 1n
        : quotient;
}
