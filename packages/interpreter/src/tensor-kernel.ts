import {
    isApplicationExpression, isAssignmentStatement, isReturnStatement, isBinaryExpression,
    isNameExpression, isNumberLiteral, isBooleanLiteral, isStringLiteral,
    isParenthesizedExpression, isUnaryExpression,
    type Expression, type Statement,
} from 'rank-language';
import { type RankValue, isRankArray } from './value.js';
import { broadcastShape } from './tensor.js';
import { materializedArrayItems, ownedArray } from './array-storage.js';
import { privateTensorNames, tensorReadCount } from './tensor-use.js';

type Terminal = 'copy' | 'sum' | 'mean' | 'any' | 'all' | 'count' | 'min' | 'max';
const terminals = new Set(['copy', 'sum', 'mean', 'any', 'all', 'count', 'min', 'max']);
const binary = new Set(['+', '-', '*', '/', '**', 'less', 'greater', 'atmost', 'atleast', 'equal', 'notequal', 'and', 'or', 'xor']);
const comparison: Record<string, string> = { less: '<', greater: '>', atmost: '<=', atleast: '>=', equal: '===', notequal: '!==' };
export type TensorNode =
    | { kind: 'input'; name?: string; value?: RankValue }
    | { kind: 'binary'; op: string; left: TensorNode; right: TensorNode }
    | { kind: 'unary'; op: string; operand: TensorNode }
    | { kind: 'select'; source: TensorNode; selector: TensorNode };
export interface TensorKernelHost {
    readonly textDigits?: boolean;
    lookup(name: string): RankValue | undefined;
    builtin(name: Terminal | 'text' | 'integer'): boolean;
    compiled?(source: string): void;
}
const unwrap = (value: Expression): Expression => isParenthesizedExpression(value) ? unwrap(value.value) : value;
function pair(value: Expression): Expression[] | undefined {
    const atom = unwrap(value);
    return isApplicationExpression(atom) && atom.arguments.length === 1 ? [atom.head, atom.arguments[0]] : undefined;
}
interface View { items: RankValue[]; offset: number; shape: readonly number[] }
interface Bound { shape?: readonly number[]; boolean: boolean; slot?: number; view?: View; scalar?: RankValue; filter?: boolean; digits?: boolean }
const numeric = (value: unknown) => typeof value === 'bigint' || typeof value === 'number' && Number.isFinite(value);
const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((n, i) => n === b[i]);

/** Composable tensor expression IR. Shape binding is separate from emission;
 * unsupported layouts/values decline without evaluating user code or lazy data. */
export function compileTensorKernel(statements: Statement[], host: TensorKernelHost): {
    count: number; source: string; run(): RankValue | undefined;
} | undefined {
    const definitions = new Map<string, TensorNode>();
    const reads = new Map<string, number>();
    const names: string[] = [];
    function parse(expression: Expression): TensorNode | undefined {
        const e = unwrap(expression);
        if (isNameExpression(e) && !e.name.includes('.')) {
            reads.set(e.name, (reads.get(e.name) ?? 0) + 1);
            return definitions.get(e.name) ?? { kind: 'input', name: e.name };
        }
        if (isNumberLiteral(e) || isBooleanLiteral(e) || host.textDigits && isStringLiteral(e)) return { kind: 'input', value: e.value };
        if (isBinaryExpression(e) && binary.has(e.operator) && !e.step) {
            // Rank gives power precedence over an unparenthesized sign.
            if (e.operator === '**' && isUnaryExpression(e.left)
                && (e.left.operator === '+' || e.left.operator === '-')) {
                const left = parse(e.left.operand), right = parse(e.right);
                return left && right ? { kind: 'unary', op: e.left.operator,
                    operand: { kind: 'binary', op: '**', left, right } } : undefined;
            }
            const left = parse(e.left), right = parse(e.right);
            return left && right ? { kind: 'binary', op: e.operator, left, right } : undefined;
        }
        if (isUnaryExpression(e) && ['not', '+', '-'].includes(e.operator)) {
            const operand = parse(e.operand);
            return operand ? { kind: 'unary', op: e.operator, operand } : undefined;
        }
        if (host.textDigits) {
            const flatten = (node: Expression): Expression[] => isApplicationExpression(node)
                ? [...flatten(node.head), ...node.arguments.flatMap(flatten)] : [node];
            const parts = flatten(e);
            if (parts.length === 4 && isNameExpression(parts[1]) && parts[1].name === 'integer'
                && isNameExpression(parts[2]) && parts[2].name === 'rank'
                && isNumberLiteral(parts[3]) && parts[3].value === 0n) {
                const operand = parse(parts[0]);
                return operand ? { kind: 'unary', op: 'integer0', operand } : undefined;
            }
            if (parts.length === 2 && isNameExpression(parts[1]) && parts[1].name === 'text') {
                const operand = parse(parts[0]);
                return operand ? { kind: 'unary', op: 'text', operand } : undefined;
            }
        }
        const parts = pair(e);
        if (parts) {
            const source = parse(parts[0]), selector = parse(parts[1]);
            return source && selector ? { kind: 'select', source, selector } : undefined;
        }
        return undefined;
    }
    for (let index = 0; index < Math.min(statements.length, 16); index++) {
        const statement = statements[index];
        const assignment = isAssignmentStatement(statement) && statement.operator === '=';
        if ((!assignment && !isReturnStatement(statement)) || !statement.value) return undefined;
        const parts = pair(statement.value);
        const last = parts && unwrap(parts[1]);
        if (last && isNameExpression(last) && terminals.has(last.name)) {
            const root = parse(parts![0]);
            if (!root || root.kind === 'input' && names.length === 0) return undefined;
            if (!privateTensorNames(statements[0], names)
                || names.some(name => tensorReadCount(statements[0], name) !== reads.get(name))) return undefined;
            // Do not discard independent assignments merely because a later
            // expression ends with a reduction.
            const reached = new Set<TensorNode>();
            const visit = (node: TensorNode): void => {
                if (reached.has(node)) return;
                reached.add(node);
                if (node.kind === 'binary') { visit(node.left); visit(node.right); }
                if (node.kind === 'unary') visit(node.operand);
                if (node.kind === 'select') { visit(node.source); visit(node.selector); }
            };
            visit(root);
            if ([...definitions.values()].some(node => !reached.has(node))) return undefined;
            return build(root, names, last.name as Terminal, index + 1, host);
        }
        if (!isAssignmentStatement(statement)) return undefined;
        const value = parse(statement.value);
        if (!value || definitions.has(statement.name)) return undefined;
        definitions.set(statement.name, value);
        names.push(statement.name);
    }
    return undefined;
}

