import {
    isYieldStatement, isFunctionStatement, isTestStatement,
    isIfStatement, isForStatement, isTryStatement,
    type FunctionStatement, type Statement,
} from 'rank-language';

interface PreparedFunction {
    readonly generator: boolean;
    readonly locals: readonly FunctionStatement[];
}

// Only immutable syntax is cached. Closures and their frames remain per invocation.
const prepared = new WeakMap<FunctionStatement, PreparedFunction>();

export function prepareFunction(statement: FunctionStatement): PreparedFunction {
    let result = prepared.get(statement);
    if (!result) {
        result = {
            generator: statementsContainYield(statement.statements),
            locals: statement.statements.filter(isFunctionStatement),
        };
        prepared.set(statement, result);
    }
    return result;
}

function statementsContainYield(statements: readonly Statement[]): boolean {
    return statements.some(statement => {
        if (isYieldStatement(statement)) return true;
        if (isFunctionStatement(statement) || isTestStatement(statement)) return false;
        if (isIfStatement(statement)) {
            return statementsContainYield(statement.thenStatements)
                || statement.elifClauses.some(clause =>
                    statementsContainYield(clause.statements))
                || statementsContainYield(statement.elseStatements);
        }
        if (isForStatement(statement)) {
            return statementsContainYield(statement.statements);
        }
        if (isTryStatement(statement)) {
            return statementsContainYield(statement.statements)
                || statement.catches.some(clause =>
                    statementsContainYield(clause.statements))
                || statementsContainYield(statement.finallyStatements);
        }
        return false;
    });
}

