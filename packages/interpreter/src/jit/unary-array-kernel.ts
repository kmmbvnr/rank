import { IntegerCells, typedArray } from '../array-storage.js';
import { RankError } from '../errors.js';
import { prepareStoredScalarView } from '../integer-view.js';
import { checkpoint, inspectionEnabled, InterruptedError, privateLoopPolling } from '../interrupt.js';
import type { RankArray } from '../value.js';

/** A private numeric pass over completed storage. Failed domains retain the
 * ordinary demand path; no lazy or host cell is read to establish eligibility. */
export function mapStoredUnary(source: RankArray, input: 'real' | 'integer' | 'number',
    operation: (value: number) => number, result: 'real' | 'integer' = 'real'): RankArray | undefined {
    if (inspectionEnabled() || !privateLoopPolling()) return undefined;
    const view = prepareStoredScalarView(source, true);
    if (!view?.linear || !view.kinds?.length || !view.kinds.every(kind =>
        input !== 'integer' && (kind === 'real' || kind === 'numeric-limit')
        || input !== 'real' && kind === 'integer')) return undefined;
    const size = source.shape.reduce((n, dimension) => n * dimension, 1);
    if (size < 1024) return undefined;
    const { offset, stride } = view.linear;
    const cells = result === 'real' ? new Float64Array(size) : new Int32Array(size);
    let wide: IntegerCells | undefined;
    try {
        view.validateUniform?.(view.items[offset]);
        for (let start = 0; start < size; start += 4096) {
            const end = Math.min(size, start + 4096);
            checkpoint('computing numeric array', end - start);
            for (let index = start; index < end; index++) {
                const value = view.items[offset + index * stride];
                if (!view.validateUniform) view.validate?.(value, index);
                const number = Number(value);
                // Integer kernels may use Number registers only while exact.
                if (result === 'integer' && typeof value === 'bigint' && !Number.isSafeInteger(number)) return undefined;
                const computed = operation(number);
                if (result === 'integer') {
                    if (!Number.isInteger(computed)) return undefined;
                    if (!wide && computed !== (computed | 0)) {
                        wide = new IntegerCells(size);
                        for (let previous = 0; previous < index; previous++) {
                            if ((previous & 4095) === 0) checkpoint('widening integer array', Math.min(4096, index - previous));
                            wide.set(previous, BigInt(cells[previous]));
                        }
                    }
                    if (wide) { wide.set(index, BigInt(computed)); continue; }
                }
                cells[index] = computed;
            }
        }
    } catch (error) {
        if (error instanceof InterruptedError) throw error;
        if (error instanceof RankError) return undefined;
        throw error;
    }
    return wide ? wide.array(source.shape) : typedArray(cells, source.shape);
}
