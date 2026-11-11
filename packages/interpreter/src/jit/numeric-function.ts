import { observeCompiler, observedRun, declineCompiler, withCompilerMethods } from '../compiler-observation.js';
import {
    applicationForm, flattenApplication, isAllAxisExpression, isArrayExpression, isApplicationExpression, isAssignmentStatement,
    isBinaryExpression, isNameExpression, isNumberLiteral, isParenthesizedExpression,
    isReturnStatement, isTupleExpression, isUnaryExpression, isUnpackStatement,
    type Expression, type FunctionStatement,
} from '@arrrank/language';
import { InterruptedError, interruptsEnabled, privateLoopPolling } from '../interrupt.js';
import { RankError } from '../errors.js';
import { currentDiagnostics, recordFallback } from '../diagnostics.js';
import { ownedStorage } from '../array-storage-state.js';
import { MAX_HELD_CELLS, realCells, storedScalarKinds, typedArray } from '../array-storage.js';
import { tuple, type RankArray, type RankValue } from '../value.js';
import { broadcastShape } from '../tensor.js';
import { inputBounds } from './tensor-bounds.js';
import { safeIntegerSquareRoot } from '../integer-square-root.js';
import { floorDivide, floorRemainder } from '../numeric-division.js';
import { reshapeDimensions } from './tensor-layout.js';
import { emitNumericFunction, type NumericRun } from './numeric-function-codegen.js';

export type NumericNode = { kind: 'input'; name: string } | { kind: 'constant'; value: number; integer: boolean }
    | { kind: 'unary'; op: string; child: NumericNode }
    | { kind: 'binary'; op: string; left: NumericNode; right: NumericNode }
    | { kind: 'integer'; source: NumericNode } | { kind: 'length'; source: NumericNode } | { kind: 'sqrt'; source: NumericNode } | { kind: 'sum'; source: NumericNode }
    | { kind: 'math'; op: 'sqrt' | 'asin' | 'log' | 'exp'; source: NumericNode }
    | { kind: 'choose'; condition: NumericNode; yes: NumericNode; no: NumericNode }
    | { kind: 'range'; start: NumericNode; end: NumericNode; inclusive: boolean }
    | { kind: 'reshape'; source: NumericNode; dimensions: (NumericNode | undefined)[] }
    | { kind: 'slice'; source: NumericNode; axis: number; position: number; count: number }
    | { kind: 'gather'; source: NumericNode; indices: NumericNode }
    | { kind: 'concat'; sources: NumericNode[]; axis: number };
export interface NumericBound {
    shape: readonly number[]; size: number; integer: boolean;
    scalar?: number; data?: number; low?: number; high?: number; boolean?: boolean;
}
interface Host {
    lookup(name: string): RankValue | undefined;
    buffer?(name: string): NumericBuffer | undefined;
    builtin(name: string): boolean;
    compiled(source: string): void;
    executed(): void;
}
const unwrap = (e: Expression): Expression => isParenthesizedExpression(e) ? unwrap(e.value) : e;
const sizeOf = (shape: readonly number[]) => shape.reduce((a, b) => a * b, 1);
const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const safe = (n: number) => Number.isSafeInteger(n);
// A named binding completes a range into an array; an inline range is still
// a sequence, and ordinary unary +/- do not accept sequence operands.
function inlineRange(expression: Expression, budget = { left: 512 }): boolean {
    if (--budget.left < 0) return true;
    const e = unwrap(expression);
    return isBinaryExpression(e) && (e.operator === 'to' || e.operator === 'till'
        || inlineRange(e.left, budget) || inlineRange(e.right, budget))
        || isUnaryExpression(e) && inlineRange(e.operand, budget);
}

/** Invocation-private array registers; never accepted as ordinary host values. */
export class NumericBuffer {
    constructor(readonly cells: ArrayLike<number>, readonly shape: readonly number[],
        readonly integer = false, readonly low?: number, readonly high?: number) {}
}

/** Borrow completed real or Int32 storage, with no user-defined readers.
 * Integer bounds share the revision-checked tensor evidence cache. */
