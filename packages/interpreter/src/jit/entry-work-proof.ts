import { arrayPermutation } from './array-transfer.js';
import {
    expressionFacts, flattenApplication, isApplicationExpression, isArrayAssignmentStatement, isAssignmentStatement,
    isBinaryExpression, isBooleanLiteral, isBreakStatement, isContinueStatement, isForStatement, isIfStatement,
    isNameExpression, isParenthesizedExpression, isReturnStatement, isUnaryExpression, isYieldStatement, isUnpackStatement,
    type Expression, type Statement,
} from '@arrrank/language';
import { hasNativeArrayHeader, integer32Cells, integer64Cells } from '../array-storage.js';
import { ownedStorage } from '../array-storage-state.js';
import { loopTraversal } from '../loop-traversal.js';
import { checkedNumberPower, numberOverflow } from './number-arithmetic.js';
import { floorDivide, floorRemainder } from '../numeric-division.js';
import type { IntegerLoopPlan, LoopHost } from './integer-loop-plan.js';

type Values = Map<string, bigint | boolean>;
type Flow = 'next' | 'break' | 'continue' | 'unknown';
interface Work { work: number; flow: Flow }
interface Block {
    readonly writes: ReadonlySet<string>;
    readonly exits: boolean;
    readonly escapes: boolean;
    readonly hasWork: boolean;
    run(values: Values, target: number): Work;
}
type Integer = (values: Values) => bigint | undefined;
type Truth = (values: Values) => boolean | undefined;
const facts = (values: Values) => (name: string) => {
    const value = values.get(name);
    return typeof value === 'bigint' ? { types: ['integer' as const], rank: 0, shape: [], integer: String(value) } : undefined;
};

/** Entry scalar facts contain no callbacks or computed-cell caches. */
export function entryWorkValues(plan: IntegerLoopPlan, input: unknown[], excluded?: ReadonlySet<string>): Values {
    const values: Values = new Map();
    for (const slot of plan.required) {
        const name = plan.names[slot], value = input[slot];
        if (excluded?.has(name)) continue;
        if (plan.localTypes.get(name) === 'integer'
            && (typeof value === 'bigint' || typeof value === 'number' && Number.isSafeInteger(value))) values.set(name, BigInt(value));
        if (plan.localTypes.get(name) === 'boolean' && typeof value === 'boolean') values.set(name, value);
    }
    return values;
}

/** Prepare one compositional cost proof for condition and vector regions.
 * Counts describe normally completing passes, not permission to execute or
 * mutate. Runtime guards, error publication and overflow replay remain separate.
 * No loops are executed here: invariant nested work composes by multiplication.
 * Indexed facts may read only guarded immutable entry cells, disjoint from writes. */
