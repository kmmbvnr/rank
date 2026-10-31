import {
    isAssignmentStatement, isBinaryExpression, isNameExpression, isNumberLiteral,
    isParenthesizedExpression, isUnaryExpression, type AssignmentStatement, type Expression, type Statement,
} from '@arrrank/language';
import { privateLoopPolling, interruptsEnabled } from '../interrupt.js';
import { ownedStorage } from '../array-storage-state.js';
import { typedArray, isSharedArray } from '../array-storage.js';
import { currentDiagnostics } from '../diagnostics.js';
import { broadcastShape } from '../tensor.js';
import { DENSE_MIN_CELLS } from './tensor-operands.js';
import type { RankArray, RankValue } from '../value.js';

interface Host {
    lookup(name: string): RankValue | undefined;
    commit(statement: AssignmentStatement, value: RankArray): void;
    compiled(source: string): void;
    executed(): void;
}
type Node = { kind: 'input'; name: string } | { kind: 'constant'; value: number }
    | { kind: 'unary'; op: string; child: Node }
    | { kind: 'binary'; op: string; left: Node; right: Node };
type Input = { cells?: Float64Array; scalar?: number; shape: readonly number[] };
type Run = (data: Float64Array[], scalars: number[], size: number, output: Float64Array[]) => boolean;
const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Fuse pure adjacent real-array assignments while retaining every binding.
 * Speculation writes only unpublished buffers; any guard failure replays the
 * ordinary statements in their original order. Calls and structural operations
 * terminate the region. Inputs are never cached. Recycled output storage must
 * be private and no longer published by any of the region's assignments. */
