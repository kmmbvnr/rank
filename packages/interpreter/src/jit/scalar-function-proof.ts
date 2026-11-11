import { observeCompiler } from '../compiler-observation.js';
import { currentDiagnostics } from '../diagnostics.js';
import { compiledCalleeTypeKey, sameCompiledCalleeType, isCompiledContainer, isCompiledArray, type CompiledCalleeType } from './compiled-callee-type.js';
import { positionalDeclaredCall, strictDataCall, wholeDeclaredCall } from './declared-scalar-call.js';
import {
    symbolicApplicationForm, scalarChooseOperands, functionScope, functionCallSignature, lexicalBinding, applicationForm, findOperation, unaryApplicationHead, terminalReductionForm,
    scalarOperatorSignature, compiledScalarTypes, matchCompiledCallSignature, inferCompiledExpression, matchCompiledOperatorSignature,
    type CompiledExpression, type CompiledFunctionType, type CompiledScalarType, flattenApplication, isApplicationExpression, isDeclaredCallExpression,
    isNameExpression, isExpressionStatement, isReturnStatement, isAssignmentStatement, isIfStatement, isForStatement, isBinaryExpression, isParenthesizedExpression, forIteration, isNewStructureExpression, isPushStatement, isArrayAssignmentStatement, isArrayExpression, isBreakStatement, isContinueStatement, isMaterializeExpression,
    isCountClauseExpression, isAllAxisExpression, isUnpackStatement, type Expression, type FunctionStatement, type Statement, type Operation, type FunctionEffects, type ReturnOrigin,
} from '@arrrank/language';
import { describeCompilerRejection, recordCompilerRejection, type CompilerRejection } from './compiler-rejection.js';
import { recordFallback } from '../diagnostics.js';
import { AstUtils } from 'langium';
import { proveFunctionPlan, functionPlanType, type FunctionPlan, type FunctionPlanConsumer } from '../function-plan.js';
import { isNumberLiteral, isUnaryExpression } from '@arrrank/language';

export type ScalarCaptureTypes = ReadonlyMap<string, CompiledFunctionType>;
export function scalarCaptureKey(captures: ScalarCaptureTypes): string {
    return JSON.stringify([...captures].sort(([a], [b]) => a.localeCompare(b)));
}
const noCaptures: ScalarCaptureTypes = new Map();

/** The compiled subset uses the same parameter-effect convention as the
 * language analysis. Unknown operations remain an observation boundary. */
export interface ScalarFunctionEffects extends Pick<FunctionEffects, 'unknown' | 'parameters' | 'readParameters' | 'returns'> {
    readonly localWrites: boolean;
    readonly returnsReference: boolean;
    readonly deferredResult: boolean;
}
type ProvenExpression = CompiledExpression<CompiledCalleeType, ScalarFunctionInput>;
const freshOrigin: ReturnOrigin = { kind: 'fresh' };
const unknownOrigin: ReturnOrigin = { kind: 'unknown' };
function originKey(origin: ReturnOrigin): string {
    return origin.kind === 'parameter' ? `parameter:${origin.index}`
        : origin.kind === 'capture' ? `capture:${origin.name}` : origin.kind;
}
function joinOrigins(origins: readonly ReturnOrigin[]): ReturnOrigin[] {
    return [...new Map(origins.map(origin => [originKey(origin), origin])).values()];
}
/** Origin transfer uses the expressions already accepted by the scalar proof.
 * A union over rebindings and branches is conservative, without another AST pass. */
function expressionOrigins(expression: ProvenExpression | undefined,
    bindings: ReadonlyMap<string, readonly ReturnOrigin[]>): readonly ReturnOrigin[] {
    if (!expression) return [unknownOrigin];
    if (typeof expression.type === 'string') return [freshOrigin];
    if (expression.kind === 'group') return expressionOrigins(expression.operand, bindings);
    if (expression.kind !== 'input') return [unknownOrigin];
    const input = expression.input;
    if (!input.operation && !input.indices) return bindings.get(input.name) ?? [];
    if (input.operation === 'reshape') return expressionOrigins(input.indices?.[0], bindings);
    if (input.operation === 'user-call' && input.callee) {
        return scalarFunctionEffects(input.callee.proof).returns.flatMap(origin =>
            origin.kind === 'parameter' ? [...expressionOrigins(input.indices?.[origin.index], bindings)] : [origin]);
    }
    return ['array', 'new', 'vector', 'copy', 'concat-copy', 'materialize-deque', 'materialize-iterable', 'range-array', 'sort', 'unique', 'argsort', 'gather']
        .includes(input.operation ?? '') ? [freshOrigin] : [unknownOrigin];
}
function storageOrigins(parameters: readonly string[], types: readonly CompiledCalleeType[],
    bindings: ReadonlyMap<string, readonly ProvenExpression[]>): ReadonlyMap<string, readonly ReturnOrigin[]> {
    const origins = new Map<string, readonly ReturnOrigin[]>();
    parameters.forEach((name, index) => {
        if (typeof types[index] !== 'string') origins.set(name, joinOrigins([...(origins.get(name) ?? []), { kind: 'parameter', index }]));
    });
    for (let changed = true; changed;) {
        changed = false;
        for (const [name, values] of bindings) {
            const previous = origins.get(name) ?? [];
            const next = joinOrigins([...previous, ...values.flatMap(value => [...expressionOrigins(value, origins)])]);
            if (next.length !== previous.length) { origins.set(name, next); changed = true; }
        }
    }
    for (const name of bindings.keys()) if (!origins.get(name)?.length) origins.set(name, [unknownOrigin]);
    return origins;
}
const effectProofs = new WeakMap<ScalarFunctionProof, ScalarFunctionEffects>();

