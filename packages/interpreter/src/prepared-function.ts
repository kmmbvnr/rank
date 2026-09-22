import {
    isYieldStatement, isFunctionStatement, isTestStatement,
    isIfStatement, isForStatement, isTryStatement,
    isReturnStatement, isApplicationExpression, isNumberLiteral,
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
    const isDirectName = (expr: Expression | undefined, target: string): boolean => {
        if (!expr) return false;
        if (isNameExpression(expr) && expr.name === target) return true;
        if (isParenthesizedExpression(expr)) return isDirectName(expr.value, target);
        return false;
    };

    // Without call-effect and alias analysis, an unfamiliar name can invoke a
    // zero-argument function that writes the caller's array. Even another
    // parameter can be such a callback. Prove a small pure subset per parameter;
    // everything else keeps the normal copy-on-write binding.
    function onlyReads(node: unknown, parameter: string): boolean {
        if (!node || typeof node !== 'object') return true;
        if (Array.isArray(node)) return node.every(child => onlyReads(child, parameter));
        const obj = node as Record<string, unknown>;
        if (isNameExpression(obj)) return obj.name === parameter;
        if (isReturnStatement(obj) && isDirectName(obj.value, parameter)) return false;
        if (isApplicationExpression(obj)) {
            // Juxtaposition is both calling and addressing. Only literal
            // indexing of this parameter is known to be a read when it is an
            // array (the only value whose ownership borrowing changes).
            return isDirectName(obj.head, parameter)
                && obj.arguments.every(isNumberLiteral);
        }
        switch (obj.$type) {
            case 'ReturnStatement':
            case 'IfStatement':
            case 'ElifClause':
            case 'BinaryExpression':
            case 'UnaryExpression':
            case 'ParenthesizedExpression':
            case 'NumberLiteral':
            case 'BooleanLiteral':
            case 'StringLiteral':
            case 'LabelLiteral':
                return Object.entries(obj).every(([key, child]) =>
                    key.startsWith('$') || onlyReads(child, parameter));
            default:
                return false;
        }
    }

    return new Set(statement.parameters.filter(parameter => onlyReads(statement.statements, parameter)));
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
