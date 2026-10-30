import { compiledCalleeTypeKey, sameCompiledCalleeType, isCompiledContainer, type CompiledCalleeType } from './compiled-callee-type.js';
import {
    functionScope, functionCallSignature, lexicalBinding, applicationForm, findOperation, unaryApplicationHead, terminalReductionForm,
    scalarOperatorSignature, compiledScalarTypes, matchCompiledCallSignature, inferCompiledExpression, matchCompiledOperatorSignature,
    type CompiledExpression, type CompiledScalarType, type CompiledFunctionType, flattenApplication, isApplicationExpression,
    isNameExpression, isExpressionStatement, isReturnStatement, isAssignmentStatement, isIfStatement, isForStatement, isBinaryExpression, isParenthesizedExpression, forIteration, isNewStructureExpression, isPushStatement, isArrayAssignmentStatement, isArrayExpression, isBreakStatement, isContinueStatement, isMaterializeExpression,
    isCountClauseExpression, isUnpackStatement, type Expression, type FunctionStatement, type Statement,
} from '@arrrank/language';
import { describeCompilerRejection, recordCompilerRejection, type CompilerRejection } from './compiler-rejection.js';
import { recordFallback } from '../diagnostics.js';
import { AstUtils } from 'langium';
import { proveFunctionPlan, functionPlanType, type FunctionPlan, type FunctionPlanConsumer } from '../function-plan.js';
import { isNumberLiteral, isUnaryExpression } from '@arrrank/language';

export type ScalarCaptureTypes = ReadonlyMap<string, CompiledScalarType>;
export function scalarCaptureKey(captures: ScalarCaptureTypes): string {
    return JSON.stringify([...captures].sort(([a], [b]) => a.localeCompare(b)));
}
const noCaptures: ScalarCaptureTypes = new Map();

export interface ScalarFunctionInput {
    readonly name: string;
    readonly operation?: 'new' | 'pop' | 'len' | 'contains' | 'not-contains' | 'set-contains' | 'set-not-contains' | 'array' | 'vector' | 'materialize-deque' | 'sequence-contains' | 'sequence-not-contains' | 'array-contains' | 'array-not-contains' | 'user-call' | 'self-call' | 'index-default' | 'captured-read' | 'captured-scalar' | 'take' | 'drop' | 'copy' | 'plan' | 'integer-power' | 'text-at' | 'gather' | 'compare-array';
    readonly plan?: FunctionPlanConsumer;
    readonly negative?: boolean;
    readonly keyed?: boolean;
    readonly callee?: { readonly statement: FunctionStatement; readonly types: readonly CompiledCalleeType[]; readonly proof: ScalarFunctionProof; readonly captures: ScalarCaptureTypes };
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
    readonly localArrayWrites: boolean;
    readonly expressions: ReadonlyMap<Expression, CompiledExpression<CompiledCalleeType, ScalarFunctionInput>>;
    readonly planCalls: readonly { readonly name: string; readonly statement: FunctionStatement; readonly types: readonly CompiledCalleeType[]; readonly proof: ScalarFunctionProof; readonly captures: ScalarCaptureTypes }[];
    readonly planBindings: ReadonlyMap<Statement, FunctionPlan>;
    readonly planReturn: boolean;
    readonly planReturns: ReadonlySet<Statement>;
    readonly nonnegative: readonly number[];
}
const simpleProofs = new WeakMap<FunctionStatement, Map<string, ScalarFunctionProof | CompilerRejection>>();
const loopProofs = new WeakMap<FunctionStatement, Map<string, ScalarFunctionProof | CompilerRejection>>();
const blockProofs = new WeakMap<FunctionStatement, Map<string, ScalarFunctionProof | CompilerRejection>>();