export function borrowNumericBuffer(value: RankValue | undefined): NumericBuffer | undefined {
    const state = value && typeof value === 'object' ? ownedStorage.get(value as RankArray) : undefined;
    if (!state?.stable || !state.scalarOnly || state.validity || state.readOnlyCells
        || state.typed && !(state.typed instanceof Float64Array) && !(state.typed instanceof Int32Array)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, 'shape');
    if (!descriptor || !('value' in descriptor) || !same(descriptor.value, state.shape)
        || Object.getOwnPropertyDescriptor(value, 'itemAt') || Object.getOwnPropertyDescriptor(value, 'columnNames')
        || Object.getOwnPropertyDescriptor(value, 'tableScopes') || Object.getOwnPropertyDescriptor(value, 'sortKeys')
        || storedScalarKinds(value as RankArray, true)?.join() !== (state.typed instanceof Int32Array ? 'integer' : 'real')) return undefined;
    const cells = state.typed instanceof Int32Array ? state.typed : realCells(value as RankArray), shape = [...state.shape];
    if (!cells || !shape.length || sizeOf(shape) !== cells.length
        || ArrayBuffer.isView(cells) && !(cells.buffer instanceof ArrayBuffer)) return undefined;
    if (cells instanceof Int32Array) {
        if (!cells.length) return undefined;
        const bounds = inputBounds(value as RankArray, cells);
        return bounds && new NumericBuffer(cells, shape, true, Number(bounds.low), Number(bounds.high));
    }
    return new NumericBuffer(cells, shape);
}

/** A pure function boundary lets structural numeric intermediates stay virtual.
 * Inputs are completed tracked real/Int32 arrays; speculative storage stays
 * unpublished. Integer operations and reduction prefixes are exact or replay.
 * A declined shape, arithmetic or type guard replays the ordinary function. */
export function compileNumericFunction(statement: FunctionStatement, host: Host) {
    const provenTypes = undefined;
    const candidate = observeCompiler(statement, 'numeric-function', 'prepare', () => compileNumericFunctionObservedImplementation(statement, host), provenTypes);
    return candidate && withCompilerMethods(candidate, { run: observedRun(statement, 'numeric-function', candidate.run.bind(candidate), provenTypes), runBuffers: observedRun(statement, 'numeric-function', candidate.runBuffers.bind(candidate), provenTypes) });
}