export function compileTensorRegion(statements: readonly Statement[], start: number, host: Host) {
    const definitions = new Map<string, Node>();
    const commands: { statement: AssignmentStatement; root: Node }[] = [];
    function parse(expression: Expression, budget: { left: number }): Node | undefined {
        if (--budget.left < 0) return undefined;
        if (isParenthesizedExpression(expression)) return parse(expression.value, budget);
        if (isNumberLiteral(expression) && typeof expression.value === 'number' && Number.isFinite(expression.value))
            return { kind: 'constant', value: expression.value };
        if (isNameExpression(expression) && !expression.name.includes('.'))
            return definitions.get(expression.name) ?? { kind: 'input', name: expression.name };
        if (isUnaryExpression(expression) && ['+', '-'].includes(expression.operator)) {
            const child = parse(expression.operand, budget);
            return child && { kind: 'unary', op: expression.operator, child };
        }
        if (isBinaryExpression(expression) && !expression.step && ['+', '-', '*', '/'].includes(expression.operator)) {
            const left = parse(expression.left, budget), right = parse(expression.right, budget);
            return left && right && { kind: 'binary', op: expression.operator, left, right };
        }
        return undefined;
    }
    for (const statement of statements.slice(start, start + 8)) {
        if (!isAssignmentStatement(statement) || statement.deferred || statement.name.includes('.') || definitions.has(statement.name)) break;
        const root = parse(statement.value, { left: 64 });
        if (!root || root.kind === 'input' || root.kind === 'constant') break;
        definitions.set(statement.name, root);
        commands.push({ statement, root });
    }
    if (commands.length < 2) return undefined;
    const inputNames = new Set<string>(), visited = new Set<Node>();
    function collect(node: Node): void {
        if (visited.has(node)) return;
        visited.add(node);
        if (node.kind === 'input') inputNames.add(node.name);
        else if (node.kind === 'unary') collect(node.child);
        else if (node.kind === 'binary') { collect(node.left); collect(node.right); }
    }
    commands.forEach(command => collect(command.root));
    const variants = new Map<string, Run>();
    // The loop invocation owns at most two banks. Re-entering the same parsed
    // loop gets a new control object and cannot overwrite a retained result.
    const pools = new WeakMap<object, RankArray[][]>();
    let unavailable = false;
    return { length: commands.length, run(session?: object): RankValue | undefined {
        if (unavailable || !privateLoopPolling() || interruptsEnabled()) return undefined;
        // As with other dense kernels, preparation is not amortized on short arrays.
        let dense = false;
        for (const name of inputNames) {
            const value = host.lookup(name);
            if (typeof value === 'number') continue;
            const state = value && typeof value === 'object' ? ownedStorage.get(value as RankArray) : undefined;
            if (!(state?.typed instanceof Float64Array) || state.typed.length < DENSE_MIN_CELLS) return undefined;
            dense = true;
            break;
        }
        if (!dense) return undefined;
        const nodes = new Map<Node, readonly number[]>(), inputs = new Map<string, Input>();
        let rejected = false;
        function bind(node: Node): readonly number[] {
            const known = nodes.get(node);
            if (known) return known;
            let shape: readonly number[] = [];
            if (node.kind === 'input') {
                let input = inputs.get(node.name);
                if (!input) {
                    const value = host.lookup(node.name);
                    if (typeof value === 'number' && Number.isFinite(value)) input = { scalar: value, shape: [] };
                    else if (value && typeof value === 'object') {
                        const state = ownedStorage.get(value as RankArray);
                        if (state?.stable && state.scalarOnly && !state.validity && !state.readOnlyCells
                            && state.typed instanceof Float64Array) {
                            const descriptor = Object.getOwnPropertyDescriptor(value, 'shape');
                            if (descriptor && 'value' in descriptor && same(descriptor.value, state.shape)
                                && state.typed.length === state.shape.reduce((a, b) => a * b, 1)
                                && !Object.getOwnPropertyDescriptor(value, 'itemAt')
                                && !Object.getOwnPropertyDescriptor(value, 'columnNames')
                                && !Object.getOwnPropertyDescriptor(value, 'tableScopes') && !Object.getOwnPropertyDescriptor(value, 'sortKeys'))
                                input = { cells: state.typed, shape: [...state.shape] };
                        }
                    }
                    if (!input) { rejected = true; return []; }
                    inputs.set(node.name, input);
                }
                shape = input.shape;
            } else if (node.kind === 'unary') shape = bind(node.child);
            else if (node.kind === 'binary') {
                const left = bind(node.left), right = bind(node.right);
                try { shape = broadcastShape(left, right); } catch { rejected = true; }
            }
            nodes.set(node, shape);
            return shape;
        }
        const shapes = commands.map(command => bind(command.root)), shape = shapes[0];
        if (rejected || shape.length === 0 || !shapes.every(next => same(shape, next))) return undefined;
        const size = shape.reduce((a, b) => a * b, 1);
        if (size < DENSE_MIN_CELLS) return undefined;
        // A trailing input broadcasts by modulo; other layouts retain normal dispatch.
        for (const input of inputs.values()) if (input.cells && input.cells.length !== 1 && (input.shape.length > shape.length
            || input.shape.some((n, i) => n !== shape[shape.length - input.shape.length + i]))) return undefined;
        const data: Float64Array[] = [], scalars: number[] = [];
        const slots = new Map<string, string>();
        for (const [name, input] of inputs) {
            if (input.cells) {
                const index = input.cells.length === size ? 'i' : `i % ${input.cells.length}`;
                slots.set(name, `data[${data.length}][${index}]`); data.push(input.cells);
            } else { slots.set(name, `scalars[${scalars.length}]`); scalars.push(input.scalar!); }
        }
        const key = JSON.stringify([...inputs.values()].map(input => input.cells ? input.shape : null));
        let run = variants.get(key);
        if (!run) {
            const emitted = new Map<Node, string>(), lines: string[] = [];
            function emit(node: Node): string {
                const known = emitted.get(node);
                if (known) return known;
                let expression: string;
                if (node.kind === 'input') expression = slots.get(node.name)!;
                else if (node.kind === 'constant') expression = Object.is(node.value, -0) ? '-0' : String(node.value);
                else if (node.kind === 'unary') expression = `${node.op}(${emit(node.child)})`;
                else expression = `(${emit(node.left)}) ${node.op} (${emit(node.right)})`;
                const name = `v${emitted.size}`;
                emitted.set(node, name);
                lines.push(`const ${name} = ${expression}; if (!Number.isFinite(${name})) return false;`);
                return name;
            }
            const values = commands.map(command => emit(command.root));
            const source = `"use strict"; return function(data, scalars, size, output) { for (let i = 0; i < size; i++) { ${lines.join('\n')} ${values.map((value, i) => `output[${i}][i] = ${value};`).join('\n')} } return true; };`;
            try { run = new Function(source)() as Run; } catch { unavailable = true; return undefined; }
            if (variants.size >= 32) variants.delete(variants.keys().next().value!);
            variants.set(key, run); host.compiled(source);
        }
        const banks = session ? pools.get(session) ?? [] : [];
        const live = banks.length ? new Set(commands.map(command => host.lookup(command.statement.name))) : undefined;
        const candidate = banks.findIndex(bank => bank.every(value => {
            const state = ownedStorage.get(value);
            return state?.stable && state.scalarOnly && !state.validity && !state.readOnlyCells
                && state.owners === 1 && state.typed instanceof Float64Array && state.typed.length === size
                && !live!.has(value) && !isSharedArray(value) && !Object.getOwnPropertyDescriptor(value, 'itemAt')
                && !data.some(input => input.buffer === state.typed!.buffer);
        }));
        const recycled = candidate < 0 ? undefined : banks.splice(candidate, 1)[0];
        const outputs = recycled ? recycled.map(value => ownedStorage.get(value)!.typed as Float64Array)
            : commands.map(() => new Float64Array(size));
        if (!run(data, scalars, size, outputs)) return undefined;
        let result: RankValue | undefined;
        const published: RankArray[] = [];
        for (let i = 0; i < commands.length; i++) {
            result = typedArray(outputs[i], shape, undefined, 'real');
            host.commit(commands[i].statement, result);
            published.push(result);
        }
        host.executed();
        if (session) {
            banks.push(published);
            if (banks.length > 2) banks.shift();
            pools.set(session, banks);
        }
        const diagnostics = currentDiagnostics();
        if (recycled && diagnostics) {
            diagnostics.reusedTensorBuffers += outputs.length;
            diagnostics.reusedTensorBufferCells += outputs.length * size;
        }
        return result;
    } };
}