// The caller must additionally check that local assignment names neither exist
// in the closure context nor can be created by the surrounding register region.
export function scalarFunctionResult(statement: FunctionStatement, blocks = false,
    parameterTypes?: readonly CompiledCalleeType[], loops = false, path: readonly FunctionStatement[] = [], captures: ScalarCaptureTypes = noCaptures): ScalarFunctionProof | undefined {
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
    const key = `${types.map(compiledCalleeTypeKey).join(',')}|${scalarCaptureKey(captures)}`;
    const cached = proofs.get(key);
    if (cached && 'reason' in cached) return recordCompilerRejection(cached);
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
    let rejection: CompilerRejection | undefined;
    function reject(node: Expression | Statement, detail?: string): undefined {
        rejection ??= describeCompilerRejection('scalar-function', node, detail);
        return undefined;
    }
    const expressions = new Map<Expression, CompiledExpression<CompiledCalleeType, ScalarFunctionInput>>();
    const nativeReads = new Set<string>();
    const dependencies = new Set<string>();
    const lexical = functionScope(statement);
    const scope = lexical?.scope;
    let callDepth = 1, callCount = 0, recursive = false;
    const modules = new Set<string>();
    const arrayWrites = new Set<Statement>();
    let containers = types.some(isCompiledContainer);
    const parameters = new Set(statement.parameters);
    const locals = new Set<string>();
    const settled = new Map<string, CompiledCalleeType>(statement.parameters.map((name, index) => [name, types[index]]));
    const budget = { remaining: blocks ? 256 : 129 };
    let resultType: CompiledFunctionType | undefined;
    const stages = new Map<string, FunctionPlan>();
    const planCalls: { name: string; statement: FunctionStatement; types: readonly CompiledCalleeType[]; proof: ScalarFunctionProof; captures: ScalarCaptureTypes }[] = [];
    const planBindings = new Map<Statement, FunctionPlan>();
    const protectedNames = new Set<string>();
    const nonnegativeParameters = new Set<number>();
    const modified = new Set<string>();
    for (const node of AstUtils.streamAst(statement)) {
        if (isAssignmentStatement(node)) modified.add(node.name);
        if (isUnpackStatement(node)) for (const name of node.names) modified.add(name);
        if (isForStatement(node)) for (const name of forIteration(node.condition)?.names ?? []) modified.add(name);
    }
    let planReturn = false;
    const planReturns = new Set<Statement>();
    let consumerRoot: Expression | undefined;
    const unwrap = (source: Expression): Expression => isParenthesizedExpression(source) ? unwrap(source.value) : source;
    const readsStage = (source: Expression) => AstUtils.streamAst(source).some(node => isNameExpression(node) && stages.has(node.name));
    function nonnegative(source: Expression): boolean {
        source = unwrap(source);
        if (isNumberLiteral(source)) return typeof source.value === 'bigint' && source.value >= 0n;
        if (!isNameExpression(source) || modified.has(source.name)) return false;
        const index = statement.parameters.lastIndexOf(source.name);
        if (index < 0) return false;
        nonnegativeParameters.add(index);
        return true;
    }
    function plan(source: Expression, env: ReadonlyMap<string, CompiledCalleeType>, protect = true): FunctionPlan | undefined {
        return proveFunctionPlan(source, {
            budget, nonnegative,
            input: name => {
                const domain = env.get(name);
                if (typeof domain === 'string') return { element: domain, rank: 0 };
                if (domain && !isCompiledContainer(domain) && (domain.rank === 1 || domain.rank === 2)) return { element: domain.element, rank: domain.rank };
                return undefined;
            },
            stage: name => stages.get(name),
            builtin: name => {
                if (env.has(name) || lexicalBinding(scope, name)) return false;
                nativeReads.add(name);
                return true;
            },
            capture: name => { if (protect) protectedNames.add(name); },
            operator: name => !env.has(name) && !lexicalBinding(scope, name),
            callback: (name, element) => {
                const callee = lexicalBinding(scope, name)?.function;
                if (env.has(name) || !callee || callee.memo || callee.parameters.length !== 1
                    || callee.ranks.some(rank => rank !== 'all')) return undefined;
                const signature = functionCallSignature(callee);
                if (signature.words.length || signature.parameters.some(parameter => parameter.kind === 'function' || parameter.deferred)) return undefined;
                const proof = scalarFunctionResult(callee, true, [element], true, [...path, statement], captures);
                if (!proof || typeof proof.type !== 'string' || proof.planReturn || proof.containers || proof.arrayWrites.size
                    || proof.nonnegative.length || proof.callDepth >= 16 || callCount + proof.callCount + 1 > 64) return undefined;
                callDepth = Math.max(callDepth, proof.callDepth + 1);
                callCount += proof.callCount + 1;
                dependencies.add(name);
                for (const dependency of [...proof.dependencies, ...proof.nativeReads, ...proof.locals]) dependencies.add(dependency);
                const key = planCalls.push({ name, statement: callee, types: [element], proof, captures }) - 1;
                return { key, element: proof.type };
            },
        });
    }
    function userCall(parts: readonly Expression[], env: ReadonlyMap<string, CompiledCalleeType>, source?: Expression) {
        const last = parts.at(-1);
        if (!loops || !last || !isNameExpression(last) || env.has(last.name)) return undefined;
        const callee = (lexical?.reads.get(last) ?? lexicalBinding(scope, last.name))?.function;
        if (!callee || callee.memo || callee.parameters.length !== parts.length - 1
            || callee.ranks.some(rank => rank !== 'all')) return undefined;
        const signature = functionCallSignature(callee);
        if (signature.words.length || signature.parameters.some(parameter => parameter.kind === 'function')) return undefined;
        const arguments_ = parts.slice(0, -1);
        if (signature.parameters.some(parameter => parameter.deferred && readsStage(arguments_[parameter.index]))) return undefined;
        const inputs = arguments_.map(argument => type(argument, env));
        // A base return establishes the self-call's scalar result. Its inputs
        // must preserve every domain, and the completed proof excludes array
        // writes; integer index mutations retain their shared-reference meaning.
        if (callee === statement && typeof resultType === 'string'
            && inputs.every((input, index) => input !== undefined && sameCompiledCalleeType(input, types[index]))) {
            recursive = true;
            callCount++;
            dependencies.add(last.name);
            return { type: resultType, input: { name: last.name, operation: 'self-call' as const,
                indices: arguments_.map(argument => expressions.get(argument)!) } };
        }
        // Read-only arguments and integer containers keep their proven domains
        // across linked calls. Writes to arguments still need a binding frame.
        if (!inputs.every((input): input is CompiledCalleeType => input !== undefined)) return undefined;
        const proof = scalarFunctionResult(callee, true, inputs, true, [...path, statement], captures);
        if (!proof || !proof.localArrayWrites || proof.arrayWrites.size && !proof.containers
            || proof.callDepth >= 16 || callCount + proof.callCount + 1 > 64) return undefined;
        if (proof.planReturn && (!consumerRoot || unwrap(consumerRoot) !== source)) return undefined;
        if (proof.nonnegative.some(index => !nonnegative(arguments_[index]))) return undefined;
        callDepth = Math.max(callDepth, proof.callDepth + 1);
        callCount += proof.callCount + 1;
        dependencies.add(last.name);
        for (const name of [...proof.dependencies, ...proof.nativeReads, ...proof.locals]) dependencies.add(name);
        return { type: proof.type, input: { name: last.name, operation: 'user-call' as const,
            callee: { statement: callee, types: inputs, proof, captures }, indices: arguments_.map(argument => expressions.get(argument)!) } };
    }
    function type(expression: Expression, env: ReadonlyMap<string, CompiledCalleeType>): CompiledCalleeType | undefined {
        const sumReduction = terminalReductionForm(flattenApplication(unwrap(expression)), name => !env.has(name) && !lexicalBinding(scope, name));
        const stageSum = stages.size > 0 && sumReduction?.operation === 'sum';
        if (loops && !stageSum && !isNameExpression(expression) && AstUtils.streamAst(expression).some(node => isNameExpression(node)
            && (stages.has(node.name) || typeof env.get(node.name) === 'object' && !isCompiledContainer(env.get(node.name)!)))) {
            const stage = plan(expression, env, false);
            if (stage) {
                const domain = functionPlanType(stage);
                expressions.set(expression, { kind: 'input', source: expression, type: domain,
                    input: { name: '', operation: 'plan', plan: { stage, terminal: 'copy' } } });
                return domain;
            }
        }
        const inferred = inferCompiledExpression<CompiledCalleeType, ScalarFunctionInput>(expression, {
            atom: type => compiledScalarTypes.find(candidate => candidate === type),
            read: source => {
                if (loops && isBinaryExpression(source) && source.operator === '**') {
                    const signed = isUnaryExpression(source.left) && ['+', '-'].includes(source.left.operator) ? source.left : undefined;
                    const base = signed?.operand ?? source.left;
                    if (type(base, env) === 'integer' && type(source.right, env) === 'integer' && nonnegative(source.right)) {
                        return { type: 'integer', input: { name: '', operation: 'integer-power', negative: signed?.operator === '-',
                            indices: [expressions.get(base)!, expressions.get(source.right)!] } };
                    }
                }
                if (loops && isNameExpression(source) && stages.has(source.name)) {
                    const stage = stages.get(source.name)!;
                    return { type: functionPlanType(stage), input: { name: '', operation: 'plan', plan: { stage, terminal: 'copy' } } };
                }
                if (loops && stages.size && isApplicationExpression(source)) {
                    const reduction = terminalReductionForm(flattenApplication(source), name => !env.has(name) && !lexicalBinding(scope, name));
                    if (reduction?.operation === 'sum') {
                        const stage = plan(reduction.source, env, false);
                        if (stage?.type.rank === 1 && ['integer', 'real'].includes(stage.type.element)) {
                            nativeReads.add('sum');
                            return { type: stage.type.element, input: { name: '', operation: 'plan', plan: { stage, terminal: 'sum' } } };
                        }
                    }
                }
                if (loops && isMaterializeExpression(source)) {
                    const domain = type(source.source, env);
                    if (!domain || !isCompiledContainer(domain) || domain.kind !== 'deque') return undefined;
                    return { type: { kind: 'array', element: 'integer', rank: 1 },
                        input: { name: '', operation: 'materialize-deque', indices: [expressions.get(source.source)!] } };
                }
                if (loops && isCountClauseExpression(source)) {
                    const array = type(source.source, env);
                    if (!array || typeof array === 'string' || isCompiledContainer(array)
                        || type(source.count, env) !== 'integer') return undefined;
                    return { type: array, input: { name: '', operation: source.operator,
                        indices: [expressions.get(source.source)!, expressions.get(source.count)!] } };
                }
                if (loops && isArrayExpression(source) && source.items.length
                    && !source.dimensions.length && !source.fill && !source.rows.length && !source.range) {
                    if (source.items.some(item => item.sign)) return undefined;
                    const types = source.items.map(item => type(item.value, env));
                    const element = types[0];
                    if (typeof element !== 'string' || types.some(type => type !== element)) return undefined;
                    return { type: { kind: 'array', element, rank: 1 }, input: {
                        name: '', operation: 'vector', indices: source.items.map(item => expressions.get(item.value)!),
                    } };
                }
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
                if (loops && isNewStructureExpression(source) && ['index', 'set', 'stack', 'queue', 'deque'].includes(source.structure)) {
                    containers = true;
                    modules.add('algo');
                    return { type: source.structure === 'index' || source.structure === 'set' ? { kind: source.structure } : { kind: 'deque', mode: source.structure as 'stack' | 'queue' | 'deque' }, input: { name: source.structure, operation: 'new' } };
                }
                if (loops && isBinaryExpression(source) && source.operator === 'default') {
                    let left = source.left;
                    while (isParenthesizedExpression(left)) left = left.value;
                    if (isApplicationExpression(left)) {
                        const parts = flattenApplication(left), [receiver, key] = parts;
                        const domain = isNameExpression(receiver) ? env.get(receiver.name) : undefined;
                        // A scalar slot cannot itself raise MissingValueError.
                        // Broader selector expressions retain ordinary default
                        // evaluation, which catches missing intermediate reads.
                        if (parts.length === 2 && isNameExpression(receiver) && isNameExpression(key)
                            && domain && isCompiledContainer(domain) && domain.kind === 'index'
                            && type(key, env) === 'integer' && type(source.right, env) === 'integer') {
                            return { type: 'integer', input: { name: receiver.name, operation: 'index-default',
                                indices: [expressions.get(key)!, expressions.get(source.right)!] } };
                        }
                    }
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
                    if (domain && isCompiledContainer(domain) && domain.kind === 'set' && type(source.left, env) === 'integer') {
                        return { type: 'boolean', input: { name: source.right.name, operation: source.operator === 'in' ? 'set-contains' : 'set-not-contains', indices: [expressions.get(source.left)!] } };
                    }
                }
                if (loops && isApplicationExpression(source)) {
                    const parts = flattenApplication(source);
                    const [receiver, operation] = parts;
                    if (parts.length === 2 && isNameExpression(operation) && operation.name === 'copy'
                        && !env.has('copy') && !lexicalBinding(scope, 'copy')) {
                        const array = type(receiver, env);
                        if (array && typeof array !== 'string' && !isCompiledContainer(array)) {
                            nativeReads.add('copy');
                            return { type: array, input: { name: '', operation: 'copy', indices: [expressions.get(receiver)!] } };
                        }
                    }
                    const domain = isNameExpression(receiver) ? env.get(receiver.name) : undefined;
                    if (parts.length === 2 && isNameExpression(receiver) && domain && isCompiledContainer(domain)
                        && domain.kind === 'deque'
                        && isNameExpression(operation) && !env.has(operation.name)
                        && (operation.name === 'len' || operation.name === 'pop' && domain.kind === 'deque')) {
                        nativeReads.add(operation.name);
                        return { type: 'integer', input: { name: receiver.name, operation: operation.name } };
                    }
                }
                if (isNameExpression(source)) {
                    const known = env.get(source.name);
                    if (known) return { type: known, input: { name: source.name } };
                    const captured = captures.get(source.name), binding = lexical?.reads.get(source) ?? lexicalBinding(scope, source.name);
                    if (loops && captured && binding && binding.scope.owner !== statement && !binding.function
                        && !source.name.includes('.')) {
                        dependencies.add(source.name);
                        return { type: captured, input: { name: source.name, operation: 'captured-scalar' } };
                    }
                    return userCall([source], env, source);
                }
                const lookup = (name: string) => env.has(name) || lexicalBinding(scope, name) ? false : findOperation(name);
                const form = applicationForm(source, lookup);
                if (form.kind === 'comparison-rank' && form.rank === 1 && form.axes === undefined) {
                    const left = type(form.left, env), right = type(form.right, env);
                    if (left && right && typeof left !== 'string' && typeof right !== 'string'
                        && !isCompiledContainer(left) && !isCompiledContainer(right) && left.rank === 1 && right.rank === 1
                        && left.element === right.element) return { type: 'boolean', input: { name: form.operator, operation: 'compare-array',
                            indices: [expressions.get(form.left)!, expressions.get(form.right)!] } };
                }
                if (form.kind !== 'plain' || !isApplicationExpression(source)) return undefined;
                const unary = unaryApplicationHead(source, name => {
                    const fn = lexicalBinding(scope, name)?.function;
                    return fn ? [fn.parameters.length] : undefined;
                }, name => !env.has(name));
                const call = userCall(unary ? [unary, source.arguments[0]] : flattenApplication(source), env, source);
                if (call) return call;
                const [head, ...indices] = flattenApplication(source);
                if (!isNameExpression(head)) return undefined;
                const array = env.get(head.name);
                if (array === 'text' && indices.length === 1 && type(indices[0], env) === 'integer') {
                    return { type: 'text', input: { name: head.name, operation: 'text-at', indices: [expressions.get(indices[0])!] } };
                }
                // A captured array is guarded as integer cells at call entry.
                if (!array && loops && lexical && lexical.reads.get(head)?.scope.owner !== statement
                    && !lexicalBinding(scope, head.name)?.function && !findOperation(head.name) && !head.name.includes('.')
                    && indices.length && indices.every(index => type(index, env) === 'integer')) {
                    dependencies.add(head.name);
                    return { type: 'integer', input: { name: head.name, operation: 'captured-read',
                        indices: indices.map(index => expressions.get(index)!) } };
                }
                if (!array || typeof array === 'string' || (isCompiledContainer(array) ? indices.length !== 1 : indices.length !== array.rank)) return undefined;
                if (!isCompiledContainer(array) && array.rank === 1 && indices.length === 1) {
                    const selector = type(indices[0], env);
                    if (selector && typeof selector !== 'string' && !isCompiledContainer(selector)
                        && selector.rank === 1 && selector.element === 'integer') return { type: array,
                            input: { name: head.name, operation: 'gather', indices: [expressions.get(indices[0])!] } };
                }
                if (!indices.every(index => type(index, env) === 'integer')) return undefined;
                return { type: isCompiledContainer(array) ? 'integer' : array.element, input: { name: head.name, keyed: isCompiledContainer(array), indices: indices.map(index => expressions.get(index)!) } };
            },
            isBound: name => env.has(name) || captures.has(name),
            extreme: (name, inputs) => {
                const type = inputs[0];
                if (lexicalBinding(scope, name) || type !== 'integer' && type !== 'real'
                    || inputs.some(input => input !== type)) return undefined;
                nativeReads.add(name);
                return type;
            },
            operator: (operation, inputs) => inputs.every((value): value is CompiledScalarType => typeof value === 'string')
                ? matchCompiledOperatorSignature(operation.scalarFunction, inputs) : undefined,
            call: (operation, inputs) => {
                // Only explicit completion and the lowered sum own a plan's
                // traversal. Metadata calls such as len must not force its cells.
                if (stages.size && readsStage(expression)) return undefined;
                if (inputs.some(isCompiledContainer)) return undefined;
                const signature = matchCompiledCallSignature(operation, inputs.map(value => typeof value === 'string' ? value
                    : !isCompiledContainer(value) && (value.element === 'text' || value.element === 'integer') && value.rank === 1 ? `${value.element}-array` : 'array'));
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
    function flow(commands: readonly Statement[], env: Map<string, CompiledCalleeType>, inLoop = false): Map<string, CompiledCalleeType> | null | undefined {
        for (let index = 0; index < commands.length; index++) {
            const command = commands[index];
            if (--budget.remaining < 0) return reject(command, 'budget');
            if (isReturnStatement(command) && command.value) {
                const delayed = readsStage(command.value);
                const value = type(command.value, env);
                if (delayed) {
                    let expression = expressions.get(command.value);
                    while (expression?.kind === 'group') expression = expression.operand;
                    if (expression?.kind !== 'input' || expression.input.plan?.terminal !== 'sum') return reject(command, 'plan-escape');
                    planReturn = true;
                    planReturns.add(command);
                }
                if (!value || isCompiledContainer(value) || resultType && !sameCompiledCalleeType(resultType, value)) return reject(command, 'return-type');
                resultType = value;
                // Reject unreachable syntax as well: local functions are hoisted.
                return index === commands.length - 1 ? null : reject(commands[index + 1], 'unreachable');
            }
            if (!blocks) return reject(command, 'blocks-disabled');
            // Like a return, a jump ends this path; the loop exit keeps the entry facts.
            if (loops && inLoop && (isBreakStatement(command) || isContinueStatement(command))) {
                return index === commands.length - 1 ? null : reject(commands[index + 1], 'unreachable');
            }
            if (isAssignmentStatement(command) && !command.name.includes('.')) {
                if (protectedNames.has(command.name)) return reject(command, 'plan-capture-write');
                if (command.deferred) {
                    // Fresh local stages may be erased only inside a proved
                    // consumer. Rebindings retain ordinary demand-time contracts.
                    if (!loops || commands !== statement.statements || command.operator !== '='
                        || settled.has(command.name) || stages.has(command.name)) return reject(command, 'deferred-binding');
                    const stage = plan(command.value, env);
                    if (!stage) return reject(command, 'plan-expression');
                    stages.set(command.name, stage);
                    planBindings.set(command, stage);
                    locals.add(command.name);
                    continue;
                }
                if (stages.has(command.name)) return reject(command, 'plan-rebinding');
                consumerRoot = command.value;
                const value = type(command.value, env);
                consumerRoot = undefined;
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
            if (loops && isUnpackStatement(command)) {
                const array = type(command.value, env);
                if (!array || typeof array === 'string' || isCompiledContainer(array) || array.rank !== 1) return reject(command, 'unpack-domain');
                for (const name of command.names) {
                    if (name === '#') continue;
                    if (name.includes('.') || protectedNames.has(name) || stages.has(name)
                        || settled.has(name) && settled.get(name) !== array.element) return reject(command, 'unpack-binding');
                    settled.set(name, array.element); env.set(name, array.element);
                    if (!parameters.has(name)) locals.add(name);
                }
                continue;
            }
            if (loops && isExpressionStatement(command)) {
                const mutation = applicationForm(command.value, findOperation, true);
                if (mutation.kind === 'collection-mutation' && mutation.operation === 'add'
                    && isNameExpression(mutation.receiver) && !env.has('add') && !lexicalBinding(scope, 'add')) {
                    const receiver = env.get(mutation.receiver.name);
                    if (receiver && isCompiledContainer(receiver) && receiver.kind === 'set'
                        && type(mutation.value, env) === 'integer') {
                        modules.add('algo');
                        nativeReads.add('add');
                        continue;
                    }
                }
                if (!type(command.value, env)) return reject(command);
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
                    || command.indices.length !== (isCompiledContainer(receiver) ? 1 : receiver.rank)
                    || command.indices.some(index => index.all || index.sign || !index.value || type(index.value, env) !== 'integer')
                    || type(command.value, env) !== (isCompiledContainer(receiver) ? 'integer' : receiver.element)) return reject(command, 'container-write');
                if (command.operator !== '=') {
                    const element = isCompiledContainer(receiver) ? 'integer' : receiver.element;
                    const signature = scalarOperatorSignature(command.operator.slice(0, -1), [element, element]);
                    if (!signature?.compound || signature.result !== element) return reject(command, 'array-compound');
                }
                if (!isCompiledContainer(receiver)) arrayWrites.add(command);
                continue;
            }
            if (loops && isForStatement(command)) {
                const body = new Map(env);
                const binding = forIteration(command.condition);
                if (binding) {
                    let range = binding.iterable;
                    while (isParenthesizedExpression(range)) range = range.value;
                    const iterable = !(isBinaryExpression(range) && ['to', 'till'].includes(range.operator)) ? type(range, env) : undefined;
                    const text = iterable === 'text';
                    const deque = iterable && isCompiledContainer(iterable) && iterable.kind === 'deque';
                    if ((!text && !deque && (!isBinaryExpression(range) || !['to', 'till'].includes(range.operator)
                        || type(range.left, env) !== 'integer' || type(range.right, env) !== 'integer'
                        || range.step && type(range.step, env) !== 'integer'))
                        || binding.names.length > 2 || new Set(binding.names).size !== binding.names.length) return reject(command, 'loop-range');
                    for (const [index, name] of binding.names.entries()) {
                        if (name === '#') continue;
                        if (protectedNames.has(name) || stages.has(name)) return reject(command, 'plan-capture-write');
                        const domain = text && index === 0 ? 'text' : 'integer';
                        if (name.includes('.') || settled.has(name) && settled.get(name) !== domain) return reject(command, 'loop-binding');
                        settled.set(name, domain);
                        body.set(name, domain);
                        if (!parameters.has(name)) locals.add(name);
                    }
                } else if (command.condition && type(command.condition, env) !== 'boolean') return reject(command, 'loop-condition');
                if (flow(command.statements, body, true) === undefined) return undefined;
                // A loop may execute zero times. New locals are not definitely
                // assigned afterwards, and a return inside does not prove exit.
                continue;
            }
            if (isIfStatement(command)) {
                const continuing: Map<string, CompiledCalleeType>[] = [];
                for (const branch of [{ condition: command.condition, statements: command.thenStatements }, ...command.elifClauses]) {
                    if (type(branch.condition, env) !== 'boolean') return reject(branch.condition, 'condition-type');
                    const outcome = flow(branch.statements, new Map(env), inLoop);
                    if (outcome === undefined) return undefined;
                    if (outcome) continuing.push(outcome);
                }
                const otherwise = flow(command.elseStatements, new Map(env), inLoop);
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
    // Seed a closed scalar return before visiting recursive calls. This is
    // only a candidate: normal flow still checks every return and all paths.
    // Do not read locals/captures or execute calls out of source order.
    const terminal = statement.statements.at(-1);
    if (loops && terminal && isReturnStatement(terminal) && terminal.value) {
        const seed = inferCompiledExpression<CompiledScalarType, never>(terminal.value, {
            atom: type => compiledScalarTypes.find(candidate => candidate === type),
            read: () => undefined,
            isBound: () => true,
            operator: (operation, inputs) => matchCompiledOperatorSignature(operation.scalarFunction, inputs),
            call: () => undefined,
            budget: { remaining: 64 },
        });
        if (!seed.failure) resultType = seed.expression.type;
    }
    const outcome = flow(statement.statements, new Map(settled));
    // Only constructor-owned slots can be written without an argument frame.
    // Reject aliases and every later assignment from a non-constructor source.
    const localArrays = new Set([...arrayWrites].filter(isArrayAssignmentStatement).map(command => command.name));
    for (const name of parameters) localArrays.delete(name);
    for (const node of AstUtils.streamAst(statement)) {
        if (!isAssignmentStatement(node) || !localArrays.has(node.name)) continue;
        const source = unwrap(node.value);
        if (node.operator !== '=' || !isArrayExpression(source) || !source.dimensions.length || !source.fill) localArrays.delete(node.name);
    }
    const localArrayWrites = [...arrayWrites].every(command => isArrayAssignmentStatement(command) && localArrays.has(command.name));
    const result = outcome === null && resultType && !(recursive && (arrayWrites.size || nonnegativeParameters.size))
        && !(planBindings.size && (containers || arrayWrites.size))
        ? { type: resultType, dependencies: [...dependencies], callDepth, callCount, locals: [...locals], nativeReads: [...nativeReads], modules: [...modules], containers, arrayWrites, localArrayWrites, expressions,
            planCalls, planBindings, planReturn, planReturns, nonnegative: [...nonnegativeParameters] } : undefined;
    const failure = rejection ?? { ...describeCompilerRejection('scalar-function', statement), reason: 'scalar-function:missing-return' };
    // A path-depth limit must not poison a helper that is shallow on its own.
    if (result || !path.length) proofs.set(key, result ?? failure);
    return result ?? recordCompilerRejection(failure);
}