function compileNumericFunctionObservedImplementation(statement: FunctionStatement, host: Host) {
    const commands = statement.statements, last = commands.at(-1);
    if (!last || !isReturnStatement(last) || !last.value) return declineCompiler('terminal-return-required', statement);
    if (commands.length > 64) return declineCompiler('statement-budget', statement);
    if (statement.ranks.length) return declineCompiler('ranked-signature', statement);
    if ([...statement.leftBindings, ...statement.rightBindings].some(p => p.deferred || typeof p.name !== 'string')) return declineCompiler('deferred-or-functional-parameter', statement);
    const parameters = new Set(statement.parameters);
    if (parameters.size !== statement.parameters.length) return declineCompiler('duplicate-parameter', statement);
    const captures = new Set<string>();
    const definitions = new Map<string, NumericNode>(), assignments: { name: string; node: NumericNode }[] = [];
    const builtins = new Set<string>();
    let budget = 512;
    function parse(expression: Expression): NumericNode | undefined {
        if (--budget < 0) return declineCompiler('expression-budget', expression);
        const e = unwrap(expression);
        if (isNameExpression(e)) {
            const defined = definitions.get(e.name);
            if (defined) return defined;
            if (!parameters.has(e.name)) captures.add(e.name);
            return { kind: 'input', name: e.name };
        }
        if (isNumberLiteral(e)) {
            const value = Number(e.value), integer = typeof e.value === 'bigint';
            return Number.isFinite(value) && (!integer || safe(value)) ? { kind: 'constant', value, integer } : undefined;
        }
        if (isUnaryExpression(e) && ['+', '-'].includes(e.operator)) {
            if (inlineRange(e.operand)) return declineCompiler('unary-inline-range', e);
            const child = parse(e.operand);
            return child && { kind: 'unary', op: e.operator, child };
        }
        if (isBinaryExpression(e) && !e.step) {
            const left = parse(e.left), right = parse(e.right);
            if (!left || !right) return undefined;
            if (e.operator === 'till' || e.operator === 'to') {
                return { kind: 'range', start: left, end: right, inclusive: e.operator === 'to' };
            }
            if (['+', '-', '*', '/', '//', 'mod', 'equal', 'notequal', 'less', 'greater', 'atmost', 'atleast'].includes(e.operator)) return { kind: 'binary', op: e.operator, left, right };
        }
        if (isApplicationExpression(e)) {
            const form = applicationForm(e);
            if (form.kind === 'reshape' && !form.rest.length) {
                const source = parse(form.source);
                const dimensions = form.dimensions.map(part => isAllAxisExpression(part) ? undefined : parse(part));
                if (!source || dimensions.some((d, i) => !d && !isAllAxisExpression(form.dimensions[i]))) return undefined;
                builtins.add('reshape');
                return { kind: 'reshape', source, dimensions };
            }
            if (form.kind === 'array-combine-constructor' && form.operation === 'concat' && !form.rest.length) {
                const axis = form.axis && unwrap(form.axis);
                if (axis && (!isNumberLiteral(axis) || typeof axis.value !== 'bigint' || axis.value < 0n || axis.value > 15n)) return undefined;
                const sources = form.items.map(parse);
                if (!sources.length || sources.some(s => !s)) return undefined;
                builtins.add('concat');
                return { kind: 'concat', sources: sources as NumericNode[], axis: axis ? Number(axis.value) : 0 };
            }
            const parts = flattenApplication(e);
            if (parts.length === 3 && isNameExpression(parts[2]) && ['band', 'bor', 'bxor', 'min', 'max'].includes(parts[2].name)) {
                const left = parse(parts[0]), right = parse(parts[1]);
                builtins.add(parts[2].name);
                return left && right ? { kind: 'binary', op: parts[2].name, left, right } : undefined;
            }
            if (parts.length === 4 && isNameExpression(parts[3]) && parts[3].name === 'choose') {
                const condition = parse(parts[0]), yes = parse(parts[1]), no = parse(parts[2]);
                builtins.add('choose');
                return condition && yes && no ? { kind: 'choose', condition, yes, no } : undefined;
            }
            const tail = e.arguments.length === 1 ? e.arguments[0] : undefined;
            if (tail && isNameExpression(tail) && ['sum', 'isqrt', 'sqrt', 'asin', 'log', 'exp', 'copy', 'len', 'integer'].includes(tail.name)) {
                const source = parse(e.head), word = tail.name;
                builtins.add(word); if (['sqrt', 'asin', 'log', 'exp'].includes(word)) {
                    return source ? { kind: 'math', op: word as 'sqrt' | 'asin' | 'log' | 'exp', source } : undefined;
                }
                return source && (word === 'copy' ? source : { kind: word === 'isqrt' ? 'sqrt' : word === 'len' ? 'length' : word === 'integer' ? 'integer' : 'sum', source });
            }
            if (parts.length === 2) {
                const source = parse(parts[0]), indices = parse(parts[1]);
                if (!source || !indices) return undefined;
                return { kind: 'gather', source, indices };
            }
        }
        return declineCompiler('unsupported-expression', expression);
    }
    for (const command of commands.slice(0, -1)) {
        if (isAssignmentStatement(command) && command.operator === '=' && !command.deferred && !command.name.includes('.')) {
            const node = parse(command.value);
            if (!node) return undefined;
            definitions.set(command.name, node); assignments.push({ name: command.name, node });
        } else if (isUnpackStatement(command)) {
            const parts = isApplicationExpression(command.value) ? flattenApplication(command.value) : [command.value];
            let axis = 0, expression = command.value;
            if (parts.length === 3 && isNameExpression(parts[1]) && parts[1].name === 'axis' && isNumberLiteral(parts[2])
                && typeof parts[2].value === 'bigint' && parts[2].value >= 0n && parts[2].value <= 15n) {
                expression = parts[0]; axis = Number(parts[2].value);
            }
            const source = parse(expression);
            if (!source || new Set(command.names).size !== command.names.length) return undefined;
            for (const [position, name] of command.names.entries()) if (name !== '#' && !name.includes('.')) {
                const node: NumericNode = { kind: 'slice', source, axis, position, count: command.names.length };
                definitions.set(name, node); assignments.push({ name, node });
            } else return undefined;
        } else return declineCompiler('unsupported-statement', command);
    }
    const returned = unwrap(last.value), product = isTupleExpression(returned);
    const arrayResult = isArrayExpression(returned) && returned.items.length > 0
        && !returned.dimensions.length && !returned.fill && !returned.range && !returned.rows.length;
    if ((product || arrayResult) && returned.items.some(item => item.sign)) return declineCompiler('signed-result-items', returned);
    const expressions = product || arrayResult ? returned.items.map(item => item.value) : [returned];
    if (!expressions.length || expressions.length > 8) return declineCompiler('result-count-budget', returned);
    const outputs = expressions.map(parse);
    if (assignments.some(a => captures.has(a.name))) return declineCompiler('unsupported-forward-or-written-capture', statement);
    if (outputs.some(n => !n)) return declineCompiler('unsupported-result-expression', returned);
    if ([...builtins].some(name => parameters.has(name) || assignments.some(a => a.name === name))) return declineCompiler('shadowed-builtin', statement);
    const roots = outputs as NumericNode[];
    const reachable = new Set<NumericNode>();
    function visit(node: NumericNode): void {
        if (reachable.has(node)) return; reachable.add(node);
        if (node.kind === 'unary') visit(node.child);
        else if (node.kind === 'binary') { visit(node.left); visit(node.right); }
        else if (node.kind === 'range') { visit(node.start); visit(node.end); }
        else if (node.kind === 'gather') { visit(node.source); visit(node.indices); }
        else if (node.kind === 'choose') { visit(node.condition); visit(node.yes); visit(node.no); }
        else if (node.kind === 'concat') node.sources.forEach(visit);
        else if ('source' in node) { visit(node.source); if (node.kind === 'reshape') node.dimensions.forEach(n => n && visit(n)); }
    }
    roots.forEach(visit);
    // Dead ordinary bindings can still raise while completing their arrays.
    if (assignments.some(a => !reachable.has(a.node))) return declineCompiler('unused-binding-may-throw', statement);
    const demanded = new Set<NumericNode>();
    function demand(node: NumericNode): void {
        if (demanded.has(node)) return; demanded.add(node);
        if (node.kind === 'unary') demand(node.child);
        else if (node.kind === 'binary') { demand(node.left); demand(node.right); }
        else if (node.kind === 'range') { demand(node.start); demand(node.end); }
        else if (node.kind === 'gather') { demand(node.source); demand(node.indices); }
        else if (node.kind === 'choose') { demand(node.condition); demand(node.yes); demand(node.no); }
        else if (node.kind === 'sum' || node.kind === 'sqrt' || node.kind === 'math' || node.kind === 'integer') demand(node.source);
        else if (node.kind === 'concat') node.sources.forEach(demand);
        else if (node.kind === 'reshape' || node.kind === 'slice') demand(node.source);
        // len and reshape dimensions demand metadata, not computed source cells.
    }
    roots.forEach(demand);
    // Only shape/scalar facts are retained, never input storage or results.
    type Prepared = { run: NumericRun; results: NumericBound[]; scalars: number[]; sizes: number[] };
    const variants = new Map<string, Prepared>();
    const programs = new Map<string, NumericRun>();
    const inputNames = new Set([...reachable].flatMap(node => node.kind === 'input' ? [node.name] : []));
    for (const { name } of assignments) if (parameters.has(name)) inputNames.add(name);
    let unavailable = false;
    function invoke(raw: boolean): RankValue | NumericBuffer[] | undefined {
        if (unavailable) return declineCompiler('code-generation', statement);
        if (!privateLoopPolling() || interruptsEnabled()) return declineCompiler('observable-polling', statement);
        for (const name of builtins) if (!host.builtin(name)) return recordFallback(`numeric-function:builtin:${name}`);
        const bound = new Map<NumericNode, NumericBound>(), inputs = new Map<string, NumericBound>();
        const data: ArrayLike<number>[] = [];
        let rejected = false;
        const bad = (reason = 'domain'): NumericBound => { rejected = true; recordFallback(`numeric-function:${reason}`); return { shape: [], size: 1, integer: false }; };
        function viewOnly(node: NumericNode): boolean { return node.kind === 'input' || node.kind === 'reshape' && viewOnly(node.source); }
        function binary(op: string, a: number, b: number): number {
            return op === 'min' ? b < a ? b : a : op === 'max' ? b > a ? b : a : op === 'band' ? a & b : op === 'bor' ? a | b : op === 'bxor' ? a ^ b : op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : op === '/' ? a / b
                : op === '//' ? Math.floor(a / b) : a - Math.floor(a / b) * b;
        }
        function readInput(name: string): NumericBound {
            let info: NumericBound;
            const buffer = host.buffer?.(name);
            const value = buffer ? undefined : host.lookup(name);
            if (typeof value === 'bigint' && safe(Number(value))) info = { shape: [], size: 1, integer: true, scalar: Number(value), low: Number(value), high: Number(value) };
            else if (typeof value === 'number' && Number.isFinite(value)) info = { shape: [], size: 1, integer: false, scalar: value };
            else {
                if (captures.has(name)) return bad('captured-scalar-guard');
                const input = buffer ?? borrowNumericBuffer(value);
                if (!input) return bad(`input-storage-guard:${name}`);
                info = { shape: input.shape, size: input.cells.length, integer: input.integer, low: input.low, high: input.high, data: data.length };
                data.push(input.cells);
            }
            return info;
        }
        function inputsStillMatch(): boolean {
            for (const [name, info] of inputs) {
                const buffer = host.buffer?.(name), value = buffer ? undefined : host.lookup(name);
                if (!info.shape.length) {
                    if (info.integer ? typeof value !== 'bigint' || Number(value) !== info.scalar
                        : typeof value !== 'number' || !Object.is(value, info.scalar)) return false;
                } else {
                    const current = buffer ?? borrowNumericBuffer(value);
                    if (!current || current.cells !== data[info.data!] || !same(current.shape, info.shape)
                        || current.integer !== info.integer || current.low !== info.low || current.high !== info.high) return false;
                }
            }
            return true;
        }
        function execute(prepared: Prepared): RankValue | NumericBuffer[] | undefined {
            // A proved Int32 result can be published directly. Keeping it compact
            // also lets the next numeric helper borrow it without a boxed conversion.
            const buffers = prepared.results.map(r => r.integer && r.low! >= -2147483648 && r.high! <= 2147483647
                ? new Int32Array(r.size) : new Float64Array(r.size));
            if (!prepared.run(data, prepared.scalars, buffers, prepared.sizes)) return declineCompiler('numeric-domain-guard', statement);
            if (raw && arrayResult) {
                host.executed();
                const cells = Float64Array.from(buffers, buffer => buffer[0]);
                return [new NumericBuffer(cells, [cells.length], true,
                    Math.min(...prepared.results.map(r => r.low!)), Math.max(...prepared.results.map(r => r.high!)))];
            }
            if (raw) {
                host.executed();
                return buffers.map((buffer, i) => new NumericBuffer(buffer, prepared.results[i].shape, prepared.results[i].integer, prepared.results[i].low, prepared.results[i].high));
            }
            if (arrayResult) {
                host.executed();
                const compact = prepared.results.every(r => r.low! >= -2147483648 && r.high! <= 2147483647);
                return compact ? typedArray(Int32Array.from(buffers, buffer => buffer[0]))
                    : typedArray(BigInt64Array.from(buffers, buffer => BigInt(buffer[0])));
            }
            const values = buffers.map((buffer, i) => {
                const result = prepared.results[i];
                if (!result.shape.length) return BigInt(buffer[0]);
                return result.integer ? typedArray(buffer instanceof Int32Array ? buffer : BigInt64Array.from(buffer, BigInt), result.shape)
                    : typedArray(buffer, result.shape, undefined, 'real');
            });
            host.executed();
            return product ? tuple(values) : values[0];
        }
        function affine(node: NumericNode): readonly [number, number] | undefined {
            const info = bound.get(node)!;
            if (info.scalar !== undefined) return [info.scalar, info.scalar];
            if (info.integer && info.low !== undefined && info.low === info.high) return [info.low, info.high];
            if (node.kind === 'range') return [info.low!, info.high!];
            if (node.kind === 'reshape') return affine(node.source);
            if (node.kind === 'unary') {
                const a = affine(node.child);
                return a && (node.op === '-' ? [-a[0], -a[1]] : a);
            }
            if (node.kind !== 'binary' || !['+', '-', '*'].includes(node.op)) return undefined;
            const a = affine(node.left); if (!a) return undefined;
            const b = affine(node.right); if (!b) return undefined;
            if (a[0] !== a[1] && !same(bound.get(node.left)!.shape, info.shape)
                || b[0] !== b[1] && !same(bound.get(node.right)!.shape, info.shape)
                || node.op === '*' && a[0] !== a[1] && b[0] !== b[1]) return undefined;
            return [binary(node.op, a[0], b[0]), binary(node.op, a[1], b[1])];
        }
        function bind(node: NumericNode): NumericBound {
            const old = bound.get(node); if (old) return old;
            let info: NumericBound;
            if (node.kind === 'input') {
                info = inputs.get(node.name)!;
            } else if (node.kind === 'constant') info = { shape: [], size: 1, integer: node.integer, scalar: node.value, low: node.integer ? node.value : undefined, high: node.integer ? node.value : undefined };
            else if (node.kind === 'length') {
                const source = bind(node.source); if (!source.shape.length) return bad();
                info = { shape: [], size: 1, integer: true, scalar: source.shape[0], low: source.shape[0], high: source.shape[0] };
            } else if (node.kind === 'integer') {
                const source = bind(node.source);
                if (!source.integer && !source.boolean) return bad();
                info = { ...source, integer: true, boolean: false, data: undefined };
            } else if (node.kind === 'math') {
                const source = bind(node.source);
                if (source.boolean) return bad();
                const scalar = source.scalar === undefined ? undefined : Math[node.op](source.scalar);
                if (scalar !== undefined && !Number.isFinite(scalar)) return bad();
                info = { shape: source.shape, size: source.size, integer: false, scalar };
            } else if (node.kind === 'sqrt' || node.kind === 'sum') {
                const source = bind(node.source);
                if (!source.integer || source.boolean) return bad();
                if (node.kind === 'sqrt') {
                    if (source.low === undefined || source.high === undefined || source.high < 0
                        || source.scalar !== undefined && source.scalar < 0) return bad();
                    // Correlated arrays can have a nonnegative difference even
                    // when interval bounds cross zero. Guard actual cells and
                    // replay the ordinary function on a negative operand.
                    const low = safeIntegerSquareRoot(Math.max(0, source.low)), high = safeIntegerSquareRoot(source.high);
                    const scalar = source.scalar === undefined ? undefined : safeIntegerSquareRoot(source.scalar);
                    info = { shape: source.shape, size: source.size, integer: true, scalar, low, high };
                } else {
                    if (!source.shape.length || source.low === undefined || source.high === undefined) return bad();
                    const low = source.low * source.size, high = source.high * source.size;
                    if (!safe(low) || !safe(high)) return bad();
                    info = { shape: [], size: 1, integer: true, low, high };
                    const ends = affine(node.source);
                    if (ends) info.scalar = Number((BigInt(ends[0]) + BigInt(ends[1])) * BigInt(source.size) / 2n);
                }
            } else if (node.kind === 'choose') {
                const condition = bind(node.condition), yes = bind(node.yes), no = bind(node.no);
                if (!condition.boolean || yes.boolean || no.boolean || yes.integer !== no.integer) return bad();
                const shape = broadcastShape(broadcastShape(condition.shape, yes.shape), no.shape);
                info = { shape, size: sizeOf(shape), integer: yes.integer };
                if (yes.integer) {
                    if (yes.low === undefined || no.low === undefined || yes.high === undefined || no.high === undefined) return bad();
                    info.low = Math.min(yes.low, no.low); info.high = Math.max(yes.high, no.high);
                }
            } else if (node.kind === 'unary' || node.kind === 'binary') {
                const a = bind(node.kind === 'unary' ? node.child : node.left), b = node.kind === 'binary' ? bind(node.right) : undefined;
                if (b && ['//', 'mod'].includes(node.op) && (!a.integer || !b.integer)) return bad();
                if (b && ['min', 'max'].includes(node.op) && a.integer !== b.integer) return bad();
                const shape = b ? broadcastShape(a.shape, b.shape) : a.shape;
                const comparison = ['equal', 'notequal', 'less', 'greater', 'atmost', 'atleast'].includes(node.op);
                if (a.boolean || b?.boolean) return bad();
                if (b && ['min', 'max'].includes(node.op) && a.integer !== b.integer) return bad();
                const integer = a.integer && (!b || b.integer) && node.op !== '/';
                info = { shape, size: sizeOf(shape), integer, ...(comparison ? { boolean: true } : {}) };
                if (b && ['band', 'bor', 'bxor'].includes(node.op)) {
                    // JavaScript bit operators preserve BigInt semantics only in this proved domain.
                    if (!integer || a.low === undefined || a.high === undefined || b.low === undefined || b.high === undefined
                        || a.low < 0 || b.low < 0
                        || a.high! > 2147483647 || b.high! > 2147483647) return bad('bitwise-domain');
                    info.low = 0;
                    info.high = node.op === 'band' ? Math.min(a.high!, b.high!)
                        : 2 ** Math.ceil(Math.log2(Math.max(a.high!, b.high!) + 1)) - 1;
                    if (!shape.length) info.scalar = binary(node.op, a.scalar!, b.scalar!);
                } else if (comparison) {
                    info.low = 0; info.high = 1;
                } else if (!shape.length && a.scalar !== undefined && (!b || b.scalar !== undefined)) {
                    // A safe remainder can still have an unsafe quotient product.
                    const division = node.op === '//' ? floorDivide : node.op === 'mod' ? floorRemainder : undefined;
                    const value = b && division ? Number(division(BigInt(a.scalar!), BigInt(b.scalar!)))
                        : b ? binary(node.op, a.scalar!, b.scalar!) : node.op === '-' ? -a.scalar! : a.scalar!;
                    if (!Number.isFinite(value) || integer && !safe(value) || b && ['/', '//', 'mod'].includes(node.op) && b.scalar === 0) return bad();
                    info.scalar = integer && value === 0 ? 0 : value;
                    if (integer) info.low = info.high = info.scalar;
                } else if (integer) {
                    if (a.low === undefined || a.high === undefined || b && (b.low === undefined || b.high === undefined)) return bad();
                    if (b && ['//', 'mod'].includes(node.op) && b.low! <= 0 && b.high! >= 0) return bad();
                    if (node.op === 'mod') {
                        info.low = b!.low! > 0 ? 0 : b!.low! + 1;
                        info.high = b!.high! < 0 ? 0 : b!.high! - 1;
                        bound.set(node, info); return info;
                    }
                    const ends = b ? [binary(node.op, a.low, b.low!), binary(node.op, a.low, b.high!), binary(node.op, a.high, b.low!), binary(node.op, a.high, b.high!)]
                        : node.op === '-' ? [-a.high, -a.low] : [a.low, a.high];
                    if (!ends.every(safe)) return bad();
                    info.low = Math.min(...ends); info.high = Math.max(...ends);
                }
            } else if (node.kind === 'range') {
                const a = bind(node.start), b = bind(node.end);
                if (a.shape.length || b.shape.length || !a.integer || !b.integer || a.boolean || b.boolean) return bad();
                const size = b.scalar! - a.scalar! + Number(node.inclusive);
                if (!safe(size) || size <= 0) return bad();
                info = { shape: [size], size, integer: true, low: a.scalar, high: a.scalar! + size - 1 };
            } else if (node.kind === 'reshape') {
                const source = bind(node.source);
                if (!source.shape.length) return bad();
                const dimensions = node.dimensions.map(n => { if (!n) return undefined; const d = bind(n); if (d.shape.length || !d.integer || d.boolean) { rejected = true; return undefined; } return BigInt(d.scalar ?? -1); });
                if (rejected) return bad();
                const shape = reshapeDimensions(dimensions, () => BigInt(source.size));
                if (sizeOf(shape) !== source.size) return bad();
                info = { ...source, shape, data: undefined };
            } else if (node.kind === 'slice') {
                const source = bind(node.source);
                if (!viewOnly(node.source) || source.shape[node.axis] !== node.count) return bad();
                const shape = source.shape.filter((_, i) => i !== node.axis);
                if (!shape.length) return bad();
                info = { ...source, shape, size: sizeOf(shape), data: undefined };
            } else if (node.kind === 'gather') {
                const source = bind(node.source), indices = bind(node.indices);
                if (!viewOnly(node.source) || source.shape.length !== 1 || source.boolean || !indices.integer || indices.boolean || !indices.shape.length
                    || indices.low === undefined || indices.low < 0 || indices.high! >= source.size) return bad();
                info = { shape: indices.shape, size: indices.size, integer: source.integer, low: source.low, high: source.high };
            } else {
                const sources = node.sources.map(bind), first = sources[0];
                if (!first.shape.length || node.axis >= first.shape.length || sources.some(s => s.integer !== first.integer || !!s.boolean !== !!first.boolean
                    || s.shape.length !== first.shape.length || s.shape.some((n, i) => i !== node.axis && n !== first.shape[i]))) return bad();
                const shape = [...first.shape]; shape[node.axis] = sources.reduce((n, s) => n + s.shape[node.axis], 0);
                info = { shape, size: sizeOf(shape), integer: first.integer, boolean: first.boolean };
                if (info.integer && sources.every(s => s.low !== undefined && s.high !== undefined)) {
                    info.low = Math.min(...sources.map(s => s.low!));
                    info.high = Math.max(...sources.map(s => s.high!));
                }
            }
            bound.set(node, info); return info;
        }
        let preflight = true;
        try {
            const signature: string[] = [];
            for (const name of inputNames) {
                const info = readInput(name);
                if (rejected) return undefined;
                inputs.set(name, info);
                currentDiagnostics()?.compilerType(name, `${info.boolean ? 'boolean' : info.integer ? 'integer' : 'real'}${info.shape.length ? `[rank ${info.shape.length}]` : ''}`);
                signature.push(info.shape.length ? `a:${info.integer ? `i:${info.low}:${info.high}` : 'r'}:${info.shape.join(',')}`
                    : `${info.integer ? 'i' : 'r'}:${Object.is(info.scalar, -0) ? '-0' : info.scalar}`);
            }
            const key = signature.join('|'), prepared = variants.get(key);
            const diagnostics = currentDiagnostics();
            if (prepared) {
                if (diagnostics) diagnostics.numericFunctionPlanHits++;
                preflight = false; return execute(prepared);
            }
            if (diagnostics) diagnostics.numericFunctionPreparations++;
            const contracts = new Map<string, string>();
            for (const { name, node } of assignments) {
                const info = bind(node), type = `${info.shape.length}:${info.integer}:${!!info.boolean}`;
                if (info.shape.length && info.size > MAX_HELD_CELLS) return declineCompiler('held-cell-budget', statement);
                if (info.shape.length && !demanded.has(node) && !viewOnly(node)) return declineCompiler('unconsumed-array-binding', statement);
                const previous = contracts.get(name) ?? (parameters.has(name) ? (() => { const p = bind({ kind: 'input', name }); return `${p.shape.length}:${p.integer}:${!!p.boolean}`; })() : undefined);
                if (previous !== undefined && previous !== type) return declineCompiler('binding-type', statement);
                contracts.set(name, type);
            }
            const results = roots.map(bind);
            if (arrayResult && results.some(r => r.shape.length || !r.integer)) return declineCompiler('scalar-integer-results-required', returned);
            if (rejected) return declineCompiler('input-domain-guard', statement);
            if (results.some(r => r.boolean || r.size <= 0 || r.size > MAX_HELD_CELLS || !r.shape.length && !r.integer)) return declineCompiler('result-domain-or-size-guard', returned);
            preflight = false;
            const scalars: number[] = [], scalarSlots = new Map<NumericNode, number>();
            for (const [node, info] of bound) if (!info.shape.length && info.scalar !== undefined) { scalarSlots.set(node, scalars.length); scalars.push(info.scalar!); }
            const emitted = emitNumericFunction(roots, bound, scalarSlots);
            if (!emitted) return declineCompiler('unsupported-numeric-emission', statement);
            let run = programs.get(emitted);
            if (!run) {
                try { run = new Function('isqrt', emitted)(safeIntegerSquareRoot) as NumericRun; } catch { unavailable = true; return declineCompiler('dynamic-code-unavailable', statement); }
                if (programs.size >= 32) programs.delete(programs.keys().next().value!);
                programs.set(emitted, run);
                host.compiled(emitted);
                if ([...builtins].some(name => !host.builtin(name))) return declineCompiler('builtin-identity-guard', statement);
                if (!inputsStillMatch()) return declineCompiler('input-revision-guard', statement);
            }
            const sizes = [...new Map([...bound.keys()].filter((node): node is NumericNode & { kind: 'sum' } => node.kind === 'sum' && !scalarSlots.has(node))
                .map(node => [bound.get(node.source)!.shape.join(','), bound.get(node.source)!.size])).values()];
            if (variants.size >= 32) variants.delete(variants.keys().next().value!);
            const plan = { run, results, scalars, sizes };
            variants.set(key, plan);
            return execute(plan);
        } catch (error) {
            if (preflight && error instanceof RankError && !(error instanceof InterruptedError)) return declineCompiler('preflight-domain-error', statement);
            throw error;
        }
    }
    return {
        tupleResult: product, resultCount: arrayResult ? 1 : roots.length,
        run: () => invoke(false) as RankValue | undefined,
        runBuffers: () => invoke(true) as NumericBuffer[] | undefined,
    };
}
