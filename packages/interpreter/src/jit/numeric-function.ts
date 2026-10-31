import {
    applicationForm, flattenApplication, isAllAxisExpression, isApplicationExpression, isAssignmentStatement,
    isBinaryExpression, isNameExpression, isNumberLiteral, isParenthesizedExpression,
    isReturnStatement, isTupleExpression, isUnaryExpression, isUnpackStatement,
    type Expression, type FunctionStatement,
} from '@arrrank/language';
import { InterruptedError, interruptsEnabled, privateLoopPolling } from '../interrupt.js';
import { RankError } from '../errors.js';
import { recordFallback } from '../diagnostics.js';
import { ownedStorage } from '../array-storage-state.js';
import { MAX_HELD_CELLS, realCells, storedScalarKinds, typedArray } from '../array-storage.js';
import { tuple, type RankArray, type RankValue } from '../value.js';
import { broadcastShape } from '../tensor.js';
import { floorDivide, floorRemainder } from '../numeric-division.js';
import { reshapeDimensions } from './tensor-layout.js';
import { emitNumericFunction, type NumericRun } from './numeric-function-codegen.js';

export type NumericNode = { kind: 'input'; name: string } | { kind: 'constant'; value: number; integer: boolean }
    | { kind: 'unary'; op: string; child: NumericNode }
    | { kind: 'binary'; op: string; left: NumericNode; right: NumericNode }
    | { kind: 'length'; source: NumericNode }
    | { kind: 'range'; start: NumericNode; end: NumericNode; inclusive: boolean }
    | { kind: 'reshape'; source: NumericNode; dimensions: (NumericNode | undefined)[] }
    | { kind: 'slice'; source: NumericNode; axis: number; position: number; count: number }
    | { kind: 'gather'; source: NumericNode; indices: NumericNode }
    | { kind: 'concat'; sources: NumericNode[]; axis: number };
export interface NumericBound {
    shape: readonly number[]; size: number; integer: boolean;
    scalar?: number; data?: number; low?: number; high?: number;
}
interface Host {
    lookup(name: string): RankValue | undefined;
    builtin(name: 'len' | 'reshape' | 'concat'): boolean;
    compiled(source: string): void;
    executed(): void;
}
const unwrap = (e: Expression): Expression => isParenthesizedExpression(e) ? unwrap(e.value) : e;
const sizeOf = (shape: readonly number[]) => shape.reduce((a, b) => a * b, 1);
const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const safe = (n: number) => Number.isSafeInteger(n);

/** A pure function boundary lets structural numeric intermediates stay virtual.
 * Inputs are completed tracked reals; all speculative storage is unpublished.
 * A declined shape, arithmetic or type guard replays the ordinary function. */