function build(root: TensorNode, names: string[], terminal: Terminal, count: number, host: TensorKernelHost) {
    let cachedKey: string | undefined;
    let cachedRun: ((data: RankValue[][], offsets: number[], scalars: RankValue[], size: number) => RankValue | RankValue[] | undefined) | undefined;
    let generated = '';
    let unavailable = false;
    return { count, get source() { return generated; }, run(): RankValue | undefined {
        if (unavailable || names.some(name => host.lookup(name) !== undefined)) return undefined;
        const bound = new Map<TensorNode, Bound>();
        let broadcasts = false;
        const data: RankValue[][] = [], offsets: number[] = [], scalars: RankValue[] = [];
        function bind(node: TensorNode): Bound | undefined {
            if (bound.has(node)) return bound.get(node);
            let result: Bound | undefined;
            if (node.kind === 'input') {
                const value = node.name === undefined ? node.value : host.lookup(node.name);
                if (numeric(value) || typeof value === 'boolean' || host.textDigits && typeof value === 'string') {
                    result = { scalar: value, boolean: typeof value === 'boolean', slot: scalars.push(value!) - 1 };
                } else if (value && isRankArray(value)) {
                    const items = materializedArrayItems(value);
                    if (!Array.isArray(items) || !value.shape.every(n => Number.isSafeInteger(n) && n >= 0)
                        || value.shape.reduce((p, n) => p * n, 1) !== items.length) return undefined;
                    const view = { items, offset: 0, shape: value.shape };
                    result = { shape: view.shape, view, boolean: typeof items[0] === 'boolean' };
                }
            } else if (node.kind === 'binary') {
                const a = bind(node.left), b = bind(node.right);
                if (!a || !b) return undefined;
                let shape = a.shape ?? b.shape;
                if (a.shape && b.shape && !same(a.shape, b.shape)) {
                    try { shape = broadcastShape(a.shape, b.shape); }
                    catch { return undefined; }
                    broadcasts = true;
                }
                result = { shape, boolean: node.op in comparison || ['and', 'or', 'xor'].includes(node.op) };
            } else if (node.kind === 'unary') {
                const a = bind(node.operand);
                if (node.op === 'text') {
                    if (a && typeof a.scalar === 'bigint' && host.builtin('text')) {
                        const value = a.scalar.toString();
                        result = { scalar: value, boolean: false, slot: scalars.push(value) - 1 };
                    }
                } else if (node.op === 'integer0') {
                    if (a && typeof a.scalar === 'string' && !/[^0-9]/.test(a.scalar) && host.builtin('integer')) {
                        result = { shape: [a.scalar.length], boolean: false, digits: true, slot: scalars.push(a.scalar) - 1 };
                    }
                } else if (a) result = { shape: a.shape, boolean: node.op === 'not' };
            } else {
                const a = bind(node.source), b = bind(node.selector);
                if (!a || !b || !a.shape || a.shape.length === 0) return undefined;
                if (typeof b.scalar === 'bigint' && a.view && b.scalar >= 0n && b.scalar < BigInt(a.shape[0])) {
                    const shape = a.shape.slice(1);
                    const stride = shape.reduce((p, n) => p * n, 1);
                    const view = { ...a.view, shape, offset: a.view.offset + Number(b.scalar) * stride };
                    if (shape.length === 0) {
                        const scalar = view.items[view.offset];
                        if (!numeric(scalar) && typeof scalar !== 'boolean') return undefined;
                        result = { scalar, boolean: typeof scalar === 'boolean', slot: scalars.push(scalar) - 1 };
                    } else result = { shape, view, boolean: typeof view.items[view.offset] === 'boolean' };
                } else if (b.shape && b.boolean && a.shape.length === 1 && same(a.shape, b.shape)) {
                    result = { shape: a.shape, boolean: a.boolean, filter: true };
                } else if (b.shape?.length === 1 && !b.boolean && a.view && a.shape.length === 1) {
                    result = { shape: b.shape, boolean: a.boolean };
                }
            }
            // Scalar computations are evaluated before their surrounding
            // tensor operation, even for an empty/fully filtered domain. Until
            // scalar lowering preserves that timing, leave them to reference.
            if (result && result.shape === undefined && result.scalar === undefined) return undefined;
            if (result) {
                if (result.view) {
                    result.slot = data.push(result.view.items) - 1;
                    offsets.push(result.view.offset);
                }
                bound.set(node, result);
            }
            return result;
        }
        const output = bind(root);
        if (!output?.shape || !host.builtin(terminal)) return undefined;
        // Gathers and filters have their own iteration domains. They require
        // explicit domain composition before they can mix with broadcasting.
        if (broadcasts && ([...bound.keys()].some(node => node.kind === 'select')
            || [...bound.values()].some(info => info.digits))) return undefined;
        const size = output.shape.reduce((p, n) => p * n, 1);
        // A selection changes cardinality. Other operands must not zip an
        // unfiltered vector against it. Until domain algebra is implemented,
        // only scalar maps and gathers can follow a filter.
        const filtered = new Map<TensorNode, boolean>();
        function domain(node: TensorNode): boolean {
            if (filtered.has(node)) return filtered.get(node)!;
            let value = bound.get(node)?.filter ?? false;
            if (node.kind === 'unary') value ||= domain(node.operand);
            if (node.kind === 'select') value ||= domain(node.selector);
            if (node.kind === 'binary') {
                const a = domain(node.left), b = domain(node.right);
                if (a && bound.get(node.right)?.shape || b && bound.get(node.left)?.shape) throw false;
                value ||= a || b;
            }
            filtered.set(node, value);
            return value;
        }
        try { domain(root); } catch { return undefined; }
        // Array output initially requires a fixed cardinality.
        if (terminal === 'copy' && [...filtered.values()].some(Boolean)) return undefined;
        const key = [...bound.values()].map(b => `${b.shape === undefined ? 's' : b.shape.join(',')}:${b.view ? 'v' : ''}:${b.boolean}:${b.filter ?? false}:${b.slot ?? ''}`).join(';');
        if (cachedKey !== key) {
            const lines: string[] = [];
            const emitted = new Map<TensorNode, string>();
            const num = (x: string) => `(typeof ${x} === 'bigint' || typeof ${x} === 'number' && Number.isFinite(${x}))`;
            function address(shape: readonly number[]): string {
                if (same(shape, output!.shape!)) return 'i';
                const target = output!.shape!;
                let sourceStride = 1, targetStride = 1;
                const terms: string[] = [];
                for (let axis = target.length - 1; axis >= 0; axis--) {
                    const sourceAxis = axis - (target.length - shape.length);
                    if (sourceAxis >= 0) {
                        const dimension = shape[sourceAxis];
                        if (dimension !== 1) {
                            const coordinate = targetStride === 1 ? 'i' : `Math.floor(i / ${targetStride})`;
                            terms.push(`(${coordinate} % ${target[axis]}) * ${sourceStride}`);
                        }
                        sourceStride *= dimension;
                    }
                    targetStride *= target[axis];
                }
                return terms.join(' + ') || '0';
            }
            function emit(node: TensorNode): string {
                const existing = emitted.get(node);
                if (existing) return existing;
                const info = bound.get(node)!;
                const name = `v${emitted.size}`;
                emitted.set(node, name);
                if (info.scalar !== undefined) lines.push(`const ${name} = scalars[${info.slot}];`);
                else if (info.digits) lines.push(`const ${name} = BigInt(scalars[${info.slot}].charCodeAt(i) - 48);`);
                else if (info.view) lines.push(`const ${name} = data[${info.slot}][offsets[${info.slot}] + ${broadcasts ? address(info.view.shape) : 'i'}];`);
                else if (node.kind === 'binary') {
                    const a = emit(node.left), b = emit(node.right);
                    if (['and', 'or', 'xor'].includes(node.op)) {
                        lines.push(`if (typeof ${a} !== 'boolean' || typeof ${b} !== 'boolean') return undefined;`);
                        lines.push(`const ${name} = ${a} ${node.op === 'and' ? '&&' : node.op === 'or' ? '||' : '!=='} ${b};`);
                    } else {
                        lines.push(`if (!${num(a)} || !${num(b)}) return undefined;`);
                        if (node.op in comparison) {
                            lines.push(`if (typeof ${a} !== typeof ${b}) return undefined;`);
                            lines.push(`const ${name} = ${a} ${comparison[node.op]} ${b};`);
                        } else {
                            if (node.op === '/') lines.push(`if (${b} === 0n || ${b} === 0) return undefined;`);
                            if (node.op === '**') lines.push(`if (${b} < 0 || ${b} > 1024 || (typeof ${b} === 'number' && !Number.isInteger(${b}))) return undefined;`);
                            const expr = `Number(${a}) ${node.op} Number(${b})`;
                            lines.push(`const ${name} = ${node.op === '/' ? expr : `(typeof ${a} === 'bigint' && typeof ${b} === 'bigint' ? ${a} ${node.op} ${b} : ${expr})`};`);
                        }
                    }
                } else if (node.kind === 'unary') {
                    const a = emit(node.operand);
                    lines.push(`if (${node.op === 'not' ? `typeof ${a} !== 'boolean'` : `!${num(a)}`}) return undefined;`);
                    lines.push(`const ${name} = ${node.op === 'not' ? '!' : node.op === '+' ? '' : '-'}${a};`);
                } else if (node.kind === 'select') {
                    const b = emit(node.selector);
                    if (info.filter) {
                        lines.push(`if (typeof ${b} !== 'boolean') return undefined; if (!${b}) continue;`);
                        const a = emit(node.source);
                        lines.push(`const ${name} = ${a};`);
                    } else {
                        const source = bound.get(node.source)!;
                        lines.push(`if (typeof ${b} !== 'bigint' || ${b} < 0n || ${b} >= BigInt(${source.shape![0]})) return undefined;`);
                        lines.push(`const ${name} = data[${source.slot}][offsets[${source.slot}] + Number(${b})];`);
                    }
                }
                return name;
            }
            const value = emit(root);
            const isBoolean = terminal === 'copy' ? output.boolean : ['any', 'all', 'count'].includes(terminal);
            lines.push(`if (${isBoolean ? `typeof ${value} !== 'boolean'` : `!${num(value)}`}) return undefined;`);
            if (terminal === 'copy') lines.push(`answer[i] = ${value};`);
            if (terminal === 'sum') lines.push(`answer = typeof answer === 'bigint' && typeof ${value} === 'bigint' ? answer + ${value} : Number(answer) + Number(${value});`);
            if (terminal === 'mean') lines.push(`answer += Number(${value});`);
            if (terminal === 'count') lines.push(`if (${value}) answer += 1n;`);
            if (terminal === 'any' || terminal === 'all') lines.push(`answer = answer ${terminal === 'any' ? '||' : '&&'} ${value};`);
            if (terminal === 'min' || terminal === 'max') lines.push(`if (length === 0 || ${value} ${terminal === 'min' ? '<' : '>'} answer) answer = ${value};`);
            lines.push('length++;');
            const initial = terminal === 'copy' ? 'new Array(size)' : terminal === 'mean' ? '0' : terminal === 'all' ? 'true' : terminal === 'any' ? 'false' : '0n';
            generated = `"use strict"; return function(data, offsets, scalars, size) { let answer = ${initial}, length = 0; for (let i = 0; i < size; i++) {\n${lines.join('\n')}\n} ${['mean', 'min', 'max'].includes(terminal) ? 'if (length === 0) return undefined;' : ''} return ${terminal === 'mean' ? 'answer / length' : 'answer'}; };`;
            try { cachedRun = new Function(generated)() as typeof cachedRun; }
            catch { unavailable = true; return undefined; }
            cachedKey = key;
            host.compiled?.(generated);
        }
        const result = cachedRun!(data, offsets, scalars, size);
        if (terminal === 'copy' && result !== undefined) {
            return ownedArray(result as RankValue[], output.shape, true);
        }
        return result as RankValue | undefined;
    } };
}
