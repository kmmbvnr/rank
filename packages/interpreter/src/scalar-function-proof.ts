import {
    scalarOperatorSignature, type CompiledScalarType,
    isReturnStatement, isAssignmentStatement, isIfStatement,
    isParenthesizedExpression, isNumberLiteral, isBooleanLiteral,
    isNameExpression, isUnaryExpression, isBinaryExpression,
    type Expression, type FunctionStatement, type Statement,
} from '@arrrank/language';

interface Proof { type: CompiledScalarType; locals: readonly string[] }
const simpleProofs = new WeakMap<FunctionStatement, Proof | null>();
const blockProofs = new WeakMap<FunctionStatement, Proof | null>();

// The caller must additionally check that local assignment names neither exist
// in the closure context nor can be created by the surrounding register region.
export function scalarFunctionResult(statement: FunctionStatement, blocks = false): Proof | undefined {
    const proofs = blocks ? blockProofs : simpleProofs;
    if (proofs.has(statement)) return proofs.get(statement) ?? undefined;
    const parameters = new Set(statement.parameters);
    const locals = new Set<string>();
    const settled = new Map<string, CompiledScalarType>(statement.parameters.map(name => [name, 'integer']));
    let remaining = blocks ? 256 : 129, resultType: CompiledScalarType | undefined;
    function type(expression: Expression, env: ReadonlyMap<string, CompiledScalarType>): CompiledScalarType | undefined {
        if (--remaining < 0) return undefined;
        if (isParenthesizedExpression(expression)) return type(expression.value, env);
        if (isNumberLiteral(expression) && typeof expression.value === 'bigint') return 'integer';
        if (isBooleanLiteral(expression)) return 'boolean';
        if (isNameExpression(expression)) return env.get(expression.name);
        if (isUnaryExpression(expression)) {
            const operand = type(expression.operand, env);
            return operand && scalarOperatorSignature(expression.operator, [operand])?.result;
        }
        if (isBinaryExpression(expression) && !expression.step) {
            const left = type(expression.left, env), right = type(expression.right, env);
            return left && right ? scalarOperatorSignature(expression.operator, [left, right])?.result : undefined;
        }
        return undefined;
    }
    // null: every path returned; undefined: unproved; map: continuing paths.
    function flow(commands: readonly Statement[], env: Map<string, CompiledScalarType>): Map<string, CompiledScalarType> | null | undefined {
        for (let index = 0; index < commands.length; index++) {
            if (--remaining < 0) return undefined;
            const command = commands[index];
            if (isReturnStatement(command) && command.value) {
                const value = type(command.value, env);
                if (!value || resultType && resultType !== value) return undefined;
                resultType = value;
                // Reject unreachable syntax as well: local functions are hoisted.
                return index === commands.length - 1 ? null : undefined;
            }
            if (!blocks) return undefined;
            if (isAssignmentStatement(command) && !command.name.includes('.')) {
                const value = type(command.value, env);
                if (!value || settled.has(command.name) && settled.get(command.name) !== value) return undefined;
                if (command.operator !== '=') {
                    if (env.get(command.name) !== value) return undefined;
                    const signature = scalarOperatorSignature(command.operator.slice(0, -1), [value, value]);
                    if (!signature?.compound || signature.result !== value) return undefined;
                }
                settled.set(command.name, value);
                env.set(command.name, value);
                if (!parameters.has(command.name)) locals.add(command.name);
                continue;
            }
            if (isIfStatement(command)) {
                const continuing: Map<string, CompiledScalarType>[] = [];
                for (const branch of [{ condition: command.condition, statements: command.thenStatements }, ...command.elifClauses]) {
                    if (type(branch.condition, env) !== 'boolean') return undefined;
                    const outcome = flow(branch.statements, new Map(env));
                    if (outcome === undefined) return undefined;
                    if (outcome) continuing.push(outcome);
                }
                const otherwise = flow(command.elseStatements, new Map(env));
                if (otherwise === undefined) return undefined;
                if (otherwise) continuing.push(otherwise);
                if (!continuing.length) return index === commands.length - 1 ? null : undefined;
                env = new Map([...continuing[0]].filter(([name, value]) => continuing.every(branch => branch.get(name) === value)));
                continue;
            }
            return undefined;
        }
        return env;
    }
    const outcome = flow(statement.statements, new Map(settled));
    const result = outcome === null && resultType ? { type: resultType, locals: [...locals] } : undefined;
    proofs.set(statement, result ?? null);
    return result;
}
