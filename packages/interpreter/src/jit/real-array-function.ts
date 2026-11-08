import {
    flattenApplication, isApplicationExpression, isAssignmentStatement, isReturnStatement,
    isNameExpression, isNumberLiteral, isUnaryExpression, isBinaryExpression, isParenthesizedExpression,
    type Expression, type FunctionStatement,
} from '@arrrank/language';
import type { CompiledCalleeType } from './compiled-callee-type.js';
import { PrivateNumericArray } from './number-loop-runtime.js';
import { scalarExtremeSource } from './operator-codegen.js';
import { broadcastShape } from './tensor-layout.js';
import { numberOverflow } from './number-arithmetic.js';

type Domain = { array: boolean; real: boolean };
type Node = Domain & ({ kind: 'input'; index: number } | { kind: 'constant'; value: number }
    | { kind: 'unary'; op: string; operand: Node }
    | { kind: 'binary'; op: string; left: Node; right: Node });
export type RealArrayAllocator = (shape: number[]) => PrivateNumericArray;
export interface RealArrayInput { readonly cells: Float64Array; readonly shape: readonly number[] }
export type RealArrayArgument = number | ArrayLike<number | bigint> | RealArrayInput | RealArrayAllocator;
type Run = (...args: RealArrayArgument[]) => PrivateNumericArray;
const kernels = new WeakMap<FunctionStatement, Map<string, Run | null>>();

/** Fresh rank-one/two real results inside an unobservable Number transaction.
 * The caller proves the ordinary function contract and guards every native
 * binding. Any failed finite/shape/integer proof replays the original body,
 * including its eager bindings and their error order. No input is mutated. */
