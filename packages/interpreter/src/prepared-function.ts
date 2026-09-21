import {
    isYieldStatement, isFunctionStatement, isTestStatement,
    isIfStatement, isForStatement, isTryStatement,
    isAssignmentStatement, isArrayAssignmentStatement, isIndexAssignmentStatement,
    isAddStatement, isPushStatement, isUnpackStatement, isReturnStatement,
    isNameExpression, isParenthesizedExpression,
    type FunctionStatement, type Statement, type Expression,
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
    const borrowed = new Set(statement.parameters);

    const isDirectName = (expr: Expression | undefined, target: string): boolean => {
        if (!expr) return false;
        if (isNameExpression(expr) && expr.name === target) return true;
        if (isParenthesizedExpression(expr)) return isDirectName(expr.value, target);
        return false;
    };

    function visit(node: unknown): void {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            for (const item of node) visit(item);
            return;
        }
        const obj = node as Record<string, unknown>;
        const type = String(obj.$type ?? '');

        // 1. Direct mutation of the parameter name:
        if (isAssignmentStatement(obj) || isArrayAssignmentStatement(obj)
            || isIndexAssignmentStatement(obj) || isAddStatement(obj) || isPushStatement(obj)) {
            if (typeof obj.name === 'string' && borrowed.has(obj.name)) {
                borrowed.delete(obj.name);
            }
            // Storing the parameter into another variable, collection, or array cell:
            if (obj.value) {
                for (const param of borrowed) {
                    if (isDirectName(obj.value as Expression, param)) borrowed.delete(param);
                }
            }
        }
        if (isUnpackStatement(obj) && Array.isArray(obj.names)) {
            for (const name of obj.names) {
                if (typeof name === 'string' && borrowed.has(name)) borrowed.delete(name);
            }
        }

        // 2. Returning the parameter directly escapes it to the caller:
        if (isReturnStatement(obj) && obj.value) {
            for (const param of borrowed) {
                if (isDirectName(obj.value, param)) borrowed.delete(param);
            }
        }

        // 3. Captures in nested functions:
        if (isFunctionStatement(obj) && obj !== statement) {
            function checkCapture(nested: unknown): void {
                if (!nested || typeof nested !== 'object') return;
                if (Array.isArray(nested)) { for (const it of nested) checkCapture(it); return; }
                const nestedObj = nested as Record<string, unknown>;
                if (isNameExpression(nestedObj) && borrowed.has(nestedObj.name)) {
                    borrowed.delete(nestedObj.name);
                }
                for (const [key, child] of Object.entries(nestedObj)) {
                    if (!key.startsWith('$')) checkCapture(child);
                }
            }
            checkCapture(obj.statements);
            return;
        }

        // 4. Storing parameter into a record field:
        if (type === 'RecordField' && obj.value) {
            for (const param of borrowed) {
                if (isDirectName(obj.value as Expression, param)) borrowed.delete(param);
            }
        }

        for (const [key, child] of Object.entries(obj)) {
            if (!key.startsWith('$')) visit(child);
        }
    }

    visit(statement.statements);
    return borrowed;
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
