import {
    isYieldStatement, isFunctionStatement, isTestStatement,
    isIfStatement, isForStatement, isTryStatement,
    flatArrayBorrowCandidates,
    type FunctionStatement, type Statement,
} from '@arrrank/language';

export interface PreparedFunction {
    readonly generator: boolean;
    readonly locals: readonly FunctionStatement[];
    readonly layout: Map<string, number>;
    readonly borrowedParameters: ReadonlySet<string>;
}

// Syntax and slot names are shared, never values. Closures remain per invocation.
const prepared = new WeakMap<FunctionStatement, PreparedFunction>();

export function prepareFunction(statement: FunctionStatement): PreparedFunction {
    let result = prepared.get(statement);
    if (!result) {
        const generator = statementsContainYield(statement.statements);
        result = {
            generator,
            locals: statement.statements.filter(isFunctionStatement),
            layout: new Map([...new Set(statement.parameters)].map((name, index) => [name, index])),
            borrowedParameters: inferBorrowedParameters(statement, generator),
        };
        prepared.set(statement, result);
    }
    return result;
}

function inferBorrowedParameters(statement: FunctionStatement, isGenerator: boolean): ReadonlySet<string> {
    if (isGenerator || statement.parameters.length === 0) return new Set();
    // Dynamic helper calls need a call-site identity guard, so preparation
    // only accepts proofs that do not resolve another function.
    const indices = flatArrayBorrowCandidates(statement, () => undefined);
    return new Set(statement.parameters.filter((_, index) => indices.has(index)));
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