export function scalarFunctionEffects(proof: ScalarFunctionProof): ScalarFunctionEffects {
    const known = effectProofs.get(proof);
    if (known) return known;
    const parameters = new Set<number>();
    let unknown = proof.observableCaptures || !proof.localArrayWrites;
    // Plan operands already have closed local/parameter domains. Only their
    // linked callbacks add effects; native iterator bindings stay guarded.
    for (const call of proof.planCalls) {
        const effects = scalarFunctionEffects(call.proof);
        unknown ||= effects.unknown || !!effects.parameters.size || effects.returnsReference;
    }
    function iterableSafe(iterable: ScalarLoopIterable): boolean {
        if (iterable.kind === 'group' || iterable.kind === 'capture') return false;
        if (iterable.kind === 'literal') return true;
        return !iterable.operation.effects?.length
            && (!('kind' in iterable.source) || iterableSafe(iterable.source));
    }
    unknown ||= [...proof.loopIterables.values()].some(iterable => !iterableSafe(iterable));
    let localWrites = !!proof.arrayWrites.size;
    function write(name: string): void {
        for (const origin of proof.storageOrigins.get(name) ?? [unknownOrigin]) {
            if (origin.kind === 'fresh') localWrites = true;
            else if (origin.kind === 'parameter') parameters.add(origin.index);
            else unknown = true;
        }
    }
    for (const name of proof.containerWrites) write(name);
    function expression(node: CompiledExpression<CompiledCalleeType, ScalarFunctionInput>): boolean {
        if (node.kind === 'literal') return true;
        if (node.kind === 'group' || node.kind === 'unary') return expression(node.operand);
        if (node.kind === 'binary' || node.kind === 'extreme') return expression(node.left)
            && (!node.right || expression(node.right));
        if (node.kind === 'call') return node.signature.callbacks === 'none' && !node.signature.hostFunction
            && node.arguments.every(expression);
        const input = node.input;
        if (input.reshapeDimensions?.some(value => value && !expression(value))) return false;
        if (input.indices && !input.indices.every(expression)
            || input.dimensions && !input.dimensions.every(dimension => expression(dimension.value))) return false;
        if (input.operation === 'user-call') {
            if (!input.callee) return false;
            const effects = scalarFunctionEffects(input.callee.proof);
            localWrites ||= effects.localWrites;
            for (const index of effects.parameters) {
                let argument = input.indices?.[index];
                while (argument?.kind === 'group') argument = argument.operand;
                if (argument?.kind !== 'input' || argument.input.operation || argument.input.indices) return false;
                write(argument.input.name);
            }
            return !effects.unknown;
        }
        if (input.operation === 'fold') {
            if (!input.callee) return false;
            const effects = scalarFunctionEffects(input.callee.proof);
            localWrites ||= effects.localWrites;
            return !effects.unknown && !effects.parameters.size;
        }
        if (input.operation === 'array-native') return input.native?.name === 'powmod';
        if (input.operation === 'materialize-iterable') return !!input.iterable && iterableSafe(input.iterable);
        if (input.operation === 'pop') write(input.name);
        // Self calls keep the same parameter domains, but may remap references.
        if (input.operation === 'self-call') return !proof.parameterTypes.some(type => typeof type !== 'string');
        return !input.operation || ['choose', 'integer-power', 'text-at', 'array-len', 'range-array', 'reshape', 'array-power', 'stack', 'gather', 'concat', 'concat-copy', 'copy', 'take', 'drop', 'sort', 'unique', 'argsort',
            'array', 'vector', 'new', 'pop', 'len', 'contains', 'not-contains',
            'set-contains', 'set-not-contains', 'index-default', 'plan'].includes(input.operation);
    }
    if (![...proof.expressions.values()].every(expression)) unknown = true;
    const effects = { unknown, parameters, localWrites, returnsReference: typeof proof.type !== 'string' || proof.planReturn, deferredResult: proof.planReturn,
        readParameters: new Set(proof.parameterTypes.flatMap((type, index) => typeof type !== 'string' ? [index] : [])),
        returns: joinOrigins(proof.returned.flatMap(value => [...expressionOrigins(value, proof.storageOrigins)])) };
    effectProofs.set(proof, effects);
    return effects;
}

/** A finite native completion needs the exact tier, including in linked helpers. */
export function hasNativeCompletion(proof: ScalarFunctionProof, seen = new Set<ScalarFunctionProof>()): boolean {
    if (seen.has(proof)) return false;
    seen.add(proof);
    return [...proof.expressions.values()].some(expression => expression.kind === 'input'
        && (expression.input.operation === 'materialize-iterable'
            || expression.input.callee && hasNativeCompletion(expression.input.callee.proof, seen)));
}

/** Live binding and native implementation guards are still checked at entry. */
export function privateScalarFunction(proof: ScalarFunctionProof, consumed = false): boolean {
    const effects = scalarFunctionEffects(proof);
    return !effects.unknown && !effects.parameters.size
        && (!effects.returnsReference || consumed && effects.deferredResult && typeof proof.type === 'string');
}

export interface ScalarFunctionInput {
    readonly name: string;
    readonly operation?: 'new' | 'pop' | 'len' | 'contains' | 'not-contains' | 'set-contains' | 'set-not-contains' | 'array' | 'vector' | 'materialize-deque' | 'materialize-iterable' | 'range-array' | 'reshape' | 'array-native' | 'array-power' | 'stack' | 'fold' | 'sequence-contains' | 'sequence-not-contains' | 'array-contains' | 'array-not-contains' | 'user-call' | 'self-call' | 'index-default' | 'captured-read' | 'captured-scalar' | 'captured-value' | 'captured-len' | 'take' | 'drop' | 'copy' | 'plan' | 'integer-power' | 'text-at' | 'gather' | 'compare-array' | 'array-len' | 'sort' | 'unique' | 'argsort' | 'choose' | 'concat' | 'concat-copy' | 'captured-bound-len';
    readonly plan?: FunctionPlanConsumer;
    /** Preserve native symbolic-fold work when polling or hooks are observable. */
    readonly privateFold?: boolean;
    readonly iterable?: ScalarLoopIterable;
    readonly native?: Operation;
    readonly axis?: number;
    readonly reshapeDimensions?: readonly (CompiledExpression<CompiledCalleeType, ScalarFunctionInput> | undefined)[];
    readonly negative?: boolean;
    readonly keyed?: boolean;
    readonly callee?: { readonly statement: FunctionStatement; readonly types: readonly CompiledCalleeType[]; readonly proof: ScalarFunctionProof; readonly captures: ScalarCaptureTypes; readonly parameter?: boolean };
    readonly dimensions?: readonly { readonly value: CompiledExpression<CompiledCalleeType, ScalarFunctionInput>; readonly negative: boolean }[];
    readonly signs?: readonly boolean[];
    readonly indices?: readonly CompiledExpression<CompiledCalleeType, ScalarFunctionInput>[];
}
/** A finite native stage is consumed only by its loop, never as an array value. */
export type ScalarLoopIterable = { readonly kind: 'capture'; readonly name: string; readonly element: 'integer' }
    | { readonly kind: 'literal'; readonly expression: Expression; readonly element: CompiledScalarType }
    | {readonly kind:'group'; readonly receiver:string; readonly key:CompiledExpression<CompiledCalleeType,ScalarFunctionInput>; readonly element:'integer'}
    | { readonly kind: 'native'; readonly element: CompiledScalarType; readonly operation: Operation; readonly source: ScalarLoopIterable | Expression;
        readonly origin: Expression; readonly argument?: FunctionPlan; readonly deferred?: boolean };
export interface ScalarFunctionProof {
    readonly parameters: readonly string[];
    readonly parameterTypes: readonly CompiledCalleeType[];
    readonly ownedStorage: ReadonlySet<string>;
    readonly storageOrigins: ReadonlyMap<string, readonly ReturnOrigin[]>;
    readonly returned: readonly ProvenExpression[];
    readonly containerWrites: ReadonlySet<string>;
    readonly type: CompiledCalleeType;
    readonly dependencies: readonly string[];
    readonly callDepth: number;
    readonly callCount: number;
    readonly locals: readonly string[];
    readonly nativeReads: readonly string[];
    readonly modules: readonly string[];
    readonly containers: boolean;
    readonly recursive: boolean;
    readonly arrayWrites: ReadonlySet<Statement>;
    readonly localArrayWrites: boolean;
    /** A captured collection's size may run a host header/sequence reader. */
    readonly observableCaptures: boolean;
    readonly expressions: ReadonlyMap<Expression, CompiledExpression<CompiledCalleeType, ScalarFunctionInput>>;
    readonly planCalls: readonly { readonly name: string; readonly statement: FunctionStatement; readonly types: readonly CompiledCalleeType[]; readonly proof: ScalarFunctionProof; readonly captures: ScalarCaptureTypes }[];
    readonly planBindings: ReadonlyMap<Statement, FunctionPlan>;
    readonly planReturn: boolean;
    readonly planReturns: ReadonlySet<Statement>;
    readonly loopIterables: ReadonlyMap<Statement, ScalarLoopIterable>;
    readonly iterableBindings: ReadonlySet<Statement>;
    readonly nonnegative: readonly number[];
}
const simpleProofs = new WeakMap<FunctionStatement, Map<string, ScalarFunctionProof | CompilerRejection>>();
const loopProofs = new WeakMap<FunctionStatement, Map<string, ScalarFunctionProof | CompilerRejection>>();
const blockProofs = new WeakMap<FunctionStatement, Map<string, ScalarFunctionProof | CompilerRejection>>();

