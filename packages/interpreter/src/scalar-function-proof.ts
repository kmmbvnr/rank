import { compiledCalleeTypeKey, sameCompiledCalleeType, isCompiledContainer, type CompiledCalleeType } from './compiled-callee-type.js';
import {
    functionScope, functionCallSignature, lexicalBinding, applicationForm, findOperation, unaryApplicationHead,
    scalarOperatorSignature, compiledScalarTypes, matchCompiledCallSignature, inferCompiledExpression, matchCompiledOperatorSignature,
    type CompiledExpression, type CompiledScalarType, type CompiledFunctionType, flattenApplication, isApplicationExpression,
    isNameExpression, isReturnStatement, isAssignmentStatement, isIfStatement, isForStatement, isBinaryExpression, isParenthesizedExpression, forIteration, isNewStructureExpression, isPushStatement, isArrayAssignmentStatement, isArrayExpression,
    type Expression, type FunctionStatement, type Statement,
} from '@arrrank/language';
import { compilerRejection } from './compiler-rejection.js';
import { recordFallback } from './diagnostics.js';

export interface ScalarFunctionInput {
    readonly name: string;
    readonly operation?: 'new' | 'pop' | 'len' | 'contains' | 'not-contains' | 'array' | 'sequence-contains' | 'sequence-not-contains' | 'array-contains' | 'array-not-contains' | 'user-call';
    readonly callee?: { readonly statement: FunctionStatement; readonly types: readonly CompiledCalleeType[]; readonly proof: ScalarFunctionProof };
    readonly dimensions?: readonly { readonly value: CompiledExpression<CompiledCalleeType, ScalarFunctionInput>; readonly negative: boolean }[];
    readonly indices?: readonly CompiledExpression<CompiledCalleeType, ScalarFunctionInput>[];
}
export interface ScalarFunctionProof {
    readonly type: CompiledFunctionType;
    readonly dependencies: readonly string[];
    readonly callDepth: number;
    readonly callCount: number;
    readonly locals: readonly string[];
    readonly nativeReads: readonly string[];
    readonly modules: readonly string[];
    readonly containers: boolean;
    readonly arrayWrites: ReadonlySet<Statement>;
    readonly expressions: ReadonlyMap<Expression, CompiledExpression<CompiledCalleeType, ScalarFunctionInput>>;
}
const simpleProofs = new WeakMap<FunctionStatement, Map<string, ScalarFunctionProof | string>>();
const loopProofs = new WeakMap<FunctionStatement, Map<string, ScalarFunctionProof | string>>();
const blockProofs = new WeakMap<FunctionStatement, Map<string, ScalarFunctionProof | string>>();

