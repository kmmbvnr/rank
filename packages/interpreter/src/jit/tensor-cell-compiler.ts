import { compilerSource, observeCompilerSource, observedSourceRun, declineCompiler } from '../compiler-observation.js';
import { currentDiagnostics } from '../diagnostics.js';
import { checkpoint, interruptsEnabled } from '../interrupt.js';
import type { RankArray, RankValue } from '../value.js';

type Copy = (source: RankArray, coordinates: number[], shape: readonly number[]) => RankValue[] | undefined;
const kernels = new Map<string, Copy>();

/** Specialize axis routing, never dimensions, storage or element values. */
export function compileTensorCellCopy(rank: number, axes: readonly number[], size?: number): Copy | undefined {
    const sourceSite = compilerSource();
    const provenTypes = { rank: String(rank), axes: axes.join(', ') };
    return observeCompilerSource(sourceSite, 'tensor-cell-copy', 'prepare', () => compileTensorCellCopyObservedImplementation(rank, axes, size), provenTypes);
}

function compileTensorCellCopyObservedImplementation(rank: number, axes: readonly number[], size?: number): Copy | undefined {
    const generic = rank > 16;
    if (generic && size !== undefined && size < 32) {
        currentDiagnostics()?.compilerBudget('minimum generic copy cells', 32, size, 'ordinary copy for a small cell');
        return declineCompiler('copy-size-budget');
    }
    if (generic) currentDiagnostics()?.compilerBudget('unrolled tensor rank', 16, rank, 'generated axis loop');
    const interruptible = interruptsEnabled();
    const key = `${interruptible}:${rank}:${axes.join(',')}`;
    const cached = kernels.get(key);
    if (cached) return cached;
    const decode = generic ? `for (let position = routes.length - 1; position >= 0; position--) {
        coordinates[routes[position]] = remaining % shape[position];
        remaining = Math.floor(remaining / shape[position]);
    }` : axes.map((axis, position) =>
        `coordinates[${axis}] = remaining % shape[${position}]; remaining = Math.floor(remaining / shape[${position}]);`)
        .reverse().join('\n');
    let offset = '0';
    for (let axis = 0; !generic && axis < rank; axis++) offset = `(${offset} * dimensions[${axis}] + coordinates[${axis}])`;
    const source = `"use strict"; return function(source, coordinates, shape) {
        if (coordinates.length !== ${rank}) return decline('coordinate-rank-guard');
        const size = shape.reduce((a, b) => a * b, 1);
        const items = [];
        for (let linear = 0; linear < size; linear++) {
            ${interruptible ? "checkpoint('copying tensor cell');" : ''}
            let remaining = linear;
            if (shape.length === ${axes.length}) { ${decode} }
            else {
                // Public cell shapes may be resized by a host element reader.
                const cell = Array(shape.length).fill(0);
                for (let i = shape.length - 1; i >= 0; i--) {
                    cell[i] = remaining % shape[i];
                    remaining = Math.floor(remaining / shape[i]);
                }
                ${generic ? 'for (let i = 0; i < routes.length; i++) coordinates[routes[i]] = cell[i];'
                    : axes.map((axis, i) => `coordinates[${axis}] = cell[${i}];`).join('\n')}
            }
            // Preserve getter order and one storage access per atom.
            const storage = source.items;
            const dimensions = source.shape;
            ${generic ? `let offset = 0;
            for (let axis = 0; axis < ${rank}; axis++) offset = offset * dimensions[axis] + coordinates[axis];` : ''}
            items.push(storage[${generic ? 'offset' : offset}]);
        }
        return items;
    };`;
    try {
        const kernel = new Function('checkpoint', 'decline', 'routes', source)(checkpoint, declineCompiler, [...axes]) as Copy;
        // A stored generator can resume under a later preview or interrupt.
        // Keep its unchecked specialization behind a call-time scope guard.
        const routes = [...axes];
        const copy: Copy = interruptible ? kernel : (value, coordinates, shape) =>
            interruptsEnabled() ? compileTensorCellCopy(rank, routes)?.(value, coordinates, shape)
                : kernel(value, coordinates, shape);
        // Shared axis kernels keep their identity and inherit each caller's source.
        const observed = observedSourceRun({ node: 'NativeDemand', operation: 'tensor cell copy' },
            'tensor-cell-copy', copy, { rank: String(rank), axes: axes.join(', ') });
        if (kernels.size >= 32) kernels.delete(kernels.keys().next().value!);
        kernels.set(key, observed);
        return observed;
    } catch { return declineCompiler('dynamic-code-unavailable'); }
}
