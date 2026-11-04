import { AstUtils, type AstNode } from 'langium';
import {
    forIteration, isExpression, isNumberLiteral, isNameExpression, isParenthesizedExpression,
    isBinaryExpression, isUnaryExpression, isAssignmentStatement, isUnpackStatement,
    isForStatement, isIfStatement, isArrayAssignmentStatement, isExpressionStatement,
    isReturnStatement, isBreakStatement, isContinueStatement,
    type Expression, type Statement, type ForStatement, type FunctionStatement,
} from '@arrrank/language';
import { floorDivide } from '../numeric-division.js';

export type IntegerRange = readonly [bigint, bigint];
const limit = 1n << 256n;
const safeLimit = 9007199254740991n;
const bounded = (a: bigint, b: bigint): IntegerRange | undefined =>
    a >= -limit && b <= limit ? [a, b] : undefined;
const hull = (values: readonly bigint[]): IntegerRange | undefined =>
    bounded(values.reduce((a, b) => a < b ? a : b), values.reduce((a, b) => a > b ? a : b));

export function safeIntegerRange(range: IntegerRange | undefined): readonly [number, number] | undefined {
    return range && range[0] >= -safeLimit && range[1] <= safeLimit ? [Number(range[0]), Number(range[1])] : undefined;
}

/** Exact interval arithmetic, capped to keep proof construction bounded. */
export function integerRange(op: string, left: IntegerRange | undefined, right: IntegerRange | undefined): IntegerRange | undefined {
    if (!right) return undefined;
    const [c, d] = right;
    if (op === 'mod' && (c > 0n || d < 0n)) return c > 0n ? bounded(0n, d - 1n) : bounded(c + 1n, 0n);
    if (!left) return undefined;
    const [a, b] = left;
    if (op === '+') return bounded(a + c, b + d);
    if (op === '-') return bounded(a - d, b - c);
    if (op === '*') return hull([a * c, a * d, b * c, b * d]);
    if (op === '//' && (c > 0n || d < 0n)) return hull([floorDivide(a, c), floorDivide(a, d), floorDivide(b, c), floorDivide(b, d)]);
    return undefined;
}

export interface IntegerRangeFacts {
    readonly values: WeakMap<Expression, IntegerRange>;
    readonly definitions: WeakMap<Statement, IntegerRange>;
    readonly narrowing: ReadonlySet<Expression>;
}
type Values = Map<string, IntegerRange>;
const cache = new WeakMap<ForStatement | FunctionStatement, IntegerRangeFacts>();

/** Facts belong to source occurrences, not variable names across definitions.
 * Back edges kill written names; branches merge ranges. No observed values,
 * array cells or callbacks are used. Unknown effects discard scalar facts. */