export function prepareEntryWorkProof(plan: IntegerLoopPlan, host: LoopHost) {
    function integer(expression: Expression): Integer {
        if (isParenthesizedExpression(expression)) return integer(expression.value);
        if (isBinaryExpression(expression) && ['+', '-', '*', '//', 'mod', '**'].includes(expression.operator)) {
            const left = integer(expression.left), right = integer(expression.right), op = expression.operator;
            return values => {
                const a = left(values), b = right(values);
                if (a === undefined || b === undefined || b === 0n && ['//', 'mod'].includes(op)) return undefined;
                if (op === '**') {
                    // Safe exponents bound the checked squaring proof to 53 steps.
                    if (b < 0n || !Number.isSafeInteger(Number(a)) || !Number.isSafeInteger(Number(b))) return undefined;
                    try { return BigInt(checkedNumberPower(Number(a), Number(b))); }
                    catch (error) { if (error !== numberOverflow) throw error; return undefined; }
                }
                const value = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b
                    : op === '//' ? floorDivide(a, b) : floorRemainder(a, b);
                return value >= -BigInt(Number.MAX_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? value : undefined;
            };
        }
        const selected = isApplicationExpression(expression) ? flattenApplication(expression) : undefined;
        if (selected?.length === 2 && isNameExpression(selected[0])) {
            const name = selected[0].name, index = integer(selected[1]);
            if (plan.arrayInputs.has(name) && !plan.arrayDefinitions.has(name) && !plan.writable.has(name)) {
                return values => {
                    const at = index(values);
                    if (at === undefined || at < 0n || at > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
                    const value = host.read(name);
                    if (!value || !hasNativeArrayHeader(value) || value.shape.length !== 1) return undefined;
                    const cells = integer32Cells(value) ?? integer64Cells(value);
                    if (!cells || cells.length !== value.shape[0] || at >= BigInt(cells.length)) return undefined;
                    for (const destination of plan.destinations.keys()) {
                        if (plan.arrayDefinitions.has(destination) && !plan.arrayInputs.has(destination)) continue;
                        const other = host.read(destination);
                        if (!other || !hasNativeArrayHeader(other) || other === value
                            || ownedStorage.get(other)?.typed?.buffer === cells.buffer) return undefined;
                    }
                    const result = cells[Number(at)];
                    return Number.isSafeInteger(Number(result)) ? BigInt(result) : undefined;
                };
            }
        }
        const parts = isApplicationExpression(expression) && host.extrema ? flattenApplication(expression) : undefined;
        const word = parts?.at(-1);
        if (parts?.length === 3 && isNameExpression(word) && ['min', 'max'].includes(word.name)
            && plan.builtins.get(word.name) === 'core' && !plan.localTypes.has(word.name)
            && !plan.arrays.has(word.name) && !plan.containers.has(word.name)) {
            const left = integer(parts[0]), right = integer(parts[1]);
            return values => {
                const a = left(values), b = right(values);
                if (a === undefined || b === undefined) return undefined;
                return word.name === 'min' ? (a < b ? a : b) : (a > b ? a : b);
            };
        }
        return values => {
            const value = expressionFacts(expression, facts(values)).integer;
            return value === undefined ? undefined : BigInt(value);
        };
    }
    function truth(expression: Expression): Truth {
        if (isParenthesizedExpression(expression)) return truth(expression.value);
        if (isBooleanLiteral(expression)) return () => expression.value;
        if (isNameExpression(expression)) return values => {
            const value = values.get(expression.name);
            return typeof value === 'boolean' ? value : undefined;
        };
        if (isUnaryExpression(expression) && expression.operator === 'not') {
            const operand = truth(expression.operand);
            return values => { const value = operand(values); return value === undefined ? undefined : !value; };
        }
        if (!isBinaryExpression(expression)) return () => undefined;
        const left = integer(expression.left), right = integer(expression.right);
        return values => {
            const a = left(values), b = right(values);
            if (a === undefined || b === undefined) return undefined;
            switch (expression.operator) {
                case 'less': return a < b;
                case 'greater': return a > b;
                case 'atmost': return a <= b;
                case 'atleast': return a >= b;
                case 'equal': return a === b;
                case 'notequal': return a !== b;
                default: return undefined;
            }
        };
    }
    const rangeKey = (name: string) => `#range:${name}`;
    function range(expression: Expression | undefined) {
        while (expression && isParenthesizedExpression(expression)) expression = expression.value;
        if (expression && isApplicationExpression(expression) && plan.builtins.get('copy') === 'sequences') {
            const parts = flattenApplication(expression), last = parts.at(-1);
            if (parts.length === 2 && isNameExpression(last) && last.name === 'copy') {
                expression = parts[0];
                while (isParenthesizedExpression(expression)) expression = expression.value;
            }
        }
        const source = expression;
        const pointwise = source && isBinaryExpression(source) && ['+', '-', '*', '//', 'mod'].includes(source.operator)
            ? { left: range(source.left), right: range(source.right), a: integer(source.left), b: integer(source.right) } : undefined;
        return (values: Values): number => {
            if (source && isNameExpression(source)) {
                const count = values.get(rangeKey(source.name));
                return typeof count === 'bigint' ? Number(count) : 0;
            }
            if (pointwise) {
                const left = pointwise.left(values), right = pointwise.right(values);
                // Scalar broadcasts preserve the completed selector length.
                // Two vectors must agree; unknown operands prove no work.
                if (left && right) return left === right ? left : 0;
                if (left && pointwise.b(values) !== undefined) return left;
                if (right && pointwise.a(values) !== undefined) return right;
                return 0;
            }
            if (!source || !isBinaryExpression(source) || !['to', 'till'].includes(source.operator)) return 0;
            const count = expressionFacts(source, facts(values)).shape?.[0];
            return count !== undefined && count !== null && Number.isSafeInteger(count) && count >= 0 ? count : 0;
        };
    }
    function block(statements: readonly Statement[]): Block {
        const writes = new Set<string>();
        let exits = false, escapes = false, hasWork = false;
        const steps = statements.map(statement => {
            const next = (work = 0): Work => ({ work, flow: 'next' });
            if (isUnpackStatement(statement) && arrayPermutation(statement)) {
                statement.names.forEach(name => writes.add(name));
                return (values: Values): Work => {
                    statement.names.forEach(name => { values.delete(name); values.delete(rangeKey(name)); });
                    return next();
                };
            }
            if (isAssignmentStatement(statement)) {
                writes.add(statement.name);
                const value = integer(statement.value), boolean = truth(statement.value), count = range(statement.value);
                return (values: Values): Work => {
                    const cells = statement.operator === '=' ? count(values) : 0;
                    values.delete(rangeKey(statement.name));
                    // Keep completed selector lengths, not live bound expressions.
                    if (cells) values.set(rangeKey(statement.name), BigInt(cells));
                    const result = statement.operator === '=' ? value(values) ?? boolean(values) : undefined;
                    if (result === undefined) values.delete(statement.name);
                    else values.set(statement.name, result);
                    return next();
                };
            }
            if (isIfStatement(statement)) {
                const branches = [{ condition: statement.condition, statements: statement.thenStatements }, ...statement.elifClauses]
                    .map(branch => ({ condition: truth(branch.condition), body: block(branch.statements) }));
                const otherwise = block(statement.elseStatements);
                for (const body of [...branches.map(branch => branch.body), otherwise]) {
                    body.writes.forEach(name => writes.add(name));
                    exits ||= body.exits;
                    escapes ||= body.escapes;
                    hasWork ||= body.hasWork;
                }
                return (values: Values, target: number): Work => {
                    for (const branch of branches) {
                        const selected = branch.condition(values);
                        if (selected === undefined) return { work: 0, flow: 'unknown' };
                        if (selected) return branch.body.run(values, target);
                    }
                    return otherwise.run(values, target);
                };
            }
            if (isForStatement(statement)) {
                const binding = host.iteration(statement.condition), traversal = binding && loopTraversal(binding);
                const source = traversal && !traversal.slice ? traversal.source : undefined;
                const count = range(source);
                hasWork ||= !!source && isBinaryExpression(source) && ['to', 'till'].includes(source.operator);
                const body = block(statement.statements);
                const changed = new Set([...body.writes, ...(binding?.names ?? [])]);
                changed.forEach(name => writes.add(name));
                exits ||= body.exits;
                escapes ||= body.escapes;
                return (values: Values, target: number): Work => {
                    if (body.exits) return { work: 0, flow: 'unknown' };
                    const iterations = count(values);
                    // A value modified on a back edge is not invariant, even if
                    // this entry happens to have a useful value for its bound.
                    const invariant = new Map(values);
                    changed.forEach(name => { invariant.delete(name); invariant.delete(rangeKey(name)); values.delete(name); values.delete(rangeKey(name)); });
                    const nested = iterations > 0 && iterations < target ? body.run(invariant, target).work : 0;
                    // Saturate before multiplication to keep the cost exact.
                    return next(iterations >= target / (1 + nested) ? target : iterations * (1 + nested));
                };
            }
            if (isArrayAssignmentStatement(statement)) {
                let source = statement.indices.at(-1)?.value;
                while (source && isParenthesizedExpression(source)) source = source.value;
                hasWork ||= !!source && (isNameExpression(source) || isBinaryExpression(source) && ['to', 'till'].includes(source.operator));
                const count = range(source);
                return (values: Values, target: number): Work => next(Math.min(count(values), target));
            }
            if (isBreakStatement(statement) || isContinueStatement(statement)
                || isReturnStatement(statement) || isYieldStatement(statement)) {
                exits = true;
                escapes ||= !isContinueStatement(statement);
                const flow: Flow = isBreakStatement(statement) ? 'break' : isContinueStatement(statement) ? 'continue' : 'unknown';
                return (): Work => ({ work: 0, flow });
            }
            // Unknown statements may change bindings or leave the region.
            // A surrounding repetition cannot assume invariant facts survive.
            exits = escapes = true;
            return (): Work => ({ work: 0, flow: 'unknown' });
        });
        return { writes, exits, escapes, hasWork, run(values, target) {
            let work = 0;
            for (const step of steps) {
                if (work >= target) break;
                const result = step(values, target - work);
                work += result.work;
                if (result.flow !== 'next') return { work, flow: result.flow };
            }
            return { work, flow: 'next' };
        } };
    }
    return { block, truth, integer, range };
}
