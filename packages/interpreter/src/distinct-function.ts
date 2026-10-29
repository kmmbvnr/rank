import {
    flattenApplication, isApplicationExpression, isAssignmentStatement, isBinaryExpression,
    isBooleanLiteral, isIfStatement, isNameExpression, isNumberLiteral,
    isParenthesizedExpression, isReturnStatement, isUnaryExpression,
    type Expression, type FunctionStatement,
} from '@arrrank/language';
import { checkpoint } from './interrupt.js';
import { prepareIntegerView } from './integer-view.js';
import { isNativeFunction, type RankValue } from './value.js';
import { evaluateBinaryInteger } from './jit/operator-codegen.js';

type Node = { kind: 'read'; name: string } | { kind: 'literal'; value: bigint | boolean }
    | { kind: 'count'; input: Node } | { kind: 'length'; input: Node }
    | { kind: 'binary'; op: string; left: Node; right: Node };
type Scalar = { type: 'integer' | 'boolean'; scalar(): bigint | boolean };
type Vector = { length: number; read(index: number): bigint };
type Bound = Scalar | Vector | { distinct: Vector };

/** Private integer-vector predicates can compare distinct counts directly.
 * Counts are only deferred across pure assignments; guarded readers cannot
 * execute host code, change type or fail in an unvisited suffix. */