// The caller must additionally check that local assignment names neither exist
// in the closure context nor can be created by the surrounding register region.
export function scalarFunctionResult(statement: FunctionStatement, blocks = false,
    parameterTypes?: readonly CompiledCalleeType[], loops = false, path: readonly FunctionStatement[] = [], captures: ScalarCaptureTypes = noCaptures): ScalarFunctionProof | undefined {
    if (!currentDiagnostics()?.traceCompiler) return scalarFunctionResultObservedImplementation(statement, blocks, parameterTypes, loops, path, captures);
    const provenTypes = Object.fromEntries(statement.parameters.map((name, index) => {
        const type = parameterTypes?.[index] ?? 'integer';
        return [name, typeof type !== 'string' && type.kind === 'function' ? 'function' : typeof type === 'string' ? type : JSON.stringify(type)];
    }));
    return observeCompiler(statement, 'scalar-function-proof', 'prepare', () => {
        const proof = scalarFunctionResultObservedImplementation(statement, blocks, parameterTypes, loops, path, captures);
        if (proof) currentDiagnostics()?.compilerType('return', typeof proof.type === 'string' ? proof.type : JSON.stringify(proof.type));
        return proof;
    }, provenTypes);
}

function scalarFunctionResultObservedImplementation(statement: FunctionStatement, blocks = false,
    parameterTypes?: readonly CompiledCalleeType[], loops = false, path: readonly FunctionStatement[] = [], captures: ScalarCaptureTypes = noCaptures): ScalarFunctionProof | undefined {
    if (path.includes(statement)) return recordFallback('scalar-function:unsupported-recursive-call-graph');
    if (path.length >= 16) {
        currentDiagnostics()?.compilerBudget('scalar call graph depth', 16, path.length, 'decline private scalar proof; caller retains checked calls');
        return recordFallback('scalar-function:call-graph-depth-limit');
    }
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
    if (proofs.size >= 32) {
        currentDiagnostics()?.compilerBudget('scalar proof specializations', 32, proofs.size + 1, 'decline private scalar proof; caller retains checked calls');
        return recordFallback('scalar-function:specialization-budget:32', 'cost');
    }
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
    const bindings = new Map<string, ProvenExpression[]>();
    const returned: ProvenExpression[] = [];
    const nativeReads = new Set<string>();
    const dependencies = new Set<string>();
    const lexical = functionScope(statement);
    const scope = lexical?.scope;
    let callDepth = 1, callCount = 0, recursive = false, observableCaptures = false;
    const modules = new Set<string>();
    const arrayWrites = new Set<Statement>();
    const containerWrites = new Set<string>();
    let containers = types.some(isCompiledContainer);
    const parameters = new Set(statement.parameters);
    const locals = new Set<string>();
    const settled = new Map<string, CompiledCalleeType>(statement.parameters.map((name, index) => [name, types[index]]));
    // Medium numeric kernels exceed 256 proof visits; traversal and call
    // graph budgets remain bounded independently of runtime work.
    const budget = { remaining: blocks ? 512 : 129 };
    let resultType: CompiledCalleeType | undefined;
    const stages = new Map<string, FunctionPlan>();
    const planCalls: { name: string; statement: FunctionStatement; types: readonly CompiledCalleeType[]; proof: ScalarFunctionProof; captures: ScalarCaptureTypes }[] = [];
    const planBindings = new Map<Statement, FunctionPlan>();
    const protectedNames = new Set<string>();
    const nonnegativeParameters = new Set<number>();
    const modified = new Set<string>();
    const definitions = new Map<string, Expression | undefined>();
    for (const node of AstUtils.streamAst(statement)) {
        if (isAssignmentStatement(node)) {
            modified.add(node.name);
            definitions.set(node.name, definitions.has(node.name) || node.operator !== '=' || node.deferred ? undefined : node.value);
        }
        if (isUnpackStatement(node)) for (const name of node.names) modified.add(name);
        if (isForStatement(node)) for (const name of forIteration(node.condition)?.names ?? []) modified.add(name);
    }
    let planReturn = false;
    const planReturns = new Set<Statement>();
    const loopIterables = new Map<Statement, ScalarLoopIterable>();
    const iterableBindings = new Set<Statement>();
    const iterableStages = new Map<string, ScalarLoopIterable>();
    const iterableNames = new Set<string>();
    let consumerRoot: Expression | undefined;
    const unwrap = (source: Expression): Expression => isParenthesizedExpression(source) ? unwrap(source.value) : source;
    const readsStage = (source: Expression) => AstUtils.streamAst(source).some(node => isNameExpression(node) && stages.has(node.name));
    function nonnegative(source: Expression): boolean {
        source = unwrap(source);
        if (isNumberLiteral(source)) return typeof source.value === 'bigint' && source.value >= 0n;
        if (isArrayExpression(source) && source.items.length && !source.dimensions.length
            && !source.fill && !source.rows.length && !source.range) return source.items.every(item =>
                isNumberLiteral(item.value) && typeof item.value.value === 'bigint' && item.value.value >= 0n
                && (item.sign !== '-' || item.value.value === 0n));
        if (!isNameExpression(source)) return false;
        if (modified.has(source.name)) {
            // A single local definition whose proved operation returns a size
            // stays nonnegative even when that definition runs in a loop.
            if (parameters.has(source.name)) return false;
            const value = definitions.get(source.name);
            let compiled = value && expressions.get(value);
            while (compiled?.kind === 'group') compiled = compiled.operand;
            if (compiled?.kind === 'call') return ['count', 'len'].includes(compiled.operation.name);
            if (compiled?.kind !== 'input') return false;
            if (compiled.input.operation === 'vector') return !!compiled.input.indices?.every((item, index) =>
                item.kind === 'literal' && typeof item.value === 'bigint' && item.value >= 0n
                && (!compiled.input.signs?.[index] || item.value === 0n));
            if (['array-len', 'len', 'captured-len', 'captured-bound-len'].includes(compiled.input.operation ?? '')) return true;
            const stage = compiled.input.plan?.stage;
            return stage?.kind === 'input' && (!!stage.input.length || stage.input.reduction?.name === 'count');
        }
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
                if (domain && isCompiledArray(domain) && (domain.rank === 1 || domain.rank === 2)) return { element: domain.element, rank: domain.rank };
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
                    || !wholeDeclaredCall(callee, [element])) return undefined;
                const signature = functionCallSignature(callee);
                if (signature.words.length || signature.parameters.some(parameter => parameter.kind === 'function' || parameter.deferred)) return undefined;
                const proof = scalarFunctionResult(callee, true, [element], true, [...path, statement], captures);
                if (!proof || typeof proof.type !== 'string' || proof.planReturn
                    || (proof.containers || proof.arrayWrites.size) && !privateScalarFunction(proof)
                    || proof.nonnegative.length || proof.callDepth >= 16 || callCount + proof.callCount + 1 > 64) return undefined;
                callDepth = Math.max(callDepth, proof.callDepth + 1);
                callCount += proof.callCount + 1;
                observableCaptures ||= proof.observableCaptures;
                dependencies.add(name);
                for (const dependency of [...proof.dependencies, ...proof.nativeReads, ...proof.locals]) dependencies.add(dependency);
                const key = planCalls.push({ name, statement: callee, types: [element], proof, captures }) - 1;
                return { key, element: proof.type };
            },
        });
    }
    function userCall(parts: readonly Expression[], env: ReadonlyMap<string, CompiledCalleeType>, source?: Expression) {
        const last = parts.at(-1);
        if (!loops || !last || !isNameExpression(last)) return undefined;
        const parameter = env.get(last.name);
        const callable = parameter && typeof parameter !== 'string' && parameter.kind === 'function' ? parameter : undefined;
        if (parameter && !callable) return undefined;
        const callee = callable?.statement ?? (lexical?.reads.get(last) ?? lexicalBinding(scope, last.name))?.function;
        if (!callee || callee.memo || callee.parameters.length !== parts.length - 1) return undefined;
        const signature = functionCallSignature(callee);
        if (signature.words.length) return undefined;
        const arguments_ = parts.slice(0, -1);
        if (signature.parameters.some(parameter => parameter.deferred && readsStage(arguments_[parameter.index]))) return undefined;
        const inputs = arguments_.map((argument, index) => {
            const value = unwrap(argument);
            const domain = isNameExpression(value) ? env.get(value.name) : undefined;
            if (isNameExpression(value) && signature.parameters[index]?.kind === 'function' && domain && typeof domain !== 'string' && domain.kind === 'function') {
                expressions.set(argument, { kind: 'input', source: argument, type: domain, input: { name: value.name } });
                return domain;
            }
            return type(argument, env);
        });
        if (!inputs.every((input): input is CompiledCalleeType => input !== undefined)
            || !wholeDeclaredCall(callee, inputs)
            || signature.parameters.some((parameter, index) => parameter.kind === 'function'
                && !(typeof inputs[index] !== 'string' && inputs[index].kind === 'function'))) return undefined;
        // A base return establishes the self-call's scalar result. Its inputs
        // must preserve every domain, and the completed proof excludes array
        // writes; integer index mutations retain their shared-reference meaning.
        if (callee === statement && typeof resultType === 'string'
            && inputs.every((input, index) => {
                if (!sameCompiledCalleeType(input, types[index])) return false;
                if (typeof input === 'string' || input.kind !== 'function') return true;
                const argument = unwrap(arguments_[index]);
                return isNameExpression(argument) && argument.name === statement.parameters[index];
            })) {
            recursive = true;
            callCount++;
            dependencies.add(last.name);
            return { type: resultType, input: { name: last.name, operation: 'self-call' as const,
                indices: arguments_.map(argument => expressions.get(argument)!) } };
        }
        // Read-only arguments and integer containers keep their proven domains
        // across linked calls. Writes to arguments still need a binding frame.
        const callCaptures = callable?.captures ?? captures;
        const proof = scalarFunctionResult(callee, true, inputs, true, [...path, statement], callCaptures);
        if (!proof || !proof.localArrayWrites
            || proof.callDepth >= 16 || callCount + proof.callCount + 1 > 64) return undefined;
        if (proof.planReturn && (!consumerRoot || unwrap(consumerRoot) !== source)) return undefined;
        if (proof.nonnegative.some(index => !nonnegative(arguments_[index]))) return undefined;
        callDepth = Math.max(callDepth, proof.callDepth + 1);
        callCount += proof.callCount + 1;
        observableCaptures ||= proof.observableCaptures;
        if (!callable) {
            dependencies.add(last.name);
            for (const name of [...proof.dependencies, ...proof.nativeReads, ...proof.locals]) dependencies.add(name);
        }
        return { type: proof.type, input: { name: last.name, operation: 'user-call' as const,
            callee: { statement: callee, types: inputs, proof, captures: callCaptures, parameter: !!callable }, indices: arguments_.map(argument => expressions.get(argument)!) } };
    }
    function type(expression: Expression, env: ReadonlyMap<string, CompiledCalleeType>): CompiledCalleeType | undefined {
        const sumReduction = terminalReductionForm(flattenApplication(unwrap(expression)), name => !env.has(name) && !lexicalBinding(scope, name));
        const stageSum = sumReduction?.operation === 'sum';
        if (loops && !stageSum && !isNameExpression(expression) && AstUtils.streamAst(expression).some(node => isNameExpression(node)
            && (stages.has(node.name) || env.has(node.name) && isCompiledArray(env.get(node.name)!)))) {
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
                const choice = scalarChooseOperands(source, name => !env.has(name) && !lexicalBinding(scope, name));
                if (choice) {
                    const types = choice.map(operand => type(operand, env));
                    if (types[0] !== 'boolean' || typeof types[1] !== 'string' || types[1] !== types[2]
                        || !choice.every(operand => callbackFreeChoice(expressions.get(operand)!))) return undefined;
                    nativeReads.add('choose');
                    return { type: types[1], input: { name: '', operation: 'choose',
                        indices: choice.map(operand => expressions.get(operand)!) } };
                }
                if (isDeclaredCallExpression(source)) {
                    const parts = positionalDeclaredCall(source);
                    const callee = isNameExpression(source.callee)
                        ? (lexical?.reads.get(source.callee) ?? lexicalBinding(scope, source.callee.name))?.function : undefined;
                    return parts && callee && !functionCallSignature(callee).parameters.some(parameter => parameter.deferred)
                        ? userCall(parts, env, source) : undefined;
                }
                if (loops && isBinaryExpression(source)) {
                    const fold = symbolicApplicationForm(source, name => !env.has(name) && !lexicalBinding(scope, name));
                    if (fold?.kind === 'reduce' && ['+', '*'].includes(fold.operator) && !fold.rank && !fold.axes
                        && !fold.keys && !fold.size) {
                        const seed = fold.seed && unwrap(fold.seed);
                        const identity = fold.operator === '*' ? 1n : 0n;
                        // Only an exact integer identity may disappear. A real
                        // or nonidentity seed retains its ordinary type/work.
                        if (!seed || isNumberLiteral(seed) && seed.value === identity) {
                            const stage = plan(fold.source, env, false);
                            if (stage?.type.rank === 1 && stage.type.element === 'integer') return {
                                type: 'integer', input: { name: '', operation: 'plan', privateFold: !!seed || fold.operator === '+', plan: {
                                    stage, terminal: fold.operator === '*' ? 'product' : 'sum',
                                } },
                            };
                        }
                    }
                }
                if (loops && isBinaryExpression(source) && ['to', 'till'].includes(source.operator)) {
                    let owner = source.$container;
                    while (owner && isParenthesizedExpression(owner)) owner = owner.$container;
                    // A native copy completes its operand even when nested in
                    // arithmetic or another consumer. Its lowering still owns
                    // the copy and its guards; unused recipes stay deferred.
                    let copied = false;
                    let selection = false;
                    if (owner && isApplicationExpression(owner)) {
                        const parts = flattenApplication(owner), last = parts.at(-1);
                        const receiver = isNameExpression(parts[0]) ? env.get(parts[0].name) : undefined;
                        selection = parts.length === 2 && unwrap(parts[1]) === source
                            && !!receiver && isCompiledArray(receiver) && receiver.rank === 1;
                        copied = parts.length === 2 && unwrap(parts[0]) === source && isNameExpression(last)
                            && last.name === 'copy' && !env.has('copy') && !lexicalBinding(scope, 'copy');
                    }
                    // A bare range needs the existing ordinary binding boundary.
                    // Broader metadata consumers must not complete it implicitly.
                    if ((copied || selection || owner && isAssignmentStatement(owner) && !owner.deferred && owner.operator === '=')
                        && type(source.left, env) === 'integer' && type(source.right, env) === 'integer'
                        && (!source.step || type(source.step, env) === 'integer')) {
                        return { type: { kind: 'array', element: 'integer', rank: 1 }, input: {
                            name: source.operator, operation: 'range-array', indices: [expressions.get(source.left)!, expressions.get(source.right)!,
                                ...source.step ? [expressions.get(source.step)!] : []] } };
                    }
                }
                if (loops && isBinaryExpression(source) && source.operator === '**') {
                    const signed = isUnaryExpression(source.left) && ['+', '-'].includes(source.left.operator) ? source.left : undefined;
                    const base = signed?.operand ?? source.left;
                    const left = type(base, env), right = type(source.right, env);
                    if (left === 'integer' && right === 'integer' && nonnegative(source.right)) {
                        return { type: 'integer', input: { name: '', operation: 'integer-power', negative: signed?.operator === '-',
                            indices: [expressions.get(base)!, expressions.get(source.right)!] } };
                    }
                    const integer = (domain: CompiledCalleeType | undefined) => domain === 'integer'
                        || domain && typeof domain !== 'string' && isCompiledArray(domain) && domain.element === 'integer';
                    const exponent = unwrap(source.right);
                    if (integer(left) && integer(right) && (typeof left !== 'string' || typeof right !== 'string')
                        && !(typeof right !== 'string' && isNameExpression(exponent) && parameters.has(exponent.name))
                        && nonnegative(source.right)) {
                        return { type: { kind: 'array', element: 'integer', rank: Math.max(...[left, right].map(domain =>
                            domain && isCompiledArray(domain) ? domain.rank : 0)) },
                            input: { name: '', operation: 'array-power', negative: signed?.operator === '-',
                                indices: [expressions.get(base)!, expressions.get(source.right)!] } };
                    }
                }
                if (loops && isNameExpression(source) && stages.has(source.name)) {
                    const stage = stages.get(source.name)!;
                    return { type: functionPlanType(stage), input: { name: '', operation: 'plan', plan: { stage, terminal: 'copy' } } };
                }
                if (loops && isApplicationExpression(source)) {
                    const form = applicationForm(source, name => env.has(name) || lexicalBinding(scope, name) ? false : findOperation(name));
                    if (form.kind === 'array-combine-constructor' && form.operation === 'stack' && !form.rest.length) {
                        const domains = form.items.map(item => type(item, env)), first = domains[0];
                        const axis = form.axis ? isNumberLiteral(form.axis) && typeof form.axis.value === 'bigint'
                            ? Number(form.axis.value) : -1 : 0;
                        if (first && typeof first !== 'string' && isCompiledArray(first)
                            && domains.every(domain => domain && sameCompiledCalleeType(domain, first))
                            && axis >= 0 && axis <= first.rank) {
                            modules.add('sequences');
                            return { type: { ...first, rank: first.rank + 1 }, input: { name: '', operation: 'stack', axis,
                                indices: form.items.map(item => expressions.get(item)!) } };
                        }
                    }
                    if (form.kind === 'named-reduce' && form.seed && !form.keys && !form.size && isNameExpression(form.operation)
                        && !env.has(form.operation.name)) {
                        const domain = type(form.source, env), seed = type(form.seed, env);
                        const row = domain && typeof domain !== 'string' && isCompiledArray(domain) && domain.rank === 2
                            && form.rank && isNumberLiteral(form.rank) && form.rank.value === 1n
                            && form.axes?.length === 1 && isNumberLiteral(form.axes[0]) && form.axes[0].value === 0n;
                        const vector = domain && typeof domain !== 'string' && isCompiledArray(domain) && domain.rank === 1
                            && !form.rank && !form.axes;
                        const binding = lexicalBinding(scope, form.operation.name), callee = binding?.function;
                        if ((row || vector) && seed && (typeof seed === 'string' || isCompiledArray(seed)) && callee && callee !== statement
                            && binding?.scope.owner !== statement && !callee.memo && strictDataCall(callee)
                            && callee.parameters.length === 2 && callee.ranks.every(rank => rank === 'all')) {
                            const cell: CompiledCalleeType = row ? { kind: 'array', element: domain.element, rank: 1 } : domain.element;
                            const inputs = [seed, cell];
                            const proof = scalarFunctionResult(callee, true, inputs, true, [...path, statement], captures);
                            const effects = proof && scalarFunctionEffects(proof);
                            if (proof && (!proof.planReturn || typeof proof.type !== 'string') && !proof.recursive && !proof.nonnegative.length
                                && effects && !effects.unknown && !effects.parameters.size
                                && sameCompiledCalleeType(seed, proof.type)
                                && proof.callDepth < 16 && callCount + proof.callCount + 1 <= 64) {
                                callDepth = Math.max(callDepth, proof.callDepth + 1); callCount += proof.callCount + 1;
                                dependencies.add(form.operation.name);
                                for (const name of [...proof.dependencies, ...proof.nativeReads, ...proof.locals]) dependencies.add(name);
                                return { type: seed, input: { name: form.operation.name, operation: 'fold',
                                    callee: { statement: callee, types: inputs, proof, captures },
                                    indices: [expressions.get(form.source)!, expressions.get(form.seed)!] } };
                            }
                        }
                    }
                    if (form.kind === 'reshape' && !form.rest.length) {
                        const array = type(form.source, env);
                        if (array && typeof array !== 'string' && isCompiledArray(array)
                            && form.dimensions.every(dimension => isAllAxisExpression(dimension) || type(dimension, env) === 'integer')) {
                            nativeReads.add('reshape');
                            modules.add('sequences');
                            return { type: { ...array, rank: form.dimensions.length }, input: { name: '', operation: 'reshape',
                                indices: [expressions.get(form.source)!], reshapeDimensions: form.dimensions.map(dimension =>
                                    isAllAxisExpression(dimension) ? undefined : expressions.get(dimension)!) } };
                        }
                    }
                    const parts = flattenApplication(source), last = parts.at(-1);
                    if (parts.length === 4 && isNameExpression(last) && last.name === 'powmod'
                        && !env.has('powmod') && !lexicalBinding(scope, 'powmod')) {
                        const inputs = parts.slice(0, -1).map(operand => type(operand, env));
                        if (inputs.every(input => input === 'integer' || input && typeof input !== 'string'
                            && isCompiledArray(input) && input.element === 'integer')
                            && inputs.some(input => typeof input !== 'string')) {
                            nativeReads.add('powmod'); modules.add('numbers');
                            return { type: { kind: 'array', element: 'integer', rank: Math.max(...inputs.map(input =>
                                typeof input === 'string' ? 0 : (input as {rank:number}).rank)) }, input: { name: '', operation: 'array-native',
                                native: findOperation('powmod')!, indices: parts.slice(0, -1).map(operand => expressions.get(operand)!) } };
                        }
                    }
                    const reduction = terminalReductionForm(flattenApplication(source), name => !env.has(name) && !lexicalBinding(scope, name));
                    if (reduction?.operation === 'sum') {
                        const stage = plan(reduction.source, env, false);
                        if (stage?.type.rank === 1 && ['integer', 'real'].includes(stage.type.element)) {
                            nativeReads.add('sum');
                            return { type: stage.type.element, input: { name: '', operation: 'plan', plan: { stage, terminal: 'sum' } } };
                        }
                    }
                }
                if (loops && isApplicationExpression(source)) {
                    const form = applicationForm(source);
                    if (form.kind === 'array-combine-constructor' && form.operation === 'concat'
                        && !form.axis && (!form.rest.length || form.rest.length === 1 && isNameExpression(form.rest[0])
                            && form.rest[0].name === 'copy' && !env.has('copy') && !lexicalBinding(scope, 'copy'))
                        && !env.has('concat') && !lexicalBinding(scope, 'concat')) {
                        const domains = form.items.map(item => type(item, env));
                        const first = domains[0];
                        if (first && typeof first !== 'string' && isCompiledArray(first) && first.rank === 1
                            && domains.every(domain => domain && sameCompiledCalleeType(first, domain))) {
                            modules.add('sequences');
                            if (form.rest.length) nativeReads.add('copy');
                            return { type: first, input: { name: '', operation: form.rest.length ? 'concat-copy' : 'concat',
                                indices: form.items.map(item => expressions.get(item)!) } };
                        }
                    }
                    const parts = flattenApplication(source);
                    if (parts.length === 2 && isNameExpression(parts[1]) && parts[1].name === 'len'
                        && !env.has('len') && !lexicalBinding(scope, 'len')) {
                        const bound = unwrap(parts[0]);
                        if (isBinaryExpression(bound) && ['to', 'till'].includes(bound.operator) && !bound.step
                            && isNameExpression(bound.left) && !bound.left.name.includes('.') && !env.has(bound.left.name)) {
                            const binding = lexical?.reads.get(bound.left) ?? lexicalBinding(scope, bound.left.name);
                            if (binding && binding.scope.owner !== statement && !binding.function
                                && type(bound.right, env) === 'integer') {
                                nativeReads.add('len');
                                dependencies.add(bound.left.name);
                                observableCaptures = true;
                                return { type: 'integer', input: { name: bound.left.name, operation: 'captured-bound-len',
                                    negative: bound.operator === 'till', indices: [expressions.get(bound.right)!] } };
                            }
                        }
                    }
                }
                if (loops && isMaterializeExpression(source)) {
                    const iterable = loopIterable(source.source, env);
                    if (iterable && nativeFactorStage(iterable)) {
                        return { type: { kind: 'array', element: iterable.element, rank: 1 },
                            input: { name: '', operation: 'materialize-iterable', iterable } };
                    }
                    const domain = type(source.source, env);
                    if (!domain || !isCompiledContainer(domain) || domain.kind !== 'deque') return undefined;
                    return { type: { kind: 'array', element: 'integer', rank: 1 },
                        input: { name: '', operation: 'materialize-deque', indices: [expressions.get(source.source)!] } };
                }
                if (loops && isCountClauseExpression(source)) {
                    const array = type(source.source, env);
                    // The shared take/drop runtime also slices Unicode text.
                    if (!array || typeof array === 'string' && array !== 'text' || isCompiledContainer(array)
                        || type(source.count, env) !== 'integer') return undefined;
                    return { type: array, input: { name: '', operation: source.operator,
                        indices: [expressions.get(source.source)!, expressions.get(source.count)!] } };
                }
                if (loops && isArrayExpression(source) && source.items.length
                    && !source.dimensions.length && !source.fill && !source.rows.length && !source.range) {
                    const types = source.items.map(item => type(item.value, env));
                    const element = types[0];
                    if (typeof element !== 'string' || types.some(type => type !== element)
                        || source.items.some(item => item.sign && element !== 'integer' && element !== 'real')) return undefined;
                    return { type: { kind: 'array', element, rank: 1 }, input: {
                        name: '', operation: 'vector', indices: source.items.map(item => expressions.get(item.value)!),
                        signs: source.items.map(item => item.sign === '-'),
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
                    const last = source.arguments.length === 1 ? source.arguments[0] : undefined;
                    if (last && isNameExpression(last) && ['sort','unique','argsort'].includes(last.name)
                        && !env.has(last.name) && !lexicalBinding(scope,last.name)) {
                        const array = type(source.head,env);
                        if (array && typeof array !== 'string' && isCompiledArray(array) && array.rank === 1) {
                            nativeReads.add(last.name);
                            modules.add('sequences');
                            return {type:last.name === 'argsort' ? {...array,element:'integer'} : array,
                                input:{name:'',operation:last.name as 'sort'|'unique'|'argsort',indices:[expressions.get(source.head)!]}};
                        }
                    }
                    const parts = flattenApplication(source);
                    const [receiver, operation] = parts;
                    if (parts.length === 2 && isNameExpression(operation) && operation.name === 'copy'
                        && !env.has('copy') && !lexicalBinding(scope, 'copy')) {
                        const array = type(receiver, env);
                        if (array && typeof array !== 'string' && isCompiledArray(array)) {
                            nativeReads.add('copy');
                            return { type: array, input: { name: '', operation: 'copy', indices: [expressions.get(receiver)!] } };
                        }
                    }
                    const domain = isNameExpression(receiver) ? env.get(receiver.name) : undefined;
                    if (parts.length === 2 && isNameExpression(receiver) && domain && typeof domain !== 'string'
                        && isCompiledArray(domain) && isNameExpression(operation) && operation.name === 'len'
                        && !env.has('len') && !lexicalBinding(scope, 'len')) {
                        nativeReads.add('len');
                        return { type: 'integer', input: { name: receiver.name, operation: 'array-len' } };
                    }
                    if (parts.length === 2 && isNameExpression(receiver) && !domain
                        && isNameExpression(operation) && operation.name === 'len'
                        && !env.has('len') && !lexicalBinding(scope, 'len') && !receiver.name.includes('.')) {
                        const binding = lexical?.reads.get(receiver) ?? lexicalBinding(scope, receiver.name);
                        if (binding && binding.scope.owner !== statement && !binding.function) {
                            nativeReads.add('len');
                            dependencies.add(receiver.name);
                            observableCaptures = true;
                            return { type: 'integer', input: { name: receiver.name, operation: 'captured-len' } };
                        }
                    }
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
                    if (known && !(typeof known !== 'string' && known.kind === 'function')) return { type: known, input: { name: source.name } };
                    const captured = captures.get(source.name), binding = lexical?.reads.get(source) ?? lexicalBinding(scope, source.name);
                    if (loops && captured && binding && binding.scope.owner !== statement && !binding.function
                        && !source.name.includes('.')) {
                        dependencies.add(source.name);
                        return { type: captured, input: { name: source.name, operation: typeof captured === 'string' ? 'captured-scalar' : 'captured-value' } };
                    }
                    return userCall([source], env, source);
                }
                const lookup = (name: string) => env.has(name) || lexicalBinding(scope, name) ? false : findOperation(name);
                const form = applicationForm(source, lookup);
                if (form.kind === 'comparison-rank' && form.rank === 1 && form.axes === undefined) {
                    const left = type(form.left, env), right = type(form.right, env);
                    if (left && right && typeof left !== 'string' && typeof right !== 'string'
                        && isCompiledArray(left) && isCompiledArray(right) && left.rank === 1 && right.rank === 1
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
                if (!array || typeof array === 'string' || array.kind === 'function' || (isCompiledContainer(array) ? indices.length !== 1 : indices.length !== array.rank)) return undefined;
                if (isCompiledArray(array) && array.rank === 1 && indices.length === 1) {
                    const selector = type(indices[0], env);
                    if (selector && typeof selector !== 'string' && isCompiledArray(selector)
                        && selector.rank === 1 && ['integer', 'boolean'].includes(selector.element)) return { type: array,
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
            operator: (operation, inputs) => {
                if (inputs.every((value): value is CompiledScalarType => typeof value === 'string'))
                    return matchCompiledOperatorSignature(operation.scalarFunction, inputs);
                if (!['+', '-', '*', '/', '//', 'mod', 'less', 'greater', 'atmost', 'atleast', 'equal', 'notequal'].includes(operation.name)
                    || inputs.some(isCompiledContainer)) return undefined;
                const signature = matchCompiledOperatorSignature(operation.scalarFunction,
                    inputs.map(input => typeof input === 'string' ? input : isCompiledArray(input) ? input.element : 'integer'));
                return signature ? { ...signature, inputs, result: { kind: 'array', element: signature.result,
                    rank: Math.max(...inputs.map(input => isCompiledArray(input) ? input.rank : 0)) } } : undefined;
            },
            call: (operation, inputs) => {
                // Only explicit completion and the lowered sum own a plan's
                // traversal. Metadata calls such as len must not force its cells.
                if (stages.size && readsStage(expression)) return undefined;
                if (inputs.some(isCompiledContainer)) return undefined;
                const signature = matchCompiledCallSignature(operation, inputs.map(value => typeof value === 'string' ? value
                    : isCompiledArray(value) && (value.element === 'text' || value.element === 'integer') && value.rank === 1 ? `${value.element}-array` : 'array'));
                if (signature) nativeReads.add(operation.name);
                return signature;
            },
            budget,
        });
        if (inferred.failure) return reject(inferred.failure.source, inferred.failure.detail);
        expressions.set(expression, inferred.expression);
        return inferred.expression.type;
    }
    function callbackFreeChoice(expression: CompiledExpression<CompiledCalleeType, ScalarFunctionInput>): boolean {
        if (expression.kind === 'literal') return true;
        if (expression.kind === 'group' || expression.kind === 'unary') return callbackFreeChoice(expression.operand);
        if (expression.kind === 'binary' || expression.kind === 'extreme') return callbackFreeChoice(expression.left)
            && (!expression.right || callbackFreeChoice(expression.right));
        if (expression.kind === 'call') return expression.signature.callbacks === 'none' && !expression.signature.hostFunction
            && expression.arguments.every(callbackFreeChoice);
        const input = expression.input;
        return (!input.operation || ['choose', 'captured-scalar', 'captured-read', 'integer-power', 'text-at', 'array-len'].includes(input.operation))
            && (!input.indices || input.indices.every(callbackFreeChoice));
    }
    function loopIterable(source: Expression, env: ReadonlyMap<string, CompiledCalleeType>): ScalarLoopIterable | undefined {
        if (--budget.remaining < 0) return undefined;
        source = unwrap(source);
        if (isNameExpression(source) && iterableStages.has(source.name)) return iterableStages.get(source.name);
        if (isNameExpression(source) && !env.has(source.name) && typeof captures.get(source.name) !== 'string' && !source.name.includes('.')) {
            const binding = lexical?.reads.get(source) ?? lexicalBinding(scope, source.name);
            if (binding && binding.scope.owner !== statement && !binding.function) {
                dependencies.add(source.name);
                observableCaptures = true;
                return { kind: 'capture', name: source.name, element: 'integer' };
            }
        }
        if (isApplicationExpression(source)) {
            const parts = flattenApplication(source), [receiver,key] = parts;
            const domain = isNameExpression(receiver) ? env.get(receiver.name) : undefined;
            if (parts.length === 2 && isNameExpression(receiver) && domain && isCompiledContainer(domain) && domain.kind === 'groups'
                && type(key,env) === 'integer') {
                return {kind:'group',receiver:receiver.name,key:expressions.get(key)!,element:'integer'};
            }
        }
        if (isArrayExpression(source) || isNameExpression(source) && env.has(source.name)) {
            const domain = type(source, env);
            if (domain && typeof domain !== 'string' && isCompiledArray(domain) && domain.rank === 1) {
                return { kind: 'literal', expression: source, element: domain.element };
            }
            return undefined;
        }
        if (!isApplicationExpression(source) || source.arguments.length !== 1) return undefined;
        const argument = unaryApplicationHead(source, name => findOperation(name)?.arities,
            name => !env.has(name) && !lexicalBinding(scope, name)) ?? source.head;
        const operation = isNameExpression(source.arguments[0]) ? findOperation(source.arguments[0].name) : undefined;
        if (!argument || !operation || env.has(operation.name) || lexicalBinding(scope, operation.name)) return undefined;
        let input: ScalarLoopIterable | Expression | undefined;
        if (operation.name === 'factors' || operation.name === 'divisors') {
            if (type(argument, env) === 'integer') input = argument;
        } else if (operation.name === 'unique') {
            input = loopIterable(argument, env);
            // Group consumers use a private JS iterator, not a Rank value.
            // A native pipeline must retain the ordinary captured sequence.
            if (input?.kind === 'group') return undefined;
        }
        if (!input) return undefined;
        nativeReads.add(operation.name);
        modules.add(operation.module);
        return { kind: 'native', operation, source: input, element: 'kind' in input ? input.element : 'integer', origin: source };
    }
    function nativeFactorStage(stage: ScalarLoopIterable): boolean {
        return stage.kind === 'native' && (['factors', 'divisors'].includes(stage.operation.name)
            || 'kind' in stage.source && nativeFactorStage(stage.source));
    }
    function deferredIterable(stage: ScalarLoopIterable, env: ReadonlyMap<string, CompiledCalleeType>): ScalarLoopIterable | undefined {
        if (stage.kind !== 'native') return undefined;
        if ('kind' in stage.source) {
            const source = deferredIterable(stage.source, env);
            return source ? {...stage, source, deferred: true} : undefined;
        }
        const argument = plan(stage.source, env);
        return argument ? {...stage, argument, deferred: true} : undefined;
    }
    // null: every path returned; undefined: unproved; map: continuing paths.
    function flow(commands: readonly Statement[], env: Map<string, CompiledCalleeType>, inLoop = false): Map<string, CompiledCalleeType> | null | undefined {
        const inherited = new Map(iterableStages);
        try { return flowCommands(commands, env, inLoop); }
        finally {
            iterableStages.clear();
            for (const [name, stage] of inherited) iterableStages.set(name, stage);
        }
    }
    function flowCommands(commands: readonly Statement[], env: Map<string, CompiledCalleeType>, inLoop: boolean): Map<string, CompiledCalleeType> | null | undefined {
        for (let index = 0; index < commands.length; index++) {
            const command = commands[index];
            if (--budget.remaining < 0) return reject(command, 'budget');
            if (isReturnStatement(command) && command.value) {
                const delayed = readsStage(command.value);
                consumerRoot = command.value;
                const value = type(command.value, env);
                consumerRoot = undefined;
                let returnedCall = expressions.get(command.value);
                while (returnedCall?.kind === 'group') returnedCall = returnedCall.operand;
                if (returnedCall?.kind === 'input' && returnedCall.input.operation === 'user-call'
                    && returnedCall.input.callee?.proof.planReturn) {
                    planReturn = true;
                    // Arrays now return actual recipes/views. Their argument
                    // construction is eager and keeps this caller's frame.
                    if (typeof value === 'string') planReturns.add(command);
                }
                if (typeof value !== 'string' && returnedCall?.kind === 'input' && returnedCall.input.operation === 'plan'
                    && returnedCall.input.plan?.terminal === 'copy') {
                    planReturn = true;
                    planReturns.add(command);
                }
                if (delayed) {
                    let expression = expressions.get(command.value);
                    while (expression?.kind === 'group') expression = expression.operand;
                    if (expression?.kind !== 'input' || !['sum', 'product', 'copy'].includes(expression.input.plan?.terminal ?? '')) return reject(command, 'plan-escape');
                    planReturn = true;
                    planReturns.add(command);
                }
                if (!value || resultType && !sameCompiledCalleeType(resultType, value)) return reject(command, 'return-type');
                resultType = value;
                returned.push(expressions.get(command.value)!);
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
                    if (!loops || command.operator !== '=' || settled.has(command.name)
                        || stages.has(command.name) || iterableNames.has(command.name)) return reject(command, 'deferred-binding');
                    // Bind a finite recipe without evaluating it. Its lexical
                    // consumers read the protected inputs when traversal starts.
                    const iterable = loopIterable(command.value, env);
                    if (iterable && nativeFactorStage(iterable)) {
                        const deferred = deferredIterable(iterable, env);
                        if (!deferred) return reject(command, 'plan-expression');
                        iterableStages.set(command.name, deferred);
                        iterableNames.add(command.name);
                        iterableBindings.add(command);
                        locals.add(command.name);
                        continue;
                    }
                    // Fresh local stages may be erased only inside a proved
                    // consumer. Rebindings retain ordinary demand-time contracts.
                    if (commands !== statement.statements) return reject(command, 'deferred-binding');
                    const stage = plan(command.value, env);
                    if (!stage) return reject(command, 'plan-expression');
                    stages.set(command.name, stage);
                    planBindings.set(command, stage);
                    locals.add(command.name);
                    continue;
                }
                if (stages.has(command.name) || iterableNames.has(command.name)) return reject(command, 'plan-rebinding');
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
                if (typeof value !== 'string') bindings.set(command.name, [...bindings.get(command.name) ?? [], expressions.get(command.value)!]);
                settled.set(command.name, value);
                env.set(command.name, value);
                if (!parameters.has(command.name)) locals.add(command.name);
                continue;
            }
            if (loops && isUnpackStatement(command)) {
                const array = type(command.value, env);
                if (!array || !isCompiledArray(array) || array.rank !== 1) return reject(command, 'unpack-domain');
                for (const name of command.names) {
                    if (name === '#') continue;
                    if (name.includes('.') || protectedNames.has(name) || stages.has(name) || iterableNames.has(name)
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
                        containerWrites.add(mutation.receiver.name);
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
                if (isNameExpression(command.receiver)) containerWrites.add(command.receiver.name);
                modules.add('algo');
                continue;
            }
            if (loops && isArrayAssignmentStatement(command)) {
            if (command.modulus) return reject(command);
                // Erased recipes read captured slots at demand time. Independent
                // destinations may change, but a captured slot must still denote
                // its construction-time array after copy-on-write detaches it.
                if (protectedNames.has(command.name)) return reject(command, 'plan-capture-write');
                const receiver = env.get(command.name);
                if (!receiver || typeof receiver === 'string' || !isCompiledArray(receiver) && !(isCompiledContainer(receiver) && receiver.kind === 'index')
                    || command.indices.length !== (isCompiledContainer(receiver) ? 1 : receiver.rank)
                    || command.indices.some(index => index.all || index.sign || !index.value || type(index.value, env) !== 'integer')
                    || type(command.value, env) !== (isCompiledContainer(receiver) ? 'integer' : receiver.element)) return reject(command, 'container-write');
                if (command.operator !== '=') {
                    const element = isCompiledContainer(receiver) ? 'integer' : receiver.element;
                    const signature = scalarOperatorSignature(command.operator.slice(0, -1), [element, element]);
                    if (!signature?.compound || signature.result !== element) return reject(command, 'array-compound');
                }
                if (isCompiledArray(receiver)) arrayWrites.add(command);
                else containerWrites.add(command.name);
                continue;
            }
            if (loops && isForStatement(command)) {
                const body = new Map(env);
                const binding = forIteration(command.condition);
                if (binding) {
                    let range = binding.iterable;
                    while (isParenthesizedExpression(range)) range = range.value;
                    const finite = loopIterable(range, env);
                    if (finite) loopIterables.set(command, finite);
                    const iterable = !finite && !(isBinaryExpression(range) && ['to', 'till'].includes(range.operator)) ? type(range, env) : undefined;
                    const text = iterable === 'text';
                    const deque = iterable && isCompiledContainer(iterable) && iterable.kind === 'deque';
                    if ((!finite && !text && !deque && (!isBinaryExpression(range) || !['to', 'till'].includes(range.operator)
                        || type(range.left, env) !== 'integer' || type(range.right, env) !== 'integer'
                        || range.step && type(range.step, env) !== 'integer'))
                        || binding.names.length > 2 || new Set(binding.names).size !== binding.names.length) return reject(command, 'loop-range');
                    for (const [index, name] of binding.names.entries()) {
                        if (name === '#') continue;
                        if (protectedNames.has(name) || stages.has(name) || iterableNames.has(name)) return reject(command, 'plan-capture-write');
                        const domain = index === 0 && finite ? finite.element : text && index === 0 ? 'text' : 'integer';
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
    // A returned local may take its candidate from a closed initializer in
    // the straight-line prefix. Normal flow still checks every assignment;
    // inference neither reads captures nor executes the initializer early.
    const terminal = statement.statements.at(-1);
    if (loops && terminal && isReturnStatement(terminal) && terminal.value) {
        let seedSource = unwrap(terminal.value);
        if (isNameExpression(seedSource)) {
            const name = seedSource.name;
            for (const command of statement.statements) {
                if (!isAssignmentStatement(command) || command.deferred || command.operator !== '=') break;
                if (command.name === name) seedSource = command.value;
            }
        }
        const seed = inferCompiledExpression<CompiledScalarType, never>(seedSource, {
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
    // Only origins fresh to this invocation may be written without a frame.
    const origins = storageOrigins(statement.parameters, types, bindings);
    const ownedStorage = new Set([...origins].filter(([, values]) => values.length
        && values.every(origin => origin.kind === 'fresh')).map(([name]) => name));
    const localArrayWrites = [...arrayWrites].every(command => isArrayAssignmentStatement(command) && ownedStorage.has(command.name));
    // Each invocation owns these constructor slots. Recursive calls only read
    // their arguments; writes through parameters or aliases still fail ownership.
    const result = outcome === null && resultType && !(recursive && (!localArrayWrites || nonnegativeParameters.size))
        ? { parameters: statement.parameters, parameterTypes: types, ownedStorage, storageOrigins: origins, returned, containerWrites, type: resultType, dependencies: [...dependencies], callDepth, callCount, locals: [...locals], nativeReads: [...nativeReads], modules: [...modules], containers, recursive, arrayWrites, localArrayWrites, observableCaptures, expressions,
            planCalls, planBindings, planReturn, planReturns, loopIterables, iterableBindings, nonnegative: [...nonnegativeParameters] } : undefined;
    const failure = rejection ?? { ...describeCompilerRejection('scalar-function', statement), reason: 'scalar-function:missing-return' };
    // A path-depth limit must not poison a helper that is shallow on its own.
    if (result || !path.length) proofs.set(key, result ?? failure);
    return result ?? recordCompilerRejection(failure);
}
