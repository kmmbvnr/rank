import { findOperation, instantiateShapeSignature } from '@arrrank/language';
import { checkInterrupt, interruptsEnabled } from '../interrupt.js';
import { ownedArray } from '../array-storage.js';
import { MissingValueError, RankError } from '../errors.js';
import { mapSequence } from '../sequence.js';
import {
    isRankArray,
    isRankSequence,
    MISSING,
    type NativeFunction,
    type RankValue,
} from '../value.js';

export function native(
    name: string,
    arity: number | readonly number[],
    call: (arguments_: RankValue[]) => RankValue,
): NativeFunction {
    const arities = typeof arity === 'number' ? [arity] : arity;
    const operation = findOperation(name);
    const signature = operation?.shape?.find(shape => shape.args.length === 1);
    // Text and sequences are boxed result cells in ranked assembly. Their
    // logical shape must not be appended as tensor axes.
    const tensorResult = operation && !['text', 'sequence'].includes(operation.result);
    const resultShape = signature
        ? (cellShape: readonly number[]): readonly number[] | undefined => {
            const result = instantiateShapeSignature(signature, [cellShape]);
            if (result === undefined && signature.result !== null) {
                throw new RankError(`${name} expects cell shape ${signature.args[0]?.join(' ') ?? 'all'}, got ${cellShape.join(' ')}`, 'DimensionMismatch');
            }
            return tensorResult ? result?.map(n => n ?? 0) : [];
        } : undefined;
    return {
        kind: 'function',
        name,
        arities,
        monadicRank: operation?.monadicRank ?? 'all',
        monadicResultShape: resultShape,
        dyadicRanks: operation?.dyadicRanks,
        arrayCells: operation?.arrayCells,
        call(arguments_) {
            if (!arities.includes(arguments_.length)) {
                throw new RankError(
                    `${name} expects ${arities.join(' or ')} argument, got ${arguments_.length}`,
                );
            }
            if (!interruptsEnabled()) return call(arguments_);
            checkInterrupt(name);
            const result = call(arguments_);
            checkInterrupt(name);
            return result;
        },
    };
}

export function mapValue(
    value: RankValue,
    operation: (scalar: RankValue) => RankValue,
): RankValue {
    if (isRankSequence(value)) return mapSequence(value, 'map', operation);
    return isRankArray(value) ? ownedArray(value.items.map(operation), value.shape) : operation(value);
}

export function expectInteger(value: RankValue): bigint {
    if (typeof value !== 'bigint') {
        if (value === MISSING) throw new MissingValueError('missing value where an integer is needed');
        throw new RankError(`expected integer input`);
    }
    return value;
}

export function expectNumeric(value: RankValue): bigint | number {
    if (typeof value !== 'bigint' && typeof value !== 'number') {
        if (value === MISSING) throw new MissingValueError('missing value where a number is needed');
        throw new RankError('expected numeric input');
    }
    return value;
}

/** An operation from a module the program has not opened names the `use` it needs. */
export function requireModule(modules: ReadonlySet<string>, module: string, operation: string): void {
    if (!modules.has(module)) {
        throw new RankError(`${operation} requires: use ${module}`);
    }
}
