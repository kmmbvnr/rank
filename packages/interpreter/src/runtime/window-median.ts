import { checkpoint, demandBudgetEnabled, inspectionEnabled, privateLoopPolling } from '../interrupt.js';
import { slidingWindow } from '../sequence.js';
import { prepareNativeScalarView, prepareStoredScalarView } from './integer-view.js';
import { typedArray } from './owned-array.js';
import type { RankArray } from './value.js';

/** Overlapping integer windows share a frequency tree instead of sorting
 * each cell independently. Memory is bounded by the source's value span. */
export function windowMedian(value: RankArray, axes: readonly number[]): RankArray | undefined {
    if (axes.length !== 1 || axes[0] !== 1 || !privateLoopPolling() || demandBudgetEnabled() || inspectionEnabled()) return undefined;
    const checks: ((cell: bigint, index: number) => unknown)[] = [];
    let input = value, window = slidingWindow(input);
    for (let depth = 0; !window && depth < 128; depth++) {
        if (Object.getOwnPropertyDescriptor(input, 'itemAt')?.get
            || Object.getOwnPropertyDescriptor(input, 'shape')?.get) return undefined;
        const view = prepareNativeScalarView(input);
        if (!view || !view.uniform || !view.replaySafe || !view.valid()
            || view.linear?.offset !== 0 || view.linear.stride !== 1
            || view.source.shape.length !== input.shape.length
            || view.source.shape.some((n, axis) => n !== input.shape[axis])) return undefined;
        if (view.validate) checks.push(view.validate);
        input = view.source;
        window = slidingWindow(input);
    }
    if (!window || value.columnNames || value.tableScopes || value.sortKeys) return undefined;
    const { source, width, count } = window;
    if (width > 2147483647 || count > 2147483647) return undefined;
    if (count === 0) return typedArray(new Float64Array(0));
    const view = prepareStoredScalarView(source, true);
    if (!view?.compact || view.source.columnNames || view.source.tableScopes || view.source.sortKeys
        || view.validate && !view.validateUniform
        || typeof SharedArrayBuffer !== 'undefined' && view.compact.buffer instanceof SharedArrayBuffer) return undefined;
    view.validateUniform?.(0n);
    for (const validate of checks) validate(0n, 0);
    const size = source.shape[0];
    const cells = view.compact;
    const linear = view.linear;
    const read = linear ? (i: number) => cells[linear.offset + i * linear.stride]
        : (i: number) => cells[view.position(i)];
    let minimum = Infinity, maximum = -Infinity;
    for (let i = 0; i < size; i++) {
        if ((i & 4095) === 0) checkpoint('preparing window medians', Math.min(4096, size - i));
        const cell = read(i);
        if (cell < minimum) minimum = cell;
        if (cell > maximum) maximum = cell;
    }
    const span = maximum - minimum + 1;
    // Avoid a large domain allocation for a short or sparse-valued input.
    if (span > 1048576 || span > Math.max(256, size * 4)) return undefined;
    // Nearby medians walk a few frequency cells. A tree over 64-cell
    // blocks bounds long jumps without paying a full rank search per slide.
    const blockWidth = 64, blocks = Math.ceil(span / blockWidth);
    const frequencies = new Int32Array(span);
    let tree: Int32Array | undefined;
    let top = 1;
    while (top * 2 <= blocks) top *= 2;
    const add = (cell: number, amount: number) => {
        const index = cell - minimum;
        frequencies[index] += amount;
        if (tree) for (let at = Math.floor(index / blockWidth) + 1; at <= blocks; at += at & -at) tree[at] += amount;
    };
    const firstRank = Math.floor((width + 1) / 2), secondRank = Math.floor((width + 2) / 2);
    const locate = (rank: number): [number, number] => {
        // Most slides only move within nearby frequencies. Build the index
        // once, on the first long jump; subsequent stores keep it current.
        if (!tree) {
            tree = new Int32Array(blocks + 1);
            for (let i = 0; i < span; i++) {
                if ((i & 4095) === 0) checkpoint('indexing window frequencies', Math.min(4096, span - i));
                tree[Math.floor(i / blockWidth) + 1] += frequencies[i];
            }
            for (let i = 1; i <= blocks; i++) {
                const parent = i + (i & -i);
                if (parent <= blocks) tree[parent] += tree[i];
            }
        }
        let block = 0, below = 0;
        for (let step = top; step; step >>= 1) {
            const next = block + step;
            if (next <= blocks && below + tree[next] < rank) { block = next; below += tree[next]; }
        }
        let index = block * blockWidth;
        while (below + frequencies[index] < rank) below += frequencies[index++];
        return [index, below];
    };
    let lower = 0, below = 0;
    const median = () => {
        let walked = 0;
        while (below >= firstRank && walked < blockWidth) { below -= frequencies[--lower]; walked++; }
        while (below + frequencies[lower] < firstRank && walked < blockWidth) { below += frequencies[lower++]; walked++; }
        if (below >= firstRank || below + frequencies[lower] < firstRank) [lower, below] = locate(firstRank);
        let upper = lower;
        if (below + frequencies[lower] < secondRank) {
            walked = 0;
            do { upper++; walked++; } while (upper < span && frequencies[upper] === 0 && walked < blockWidth);
            if (upper >= span || frequencies[upper] === 0) upper = locate(secondRank)[0];
        }
        return minimum + (lower + upper) / 2;
    };
    for (let i = 0; i < width; i++) {
        if ((i & 4095) === 0) checkpoint('initializing window medians', Math.min(4096, width - i));
        add(read(i), 1);
    }
    const output = new Float64Array(count);
    while (below + frequencies[lower] < firstRank) {
        if ((lower & 4095) === 0) checkpoint('locating first median', Math.min(4096, span - lower));
        below += frequencies[lower++];
    }
    output[0] = median();
    for (let frame = 1; frame < count; frame++) {
        if ((frame & 4095) === 0) checkpoint('computing window medians', Math.min(4096, count - frame));
        const removed = read(frame - 1), added = read(frame + width - 1);
        add(removed, -1);
        add(added, 1);
        if (removed - minimum < lower) below--;
        if (added - minimum < lower) below++;
        output[frame] = median();
    }
    return typedArray(output);
}
