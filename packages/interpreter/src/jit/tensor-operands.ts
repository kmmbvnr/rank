import { denseScalarItems, storedOperandItems } from '../array-storage.js';
import { prepareStoredScalarView } from '../integer-view.js';
import { broadcastShape } from './tensor-layout.js';
import type { RankArray, RankValue } from '../value.js';

export const DENSE_MIN_CELLS = 1024;

/** Plan eager numeric operands without forcing unread cells or host readers. */
export function prepareDenseOperands(left: RankValue, right: RankValue, realCode: number, allowSmall: boolean) {
    const leftArray = isArrayValue(left) ? left : undefined;
    const rightArray = isArrayValue(right) ? right : undefined;
    if (!leftArray && !isNumeric(left)) return undefined;
    if (!rightArray && !isNumeric(right)) return undefined;
    const shape = leftArray && rightArray
        ? broadcastShape(leftArray.shape, rightArray.shape) : (leftArray ?? rightArray!).shape;
    const size = shape.reduce((product, dimension) => product * dimension, 1);
    // Small stored numeric formulas need no lazy cell maps. Comparison masks
    // retain their lazy/read-only interface; unread or host operands decline.
    if (size < DENSE_MIN_CELLS) {
        if (!allowSmall || realCode > 4) return undefined;
        const numeric = (array: RankArray | undefined, scalar: RankValue) => {
            if (!array) return isNumeric(scalar);
            const items = denseScalarItems(array) && storedOperandItems(array);
            if (!items) {
                const view = prepareStoredScalarView(array, true);
                return view?.regular && numericKinds(view.kinds);
            }
            for (let index = 0; index < items.length; index++) {
                if (!isNumeric(items[index])) return false;
            }
            return true;
        };
        if (!numeric(leftArray, left) || !numeric(rightArray, right)) return undefined;
    }
    const leftItems = leftArray ? storedOperandItems(leftArray) : undefined;
    const rightItems = rightArray ? storedOperandItems(rightArray) : undefined;
    return { leftArray, rightArray, shape, size, leftItems, rightItems };
}

export const isArrayValue = (value: RankValue): value is RankArray =>
    typeof value === 'object' && value !== null && (value as { kind?: string }).kind === 'array';
export const isNumeric = (value: RankValue) => typeof value === 'number' || typeof value === 'bigint';
export const numericKinds = (kinds: readonly string[] | undefined): boolean => kinds !== undefined
    && (kinds.every(kind => kind === 'integer') || kinds.every(kind => kind === 'real' || kind === 'numeric-limit'));