// The caller must additionally check that local assignment names neither exist
// in the closure context nor can be created by the surrounding register region.
export function scalarFunctionResult(statement: FunctionStatement, blocks = false,
    parameterTypes?: readonly CompiledCalleeType[], loops = false, path: readonly FunctionStatement[] = []): ScalarFunctionProof | undefined {
    if (path.includes(statement) || path.length >= 16) return recordFallback('scalar-function:call-graph');
    if (parameterTypes && parameterTypes.length !== statement.parameters.length) {
        return recordFallback('scalar-function:argument-count');
    }
    const cache = loops ? loopProofs : blocks ? blockProofs : simpleProofs;
    let proofs = cache.get(statement);
    if (!proofs) cache.set(statement, proofs = new Map());
    // The default remains the integer specialization used by loop call sites.
    // This is preparation-time work; runtime callers cache their selected proof.
    const types = parameterTypes ?? statement.parameters.map(() => 'integer' as const);
    const key = types.map(compiledCalleeTypeKey).join(',');
    const cached = proofs.get(key);
    if (typeof cached === 'string') return recordFallback(cached);
    if (cached) return cached;
    // Duplicate names are bound in order by the ordinary frame. Its array
    // contracts can reject an earlier argument even if the body reads only the
    // last binding. Equal domains are safe; mixed domains keep those checks.
    const firstTypes = new Map<string, CompiledCalleeType>();
    for (const [index, name] of statement.parameters.entries()) {
        const previous = firstTypes.get(name);
        if (previous && !sameCompiledCalleeType(previous, types[index])) return recordFallback('scalar-function:duplicate-parameter-domain');
        firstTypes.set(name, types[index]);
    }
    let rejection: string | undefined;
    function reject(node: Expression | Statement, detail?: string): undefined {
        rejection ??= compilerRejection('scalar-function', node, detail);
        return undefined;
    }
    const expressions = new Map<Expression, CompiledExpression<CompiledCalleeType, ScalarFunctionInput>>();
    const nativeReads = new Set<string>();
    const dependencies = new Set<string>();
    const lexical = functionScope(statement);
    const scope = lexical?.scope;
    let callDepth = 1, callCount = 0;
    const modules = new Set<string>();
    const arrayWrites = new Set<Statement>();
    let containers = types.some(isCompiledContainer);
    const parameters = new Set(statement.parameters);
    const locals = new Set<string>();
    const settled = new Map<string, CompiledCalleeType>(statement.parameters.map((name, index) => [name, types[index]]));
    const budget = { remaining: blocks ? 256 : 129 };
    let resultType: CompiledFunctionType | undefined;
    function userCall(parts: readonly Expression[], env: ReadonlyMap<string, CompiledCalleeType>) {
        const last = parts.at(-1);
        if (!loops || !last || !isNameExpression(last) || env.has(last.name)) return undefined;
        const callee = (lexical?.reads.get(last) ?? lexicalBinding(scope, last.name))?.function;
        if (!callee || callee.memo || callee.parameters.length !== parts.length - 1
            || callee.ranks.some(rank => rank !== 'all')) return undefined;
        const signature = functionCallSignature(callee);
        if (signature.words.length || signature.parameters.some(parameter => parameter.kind === 'function')) return undefined;
        const arguments_ = parts.slice(0, -1);
        const inputs = arguments_.map(argument => type(argument, env));
        // Nested calls cannot borrow or mutate a caller's storage implicitly.
        if (!inputs.every((input): input is CompiledScalarType => typeof input === 'string')) return undefined;
        const proof = scalarFunctionResult(callee, true, inputs, true, [...path, statement]);
        if (!proof || typeof proof.type !== 'string' || proof.containers || proof.arrayWrites.size
            || proof.callDepth >= 16 || callCount + proof.callCount + 1 > 64) return undefined;
        callDepth = Math.max(callDepth, proof.callDepth + 1);
        callCount += proof.callCount + 1;
        dependencies.add(last.name);
        for (const name of [...proof.dependencies, ...proof.nativeReads, ...proof.locals]) dependencies.add(name);
        return { type: proof.type, input: { name: last.name, operation: 'user-call' as const,
            callee: { statement: callee, types: inputs, proof }, indices: arguments_.map(argument => expressions.get(argument)!) } };
    }
    function type(expression: Expression, env: ReadonlyMap<string, CompiledCalleeType>): CompiledCalleeType | undefined {
        const inferred = inferCompiledExpression<CompiledCalleeType, ScalarFunctionInput>(expression, {
            atom: type => compiledScalarTypes.find(candidate => candidate === type),
            read: source => {
                if (loops && isArrayExpression(source) && source.dimensions.length && source.fill
                    && !source.rows.length && !source.items.length && !source.range) {
                    if (source.dimensions.some(item => !item.value || type(item.value, env) !== 'integer')) return undefined;
                    const element = type(source.fill, env);
                    if (!element || typeof element !== 'string') return undefined;
                    return { type: { kind: 'array', element, rank: source.dimensions.length }, input: {
                        name: '', operation: 'array', indices: [expressions.get(source.fill)!],
                        dimensions: source.dimensions.map(item => ({ value: expressions.get(item.value!)!, negative: item.sign === '-' })),
                    } };
                }
                if (loops && isNewStructureExpression(source) && ['index', 'stack', 'queue', 'deque'].includes(source.structure)) {
                    containers = true;
                    modules.add('algo');
                    return { type: source.structure === 'index' ? { kind: 'index' } : { kind: 'deque', mode: source.structure as 'stack' | 'queue' | 'deque' }, input: { name: source.structure, operation: 'new' } };
                }
                if (loops && isBinaryExpression(source) && ['in', 'notin'].includes(source.operator) && isNameExpression(source.right)) {
                    const domain = env.get(source.right.name);
                    if (!domain && lexical && lexical.reads.get(source.right)?.scope.owner !== statement
                        && type(source.left, env) === 'integer') {
                        dependencies.add(source.right.name);
                        return { type: 'boolean', input: { name: source.right.name,
                            operation: source.operator === 'in' ? 'sequence-contains' : 'sequence-not-contains',
                            indices: [expressions.get(source.left)!] } };
                    }
                    if (domain && typeof domain === 'object' && domain.kind === 'array'
                        && domain.element === 'integer' && domain.rank === 1 && type(source.left, env) === 'integer') {
                        return { type: 'boolean', input: { name: source.right.name,
                            operation: source.operator === 'in' ? 'array-contains' : 'array-not-contains',
                            indices: [expressions.get(source.left)!] } };
                    }
                    if (domain && isCompiledContainer(domain) && domain.kind === 'index' && type(source.left, env) === 'integer') {
                        return { type: 'boolean', input: { name: source.right.name, operation: source.operator === 'in' ? 'contains' : 'not-contains', indices: [expressions.get(source.left)!] } };
                    }
                }
                if (loops && isApplicationExpression(source)) {
                    const parts = flattenApplication(source);
                    const [receiver, operation] = parts;
                    const domain = isNameExpression(receiver) ? env.get(receiver.name) : undefined;
                    if (parts.length === 2 && isNameExpression(receiver) && domain && isCompiledContainer(domain)
                        && isNameExpression(operation) && !env.has(operation.name)
                        && (operation.name === 'len' || operation.name === 'pop' && domain.kind === 'deque')) {
                        nativeReads.add(operation.name);
                        return { type: 'integer', input: { name: receiver.name, operation: operation.name } };
                    }
                }
                if (isNameExpression(source)) {
                    const known = env.get(source.name);
                    return known ? { type: known, input: { name: source.name } } : userCall([source], env);
                }
                if (!isApplicationExpression(source)) return undefined;
                const lookup = (name: string) => env.has(name) || lexicalBinding(scope, name) ? false : findOperation(name);
                if (applicationForm(source, lookup).kind !== 'plain') return undefined;
                const unary = unaryApplicationHead(source, name => {
                    const fn = lexicalBinding(scope, name)?.function;
                    return fn ? [fn.parameters.length] : undefined;
                }, name => !env.has(name));
                const call = userCall(unary ? [unary, source.arguments[0]] : flattenApplication(source), env);
                if (call) return call;
                const [head, ...indices] = flattenApplication(source);
                if (!isNameExpression(head)) return undefined;
                const array = env.get(head.name);
                if (!array || typeof array === 'string' || (isCompiledContainer(array) ? array.kind !== 'index' || indices.length !== 1 : indices.length !== array.rank)) return undefined;
                if (!indices.every(index => type(index, env) === 'integer')) return undefined;
                return { type: isCompiledContainer(array) ? 'integer' : array.element, input: { name: head.name, indices: indices.map(index => expressions.get(index)!) } };
            },
            isBound: name => env.has(name),
            operator: (operation, inputs) => inputs.every((value): value is CompiledScalarType => typeof value === 'string')
                ? matchCompiledOperatorSignature(operation.scalarFunction, inputs) : undefined,
            call: (operation, inputs) => {
                if (inputs.some(isCompiledContainer)) return undefined;
                const signature = matchCompiledCallSignature(operation, inputs.map(value => typeof value === 'string' ? value
                    : !isCompiledContainer(value) && value.element === 'text' && value.rank === 1 ? 'text-array' : 'array'));
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
    function flow(commands: readonly Statement[], env: Map<string, CompiledCalleeType>): Map<string, CompiledCalleeType> | null | undefined {
        for (let index = 0; index < commands.length; index++) {
            const command = commands[index];
            if (--budget.remaining < 0) return reject(command, 'budget');
            if (isReturnStatement(command) && command.value) {
                const value = type(command.value, env);
                if (!value || isCompiledContainer(value) || resultType && !sameCompiledCalleeType(resultType, value)) return reject(command, 'return-type');
                resultType = value;
                // Reject unreachable syntax as well: local functions are hoisted.
                return index === commands.length - 1 ? null : reject(commands[index + 1], 'unreachable');
            }
            if (!blocks) return reject(command, 'blocks-disabled');
            if (isAssignmentStatement(command) && !command.name.includes('.')) {
                const value = type(command.value, env);
                if (!value || settled.has(command.name) && !sameCompiledCalleeType(settled.get(command.name)!, value)) return reject(command, 'binding-type');
                if (command.operator !== '=') {
                    if (!env.has(command.name) || !sameCompiledCalleeType(env.get(command.name)!, value)) return reject(command, 'compound-binding');
                    if (typeof value !== 'string') return reject(command, 'compound-type');
                    const signature = scalarOperatorSignature(command.operator.slice(0, -1), [value, value]);
                    if (!signature?.compound || signature.result !== value) return reject(command, `unsupported-op:${command.operator}`);
                }
                settled.set(command.name, value);
                env.set(command.name, value);
                if (!parameters.has(command.name)) locals.add(command.name);
                continue;
            }
            if (loops && isPushStatement(command)) {
                const receiver = isNameExpression(command.receiver) ? env.get(command.receiver.name) : undefined;
                if (!receiver || !isCompiledContainer(receiver) || receiver.kind !== 'deque'
                    || type(command.value, env) !== 'integer') return reject(command, 'container-push');
                modules.add('algo');
                continue;
            }
            if (loops && isArrayAssignmentStatement(command)) {
                const receiver = env.get(command.name);
                if (!receiver || typeof receiver === 'string' || isCompiledContainer(receiver) && receiver.kind !== 'index'
                    || command.operator !== '=' || command.indices.length !== (isCompiledContainer(receiver) ? 1 : receiver.rank)
                    || command.indices.some(index => index.all || index.sign || !index.value || type(index.value, env) !== 'integer')
                    || type(command.value, env) !== (isCompiledContainer(receiver) ? 'integer' : receiver.element)) return reject(command, 'container-write');
                if (!isCompiledContainer(receiver)) arrayWrites.add(command);
                continue;
            }
            if (loops && isForStatement(command)) {
                const body = new Map(env);
                const binding = forIteration(command.condition);
                if (binding) {
                    let range = binding.iterable;
                    while (isParenthesizedExpression(range)) range = range.value;
                    if (!isBinaryExpression(range) || !['to', 'till'].includes(range.operator)
                        || type(range.left, env) !== 'integer' || type(range.right, env) !== 'integer'
                        || range.step && type(range.step, env) !== 'integer'
                        || binding.names.length > 2 || new Set(binding.names).size !== binding.names.length) return reject(command, 'loop-range');
                    for (const name of binding.names) {
                        if (name === '#') continue;
                        if (name.includes('.') || settled.has(name) && settled.get(name) !== 'integer') return reject(command, 'loop-binding');
                        settled.set(name, 'integer');
                        body.set(name, 'integer');
                        if (!parameters.has(name)) locals.add(name);
                    }
                } else if (command.condition && type(command.condition, env) !== 'boolean') return reject(command, 'loop-condition');
                if (flow(command.statements, body) === undefined) return undefined;
                // A loop may execute zero times. New locals are not definitely
                // assigned afterwards, and a return inside does not prove exit.
                continue;
            }
            if (isIfStatement(command)) {
                const continuing: Map<string, CompiledCalleeType>[] = [];
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
                env = new Map([...continuing[0]].filter(([name, value]) => continuing.every(branch => branch.has(name) && sameCompiledCalleeType(branch.get(name)!, value))));
                continue;
            }
            return reject(command);
        }
        return env;
    }
    const outcome = flow(statement.statements, new Map(settled));
    const result = outcome === null && resultType ? { type: resultType, dependencies: [...dependencies], callDepth, callCount, locals: [...locals], nativeReads: [...nativeReads], modules: [...modules], containers, arrayWrites, expressions } : undefined;
    const reason = rejection ?? 'scalar-function:missing-return';
    // A path-depth limit must not poison a helper that is shallow on its own.
    if (result || !path.length) proofs.set(key, result ?? reason);
    return result ?? recordFallback(reason);
}
