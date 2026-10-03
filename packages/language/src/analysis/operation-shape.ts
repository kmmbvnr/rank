import type { IntrinsicRank, Operation } from '../operations.js';
import { instantiateShapeSignature, type KnownShape } from '../shape-signature.js';
import { resultTypes } from './types.js';
import { broadcastShape, incompatibleShapes, type ValueFacts } from './value-domain.js';

/** Shape-only transfer. This grants no element-type or callback-safety proofs. */
export function operationShapeFacts(
    operation: Operation, operands: readonly ValueFacts[],
    explicitRanks?: readonly IntrinsicRank[], axes?: readonly number[],
): ValueFacts | undefined {
    const signature = operation.shape?.find(shape => shape.args.length === operands.length);
    if (!signature) return;
    const ranks = explicitRanks ?? (operands.length === 1
        ? [operation.monadicRank ?? 'all'] : operation.dyadicRanks ?? operands.map(() => 'all'));
    const partition = rankedOperandShapes(operands, ranks, axes);
    if (!partition) return;
    const { cells, frame } = partition;
    const cellShape = instantiateShapeSignature(signature, cells);
    if (!cellShape) return;
    // Ranked assembly boxes non-array collections instead of adding their axes.
    if (frame.length && ['text', 'sequence'].includes(operation.result)) return;
    const shape = [...frame, ...cellShape];
    const types = frame.length ? ['array']
        : operation.preservesCollectionElements && ['array', 'sequence'].includes(operands[0].types.join())
            ? operands[0].types : resultTypes(operation);
    return { types, rank: shape.length, shape };
}

/** Shared rank/axis partition for builtin operations and user callbacks. */
export function rankedOperandShapes(operands: readonly ValueFacts[], ranks: readonly IntrinsicRank[],
    axes?: readonly number[]): { cells: (KnownShape | undefined)[]; frame: KnownShape } | undefined {
    if (operands.length !== ranks.length) return;
    const cells: (KnownShape | undefined)[] = [];
    let frame: KnownShape = [];
    for (let i = 0; i < operands.length; i++) {
        const value = operands[i];
        const rank = ranks[i];
        const shape = value.shape ?? (value.rank === undefined ? undefined : Array(value.rank).fill(null));
        if (rank === 'all') { cells.push(shape); continue; }
        if (typeof rank !== 'number' || !Number.isSafeInteger(rank) || !shape) return;
        // A negative rank counts down from the operand's own rank.
        const cellRank = rank < 0 ? Math.max(0, shape.length + rank) : rank;
        // Only tensors expose leading frames here. Text and sequences have their
        // own mapping/boxing rules and keep their specialized transfers.
        if (value.types.join() !== 'array') {
            if (shape.length > cellRank) return;
            cells.push(shape);
            continue;
        }
        const selected = axes ?? Array.from({ length: Math.max(0, shape.length - cellRank) }, (_, n) => n);
        if (selected.some(n => !Number.isSafeInteger(n) || n < 0 || n >= shape.length)
            || new Set(selected).size !== selected.length
            || axes && shape.length - selected.length !== cellRank) return;
        const nextFrame = selected.map(n => shape[n]);
        if (incompatibleShapes({ types: ['array'], shape: frame }, { types: ['array'], shape: nextFrame })) return;
        frame = broadcastShape(frame, nextFrame);
        cells.push(shape.filter((_, n) => !selected.includes(n)));
    }
    return { cells, frame };
}
