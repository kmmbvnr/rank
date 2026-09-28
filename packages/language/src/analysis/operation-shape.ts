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
    const cells: (KnownShape | undefined)[] = [];
    let frame: KnownShape = [];
    for (let i = 0; i < operands.length; i++) {
        const value = operands[i];
        const rank = ranks[i];
        const shape = value.shape ?? (value.rank === undefined ? undefined : Array(value.rank).fill(null));
        if (rank === 'all') { cells.push(shape); continue; }
        if (typeof rank !== 'number' || !Number.isSafeInteger(rank) || rank < 0 || !shape) return;
        // Only tensors expose leading frames here. Text and sequences have their
        // own mapping/boxing rules and keep their specialized transfers.
        if (value.types.join() !== 'array') {
            if (shape.length > rank) return;
            cells.push(shape);
            continue;
        }
        const selected = axes ?? Array.from({ length: Math.max(0, shape.length - rank) }, (_, n) => n);
        if (selected.some(n => !Number.isSafeInteger(n) || n < 0 || n >= shape.length)
            || new Set(selected).size !== selected.length
            || axes && shape.length - selected.length !== rank) return;
        const nextFrame = selected.map(n => shape[n]);
        if (incompatibleShapes({ types: ['array'], shape: frame }, { types: ['array'], shape: nextFrame })) return;
        frame = broadcastShape(frame, nextFrame);
        cells.push(shape.filter((_, n) => !selected.includes(n)));
    }
    const cellShape = instantiateShapeSignature(signature, cells);
    if (!cellShape) return;
    // Ranked assembly boxes non-array collections instead of adding their axes.
    if (frame.length && ['text', 'sequence'].includes(operation.result)) return;
    const shape = [...frame, ...cellShape];
    const types = frame.length ? ['array']
        : operation.preservesArrayShape && ['array', 'sequence'].includes(operands[0].types.join())
            ? operands[0].types : resultTypes(operation);
    return { types, rank: shape.length, shape };
}
