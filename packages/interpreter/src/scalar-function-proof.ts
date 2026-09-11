import {
    isReturnStatement, isParenthesizedExpression, isNumberLiteral, isBooleanLiteral,
    isNameExpression, isUnaryExpression, isBinaryExpression,
    type Expression, type FunctionStatement,
} from 'rank-language';

type ScalarType = 'integer' | 'boolean';
const proofs = new WeakMap<FunctionStatement, ScalarType | null>();

// A call from a register region must not mutate its caller or expose its frame.
// This first proof accepts one scalar return using only integer parameters.
// Calls, external names, arrays, generators and unknown result types decline.
export function scalarFunctionResult(statement: FunctionStatement): ScalarType | undefined {
    if (proofs.has(statement)) return proofs.get(statement) ?? undefined;
    const parameters = new Set(statement.parameters);
    let remaining = 128;
    function type(expression: Expression): ScalarType | undefined {
        if (--remaining < 0) return undefined;
        if (isParenthesizedExpression(expression)) return type(expression.value);
        if (isNumberLiteral(expression) && typeof expression.value === 'bigint') return 'integer';
        if (isBooleanLiteral(expression)) return 'boolean';
        if (isNameExpression(expression) && parameters.has(expression.name)) return 'integer';
        if (isUnaryExpression(expression)) {
            const operand = type(expression.operand);
            if (expression.operator === 'not' && operand === 'boolean') return 'boolean';
            if (['+', '-'].includes(expression.operator) && operand === 'integer') return 'integer';
        }
        if (isBinaryExpression(expression) && !expression.step) {
            const left = type(expression.left), right = type(expression.right);
            if (!left || left !== right) return undefined;
            if (['equal', 'notequal'].includes(expression.operator)) return 'boolean';
            if (left === 'boolean' && ['and', 'or', 'xor'].includes(expression.operator)) return 'boolean';
            if (left === 'integer') {
                if (['+', '-', '*', '//', '%'].includes(expression.operator)) return 'integer';
                if (['less', 'greater', 'atmost', 'atleast'].includes(expression.operator)) return 'boolean';
            }
        }
        return undefined;
    }
    const only = statement.statements.length === 1 ? statement.statements[0] : undefined;
    const result = only && isReturnStatement(only) && only.value ? type(only.value) : undefined;
    proofs.set(statement, result ?? null);
    return result;
}
