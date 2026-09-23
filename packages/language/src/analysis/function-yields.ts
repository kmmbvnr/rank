import {
    isBooleanLiteral, isBreakStatement, isContinueStatement, isForStatement, isFunctionStatement, isIfStatement,
    isReturnStatement, isTestStatement, isTryStatement, isYieldStatement,
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