export function compileRealArrayFunction(statement: FunctionStatement, types: readonly CompiledCalleeType[]): Run | undefined {
    const key = JSON.stringify(types);
    let variants = kernels.get(statement);
    if (!variants) kernels.set(statement, variants = new Map());
    if (!variants.has(key)) variants.set(key, lower(statement, types) ?? null);
    return variants.get(key) ?? undefined;
}
function lower(statement: FunctionStatement, types: readonly CompiledCalleeType[]): Run | undefined {
    if (statement.memo || statement.ranks.length || statement.parameters.length !== types.length
        || [...statement.leftBindings, ...statement.rightBindings].some(binding => binding.deferred)) return undefined;
    const definitions = new Map<string, Node>();
    for (let i = 0; i < types.length; i++) {
        const type = types[i];
        const array = typeof type !== 'string' && type.kind === 'array' && (type.rank === 1 || type.rank === 2) && type.element === 'real';
        if (!array && type !== 'integer' && type !== 'real' || definitions.has(statement.parameters[i])) return undefined;
        definitions.set(statement.parameters[i], { kind: 'input', index: i, array, real: array || type === 'real' });
    }
    function binary(op: string, left: Node, right: Node): Node | undefined {
        if (['//', 'mod'].includes(op) && (left.real || right.real)) return undefined;
        return { kind: 'binary', op, left, right, array: left.array || right.array,
            real: op === '/' || left.real || right.real };
    }
    function parse(source: Expression): Node | undefined {
        if (isParenthesizedExpression(source)) return parse(source.value);
        if (isNameExpression(source)) return definitions.get(source.name);
        if (isNumberLiteral(source)) {
            const value = Number(source.value), real = typeof source.value === 'number';
            return (real ? Number.isFinite(value) : Number.isSafeInteger(value))
                ? { kind: 'constant', value, array: false, real } : undefined;
        }
        if (isUnaryExpression(source) && ['+', '-'].includes(source.operator)) {
            const operand = parse(source.operand);
            return operand && { kind: 'unary', op: source.operator, operand, array: operand.array, real: operand.real };
        }
        if (isBinaryExpression(source) && !source.step && ['+', '-', '*', '/', '//', 'mod', '**'].includes(source.operator)) {
            const left = parse(source.left), right = parse(source.right);
            return left && right ? binary(source.operator, left, right) : undefined;
        }
        if (isApplicationExpression(source)) {
            const parts = flattenApplication(source);
            if (parts.length !== 3) return undefined;
            const infix = isNameExpression(parts[1]) && ['min', 'max'].includes(parts[1].name);
            const operation = infix ? parts[1] : parts[2];
            if (!isNameExpression(operation) || !['min', 'max'].includes(operation.name)) return undefined;
            const left = parse(parts[0]), right = parse(parts[infix ? 2 : 1]);
            return left && right ? binary(operation.name, left, right) : undefined;
        }
        return undefined;
    }
    const bindings: Node[] = [];
    let root: Node | undefined;
    for (const [i, command] of statement.statements.entries()) {
        if (isAssignmentStatement(command) && command.operator === '=' && !command.deferred && !command.name.includes('.')) {
            const value = parse(command.value);
            if (!value) return undefined;
            definitions.set(command.name, value); bindings.push(value);
        } else if (isReturnStatement(command) && command.value && i === statement.statements.length - 1) root = parse(command.value);
        else return undefined;
    }
    if (!root?.array || !root.real || root.kind !== 'binary') return undefined;
    const used = new Set<Node>();
    function visit(node: Node): void {
        if (used.has(node)) return;
        used.add(node);
        if (node.kind === 'binary') { visit(node.left); visit(node.right); }
        if (node.kind === 'unary') visit(node.operand);
    }
    visit(root);
    if (bindings.some(binding => !used.has(binding))) return undefined;
    let serial = 0;
    const setup: string[] = [], body: string[] = [];
    const sizes = new Map<Node, string>(), values = new Map<Node, string>();
    for (const [i, type] of types.entries()) {
        if (typeof type === 'string') setup.push(`const input${i} = ${type === 'real' ? 'finite' : 'safe'}(args[${i}]);`);
        else if (type.kind === 'array') setup.push(`const descriptor${i} = args[${i}];
            const input${i} = descriptor${i}.cells, shape${i} = descriptor${i}.shape;
            if (!(input${i} instanceof Float64Array) || !Array.isArray(shape${i}) || shape${i}.length !== ${type.rank}
                || shape${i}.some(n => !Number.isSafeInteger(n) || n < 0)
                || shape${i}.reduce((a,b) => a*b, 1) !== input${i}.length) throw overflow;`);
    }
    function shape(node: Node): string {
        if (!node.array) return '[]';
        const known = sizes.get(node); if (known) return known;
        let dimensions: string;
        if (node.kind === 'input') dimensions = `shape${node.index}`;
        else if (node.kind === 'unary') dimensions = shape(node.operand);
        else if (node.kind === 'binary') dimensions = `broadcast(${shape(node.left)}, ${shape(node.right)})`;
        else return '[]';
        const name = `shape${serial++}x`;
        setup.push(`const ${name} = ${dimensions};`); sizes.set(node, name); return name;
    }
    const dimensions = shape(root);
    const size = `(${dimensions}.length === 2 ? ${dimensions}[0] * ${dimensions}[1] : ${dimensions}[0])`;
    function cell(node: Node): string {
        const known = values.get(node); if (known) return known;
        // Parsed constants already passed their domain proof. Keep literals
        // visible to V8 (notably constant exponents) instead of hiding them
        // behind a runtime finite/safe call.
        if (node.kind === 'constant') return Object.is(node.value, -0) ? '-0' : String(node.value);
        const lines = node.array ? body : setup;
        let value: string;
        if (node.kind === 'input') {
            const type = types[node.index];
            const inputShape = `shape${node.index}`;
            const column = `(${dimensions}.length === 2 ? index % ${dimensions}[1] : index)`;
            const offset = typeof type !== 'string' && type.kind === 'array' && type.rank === 2
                ? `((${inputShape}[0] === 1 ? 0 : Math.floor(index / ${dimensions}[1]) * ${inputShape}[1]) + (${inputShape}[1] === 1 ? 0 : ${column}))`
                : `(${inputShape}[0] === 1 ? 0 : ${column})`;
            value = node.array ? `finite(input${node.index}[${offset}])` : `input${node.index}`;
        }
        else if (node.kind === 'unary') value = `${node.op}(${cell(node.operand)})`;
        else {
            const left = cell(node.left), right = cell(node.right);
            if (node.op === 'min' || node.op === 'max') value = scalarExtremeSource(node.op, left, right);
            else if (node.op === '//') value = `divide(${left}, ${right})`;
            else if (node.op === 'mod') value = `remainder(${left}, ${right})`;
            else {
                if (node.op === '/') lines.push(`if (${right} === 0) throw overflow;`);
                if (node.op === '**') lines.push(`if (${left} === 0 && ${right} < 0) throw overflow;`);
                value = `(${left}) ${node.op} (${right})`;
            }
        }
        const name = `value${serial++}`;
        lines.push(`const ${name} = ${node.real ? 'finite' : 'safe'}(${value});`);
        values.set(node, name); return name;
    }
    const value = cell(root);
    const source = `return (...args) => { ${setup.join('\n')}
        const allocate = args[${types.length}];
        const result = typeof allocate === 'function' ? allocate(${dimensions}) : new PrivateNumericArray(${dimensions}, 0, undefined, undefined, true);
        const output = result.cells;
        if (!(output instanceof Float64Array)) throw overflow;
        for (let index = 0; index < ${size}; index++) { ${body.join('\n')} output[index] = ${value}; }
        return result;
    };`;
    const safe = (value: number) => { if (!Number.isSafeInteger(value)) throw numberOverflow; return value || 0; };
    const finite = (value: number) => { if (!Number.isFinite(value)) throw numberOverflow; return value; };
    const remainder = (a: number, b: number) => { if (!b) throw numberOverflow; const r = a % b; return safe(r !== 0 && (r < 0) !== (b < 0) ? r + b : r); };
    const divide = (a: number, b: number) => { if (!b) throw numberOverflow; const r = a % b, q = safe(safe(a - r) / b); return safe(q - ((a < 0) !== (b < 0) && r !== 0 ? 1 : 0)); };
    const broadcast = (left: readonly number[], right: readonly number[]) => {
        try { return broadcastShape(left, right); } catch { throw numberOverflow; }
    };
    try { return new Function('PrivateNumericArray', 'safe', 'finite', 'divide', 'remainder', 'overflow', 'broadcast', source)(PrivateNumericArray, safe, finite, divide, remainder, numberOverflow, broadcast) as Run; }
    catch { return undefined; }
}
