import {
    isAssignmentStatement, isReturnStatement, isNameExpression, isNumberLiteral,
    isUnaryExpression, isBinaryExpression, isParenthesizedExpression,
    type Expression, type FunctionStatement,
} from '@arrrank/language';
import type { CompiledCalleeType } from './compiled-callee-type.js';
import { PrivateNumericArray } from './number-loop-runtime.js';
import { checkedNumberModularMultiply, numberOverflow } from './number-arithmetic.js';

type Node = { kind: 'input'; index: number; array: boolean }
    | { kind: 'constant'; value: number; array: false }
    | { kind: 'unary'; op: string; operand: Node; array: boolean }
    | { kind: 'binary'; op: string; left: Node; right: Node; array: boolean };
type Argument = number | ArrayLike<number | bigint>;
type Run = (...args: Argument[]) => PrivateNumericArray;

const kernels = new WeakMap<FunctionStatement, Map<string, Run | null>>();

/** A pure pointwise helper inside a private Number transaction. Arrays stay
 * virtual until the fresh result is stored. All arithmetic guards throw the
 * caller's replay signal, never an eager Rank error: the ordinary callee then
 * retains its scalar/shape error order and unselected-cell demand semantics.
 * Callers must recheck the function identity and decline observable polling. */
export function compileIntegerArrayFunction(statement: FunctionStatement, types: readonly CompiledCalleeType[]): Run | undefined {
    const key = types.map(type => typeof type === 'string' ? type : JSON.stringify(type)).join(',');
    let variants = kernels.get(statement);
    if (!variants) kernels.set(statement, variants = new Map());
    if (!variants.has(key)) variants.set(key, lowerIntegerArrayFunction(statement, types) ?? null);
    return variants.get(key) ?? undefined;
}

