import type { NumericUpdateExpression } from '@arrrank/language';
import { arithmeticRange } from '../range-plan.js';
import { prepareStoredScalarView } from './integer-view.js';
import { writeComputedSelection, denseScalarItems, storedScalarKinds } from './array-storage.js';
import { tensorSelection } from '../selectors.js';
import { sameShape } from '../tensor-index.js';
import { inspectionEnabled, privateLoopPolling } from '../interrupt.js';
import { RankError } from '../errors.js';
import type { Operators } from '../operators.js';
import { isRankArray, isRankSequence, type RankArray, type RankValue } from './value.js';

type Cells = Int32Array | Float64Array;
type Kind = 'integer' | 'real';
interface Input { cells: Cells; offset: number; stride: number }
interface Bound { kind: Kind; code: string; scalar?: bigint | number; exact(index: number): bigint | number }
interface Selection { shape: readonly number[]; unique?: boolean; linear?: { offset: number; stride: number } }
interface Host { resolveVariable(name: string): RankValue; readonly operators: Operators }
type Kernel = (dst: Cells, a: Cells[], o: number[], s: number[], c: number[], offset: number, stride: number, start: number, end: number) => number;

/** A discarded numeric RHS can feed a unique linear write directly. Syntax is
 * supplied by language analysis; guards inspect only ready native values. */
export function computedArrayUpdate(expression: NumericUpdateExpression, assignment: string) {
    if (!['+=', '-=', '*=', '/=', '//='].includes(assignment)) return undefined;
    const operation = assignment.slice(0, -1);
    const cache = new Map<string, Kernel | undefined>();
    return (target: RankArray, selection: Selection, host: Host): {
        representative: bigint | number; write(destination: RankArray): boolean;
    } | undefined => {
        if (inspectionEnabled() || !privateLoopPolling() || !selection.unique || !selection.linear || !denseScalarItems(target)
            || target.columnNames || target.tableScopes) return undefined;
        const count = selection.shape.reduce((a, b) => a * b, 1);
        if (count < 64) return undefined;
        const destination = storage(target);
        if (!destination || destination.offset !== 0 || destination.stride !== 1) return undefined;
        const targetKind: Kind = destination.cells instanceof Int32Array ? 'integer' : 'real';
        const inputs: Input[] = [], scalars: number[] = [], lines: string[] = [];
        let temporary = 0;
        const scalar = (value: RankValue): Bound | undefined => {
            if (typeof value !== 'bigint' && typeof value !== 'number') return undefined;
            if (typeof value === 'bigint' ? value < -2147483648n || value > 2147483647n : !Number.isFinite(value)) return undefined;
            const slot = scalars.push(Number(value)) - 1;
            return { kind: typeof value === 'bigint' ? 'integer' : 'real', code: `c[${slot}]`, scalar: value, exact: () => value };
        };
        const array = (value: RankValue, selectors?: RankValue[]): Bound | undefined => {
            if (!isRankArray(value)) return undefined;
            const input = storage(value);
            if (!input || value.columnNames) return undefined;
            const selected = selectors ? tensorSelection(value, selectors) : undefined;
            const shape = selected?.shape ?? value.shape;
            const linear = selected?.linear ?? (!selectors ? { offset: 0, stride: 1 } : undefined);
            if (!linear) return undefined;
            const offset = input.offset + linear.offset * input.stride, stride = input.stride * linear.stride;
            if (shape.length === 0) return scalar(input.cells instanceof Int32Array ? BigInt(input.cells[offset]) : input.cells[offset]);
            if (!sameShape(shape, selection.shape)) return undefined;
            const span = { cells: input.cells, offset, stride };
            if (!safeReads(span, destination.cells, selection.linear!, count)) return undefined;
            const slot = inputs.push(span) - 1;
            return { kind: input.cells instanceof Int32Array ? 'integer' : 'real',
                code: `a[${slot}][o[${slot}] + i * s[${slot}]]`,
                exact: i => input.cells instanceof Int32Array ? BigInt(input.cells[offset + i * stride]) : input.cells[offset + i * stride] };
        };
        const ready = (node: NumericUpdateExpression): RankValue | undefined => node.kind === 'literal' ? node.value
            : node.kind === 'name' ? host.resolveVariable(node.name) : undefined;
        const bind = (node: NumericUpdateExpression): Bound | undefined => {
            if (node.kind === 'literal') return scalar(node.value);
            if (node.kind === 'name') {
                const value = host.resolveVariable(node.name);
                return isRankArray(value) ? array(value) : scalar(value);
            }
            if (node.kind === 'select') {
                const selectors = node.selectors.map(ready);
                if (!selectors.every((value): value is RankValue => trustedSelector(value))) return undefined;
                return array(host.resolveVariable(node.name), selectors);
            }
            const left = bind(node.left), right = bind(node.right);
            if (!left || !right) return undefined;
            if (node.operator === '/' || node.operator === '//') {
                if (right.scalar === undefined || right.scalar === 0 || right.scalar === 0n) return undefined;
                if (node.operator === '//' && (left.kind !== 'integer' || right.kind !== 'integer')) return undefined;
            }
            if (left.scalar !== undefined && right.scalar !== undefined) {
                return scalar(host.operators.evaluateBinary(node.operator, left.scalar, right.scalar));
            }
            const kind: Kind = node.operator === '/' || left.kind === 'real' || right.kind === 'real' ? 'real' : 'integer';
            const name = `v${temporary++}`;
            const code = node.operator === '//' ? `Math.floor((${left.code}) / (${right.code}))`
                : `(${left.code}) ${node.operator} (${right.code})`;
            lines.push(`const ${name} = ${code};`);
            if (kind === 'integer') lines.push(`if (${name} !== (${name} | 0)) return i;`);
            return { kind, code: name, exact: i => host.operators.evaluateBinary(node.operator, left.exact(i), right.exact(i)) as bigint | number };
        };
        let rhs: Bound | undefined;
        try { rhs = bind(expression); }
        catch (error) { if (error instanceof RankError) return undefined; throw error; }
        if (!rhs || targetKind === 'integer' && rhs.kind !== 'integer') return undefined;
        if (operation === '/' || operation === '//') {
            if (rhs.scalar === undefined || rhs.scalar === 0 || rhs.scalar === 0n
                || operation === '//' && targetKind !== 'integer' || operation === '/' && targetKind !== 'real') return undefined;
        }
        const update = operation === '//' ? `Math.floor(dst[p] / (${rhs.code}))` : `dst[p] ${operation} (${rhs.code})`;
        const source = `for (let i = start; i < end; i++) {\n${lines.join('\n')}\nconst p = offset + i * stride;\nconst next = ${update};\n${targetKind === 'integer' ? 'if (next !== (next | 0)) return i;' : 'if (!Number.isFinite(next)) return i;'}\ndst[p] = next;\n}\nreturn end;`;
        if (!cache.has(source)) {
            try { cache.set(source, new Function('dst', 'a', 'o', 's', 'c', 'offset', 'stride', 'start', 'end', source) as Kernel); }
            catch { cache.set(source, undefined); }
        }
        const kernel = cache.get(source);
        if (!kernel) return undefined;
        const cells = inputs.map(input => input.cells), offsets = inputs.map(input => input.offset), strides = inputs.map(input => input.stride);
        const { offset, stride } = selection.linear;
        const exact = rhs.exact;
        return { representative: targetKind === 'integer' ? 0n : 0,
            write: target => writeComputedSelection(target, count, offset, stride,
                (dst, start, end) => kernel(dst, cells, offsets, strides, scalars, offset, stride, start, end),
                (i, old) => host.operators.evaluateBinary(operation, old, exact(i)) as bigint | number) };
    };
}