export function compileNumericFunction(statement: FunctionStatement, host: Host) {
    const commands = statement.statements, last = commands.at(-1);
    if (!last || !isReturnStatement(last) || !last.value || commands.length > 64 || statement.ranks.length
        || [...statement.leftBindings, ...statement.rightBindings].some(p => p.deferred || typeof p.name !== 'string')) return undefined;
    const parameters = new Set(statement.parameters);
    if (parameters.size !== statement.parameters.length) return undefined;
    const definitions = new Map<string, NumericNode>(), assignments: { name: string; node: NumericNode }[] = [];
    const builtins = new Set<'len' | 'reshape' | 'concat'>();
    let structural = false, budget = 512;
    function parse(expression: Expression): NumericNode | undefined {
        if (--budget < 0) return undefined;
        const e = unwrap(expression);
        if (isNameExpression(e)) return definitions.get(e.name) ?? (parameters.has(e.name) ? { kind: 'input', name: e.name } : undefined);
        if (isNumberLiteral(e)) {
            const value = Number(e.value), integer = typeof e.value === 'bigint';
            return Number.isFinite(value) && (!integer || safe(value)) ? { kind: 'constant', value, integer } : undefined;
        }
        if (isUnaryExpression(e) && ['+', '-'].includes(e.operator)) {
            const child = parse(e.operand);
            return child && { kind: 'unary', op: e.operator, child };
        }
        if (isBinaryExpression(e) && !e.step) {
            const left = parse(e.left), right = parse(e.right);
            if (!left || !right) return undefined;
            if (e.operator === 'till' || e.operator === 'to') {
                structural = true;
                return { kind: 'range', start: left, end: right, inclusive: e.operator === 'to' };
            }
            if (['+', '-', '*', '/', '//', 'mod'].includes(e.operator)) return { kind: 'binary', op: e.operator, left, right };
        }
        if (isApplicationExpression(e)) {
            const form = applicationForm(e);
            if (form.kind === 'reshape' && !form.rest.length) {
                const source = parse(form.source);
                const dimensions = form.dimensions.map(part => isAllAxisExpression(part) ? undefined : parse(part));
                if (!source || dimensions.some((d, i) => !d && !isAllAxisExpression(form.dimensions[i]))) return undefined;
                builtins.add('reshape'); structural = true;
                return { kind: 'reshape', source, dimensions };
            }
            if (form.kind === 'array-combine-constructor' && form.operation === 'concat' && !form.rest.length) {
                const axis = form.axis && unwrap(form.axis);
                if (axis && (!isNumberLiteral(axis) || typeof axis.value !== 'bigint' || axis.value < 0n || axis.value > 15n)) return undefined;
                const sources = form.items.map(parse);
                if (!sources.length || sources.some(s => !s)) return undefined;
                builtins.add('concat'); structural = true;
                return { kind: 'concat', sources: sources as NumericNode[], axis: axis ? Number(axis.value) : 0 };
            }
            const parts = flattenApplication(e);
            if (parts.length === 2 && isNameExpression(parts[1]) && parts[1].name === 'len') {
                const source = parse(parts[0]); builtins.add('len');
                return source && { kind: 'length', source };
            }
            if (parts.length === 2) {
                const source = parse(parts[0]), indices = parse(parts[1]);
                if (!source || !indices) return undefined;
                structural = true;
                return { kind: 'gather', source, indices };
            }
        }
        return undefined;
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
            structural = true;
            for (const [position, name] of command.names.entries()) if (name !== '#' && !name.includes('.')) {
                const node: NumericNode = { kind: 'slice', source, axis, position, count: command.names.length };
                definitions.set(name, node); assignments.push({ name, node });
            } else return undefined;
        } else return undefined;
    }
    const returned = unwrap(last.value), product = isTupleExpression(returned);
    if (product && returned.items.some(item => item.sign)) return undefined;
    const expressions = product ? returned.items.map(item => item.value) : [returned];
    if (!expressions.length || expressions.length > 8) return undefined;
    const outputs = expressions.map(parse);
    if (!structural || outputs.some(n => !n)) return undefined;
    const roots = outputs as NumericNode[];
    const reachable = new Set<NumericNode>();
    function visit(node: NumericNode): void {
        if (reachable.has(node)) return; reachable.add(node);
        if (node.kind === 'unary') visit(node.child);
        else if (node.kind === 'binary') { visit(node.left); visit(node.right); }
        else if (node.kind === 'range') { visit(node.start); visit(node.end); }
        else if (node.kind === 'gather') { visit(node.source); visit(node.indices); }
        else if (node.kind === 'concat') node.sources.forEach(visit);
        else if ('source' in node) { visit(node.source); if (node.kind === 'reshape') node.dimensions.forEach(n => n && visit(n)); }
    }
    roots.forEach(visit);
    // Dead ordinary bindings can still raise while completing their arrays.
    if (assignments.some(a => !reachable.has(a.node))) return undefined;
    const demanded = new Set<NumericNode>();
    function demand(node: NumericNode): void {
        if (demanded.has(node)) return; demanded.add(node);
        if (node.kind === 'unary') demand(node.child);
        else if (node.kind === 'binary') { demand(node.left); demand(node.right); }
        else if (node.kind === 'range') { demand(node.start); demand(node.end); }
        else if (node.kind === 'gather') { demand(node.source); demand(node.indices); }
        else if (node.kind === 'concat') node.sources.forEach(demand);
        else if (node.kind === 'reshape' || node.kind === 'slice') demand(node.source);
        // len and reshape dimensions demand metadata, not computed source cells.
    }
    roots.forEach(demand);
    const variants = new Map<string, NumericRun>();
    let unavailable = false;
    return { run(): RankValue | undefined {
        if (unavailable || !privateLoopPolling() || interruptsEnabled()) return undefined;
        for (const name of builtins) if (!host.builtin(name)) return recordFallback(`numeric-function:builtin:${name}`);
        const bound = new Map<NumericNode, NumericBound>(), inputs = new Map<string, NumericBound>();
        const data: ArrayLike<number>[] = [];
        let rejected = false;
        const bad = (reason = 'domain'): NumericBound => { rejected = true; recordFallback(`numeric-function:${reason}`); return { shape: [], size: 1, integer: false }; };
        function viewOnly(node: NumericNode): boolean { return node.kind === 'input' || node.kind === 'reshape' && viewOnly(node.source); }
        function binary(op: string, a: number, b: number): number {
            return op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : op === '/' ? a / b
                : op === '//' ? Math.floor(a / b) : a - Math.floor(a / b) * b;
        }
        function bind(node: NumericNode): NumericBound {
            const old = bound.get(node); if (old) return old;
            let info: NumericBound;
            if (node.kind === 'input') {
                const previous = inputs.get(node.name);
                if (previous) { bound.set(node, previous); return previous; }
                const value = host.lookup(node.name);
                if (typeof value === 'bigint' && safe(Number(value))) info = { shape: [], size: 1, integer: true, scalar: Number(value), low: Number(value), high: Number(value) };
                else if (typeof value === 'number' && Number.isFinite(value)) info = { shape: [], size: 1, integer: false, scalar: value };
                else {
                    const state = value && typeof value === 'object' ? ownedStorage.get(value as RankArray) : undefined;
                    if (!state?.stable || !state.scalarOnly || state.validity || state.readOnlyCells
                        || state.typed && !(state.typed instanceof Float64Array)) return bad(`input-storage:${node.name}`);
                    const descriptor = Object.getOwnPropertyDescriptor(value, 'shape');
                    if (!descriptor || !('value' in descriptor) || !same(descriptor.value, state.shape)
                        || Object.getOwnPropertyDescriptor(value, 'itemAt') || Object.getOwnPropertyDescriptor(value, 'columnNames')
                        || Object.getOwnPropertyDescriptor(value, 'tableScopes') || Object.getOwnPropertyDescriptor(value, 'sortKeys')
                        || storedScalarKinds(value as RankArray, true)?.join() !== 'real') return bad();
                    const cells = realCells(value as RankArray);
                    if (!cells) return bad();
                    info = { shape: [...state.shape], size: sizeOf(state.shape), integer: false, data: data.length };
                    if (!info.shape.length || info.size !== cells.length) return bad();
                    data.push(cells);
                }
                inputs.set(node.name, info);
            } else if (node.kind === 'constant') info = { shape: [], size: 1, integer: node.integer, scalar: node.value, low: node.integer ? node.value : undefined, high: node.integer ? node.value : undefined };
            else if (node.kind === 'length') {
                const source = bind(node.source); if (!source.shape.length) return bad();
                info = { shape: [], size: 1, integer: true, scalar: source.shape[0], low: source.shape[0], high: source.shape[0] };
            } else if (node.kind === 'unary' || node.kind === 'binary') {
                const a = bind(node.kind === 'unary' ? node.child : node.left), b = node.kind === 'binary' ? bind(node.right) : undefined;
                if (b && ['//', 'mod'].includes(node.op) && (!a.integer || !b.integer)) return bad();
                const shape = b ? broadcastShape(a.shape, b.shape) : a.shape;
                const integer = a.integer && (!b || b.integer) && node.op !== '/';
                info = { shape, size: sizeOf(shape), integer };
                if (!shape.length) {
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
                    if (node.op === 'mod') return bad();
                    const ends = b ? [binary(node.op, a.low, b.low!), binary(node.op, a.low, b.high!), binary(node.op, a.high, b.low!), binary(node.op, a.high, b.high!)]
                        : node.op === '-' ? [-a.high, -a.low] : [a.low, a.high];
                    if (!ends.every(safe)) return bad();
                    info.low = Math.min(...ends); info.high = Math.max(...ends);
                }
            } else if (node.kind === 'range') {
                const a = bind(node.start), b = bind(node.end);
                if (a.shape.length || b.shape.length || !a.integer || !b.integer) return bad();
                const size = b.scalar! - a.scalar! + Number(node.inclusive);
                if (!safe(size) || size <= 0) return bad();
                info = { shape: [size], size, integer: true, low: a.scalar, high: a.scalar! + size - 1 };
            } else if (node.kind === 'reshape') {
                const source = bind(node.source);
                if (!source.shape.length) return bad();
                const dimensions = node.dimensions.map(n => { if (!n) return undefined; const d = bind(n); if (d.shape.length || !d.integer) { rejected = true; return undefined; } return BigInt(d.scalar ?? -1); });
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
                if (!viewOnly(node.source) || source.shape.length !== 1 || !indices.integer || !indices.shape.length
                    || indices.low === undefined || indices.low < 0 || indices.high! >= source.size) return bad();
                info = { shape: indices.shape, size: indices.size, integer: false };
            } else {
                const sources = node.sources.map(bind), first = sources[0];
                if (!first.shape.length || node.axis >= first.shape.length || sources.some(s => s.integer !== first.integer
                    || s.shape.length !== first.shape.length || s.shape.some((n, i) => i !== node.axis && n !== first.shape[i]))) return bad();
                const shape = [...first.shape]; shape[node.axis] = sources.reduce((n, s) => n + s.shape[node.axis], 0);
                info = { shape, size: sizeOf(shape), integer: first.integer };
            }
            bound.set(node, info); return info;
        }
        let preflight = true;
        try {
            const contracts = new Map<string, string>();
            for (const { name, node } of assignments) {
                const info = bind(node), type = `${info.shape.length}:${info.integer}`;
                if (info.shape.length && (info.size > MAX_HELD_CELLS || !demanded.has(node) && !viewOnly(node))) return undefined;
                const previous = contracts.get(name) ?? (parameters.has(name) ? (() => { const p = bind({ kind: 'input', name }); return `${p.shape.length}:${p.integer}`; })() : undefined);
                if (previous !== undefined && previous !== type) return undefined;
                contracts.set(name, type);
            }
            const results = roots.map(bind);
            if (rejected || results.some(r => r.integer || !r.shape.length || r.size <= 0 || r.size > MAX_HELD_CELLS)) return undefined;
            preflight = false;
            const key = JSON.stringify([...bound.values()].map(v => [v.shape, v.integer, v.scalar]));
            const scalars: number[] = [], scalarSlots = new Map<NumericNode, number>();
            for (const [node, info] of bound) if (!info.shape.length) { scalarSlots.set(node, scalars.length); scalars.push(info.scalar!); }
            let run = variants.get(key);
            if (!run) {
                const emitted = emitNumericFunction(roots, bound, scalarSlots);
                if (!emitted) return undefined;
                try { run = new Function(emitted)() as NumericRun; } catch { unavailable = true; return undefined; }
                if (variants.size >= 32) variants.delete(variants.keys().next().value!);
                variants.set(key, run); host.compiled(emitted);
            }
            const buffers = results.map(r => new Float64Array(r.size));
            if (!run(data, scalars, buffers)) return undefined;
            const values = buffers.map((buffer, i) => typedArray(buffer, results[i].shape, undefined, 'real'));
            host.executed();
            return product ? tuple(values) : values[0];
        } catch (error) {
            if (preflight && error instanceof RankError && !(error instanceof InterruptedError)) return undefined;
            throw error;
        }
    } };
}