function lowerIntegerArrayFunction(statement: FunctionStatement, types: readonly CompiledCalleeType[]): Run | undefined {
    if (statement.memo || statement.ranks.length || statement.parameters.length !== types.length
        || [...statement.leftBindings, ...statement.rightBindings].some(binding => binding.deferred)) return undefined;
    const definitions = new Map<string, Node>();
    for (let i = 0; i < types.length; i++) {
        const type = types[i];
        const array = typeof type !== 'string' && type.kind === 'array' && type.rank === 1 && type.element === 'integer';
        if (!array && type !== 'integer' || definitions.has(statement.parameters[i])) return undefined;
        definitions.set(statement.parameters[i], { kind: 'input', index: i, array });
    }
    function parse(expression: Expression): Node | undefined {
        if (isParenthesizedExpression(expression)) return parse(expression.value);
        if (isNameExpression(expression)) return definitions.get(expression.name);
        if (isNumberLiteral(expression) && typeof expression.value === 'bigint') {
            const value = Number(expression.value);
            return Number.isSafeInteger(value) ? { kind: 'constant', value, array: false } : undefined;
        }
        if (isUnaryExpression(expression) && ['+', '-'].includes(expression.operator)) {
            const operand = parse(expression.operand);
            return operand && { kind: 'unary', op: expression.operator, operand, array: operand.array };
        }
        if (isBinaryExpression(expression) && !expression.step && ['+', '-', '*', '//', 'mod'].includes(expression.operator)) {
            const left = parse(expression.left), right = parse(expression.right);
            return left && right ? { kind: 'binary', op: expression.operator, left, right, array: left.array || right.array } : undefined;
        }
        return undefined;
    }
    const bindings: Node[] = [];
    let root: Node | undefined;
    for (const [index, command] of statement.statements.entries()) {
        if (isAssignmentStatement(command) && command.operator === '=' && !command.deferred && !command.name.includes('.')) {
            const value = parse(command.value);
            if (!value) return undefined;
            definitions.set(command.name, value);
            bindings.push(value);
        } else if (isReturnStatement(command) && command.value && index === statement.statements.length - 1) root = parse(command.value);
        else return undefined;
    }
    // Returning a parameter/alias can retain protection or other reference
    // metadata. Only a fresh arithmetic result enters this ABI.
    if (!root?.array || root.kind !== 'binary') return undefined;
    const used = new Set<Node>();
    function visit(node: Node): void {
        if (used.has(node)) return;
        used.add(node);
        if (node.kind === 'binary') { visit(node.left); visit(node.right); }
        if (node.kind === 'unary') visit(node.operand);
    }
    visit(root);
    // Unused scalar bindings can still throw at call time. Leave that body to
    // ordinary execution rather than dropping or eagerly consuming its plans.
    if (bindings.some(node => !used.has(node))) return undefined;

    let serial = 0;
    const setup: string[] = [];
    const shapes = new Map<Node, string>();
    const scalars = new Map<Node, string>();
    function arithmetic(node: Extract<Node, { kind: 'binary' }>, left: string, right: string): string {
        if (node.op === '//') return `divide(${left}, ${right})`;
        if (node.op === 'mod') return `remainder(${left}, ${right})`;
        return `safe(${left} ${node.op} ${right})`;
    }
    function scalar(node: Node): string {
        const known = scalars.get(node);
        if (known) return known;
        let value: string;
        if (node.kind === 'input') value = `safe(args[${node.index}])`;
        else if (node.kind === 'constant') value = String(node.value);
        else if (node.kind === 'unary') value = `safe(${node.op}(${scalar(node.operand)}))`;
        else value = arithmetic(node, scalar(node.left), scalar(node.right));
        const name = `scalar${serial++}`;
        setup.push(`const ${name} = ${value};`);
        scalars.set(node, name);
        return name;
    }
    function shape(node: Node): string {
        if (!node.array) { scalar(node); return '1'; }
        const known = shapes.get(node);
        if (known) return known;
        let size: string;
        if (node.kind === 'input') size = `args[${node.index}].length`;
        else if (node.kind === 'unary') size = shape(node.operand);
        else if (node.kind === 'binary') {
            const left = shape(node.left), right = shape(node.right);
            if (!node.left.array) size = right;
            else if (!node.right.array) size = left;
            else {
                setup.push(`if (${left} !== ${right} && ${left} !== 1 && ${right} !== 1) throw overflow;`);
                size = `(${left} === 1 ? ${right} : ${left})`;
            }
            // Replay zero scalar divisors even for an empty result. Exact
            // execution decides whether their original evaluation is demanded.
            if (['//', 'mod'].includes(node.op) && !node.right.array) setup.push(`if (${scalar(node.right)} === 0) throw overflow;`);
        } else throw new Error('unexpected array constant');
        const name = `size${serial++}`;
        setup.push(`const ${name} = ${size};`);
        shapes.set(node, name);
        return name;
    }
    const size = shape(root), body: string[] = [];
    const values = new Map<Node, string>();
    function cell(node: Node): string {
        if (!node.array) return scalar(node);
        const known = values.get(node);
        if (known) return known;
        let value: string;
        if (node.kind === 'input') value = `integer(args[${node.index}][${shapes.get(node)} === 1 ? 0 : index])`;
        else if (node.kind === 'unary') value = `safe(${node.op}(${cell(node.operand)}))`;
        else if (node.kind === 'binary') {
            if (node.op === 'mod' && node.left.kind === 'binary' && node.left.op === '*') {
                value = `mulmod(${cell(node.left.left)}, ${cell(node.left.right)}, ${cell(node.right)})`;
            } else value = arithmetic(node, cell(node.left), cell(node.right));
        } else throw new Error('unexpected array constant');
        const name = `value${serial++}`;
        body.push(`const ${name} = ${value};`);
        values.set(node, name);
        return name;
    }
    const value = cell(root);
    const source = `return (...args) => {
        ${setup.join('\n')}
        const result = new PrivateNumericArray([${size}], 0);
        for (let index = 0; index < ${size}; index++) {
            ${body.join('\n')}
            result.store(index, ${value});
        }
        return result;
    };`;
    const safe = (value: number) => { if (!Number.isSafeInteger(value)) throw numberOverflow; return value; };
    const integer = (value: number | bigint) => {
        if (typeof value === 'bigint' && (value > 9007199254740991n || value < -9007199254740991n)) throw numberOverflow;
        return safe(Number(value));
    };
    const remainder = (a: number, b: number) => {
        if (!b) throw numberOverflow;
        const r = a % b;
        return r !== 0 && (r < 0) !== (b < 0) ? safe(r + b) : r;
    };
    const divide = (a: number, b: number) => {
        if (!b) throw numberOverflow;
        const r = a % b, q = safe(safe(a - r) / b);
        return safe(q - ((a < 0) !== (b < 0) && r !== 0 ? 1 : 0));
    };
    try {
        return new Function('PrivateNumericArray', 'safe', 'integer', 'divide', 'remainder', 'mulmod', 'overflow', source)(
            PrivateNumericArray, safe, integer, divide, remainder, checkedNumberModularMultiply, numberOverflow) as Run;
    } catch { return undefined; }
}