export function integerRangeFacts(root: ForStatement | FunctionStatement): IntegerRangeFacts {
    const cached = cache.get(root);
    if (cached) return cached;
    const definitions = new WeakMap<Statement, IntegerRange>();
    const values = new WeakMap<Expression, IntegerRange>(), narrowing = new Set<Expression>();
    const exhausted = {};
    let visits = 0, depth = 0;
    function expression(node: Expression, env: Values): IntegerRange | undefined {
        if (++visits > 8192 || ++depth > 256) throw exhausted;
        try { return evaluate(node, env); } finally { depth--; }
    }
    function evaluate(node: Expression, env: Values): IntegerRange | undefined {
        let range: IntegerRange | undefined;
        if (isNumberLiteral(node) && typeof node.value === 'bigint') range = bounded(node.value, node.value);
        else if (isNameExpression(node)) range = env.get(node.name);
        else if (isParenthesizedExpression(node)) range = expression(node.value, env);
        else if (isUnaryExpression(node)) {
            const value = expression(node.operand, env);
            if (value) range = node.operator === '-' ? bounded(-value[1], -value[0]) : node.operator === '+' ? value : undefined;
        } else if (isBinaryExpression(node)) {
            const left = expression(node.left, env), right = expression(node.right, env);
            range = integerRange(node.operator, left, right);
            if (safeIntegerRange(range) && (!safeIntegerRange(left) || !safeIntegerRange(right))) narrowing.add(node);
            if (node.step) expression(node.step, env);
        } else {
            // Preserve facts for index expressions inside otherwise unknown calls.
            for (const child of AstUtils.streamContents(node)) visit(child, env);
        }
        if (range) values.set(node, range);
        return range;
    }
    function visit(node: AstNode, env: Values): void {
        if (isExpression(node)) expression(node, env);
        else for (const child of AstUtils.streamContents(node)) visit(child, env);
    }
    function writes(node: AstNode): Set<string> {
        const names = new Set<string>();
        for (const child of [node, ...AstUtils.streamAllContents(node)]) {
            if (isAssignmentStatement(child)) names.add(child.name);
            if (isUnpackStatement(child)) child.names.forEach(name => names.add(name));
            if (isForStatement(child)) forIteration(child.condition)?.names.forEach(name => names.add(name));
        }
        return names;
    }
    function block(statements: readonly Statement[], env: Values): void {
        for (const node of statements) {
            if (isAssignmentStatement(node)) {
                const rhs = expression(node.value, env);
                const range = node.operator === '=' ? rhs : integerRange(node.operator.slice(0, -1), env.get(node.name), rhs);
                if (range) { env.set(node.name, range); definitions.set(node, range); } else env.delete(node.name);
            } else if (isUnpackStatement(node)) {
                expression(node.value, env);
                node.names.forEach(name => env.delete(name));
            } else if (isIfStatement(node)) {
                const branches = [{ condition: node.condition, statements: node.thenStatements }, ...node.elifClauses];
                const outcomes = branches.map(branch => {
                    expression(branch.condition, env);
                    const next = new Map(env); block(branch.statements, next); return next;
                });
                const otherwise = new Map(env); block(node.elseStatements, otherwise); outcomes.push(otherwise);
                env.clear();
                for (const [name, first] of outcomes[0]) {
                    const ranges = outcomes.map(outcome => outcome.get(name));
                    if (ranges.every(range => range !== undefined)) {
                        const range = hull([first[0], first[1], ...ranges.flatMap(range => [...range!])]);
                        if (range) env.set(name, range);
                    }
                }
            } else if (isForStatement(node)) loop(node, env);
            else {
                visit(node, env);
                if (!isArrayAssignmentStatement(node) && !isExpressionStatement(node) && !isReturnStatement(node)
                    && !isBreakStatement(node) && !isContinueStatement(node)) env.clear();
            }
        }
    }
    function loop(node: ForStatement, env: Values): void {
        const changed = writes(node);
        changed.forEach(name => env.delete(name));
        if (node.condition) expression(node.condition, env);
        const body = new Map(env), binding = forIteration(node.condition);
        let range = binding?.iterable;
        while (range && isParenthesizedExpression(range)) range = range.value;
        if (binding?.names.length === 1 && range && isBinaryExpression(range) && ['to', 'till'].includes(range.operator)
            && !node.statements.some(statement => writes(statement).has(binding.names[0]))) {
            const start = values.get(range.left), end = values.get(range.right);
            const bound = start && end && hull([...start, ...end]);
            if (bound) body.set(binding.names[0], bound);
        }
        block(node.statements, body);
        // Zero iterations and early exits prevent exporting body-only facts.
        changed.forEach(name => env.delete(name));
    }
    let result: IntegerRangeFacts = { values, definitions, narrowing };
    try {
        if (isForStatement(root)) loop(root, new Map()); else block(root.statements, new Map());
    } catch (error) {
        if (error !== exhausted) throw error;
        // A partial traversal cannot justify facts after an unseen write.
        result = { values: new WeakMap(), definitions: new WeakMap(), narrowing: new Set() };
    }
    cache.set(root, result);
    return result;
}
