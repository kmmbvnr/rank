import {
    scalarOperatorSignature, compiledScalarTypes, matchCompiledCallSignature, inferCompiledExpression, matchCompiledOperatorSignature,
    type CompiledExpression, type CompiledScalarType,
    isReturnStatement, isAssignmentStatement, isIfStatement,
    type Expression, type FunctionStatement, type Statement,
} from '@arrrank/language';
import { compilerRejection } from './compiler-rejection.js';
import { recordFallback } from './diagnostics.js';

interface Proof {
    readonly type: CompiledScalarType;
    readonly locals: readonly string[];
    readonly nativeReads: readonly string[];
    readonly expressions: ReadonlyMap<Expression, CompiledExpression<CompiledScalarType>>;
}
const simpleProofs = new WeakMap<FunctionStatement, Proof | string>();
const blockProofs = new WeakMap<FunctionStatement, Proof | string>();

// The caller must additionally check that local assignment names neither exist
// in the closure context nor can be created by the surrounding register region.
export function scalarFunctionResult(statement: FunctionStatement, blocks = false): Proof | undefined {
    const proofs = blocks ? blockProofs : simpleProofs;
    const cached = proofs.get(statement);
    if (typeof cached === 'string') return recordFallback(cached);
    if (cached) return cached;
    let rejection: string | undefined;
    function reject(node: Expression | Statement, detail?: string): undefined {
        rejection ??= compilerRejection('scalar-function', node, detail);
        return undefined;
    }
    const expressions = new Map<Expression, CompiledExpression<CompiledScalarType>>();
    const nativeReads = new Set<string>();
    const parameters = new Set(statement.parameters);
    const locals = new Set<string>();
    const settled = new Map<string, CompiledScalarType>(statement.parameters.map(name => [name, 'integer']));
    const budget = { remaining: blocks ? 256 : 129 };
    let resultType: CompiledScalarType | undefined;
    function type(expression: Expression, env: ReadonlyMap<string, CompiledScalarType>): CompiledScalarType | undefined {
        const inferred = inferCompiledExpression(expression, {
            types: compiledScalarTypes,
            lookup: name => env.get(name),
            operator: (operation, inputs) => matchCompiledOperatorSignature(operation.scalarFunction, inputs),
            call: (operation, inputs) => {
                const signature = matchCompiledCallSignature(operation, inputs);
                if (signature) nativeReads.add(operation.name);
                return signature;
            },
            budget,
        });
        if (inferred.failure) return reject(inferred.failure.source, inferred.failure.detail);
        expressions.set(expression, inferred.expression);
        return inferred.expression.type;
    }
    // null: every path returned; undefined: unproved; map: continuing paths.
    function flow(commands: readonly Statement[], env: Map<string, CompiledScalarType>): Map<string, CompiledScalarType> | null | undefined {
        for (let index = 0; index < commands.length; index++) {
            const command = commands[index];
            if (--budget.remaining < 0) return reject(command, 'budget');
            if (isReturnStatement(command) && command.value) {
                const value = type(command.value, env);
                if (!value || resultType && resultType !== value) return reject(command, 'return-type');
                resultType = value;
                // Reject unreachable syntax as well: local functions are hoisted.
                return index === commands.length - 1 ? null : reject(commands[index + 1], 'unreachable');
            }
            if (!blocks) return reject(command, 'blocks-disabled');
            if (isAssignmentStatement(command) && !command.name.includes('.')) {
                const value = type(command.value, env);
                if (!value || settled.has(command.name) && settled.get(command.name) !== value) return reject(command, 'binding-type');
                if (command.operator !== '=') {
                    if (env.get(command.name) !== value) return reject(command, 'compound-binding');
                    const signature = scalarOperatorSignature(command.operator.slice(0, -1), [value, value]);
                    if (!signature?.compound || signature.result !== value) return reject(command, `unsupported-op:${command.operator}`);
                }
                settled.set(command.name, value);
                env.set(command.name, value);
                if (!parameters.has(command.name)) locals.add(command.name);
                continue;
            }
            if (isIfStatement(command)) {
                const continuing: Map<string, CompiledScalarType>[] = [];
                for (const branch of [{ condition: command.condition, statements: command.thenStatements }, ...command.elifClauses]) {
                    if (type(branch.condition, env) !== 'boolean') return reject(branch.condition, 'condition-type');
                    const outcome = flow(branch.statements, new Map(env));
                    if (outcome === undefined) return undefined;
                    if (outcome) continuing.push(outcome);
                }
                const otherwise = flow(command.elseStatements, new Map(env));
                if (otherwise === undefined) return undefined;
                if (otherwise) continuing.push(otherwise);
                if (!continuing.length) return index === commands.length - 1 ? null : reject(commands[index + 1], 'unreachable');
                env = new Map([...continuing[0]].filter(([name, value]) => continuing.every(branch => branch.get(name) === value)));
                continue;
            }
            return reject(command);
        }
        return env;
    }
    const outcome = flow(statement.statements, new Map(settled));
    const result = outcome === null && resultType ? { type: resultType, locals: [...locals], nativeReads: [...nativeReads], expressions } : undefined;
    const reason = rejection ?? 'scalar-function:missing-return';
    proofs.set(statement, result ?? reason);
    return result ?? recordFallback(reason);
}
