import { arrayCellCollector, collectArrayCells, collectArrayCellsInto, readArrayItem } from './array-read.js';
import { IntegerCells, typedArray } from './owned-array.js';
import { checkpoint, privateLoopPolling } from '../interrupt.js';
import type { RankArray, RankValue } from './value.js';

const int64Min = -(1n << 63n), int64Max = (1n << 63n) - 1n;

/** Complete numeric bindings directly into packed storage. If a later cell
 * needs ordinary storage, retain the prefix without replaying any reads. */
export function collectBindingCells(value: RankArray): RankArray | RankValue[] {
    // Observable host polling keeps the ordinary completion checkpoints.
    if (!privateLoopPolling()) return collectArrayCells(value);
    const collect = arrayCellCollector(value);
    if (collect) return collect();
    const shape = Object.getOwnPropertyDescriptor(value, 'shape');
    if (!shape || !('value' in shape)
        || ['columnNames', 'tableScopes', 'sortKeys'].some(key => key in value)) return collectArrayCells(value);
    const size = value.shape.reduce((n, dimension) => n * dimension, 1);
    if (size < 4096) return collectArrayCells(value);
    let integers: IntegerCells | undefined;
    let reals: Float64Array | undefined;
    let items: RankValue[] | undefined;
    return collectArrayCellsInto(value, {
        write(index, cell) {
            if (index === 0) {
                if (typeof cell === 'bigint') integers = new IntegerCells(size);
                else if (typeof cell === 'number') reals = new Float64Array(size);
                else items = new Array(size);
            }
            if (integers && typeof cell === 'bigint' && cell >= int64Min && cell <= int64Max) integers.set(index, cell);
            else if (reals && typeof cell === 'number') reals[index] = cell;
            else {
                if (!items) {
                    items = new Array(size);
                    const prefix = integers?.array([size]);
                    for (let previous = 0; previous < index; previous++) {
                        if ((previous & 4095) === 0) checkpoint('retaining binding prefix');
                        items[previous] = prefix ? readArrayItem(prefix, previous) : reals![previous];
                    }
                    integers = undefined;
                    reals = undefined;
                }
                items[index] = cell;
            }
            return items;
        },
        finish: () => integers?.array(value.shape) ?? (reals ? typedArray(reals, value.shape) : items!),
    });
}
