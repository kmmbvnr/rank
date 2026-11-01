import { checkpoint } from '../interrupt.js';
import { MissingValueError, RankError } from '../errors.js';
import { arithmeticRange } from '../range-plan.js';
import { ResourceSummary } from '../resource-summary.js';
import { registerStoredSequence } from './stored-value.js';
import { materializeValue } from '../materialize.js';
import { noteArrayBinding, ownedArray, readArrayItem, typedArray } from './array-storage.js';
import { isRankArray, isRankSequence, type RankArray, type RankSequence, type RankValue, type SequencePlan } from './value.js';

interface Common {
    readonly length: bigint;
    readonly height: number;
    readonly blocks: number;
    readonly scalar: boolean;
    readonly capture?: RankValue;
}
interface Range extends Common { readonly start: bigint; readonly step: bigint }
interface Cells extends Common { readonly items: readonly RankValue[]; readonly offset: number; readonly stride: number }
interface Branch extends Common { readonly left: Node; readonly right: Node; readonly reversed: boolean }
type Leaf = Range | Cells;
type Node = Leaf | Branch;
const roots = new WeakMap<SequencePlan, Node | null>();

function range(start: bigint, step: bigint, length: bigint): Range {
    return { start, step, length, height: 1, blocks: 1, scalar: true };
}
function capture(values: readonly RankValue[]): RankValue {
    const value = { kind: 'tuple' as const, items: [...values] };
    const resources = new ResourceSummary();
    resources.track(value);
    for (const item of values) resources.include(item);
    return value;
}
function branch(left: Node, right: Node): Branch {
    return { left, right, length: left.length + right.length,
        height: Math.max(left.height, right.height) + 1, blocks: left.blocks + right.blocks,
        scalar: left.scalar && right.scalar, reversed: false,
        ...(!left.scalar || !right.scalar ? { capture: capture([left.capture, right.capture].filter((x): x is RankValue => x !== undefined)) } : {}) };
}
function flip(node: Node): Node {
    if ('left' in node) return { ...node, reversed: !node.reversed };
    if ('start' in node) return range(node.start + node.step * (node.length - 1n), -node.step, node.length);
    return { ...node, offset: node.offset + Number(node.length - 1n) * node.stride, stride: -node.stride };
}
function children(node: Branch): [Node, Node] {
    return node.reversed ? [flip(node.right), flip(node.left)] : [node.left, node.right];
}
function balance(left: Node, right: Node): Node {
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
function join(left: Node | null, right: Node | null): Node | null {
    if (!left) return right;
    if (!right) return left;
    if ('start' in left && 'start' in right && left.step === right.step
        && left.start + left.step * left.length === right.start) {
        return range(left.start, left.step, left.length + right.length);
    }
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
function split(node: Node | null, count: bigint): [Node | null, Node | null] {
    if (!node || count === 0n) return [null, node];
    if (count >= node.length) return [node, null];
    if ('left' in node) {
        const [left, right] = children(node);
        if (count < left.length) {
            const [a, b] = split(left, count);
            return [a, join(b, right)];
        }
        const [a, b] = split(right, count - left.length);
        return [join(left, a), b];
    }
    if ('start' in node) return [range(node.start, node.step, count),
        range(node.start + node.step * count, node.step, node.length - count)];
    return [{ ...node, length: count },
        { ...node, length: node.length - count, offset: node.offset + Number(count) * node.stride }];
}
function item(node: Node, index: bigint): RankValue {
    let reversed = false;
    while ('left' in node) {
        reversed = reversed !== node.reversed;
        const left = reversed ? node.right : node.left;
        if (index < left.length) node = left;
        else { index -= left.length; node = reversed ? node.left : node.right; }
    }
    if (reversed) index = node.length - 1n - index;
    return 'start' in node ? node.start + node.step * index : node.items[node.offset + Number(index) * node.stride];
}
function* leaves(root: Node | null): Generator<Leaf> {
    const pending: { node: Node; reversed: boolean }[] = root ? [{ node: root, reversed: false }] : [];
    while (pending.length) {
        checkpoint('reading rope blocks');
        const { node, reversed } = pending.pop()!;
        if ('left' in node) {
            const back = reversed !== node.reversed;
            pending.push({ node: back ? node.left : node.right, reversed: back },
                { node: back ? node.right : node.left, reversed: back });
        } else yield (reversed ? flip(node) : node) as Leaf;
    }
}
function leafValue(leaf: Leaf): RankValue {
    if ('items' in leaf) return ownedArray(Array.from({ length: Number(leaf.length) }, (_, i) => leaf.items[leaf.offset + i * leaf.stride]));
    // A chunk is itself indexed and compressed, including for huge ranges.
    return wrap(leaf);
}
function wrap(root: Node | null): RankSequence {
    const scalar = !root || root.scalar;
    const plan: SequencePlan = {
        name: 'rope', replay: 'pure', size: Object.freeze({ kind: 'exact', value: root?.length ?? 0n }),
        ...(scalar && { scalarItems: true as const }),
        at: index => index < 0n || !root || index >= root.length ? undefined : item(root, index),
        *iterate() {
            for (const leaf of leaves(root)) {
                for (let i = 0n; i < leaf.length; i++) {
                    checkpoint('reading rope');
                    yield 'start' in leaf ? leaf.start + leaf.step * i : leaf.items[leaf.offset + Number(i) * leaf.stride];
                }
            }
        },
        // Share the storage dependency tree instead of capturing old rope plans.
        ...(root?.capture && { captures: [new Map([['Storage', root.capture]])] }),
    };
    const result = { kind: 'sequence' as const, plan, rope: true as const };
    roots.set(plan, root);
    if (scalar) registerStoredSequence(plan);
    else Object.freeze(plan);
    const resources = new ResourceSummary(() => scalar);
    resources.track(result);
    if (root?.capture) resources.include(root.capture);
    return result;
}
export function isRope(value: RankValue): value is RankSequence & { readonly rope: true } {
    return isRankSequence(value) && roots.has(value.plan);
}

/** Snapshot finite input once. Native arithmetic ranges remain one leaf. */
export function rope(value: RankValue): RankSequence {
    if (isRope(value)) return value;
    if (isRankSequence(value)) {
        const r = arithmeticRange(value.plan);
        if (r) return wrap(r.count ? range(r.start, r.step, r.count) : null);
        if (value.plan.size.kind === 'infinite') throw new RankError('rope requires a finite sequence', 'TypeError');
    }
    if (isRankArray(value) && value.shape.length !== 1) throw new RankError('rope expects a rank-1 array', 'TypeError');
    const input = typeof value === 'string' ? value
        : isRankSequence(value) ? { [Symbol.iterator]: () => value.plan.iterate() }
        : isRankArray(value) ? { *[Symbol.iterator]() { for (let i = 0; i < value.shape[0]; i++) yield readArrayItem(value, i); } }
        : undefined;
    if (!input) throw new RankError('rope expects text, an array or a finite sequence', 'TypeError');
    let root: Node | null = null;
    let buffer: RankValue[] = [];
    const flush = () => {
        if (!buffer.length) return;
        const items = buffer;
        const first = items[0], second = items[1];
        const step = typeof first === 'bigint' && typeof second === 'bigint' ? second - first : 0n;
        if (typeof first === 'bigint' && items.every((x, i) => typeof x === 'bigint' && x === first + BigInt(i) * step)) {
            root = join(root, range(first, step, BigInt(items.length)));
            buffer = [];
            return;
        }
        root = join(root, { items, offset: 0, stride: 1, length: BigInt(items.length),
            blocks: 1, height: 1, scalar: items.every(x => typeof x !== 'object'),
            ...(items.some(x => typeof x === 'object') && { capture: capture(items) }) });
        buffer = [];
    };
    for (const value of input) {
        checkpoint('building rope');
        const cell = materializeValue(value);
        noteArrayBinding(cell);
        buffer.push(cell);
        if (buffer.length === 256) flush();
    }
    flush();
    return wrap(root);
}
export function ropeSlice(value: RankSequence, count: bigint, drop: boolean): RankSequence {
    const root = roots.get(value.plan)!;
    const [left, right] = split(root, count);
    return wrap(drop ? right : left);
}
export function ropeConcat(values: readonly RankSequence[]): RankSequence {
    let root: Node | null = null;
    for (const value of values) { checkpoint('joining ropes'); root = join(root, roots.get(value.plan)!); }
    return wrap(root);
}
export function ropeReverse(value: RankSequence, left?: bigint, right?: bigint): RankSequence {
    const root = roots.get(value.plan)!;
    if (!root && left === undefined && right === undefined) return wrap(null);
    left ??= 0n;
    right ??= (root?.length ?? 0n) - 1n;
    if (!root || left < 0n || right >= root.length) throw new MissingValueError('rope index out of bounds');
    if (left > right) throw new RankError('rope reverse start must not exceed its end', 'DomainError');
    checkpoint('reversing rope');
    const [before, rest] = split(root, left);
    const [middle, after] = split(rest, right - left + 1n);
    return wrap(join(join(before, flip(middle!)), after));
}
export function ropeChunks(value: RankSequence): RankSequence {
    const root = roots.get(value.plan)!;
    return { kind: 'sequence', plan: { captures: [new Map([['Source', value]])], name: 'rope chunks', size: { kind: 'exact', value: BigInt(root?.blocks ?? 0) },
        *iterate() { for (const leaf of leaves(root)) yield leafValue(leaf); } } };
}
/** Numeric run metadata lets a caller reduce compressed sequences exactly. */
export function ropeRuns(value: RankSequence): RankArray {
    const root = roots.get(value.plan)!;
    let count = 0;
    for (const leaf of leaves(root)) count += 'start' in leaf ? 1 : Number(leaf.length);
    const out = new BigInt64Array(count * 3);
    let index = 0, fits = true;
    const triples = function* (): Generator<bigint> {
        for (const leaf of leaves(root)) {
            if ('start' in leaf) { yield leaf.start; yield leaf.step; yield leaf.length; }
            else for (let i = 0; i < Number(leaf.length); i++) {
                const cell = leaf.items[leaf.offset + i * leaf.stride];
                if (typeof cell !== 'bigint') throw new RankError('runs requires an integer rope', 'TypeError');
                yield cell; yield 0n; yield 1n;
            }
        }
    };
    for (const x of triples()) {
        if (x < -9223372036854775808n || x > 9223372036854775807n) fits = false;
        out[index++] = x;
    }
    return fits ? typedArray(out, [count, 3]) : ownedArray([...triples()], [count, 3]);
}
