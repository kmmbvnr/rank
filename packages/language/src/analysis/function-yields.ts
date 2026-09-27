import { AstUtils } from 'langium';
import { expressionFacts } from './value-facts.js';
import { UNKNOWN_VALUE, type ValueFacts } from './value-domain.js';
import {
    isBooleanLiteral, isBreakStatement, isContinueStatement, isForStatement, isFunctionStatement, isIfStatement,
    isReturnStatement, isTestStatement, isTryStatement, isYieldStatement,
    isAssignmentStatement, isNameExpression, isNumberLiteral, isStringLiteral, isUnpackStatement,
    type FunctionStatement, type Statement, type YieldStatement,
} from '../generated/ast.js';

/** Yields in this function, excluding nested function and test bodies. */
export function functionYields(definition: FunctionStatement, reachableOnly = false): readonly YieldStatement[] {
    const yields: YieldStatement[] = [];
    function visit(statements: readonly Statement[]): boolean {
        for (const statement of statements) {
            if (isYieldStatement(statement)) yields.push(statement);
            else if (isFunctionStatement(statement) || isTestStatement(statement)) continue;
            else if (isIfStatement(statement)) {
                let canContinue = false;
                let reachesElse = true;
                for (const clause of [{ condition: statement.condition, statements: statement.thenStatements },
                    ...statement.elifClauses]) {
                    if (reachableOnly && isBooleanLiteral(clause.condition) && !clause.condition.value) continue;
                    canContinue = visit(clause.statements) || canContinue;
                    if (reachableOnly && isBooleanLiteral(clause.condition) && clause.condition.value) {
                        reachesElse = false;
                        break;
                    }
                }
                if (reachesElse) canContinue = visit(statement.elseStatements) || canContinue;
                if (reachableOnly && !canContinue) return false;
            } else if (isForStatement(statement)) {
                if (!reachableOnly || !statement.condition || !isBooleanLiteral(statement.condition)
                    || statement.condition.value) visit(statement.statements);
            }
            else if (isTryStatement(statement)) {
                visit(statement.statements);
                for (const clause of statement.catches) visit(clause.statements);
                visit(statement.finallyStatements);
            }
            if (reachableOnly && (isReturnStatement(statement) || isBreakStatement(statement)
                || isContinueStatement(statement))) return false;
        }
        return true;
    }
    visit(definition.statements);
    return yields;
}

export function generatorCells(definition: FunctionStatement, arguments_: readonly ValueFacts[]): {
    yields: readonly YieldStatement[]; cells: readonly ValueFacts[];
} {
    const yields = functionYields(definition, true);
    // Parameters keep their input facts only when no supported path can
    // rebind them before a yield. Captures may change while suspended.
    const nodes = [...AstUtils.streamAllContents(definition)];
    const stableParameters = nodes.some(node => isForStatement(node) || isTryStatement(node)
        || isUnpackStatement(node) || isFunctionStatement(node))
        ? new Set<string>() : new Set(definition.parameters.filter(name => !nodes.some(node =>
            isAssignmentStatement(node) && node.name === name)));
    const argumentFor = (name: string): ValueFacts | undefined => {
        const index = definition.parameters.indexOf(name);
        const fact = index >= 0 && stableParameters.has(name) ? arguments_[index] : undefined;
        return fact?.types.includes('function') ? undefined : fact;
    };
    const cells = yields.map(statement => {
        const names = [statement.value, ...AstUtils.streamAllContents(statement.value)].filter(isNameExpression);
        return names.every(node => argumentFor(node.name))
            ? expressionFacts(statement.value, argumentFor) : UNKNOWN_VALUE;
    });
    if (definition.$container.$type === 'Program' && !nodes.some(isFunctionStatement)) {
        const positions = new Map(yields.map((statement, index) => [statement, index]));
        const locals = new Map<string, ValueFacts>();
        for (const statement of definition.statements) {
            if (isAssignmentStatement(statement) && statement.operator === '=' && !statement.name.includes('.')
                && !definition.parameters.includes(statement.name)
                && (isNameExpression(statement.value) || isNumberLiteral(statement.value)
                    || isStringLiteral(statement.value) || isBooleanLiteral(statement.value))) {
                const lookup = (name: string) => locals.get(name) ?? argumentFor(name);
                const facts = isNameExpression(statement.value) && !lookup(statement.value.name)
                    ? UNKNOWN_VALUE : expressionFacts(statement.value, lookup);
                locals.set(statement.name, facts);
            } else if (isYieldStatement(statement)) {
                const index = positions.get(statement);
                if (index !== undefined) {
                    const names = [statement.value, ...AstUtils.streamAllContents(statement.value)].filter(isNameExpression);
                    if (names.every(node => locals.has(node.name) || argumentFor(node.name))) {
                        cells[index] = expressionFacts(statement.value,
                            name => locals.get(name) ?? argumentFor(name));
                    }
                }
            } else {
                // Branches and other statements can change a local before
                // the next yield; do not carry its earlier fact across them.
                locals.clear();
            }
        }
    }
    return { yields, cells };
}

export function yieldTypes(cells: readonly ValueFacts[]): readonly string[] {
    return [...new Set(cells.flatMap(cell => cell.types))];
}

