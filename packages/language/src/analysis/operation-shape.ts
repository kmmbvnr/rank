import type { IntrinsicRank, Operation } from '../operations.js';
import { diagonalResultShape, matmulResultShape, instantiateShapeSignature, type KnownShape } from '../shape-signature.js';
import { resultTypes } from './types.js';
import { broadcastShape, incompatibleShapes, type ValueFacts } from './value-domain.js';

/** Shape-only transfer. This grants no element-type or callback-safety proofs. */
export function operationShapeFacts(
    operation: Operation, operands: readonly ValueFacts[],
    explicitRanks?: readonly IntrinsicRank[], axes?: readonly number[],
): ValueFacts | undefined {
    const signature = operation.shape?.find(shape => shape.args.length === operands.length);
    if (!signature && operation.name !== 'matmul') return;
    const ranks = explicitRanks ?? (operands.length === 1
        ? [operation.monadicRank ?? 'all'] : operation.dyadicRanks ?? operands.map(() => 'all'));
    const partition = rankedOperandShapes(operands, ranks, axes);
    if (!partition) return;
    const { cells, frame } = partition;
    const cellShape = operation.name === 'diag' && cells[0]
        ? diagonalResultShape(cells[0])
        : operation.name === 'matmul' && cells[0] && cells[1] ? matmulResultShape(cells[0], cells[1])
        : signature ? instantiateShapeSignature(signature, cells) : undefined;
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
function rankedOperandPart(value: ValueFacts, rank: IntrinsicRank, axes?: readonly number[]):
    { cell: KnownShape | undefined; frame: KnownShape } | undefined {
    const shape = value.shape ?? (value.rank === undefined ? undefined : Array(value.rank).fill(null));
    if (rank === 'all') return { cell: shape, frame: [] };
    if (typeof rank !== 'number' || !Number.isSafeInteger(rank) || !shape) return;
    // A negative rank counts down from the operand's own rank.
    const cellRank = rank < 0 ? Math.max(0, shape.length + rank) : rank;
    // Only tensors expose leading frames here. Text and sequences have their
    // own mapping/boxing rules and keep their specialized transfers.
    if (value.types.join() !== 'array') return shape.length > cellRank ? undefined : { cell: shape, frame: [] };
    const selected = axes ?? Array.from({ length: Math.max(0, shape.length - cellRank) }, (_, n) => n);
    if (selected.some(n => !Number.isSafeInteger(n) || n < 0 || n >= shape.length)
        || new Set(selected).size !== selected.length
        || axes && shape.length - selected.length !== cellRank) return;
    return { cell: shape.filter((_, n) => !selected.includes(n)), frame: selected.map(n => shape[n]) };
}

/** A mismatch is proven only when both frame axes are concrete and cannot stretch. */
export function rankedFrameConflict(operands: readonly ValueFacts[], ranks: readonly IntrinsicRank[],
    axes?: readonly number[]): { left: KnownShape; right: KnownShape } | undefined {
    if (operands.length !== 2 || ranks.length !== 2) return;
    const left = rankedOperandPart(operands[0], ranks[0], axes)?.frame;
    const right = rankedOperandPart(operands[1], ranks[1], axes)?.frame;
    if (left && right && incompatibleShapes({ types: ['array'], shape: left }, { types: ['array'], shape: right })) {
        return { left, right };
    }
    return;
}

export function rankedOperandShapes(operands: readonly ValueFacts[], ranks: readonly IntrinsicRank[],
    axes?: readonly number[]): { cells: (KnownShape | undefined)[]; frame: KnownShape } | undefined {
    if (operands.length !== ranks.length) return;
    const cells: (KnownShape | undefined)[] = [];
    let frame: KnownShape = [];
    for (let i = 0; i < operands.length; i++) {
        const part = rankedOperandPart(operands[i], ranks[i], axes);
        if (!part || incompatibleShapes({ types: ['array'], shape: frame },
            { types: ['array'], shape: part.frame })) return;
        frame = broadcastShape(frame, part.frame);
        cells.push(part.cell);
    }
    return { cells, frame };
}
