import { arrayDependencyNode, arrayRevision, derivedArray, readArrayItem, registerArrayReadPlan } from './array-storage.js';
import { prepareIntegerView, registerIntegerReadPlan } from './integer-view.js';
import { inspectionEnabled } from './interrupt.js';
import { arrayOffset, coordinatesAt } from './tensor-index.js';
import { MISSING, type RankArray, type RankValue } from './value.js';
import { MissingValueError } from './errors.js';

interface Check { readonly owner: object; readonly apply: (value: RankValue) => RankValue }
interface Checked { readonly checks?: readonly Check[] }
interface Leaf extends Checked { readonly source: RankArray; readonly length: number; readonly height: 1 }
interface Branch extends Checked { readonly left: Part; readonly right: Part; readonly length: number; readonly height: number }
type Part = Leaf | Branch;
interface Concat {
    readonly axis: number;
    readonly dependency: RankArray;
    readonly shape: readonly number[];
    readonly root: Part | undefined;
    readonly read: RankArray['itemAt'];
}
const concats = new WeakMap<RankArray, Concat>();

/** Borrow only proven integer concat leaves, without materializing the rope.
 * Opaque readers and replaced readers remain on the ordinary collection path. */
export function integerConcatCells(value: RankArray):
    { length: number; read(index: number): bigint } | undefined {
    const concat = concats.get(value);
    if (!concat || concat.read !== value.itemAt || concat.shape.length !== 1 || value.columnNames) return undefined;
    const view = prepareIntegerView(value, true);
    return view && { length: concat.shape[0], read: view.read };
}

function branch(left: Part, right: Part): Branch {
    return { left, right, length: left.length + right.length, height: Math.max(left.height, right.height) + 1 };
}

function withChecks(part: Part, checks: readonly Check[] | undefined): Part {
    if (!checks?.length) return part;
    const owners = new Set(checks.map(check => check.owner));
    return { ...part, checks: [...checks, ...part.checks?.filter(check => !owners.has(check.owner)) ?? []] };
}

function children(part: Branch): [Part, Part] {
    return [withChecks(part.left, part.checks), withChecks(part.right, part.checks)];
}

/** Restore AVL balance after changing one path; preserve checks on their ranges. */
function balance(left: Part, right: Part): Part {
    if (left.height > right.height + 1 && 'left' in left) {
        const [a, b] = children(left);
        if (a.height >= b.height) return branch(a, branch(b, right));
        const [c, d] = children(b as Branch);
        return branch(branch(a, c), branch(d, right));
    }
    if (right.height > left.height + 1 && 'left' in right) {
        const [a, b] = children(right);
        if (b.height >= a.height) return branch(branch(left, a), b);
        const [c, d] = children(a as Branch);
        return branch(branch(left, c), branch(d, b));
    }
    return branch(left, right);
}

function join(left: Part | undefined, right: Part | undefined): Part | undefined {
    if (!left) return right;
    if (!right) return left;
    if (left.height > right.height + 1 && 'left' in left) {
        const [a, b] = children(left);
        return balance(a, join(b, right)!);
    }
    if (right.height > left.height + 1 && 'left' in right) {
        const [a, b] = children(right);
        return balance(join(left, a)!, b);
    }
    return branch(left, right);
}

/** A root binding checks cells without changing their positions. Preserve that
 * check in the rope instead of retaining a recursive reader for every append.
 * Repeated checks by the same binding share its current contract. */
export function inheritConcatCheck(source: RankArray, target: RankArray, owner: object,
    apply: (value: RankValue) => RankValue, version: RankArray): void {
    const prior = concats.get(source);
    if (!prior || prior.read !== source.itemAt) return;
    concats.set(target, { ...prior, dependency: arrayDependencyNode([prior.dependency, version]), root: prior.root && withChecks(prior.root, [{ owner, apply }]), read: target.itemAt });
}