function storage(value: RankArray): Input | undefined {
    if (!denseScalarItems(value)) return undefined;
    const view = prepareStoredScalarView(value, true);
    if (!view || view.validate || !view.linear) return undefined;
    const cells = view.compact ?? (view.items instanceof Float64Array ? view.items : undefined);
    return cells ? { cells, ...view.linear } : undefined;
}

function trustedSelector(value: RankValue | undefined): boolean {
    if (value === undefined) return false;
    if (typeof value === 'bigint') return true;
    if (isRankSequence(value)) return arithmeticRange(value.plan) !== undefined;
    return isRankArray(value) && denseScalarItems(value) !== undefined && storedScalarKinds(value)?.join() === 'integer';
}

/** Aligned aliases read each original cell before writing it. Disjoint spans
 * cannot observe earlier writes. Other overlaps keep snapshot semantics. */
function safeReads(input: Input, target: Cells, linear: { offset: number; stride: number }, count: number): boolean {
    if (input.cells.buffer !== target.buffer) return true;
    const a = input.cells.byteOffset + input.offset * input.cells.BYTES_PER_ELEMENT;
    const b = target.byteOffset + linear.offset * target.BYTES_PER_ELEMENT;
    const as = input.stride * input.cells.BYTES_PER_ELEMENT, bs = linear.stride * target.BYTES_PER_ELEMENT;
    if (a === b && as === bs && input.cells.BYTES_PER_ELEMENT === target.BYTES_PER_ELEMENT) return true;
    const al = a + (count - 1) * as, bl = b + (count - 1) * bs;
    return Math.max(a, al) + input.cells.BYTES_PER_ELEMENT <= Math.min(b, bl)
        || Math.max(b, bl) + target.BYTES_PER_ELEMENT <= Math.min(a, al);
}
