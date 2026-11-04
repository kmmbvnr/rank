import { AstUtils } from 'langium';
import {
    expressionFacts, flattenApplication, isApplicationExpression, isArrayAssignmentStatement, isAssignmentStatement,
    isBinaryExpression, isBooleanLiteral, isBreakStatement, isContinueStatement, isForStatement, isIfStatement,
    isNameExpression, isParenthesizedExpression, isReturnStatement, isUnaryExpression, isYieldStatement,
    type Expression, type Statement,
} from '@arrrank/language';
import { hasNativeArrayHeader, integer32Cells, integer64Cells } from '../array-storage.js';
import { ownedStorage } from '../array-storage-state.js';
import { loopTraversal } from '../loop-traversal.js';
import { floorDivide, floorRemainder } from '../numeric-division.js';
import type { IntegerLoopPlan, LoopHost } from './integer-loop-plan.js';

/** Lower bound on complete nested passes in a packed vector loop. Inspect at
 * most its first two and last cells, never a callback or a body array read. Later
 * iterations are usable only without an escaping jump or mutable entry bounds.
 * This decides copy cost only; Number guards and exact replay remain mandatory. */
export function prepareVectorEntryWork(plan: IntegerLoopPlan, host: LoopHost):
    ((input: unknown[], target: number) => number) | undefined {
    const root = plan.statement, binding = plan.iteration;
    if (!binding || !isForStatement(root) || !plan.destinations.size
        || plan.calls.length || plan.callouts?.length || plan.hasYield) return undefined;
    const traversal = loopTraversal(binding);
    if (!traversal || traversal.slice || !isNameExpression(traversal.source)) return undefined;
    // Locations include every lowered statement, including nested branches.
    if (plan.locations.some(node => !isAssignmentStatement(node) && !isArrayAssignmentStatement(node)
        && !isForStatement(node) && !isIfStatement(node) && !isBreakStatement(node)
        && !isContinueStatement(node) && !isReturnStatement(node))) return undefined;
    const name = traversal.source.name, changed = new Set<string>();
    for (const node of AstUtils.streamAst(root)) {
        if (isAssignmentStatement(node)) changed.add(node.name);
        if (isForStatement(node)) host.iteration(node.condition)?.names.forEach(name => changed.add(name));
    }
    if (changed.has(name) || plan.destinations.has(name)) return undefined;
    const escapes = AstUtils.streamAst(root).some(node => isBreakStatement(node) || isReturnStatement(node));
    const abrupt = (statements: readonly Statement[]) => statements.some(statement => AstUtils.streamAst(statement)
        .some(node => isBreakStatement(node) || isContinueStatement(node) || isReturnStatement(node) || isYieldStatement(node)));
    return (input, target) => {
        const value = host.read(name);
        if (!value || !hasNativeArrayHeader(value) || value.shape.length !== 1) return 0;
        const cells = integer32Cells(value) ?? integer64Cells(value);
        if (!cells || !cells.length || cells.length !== value.shape[0]) return 0;
        for (const destination of plan.destinations.keys()) {
            if (plan.arrayDefinitions.has(destination) && !plan.arrayInputs.has(destination)) continue;
            const other = host.read(destination);
            if (!other || !hasNativeArrayHeader(other)) return 0;
            const buffer = ownedStorage.get(other)?.typed;
            if (other === value || buffer?.buffer === cells.buffer) return 0;
        }
        const base = new Map<string, bigint | boolean>();
        for (const slot of plan.required) {
            const name = plan.names[slot], value = input[slot];
            if (changed.has(name)) continue;
            if (plan.localTypes.get(name) === 'integer'
                && (typeof value === 'bigint' || typeof value === 'number' && Number.isSafeInteger(value))) base.set(name, BigInt(value));
            if (plan.localTypes.get(name) === 'boolean' && typeof value === 'boolean') base.set(name, value);
        }
        let work = 0;
        // Two leading sieve passes can pay for the copy even when the last
        // pass is tiny. Deduplicate short vectors; keep the same bounded proof
        // and do not inspect later entries after a possible escaping jump.
        const ordinals = escapes ? [0] : [...new Set([0, Math.min(1, cells.length - 1), cells.length - 1])];
        for (const ordinal of ordinals) {
            const values = new Map(base), at = traversal.reverse ? cells.length - 1 - ordinal : ordinal;
            if (binding.names[0] !== '#') values.set(binding.names[0], BigInt(cells[at]));
            if (binding.names[1] && binding.names[1] !== '#') values.set(binding.names[1], BigInt(ordinal));
            const lookup = (name: string) => {
                const value = values.get(name);
                return typeof value === 'bigint' ? { types: ['integer' as const], rank: 0, shape: [], integer: String(value) } : undefined;
            };
            const integer = (expression: Expression): bigint | undefined => {
                if (isParenthesizedExpression(expression)) return integer(expression.value);
                if (isBinaryExpression(expression) && ['+', '-', '*', '//', 'mod'].includes(expression.operator)) {
                    const a = integer(expression.left), b = integer(expression.right);
                    if (a === undefined || b === undefined || b === 0n && ['//', 'mod'].includes(expression.operator)) return undefined;
                    const value = expression.operator === '+' ? a + b : expression.operator === '-' ? a - b : expression.operator === '*' ? a * b
                        : expression.operator === '//' ? floorDivide(a, b) : floorRemainder(a, b);
                    return value >= -BigInt(Number.MAX_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? value : undefined;
                }
                const parts = isApplicationExpression(expression) && host.extrema ? flattenApplication(expression) : undefined;
                const word = parts?.at(-1);
                if (parts?.length === 3 && isNameExpression(word) && ['min', 'max'].includes(word.name)
                    && plan.builtins.get(word.name) === 'core' && !plan.localTypes.has(word.name)
                    && !plan.arrays.has(word.name) && !plan.containers.has(word.name)) {
                    const a = integer(parts[0]), b = integer(parts[1]);
                    if (a === undefined || b === undefined) return undefined;
                    return word.name === 'min' ? (a < b ? a : b) : (a > b ? a : b);
                }
                const value = expressionFacts(expression, lookup).integer;
                return value === undefined ? undefined : BigInt(value);
            };
            const boolean = (expression: Expression): boolean | undefined => {
                if (isParenthesizedExpression(expression)) return boolean(expression.value);
                if (isBooleanLiteral(expression)) return expression.value;
                if (isNameExpression(expression)) {
                    const value = values.get(expression.name);
                    return typeof value === 'boolean' ? value : undefined;
                }
                if (isUnaryExpression(expression) && expression.operator === 'not') {
                    const value = boolean(expression.operand);
                    return value === undefined ? undefined : !value;
                }
                if (!isBinaryExpression(expression)) return undefined;
                const a = integer(expression.left), b = integer(expression.right);
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
            type Flow = 'next' | 'break' | 'continue' | 'unknown';
            function walk(statements: readonly Statement[]): Flow {
                for (const statement of statements) {
                    if (work >= target) return 'next';
                    if (isAssignmentStatement(statement)) {
                        const value = statement.operator === '=' ? integer(statement.value) : undefined;
                        if (value !== undefined) values.set(statement.name, value);
                        else {
                            const truth = statement.operator === '=' ? boolean(statement.value) : undefined;
                            if (truth === undefined) values.delete(statement.name);
                            else values.set(statement.name, truth);
                        }
                    } else if (isIfStatement(statement)) {
                        let selected: readonly Statement[] | undefined;
                        for (const branch of [{ condition: statement.condition, statements: statement.thenStatements }, ...statement.elifClauses]) {
                            const truth = boolean(branch.condition);
                            if (truth === undefined) return 'unknown';
                            if (truth) { selected = branch.statements; break; }
                        }
                        const flow = walk(selected ?? statement.elseStatements);
                        if (flow !== 'next') return flow;
                    } else if (isForStatement(statement)) {
                        if (abrupt(statement.statements)) return 'unknown';
                        const nested = host.iteration(statement.condition), range = nested && loopTraversal(nested);
                        const count = range && !range.slice && isBinaryExpression(range.source) && ['to', 'till'].includes(range.source.operator)
                            ? expressionFacts(range.source, lookup).shape?.[0] : undefined;
                        if (count !== undefined && count !== null && Number.isSafeInteger(count)) work += Math.min(count, target - work);
                        // A preceding pass may change a later bound, including by
                        // reusing its name as an induction variable.
                        for (const node of AstUtils.streamAst(statement)) {
                            if (isAssignmentStatement(node)) values.delete(node.name);
                            if (isForStatement(node)) host.iteration(node.condition)?.names.forEach(name => values.delete(name));
                        }
                    } else if (isArrayAssignmentStatement(statement)) {
                        let range = statement.indices.at(-1)?.value;
                        while (range && isParenthesizedExpression(range)) range = range.value;
                        // A lowered slice stores at least one cell per selected
                        // position. Count only native ranges with known bounds;
                        // unknown selectors retain the existing copy/work cap.
                        const count = range && isBinaryExpression(range) && ['to', 'till'].includes(range.operator)
                            ? expressionFacts(range, lookup).shape?.[0] : undefined;
                        if (count !== undefined && count !== null && Number.isSafeInteger(count)) work += Math.min(count, target - work);
                    } else if (isBreakStatement(statement)) return 'break';
                    else if (isContinueStatement(statement)) return 'continue';
                    else if (isReturnStatement(statement)) return 'unknown';
                }
                return 'next';
            }
            const flow = walk(root.statements);
            if (work >= target || flow === 'break' || flow === 'unknown') return work;
        }
        return work;
    };
}