export function compileDistinctFunction(statement: FunctionStatement): {
    locals: readonly string[];
    prepare(args: readonly RankValue[], lookup: (name: string) => RankValue | undefined): (() => RankValue) | undefined;
} | undefined {
    const definitions = new Map<string, Node>();
    const names = new Set<string>();
    const assignments: Node[] = [];
    const guards: { condition: Node; result: Node }[] = [];
    let hasCount = false;
    const parse = (expression: Expression): Node | undefined => {
        if (isParenthesizedExpression(expression)) return parse(expression.value);
        if (isBooleanLiteral(expression)) return { kind: 'literal', value: expression.value };
        if (isNumberLiteral(expression) && typeof expression.value === 'bigint') return { kind: 'literal', value: expression.value };
        if (isNameExpression(expression) && !expression.name.includes('.')) {
            const defined = definitions.get(expression.name);
            if (defined) return defined;
            names.add(expression.name);
            return { kind: 'read', name: expression.name };
        }
        if (isUnaryExpression(expression) && expression.operator === '-') {
            const right = parse(expression.operand);
            return right && { kind: 'binary', op: '-', left: { kind: 'literal', value: 0n }, right };
        }
        if (isBinaryExpression(expression) && !expression.step
            && ['+', '-', '*', 'equal', 'notequal', 'and', 'or'].includes(expression.operator)) {
            const left = parse(expression.left), right = parse(expression.right);
            return left && right && { kind: 'binary', op: expression.operator, left, right };
        }
        if (isApplicationExpression(expression)) {
            const parts = flattenApplication(expression);
            if (parts.length === 3 && isNameExpression(parts[1]) && parts[1].name === 'unique'
                && isNameExpression(parts[2]) && parts[2].name === 'len') {
                const input = parse(parts[0]);
                hasCount = true;
                return input && { kind: 'count', input };
            }
            if (parts.length === 2 && isNameExpression(parts[1]) && parts[1].name === 'len') {
                const input = parse(parts[0]);
                return input && { kind: 'length', input };
            }
        }
        return undefined;
    };
    // Only straight-line assignments, early returns and a final return.
    const last = statement.statements.at(-1);
    if (statement.memo || !last || !isReturnStatement(last) || !last.value
        || statement.parameters.some(name => name === 'unique' || name === 'len')) return undefined;
    for (const command of statement.statements.slice(0, -1)) {
        if (isAssignmentStatement(command) && command.operator === '=' && command.value
            && !command.name.includes('.') && !definitions.has(command.name)
            && !statement.parameters.includes(command.name) && !names.has(command.name)
            && command.name !== 'unique' && command.name !== 'len') {
            const value = parse(command.value);
            if (!value || names.has(command.name)) return undefined;
            definitions.set(command.name, value);
            assignments.push(value);
        } else if (isIfStatement(command) && !command.elifClauses.length && !command.elseStatements.length
            && command.thenStatements.length === 1 && isReturnStatement(command.thenStatements[0])) {
            const condition = parse(command.condition), value = command.thenStatements[0].value;
            const result = value && parse(value);
            if (!condition || !result) return undefined;
            guards.push({ condition, result });
        } else return undefined;
    }
    const result = parse(last.value);
    if (!result || !hasCount) return undefined;
    const count = (vector: Vector): bigint => {
        const seen = new Set<bigint>();
        for (let i = 0; i < vector.length; i++) {
            checkpoint('counting distinct integers');
            seen.add(vector.read(i));
        }
        return BigInt(seen.size);
    };
    const equalCount = (vector: Vector, expected: bigint): boolean => {
        if (expected < 0n || expected > BigInt(vector.length)) return false;
        const target = Number(expected), seen = new Set<bigint>();
        for (let i = 0; i < vector.length; i++) {
            checkpoint('comparing distinct integers');
            seen.add(vector.read(i));
            if (seen.size > target || seen.size + vector.length - i - 1 < target) return false;
        }
        return seen.size === target;
    };
    return { locals: [...definitions.keys()], prepare(args, lookup) {
        if (args.length !== statement.parameters.length || args.some(isNativeFunction)) return undefined;
        const inputs = new Map<string, Bound>();
        for (const name of names) {
            const parameter = statement.parameters.indexOf(name);
            const value = parameter < 0 ? lookup(name) : args[parameter];
            if (typeof value === 'bigint' || typeof value === 'boolean') inputs.set(name, { type: typeof value === 'bigint' ? 'integer' : 'boolean', scalar: () => value });
            else {
                const view = value !== undefined && prepareIntegerView(value);
                if (!view || view.shape.length !== 1) return undefined;
                inputs.set(name, { length: view.shape[0], read: view.read });
            }
        }
        const bound = new Map<Node, Bound>();
        const scalar = (value: Bound): Scalar | undefined => 'distinct' in value
            ? { type: 'integer', scalar: () => count(value.distinct) } : 'scalar' in value ? value : undefined;
        const bind = (node: Node): Bound | undefined => {
            const old = bound.get(node);
            if (old) return old;
            let value: Bound | undefined;
            if (node.kind === 'read') value = inputs.get(node.name);
            else if (node.kind === 'literal') value = { type: typeof node.value === 'bigint' ? 'integer' : 'boolean', scalar: () => node.value };
            else if (node.kind === 'count' || node.kind === 'length') {
                const input = bind(node.input);
                if (!input || !('read' in input)) return undefined;
                value = node.kind === 'count' ? { distinct: input } : { type: 'integer', scalar: () => BigInt(input.length) };
            } else {
                const a = bind(node.left), b = bind(node.right);
                if (!a || !b) return undefined;
                if (node.op === 'equal' || node.op === 'notequal') {
                    const x = scalar(a), y = scalar(b);
                    if (!x || !y) return undefined;
                    const test = 'distinct' in a ? () => {
                        const expected = y.scalar();
                        return typeof expected === 'bigint' && equalCount(a.distinct, expected);
                    } : 'distinct' in b ? () => {
                        const expected = x.scalar();
                        return typeof expected === 'bigint' && equalCount(b.distinct, expected);
                    } : () => x.scalar() === y.scalar();
                    value = { type: 'boolean', scalar: () => test() === (node.op === 'equal') };
                } else if (node.op === 'and' || node.op === 'or') {
                    const x = scalar(a), y = scalar(b);
                    if (!x || !y || x.type !== 'boolean' || y.type !== 'boolean') return undefined;
                    value = { type: 'boolean', scalar: () => node.op === 'and' ? x.scalar() && y.scalar() : x.scalar() || y.scalar() };
                } else {
                    const x = 'distinct' in a ? scalar(a)! : a, y = 'distinct' in b ? scalar(b)! : b;
                    if ('scalar' in x && x.type !== 'integer'
                        || 'scalar' in y && y.type !== 'integer'
                        || 'read' in x && 'read' in y && x.length !== y.length) return undefined;
                    const op = (a: bigint, b: bigint) => evaluateBinaryInteger(node.op, a, b);
                    const read = (i: number) => op('scalar' in x ? x.scalar() as bigint : x.read(i),
                        'scalar' in y ? y.scalar() as bigint : y.read(i));
                    value = 'scalar' in x && 'scalar' in y ? { type: 'integer', scalar: () => read(0) }
                        : { length: 'read' in x ? x.length : (y as Vector).length, read };
                }
            }
            if (value) bound.set(node, value);
            return value;
        };
        for (const assignment of assignments) if (!bind(assignment)) return undefined;
        const branches = guards.map(guard => {
            const condition = bind(guard.condition), result = bind(guard.result);
            return condition && result && { condition: scalar(condition), result: scalar(result) };
        });
        const output = bind(result), returned = output && scalar(output);
        if (!returned || branches.some(branch => !branch?.condition || !branch.result
            || branch.condition.type !== 'boolean')) return undefined;
        return () => {
            for (const branch of branches) if (branch!.condition!.scalar()) return branch!.result!.scalar();
            return returned.scalar();
        };
    } };
}
