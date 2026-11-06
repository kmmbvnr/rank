import { ownedArray, arrayValues } from './array-storage.js';
import { prepareStoredScalarView } from './integer-view.js';
import { checkpoint } from './interrupt.js';
import { prepareMatrixPower } from './modules/linalg.js';
import { arrayStrides, broadcastOffset, broadcastShape } from './tensor-layout.js';
import { isRankArray, type RankValue } from './value.js';

const sizeOf = (shape: readonly number[]) => shape.reduce((a, b) => a * b, 1);

/** Only stored integer cells are inspected: declining must not replay user code.
 * Snapshot operands before the modulus, which may mutate their original arrays. */
export function prepareRankedMatrixPower(source: RankValue, powers: RankValue) {
    if (!isRankArray(source) || source.shape.length < 2) return undefined;
    const matrixShape = source.shape.slice(-2), width = sizeOf(matrixShape);
    if (matrixShape[0] !== matrixShape[1] || width === 0) return undefined;
    const matrices = prepareStoredScalarView(source);
    const exponents = isRankArray(powers) ? prepareStoredScalarView(powers) : undefined;
    if (!matrices || isRankArray(powers) && !exponents) return undefined;
    const matrixFrame = source.shape.slice(0, -2);
    const exponentFrame = isRankArray(powers) ? powers.shape : [];
    const frame = broadcastShape(matrixFrame, exponentFrame);
    const count = sizeOf(frame);
    if (!count) return undefined;
    const cells: bigint[] = [], values: bigint[] = [];
    for (let i = 0; i < sizeOf(source.shape); i++) {
        checkpoint('preparing ranked matrix powers');
        const value = matrices.read(i);
        if (typeof value !== 'bigint') return undefined;
        cells.push(value);
    }
    for (let i = 0; i < sizeOf(exponentFrame); i++) {
        checkpoint('preparing ranked matrix powers');
        const value = exponents ? exponents.read(i) : powers;
        if (typeof value !== 'bigint' || value < 0n) return undefined;
        values.push(value);
    }
    const shape = [...frame, ...matrixShape];
    const matrixStrides = arrayStrides(matrixFrame), exponentStrides = arrayStrides(exponentFrame);
    return {
        run(modulus?: RankValue) {
            let moduli: bigint[] | undefined;
            if (typeof modulus === 'bigint' && modulus > 0n) moduli = [modulus];
            else if (modulus !== undefined && isRankArray(modulus)) {
                const view = prepareStoredScalarView(modulus);
                const combined = broadcastShape(shape, modulus.shape);
                const uniform = modulus.shape.slice(-2).every(n => n === 1);
                if (view && uniform && combined.length === shape.length
                    && combined.every((n, i) => n === shape[i])) {
                    const snapshot: bigint[] = [];
                    for (let i = 0; i < sizeOf(modulus.shape); i++) {
                        const value = view.read(i);
                        if (typeof value !== 'bigint' || value <= 0n) { snapshot.length = 0; break; }
                        snapshot.push(value);
                    }
                    if (snapshot.length) moduli = snapshot;
                }
            }
            if (modulus !== undefined && !moduli) return undefined;
            const modShape = modulus !== undefined && isRankArray(modulus) ? modulus.shape : [];
            const modStrides = arrayStrides(modShape);
            const output: RankValue[] = [];
            let last = -1, matrix = ownedArray([], matrixShape);
            for (let i = 0; i < count; i++) {
                checkpoint('computing ranked matrix powers');
                const offset = broadcastOffset(i, frame, matrixFrame, matrixStrides) * width;
                if (offset !== last) { matrix = ownedArray(cells.slice(offset, offset + width), matrixShape); last = offset; }
                const exponent = values[broadcastOffset(i, frame, exponentFrame, exponentStrides)];
                const mod = moduli?.[broadcastOffset(i * width, shape, modShape, modStrides)];
                const result = prepareMatrixPower(matrix, exponent).run(mod);
                for (const cell of arrayValues(result)) output.push(cell);
            }
            return ownedArray(output, shape);
        },
    };
}