/** Inputs have already passed concat's axis and shape checks. */
export function concatArrays(arrays: readonly RankArray[], shape: readonly number[], axis: number): RankArray {
    let root: Part | undefined;
    const dependencies: RankArray[] = [];
    for (const source of arrays) {
        const prior = concats.get(source);
        const reusable = prior?.axis === axis && prior.read === source.itemAt
            && prior.shape.length === source.shape.length
            && prior.shape.every((size, i) => size === source.shape[i]);
        // A host reader may have effects. Keep the original concat's per-cell
        // caching boundary when later joins bypass intermediate concat readers.
        const leaf = !reusable && source.shape[axis] !== 0 && arrayRevision(source) === undefined
            ? derivedArray(source.shape, [source], index => readArrayItem(source, index)) : source;
        const part = reusable ? prior.root : source.shape[axis] === 0 ? undefined
            : { source: leaf, length: source.shape[axis], height: 1 as const };
        root = join(root, part);
        dependencies.push(reusable ? prior.dependency : source);
    }
    // Share dependency nodes instead of retaining every obsolete reader/cache.
    const dependency = arrayDependencyNode(dependencies);
    const value = derivedArray(shape, [dependency], index => {
        const coordinates = coordinatesAt(shape, index);
        let part = root!;
        const checks: Check[] = [];
        for (;;) {
            if (part.checks) checks.push(...part.checks);
            if (!('left' in part)) break;
            if (coordinates[axis] < part.left.length) part = part.left;
            else { coordinates[axis] -= part.left.length; part = part.right; }
        }
        let item: RankValue;
        let missing: MissingValueError | undefined;
        try { item = readArrayItem(part.source, arrayOffset(part.source.shape, coordinates)); }
        catch (error) {
            if (!(error instanceof MissingValueError) || !error.soft) throw error;
            item = MISSING;
            missing = error;
        }
        const checked = new Set<object>();
        for (let i = checks.length - 1; i >= 0; i--) {
            const check = checks[i];
            if (checked.has(check.owner)) continue;
            checked.add(check.owner);
            item = check.apply(item);
        }
        if (missing) throw missing;
        return item;
    });
    concats.set(value, { axis, dependency, shape: [...shape], root, read: value.itemAt });
    registerArrayReadPlan(value, () => prepareIntegerConcat(root, shape, axis));
    registerIntegerReadPlan(value, () => prepareIntegerConcat(root, shape, axis, true));
    return value;
}

/** Copy pure integer leaves directly, without creating per-cell concat caches.
 * Preparing a leaf must prove its storage without evaluating lazy/host cells. */
function prepareIntegerConcat(root: Part | undefined, shape: readonly number[], axis: number, regular = false):
    ((index: number) => bigint) | undefined {
    if (inspectionEnabled() || !root) return undefined;
    const leaves: { end: number; length: number; read: (index: number) => bigint; checks: Check[] }[] = [];
    const pending: { part: Part; checks: readonly Check[] }[] = [{ part: root, checks: [] }];
    let end = 0;
    while (pending.length) {
        const { part, checks } = pending.pop()!;
        const inherited = [...checks, ...(part.checks ?? [])];
        if ('left' in part) {
            pending.push({ part: part.right, checks: inherited }, { part: part.left, checks: inherited });
            continue;
        }
        const integers = prepareIntegerView(part.source, true);
        if (!integers || regular && !integers.regular) return undefined;
        const owners = new Set<object>();
        const unique = inherited.reverse().filter(check => {
            if (owners.has(check.owner)) return false;
            owners.add(check.owner);
            return true;
        });
        end += part.length;
        leaves.push({ end, length: part.length, read: integers.read, checks: unique });
    }
    if (shape.length === 1) {
        // Collection kernels read a vector from left to right. Keep its current
        // leaf instead of searching the rope and computing tensor coordinates
        // for every cell. Arbitrary indexing still uses binary search.
        let current = 0;
        let start = 0;
        return index => {
            let leaf = leaves[current];
            if (index === leaf.end && current + 1 < leaves.length) {
                start = leaf.end;
                leaf = leaves[++current];
            } else if (index < start || index >= leaf.end) {
                let low = 0, high = leaves.length - 1;
                while (low < high) {
                    const middle = (low + high) >>> 1;
                    if (index < leaves[middle].end) high = middle;
                    else low = middle + 1;
                }
                current = low;
                leaf = leaves[current];
                start = leaf.end - leaf.length;
            }
            let item: RankValue = leaf.read(index - start);
            for (const check of leaf.checks) item = check.apply(item);
            return item as bigint;
        };
    }
    const stride = shape.slice(axis + 1).reduce((product, size) => product * size, 1);
    const width = shape[axis];
    return index => {
        const coordinate = Math.floor(index / stride) % width;
        let low = 0, high = leaves.length - 1;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (coordinate < leaves[middle].end) high = middle;
            else low = middle + 1;
        }
        const leaf = leaves[low];
        const position = coordinate - (leaf.end - leaf.length);
        const outer = Math.floor(index / (width * stride));
        let item: RankValue = leaf.read((outer * leaf.length + position) * stride + index % stride);
        for (const check of leaf.checks) item = check.apply(item);
        return item as bigint;
    };
}
