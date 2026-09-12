import type { RankArray, RankValue } from './value.js';

type Copy = (source: RankArray, coordinates: number[], shape: readonly number[]) => RankValue[] | undefined;
const kernels = new Map<string, Copy>();

/** Specialize axis routing, never dimensions, storage or element values. */
export function compileTensorCellCopy(rank: number, axes: readonly number[]): Copy | undefined {
    if (rank > 16) return undefined;
    const key = `${rank}:${axes.join(',')}`;
    const cached = kernels.get(key);
    if (cached) return cached;
    const decode = axes.map((axis, position) =>
        `coordinates[${axis}] = remaining % shape[${position}]; remaining = Math.floor(remaining / shape[${position}]);`)
        .reverse().join('\n');
    let offset = '0';
    for (let axis = 0; axis < rank; axis++) offset = `(${offset} * dimensions[${axis}] + coordinates[${axis}])`;
    const source = `"use strict"; return function(source, coordinates, shape) {
        if (coordinates.length !== ${rank}) return undefined;
        const size = shape.reduce((a, b) => a * b, 1);
        const items = [];
        for (let linear = 0; linear < size; linear++) {
            let remaining = linear;
            if (shape.length === ${axes.length}) { ${decode} }
            else {
                // Public cell shapes may be resized by a host element reader.
                const cell = Array(shape.length).fill(0);
                for (let i = shape.length - 1; i >= 0; i--) {
                    cell[i] = remaining % shape[i];
                    remaining = Math.floor(remaining / shape[i]);
                }
                ${axes.map((axis, i) => `coordinates[${axis}] = cell[${i}];`).join('\n')}
            }
            // Preserve getter order and one storage access per atom.
            const storage = source.items;
            const dimensions = source.shape;
            items.push(storage[${offset}]);
        }
        return items;
    };`;
    try {
        const copy = new Function(source)() as Copy;
        kernels.set(key, copy);
        return copy;
    } catch { return undefined; }
}
