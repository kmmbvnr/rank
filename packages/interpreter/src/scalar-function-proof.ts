import {
    scalarOperatorSignature, compiledScalarTypes, matchCompiledCallSignature, inferCompiledExpression, matchCompiledOperatorSignature,
    type CompiledExpression, type CompiledScalarType, type CompiledFunctionType, compiledFunctionTypeKey, sameCompiledFunctionType, flattenApplication, isApplicationExpression,
    isNameExpression, isReturnStatement, isAssignmentStatement, isIfStatement,
    type Expression, type FunctionStatement, type Statement,
} from '@arrrank/language';
import { compilerRejection } from './compiler-rejection.js';
import { recordFallback } from './diagnostics.js';

export interface ScalarFunctionInput {
    readonly name: string;
    readonly indices?: readonly CompiledExpression<CompiledFunctionType, ScalarFunctionInput>[];
}
export interface ScalarFunctionProof {
    readonly type: CompiledFunctionType;
    readonly locals: readonly string[];
    readonly nativeReads: readonly string[];
    readonly expressions: ReadonlyMap<Expression, CompiledExpression<CompiledFunctionType, ScalarFunctionInput>>;
}
const simpleProofs = new WeakMap<FunctionStatement, Map<string, ScalarFunctionProof | string>>();
const blockProofs = new WeakMap<FunctionStatement, Map<string, ScalarFunctionProof | string>>();

// The caller must additionally check that local assignment names neither exist
// in the closure context nor can be created by the surrounding register region.
export function scalarFunctionResult(statement: FunctionStatement, blocks = false,
    parameterTypes?: readonly CompiledFunctionType[]): ScalarFunctionProof | undefined {
    if (parameterTypes && parameterTypes.length !== statement.parameters.length) {
        return recordFallback('scalar-function:argument-count');
    }
    const cache = blocks ? blockProofs : simpleProofs;
    let proofs = cache.get(statement);
    if (!proofs) cache.set(statement, proofs = new Map());
    // The default remains the integer specialization used by loop call sites.
    // This is preparation-time work; runtime callers cache their selected proof.
    const types = parameterTypes ?? statement.parameters.map(() => 'integer' as const);
    const key = types.map(compiledFunctionTypeKey).join(',');
    const cached = proofs.get(key);
    if (typeof cached === 'string') return recordFallback(cached);
    if (cached) return cached;
    let rejection: string | undefined;
    function reject(node: Expression | Statement, detail?: string): undefined {
        rejection ??= compilerRejection('scalar-function', node, detail);
        return undefined;
    }
    const expressions = new Map<Expression, CompiledExpression<CompiledFunctionType, ScalarFunctionInput>>();
    const nativeReads = new Set<string>();
    const parameters = new Set(statement.parameters);
    const locals = new Set<string>();
    const settled = new Map<string, CompiledFunctionType>(statement.parameters.map((name, index) => [name, types[index]]));
    const budget = { remaining: blocks ? 256 : 129 };
    let resultType: CompiledFunctionType | undefined;
    function type(expression: Expression, env: ReadonlyMap<string, CompiledFunctionType>): CompiledFunctionType | undefined {
        const inferred = inferCompiledExpression<CompiledFunctionType, ScalarFunctionInput>(expression, {
            atom: type => compiledScalarTypes.find(candidate => candidate === type),
            read: source => {
                if (isNameExpression(source)) {
                    const known = env.get(source.name);
                    return known ? { type: known, input: { name: source.name } } : undefined;
                }
                if (!isApplicationExpression(source)) return undefined;
                const [head, ...indices] = flattenApplication(source);
                if (!isNameExpression(head)) return undefined;
                const array = env.get(head.name);
                if (!array || typeof array === 'string' || indices.length !== array.rank) return undefined;
                if (!indices.every(index => type(index, env) === 'integer')) return undefined;
                return { type: array.element, input: { name: head.name, indices: indices.map(index => expressions.get(index)!) } };
            },
            isBound: name => env.has(name),
            operator: (operation, inputs) => inputs.every((value): value is CompiledScalarType => typeof value === 'string')
                ? matchCompiledOperatorSignature(operation.scalarFunction, inputs) : undefined,
            call: (operation, inputs) => {
                const signature = matchCompiledCallSignature(operation, inputs.map(value => typeof value === 'string' ? value
                    : value.element === 'text' && value.rank === 1 ? 'text-array' : 'array'));
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
    function flow(commands: readonly Statement[], env: Map<string, CompiledFunctionType>): Map<string, CompiledFunctionType> | null | undefined {
        for (let index = 0; index < commands.length; index++) {
            const command = commands[index];
            if (--budget.remaining < 0) return reject(command, 'budget');
            if (isReturnStatement(command) && command.value) {
                const value = type(command.value, env);
                if (!value || resultType && !sameCompiledFunctionType(resultType, value)) return reject(command, 'return-type');
                resultType = value;
                // Reject unreachable syntax as well: local functions are hoisted.
                return index === commands.length - 1 ? null : reject(commands[index + 1], 'unreachable');
            }
            if (!blocks) return reject(command, 'blocks-disabled');
            if (isAssignmentStatement(command) && !command.name.includes('.')) {
                const value = type(command.value, env);
                if (!value || settled.has(command.name) && !sameCompiledFunctionType(settled.get(command.name)!, value)) return reject(command, 'binding-type');
                if (command.operator !== '=') {
                    if (!env.has(command.name) || !sameCompiledFunctionType(env.get(command.name)!, value)) return reject(command, 'compound-binding');
                    if (typeof value !== 'string') return reject(command, 'compound-type');
                    const signature = scalarOperatorSignature(command.operator.slice(0, -1), [value, value]);
                    if (!signature?.compound || signature.result !== value) return reject(command, `unsupported-op:${command.operator}`);
                }
                settled.set(command.name, value);
                env.set(command.name, value);
                if (!parameters.has(command.name)) locals.add(command.name);
                continue;
            }
            if (isIfStatement(command)) {
                const continuing: Map<string, CompiledFunctionType>[] = [];
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
                env = new Map([...continuing[0]].filter(([name, value]) => continuing.every(branch => branch.has(name) && sameCompiledFunctionType(branch.get(name)!, value))));
                continue;
            }
            return reject(command);
        }
        return env;
    }
    const outcome = flow(statement.statements, new Map(settled));
    const result = outcome === null && resultType ? { type: resultType, locals: [...locals], nativeReads: [...nativeReads], expressions } : undefined;
    const reason = rejection ?? 'scalar-function:missing-return';
    proofs.set(key, result ?? reason);
    return result ?? recordFallback(reason);
}
