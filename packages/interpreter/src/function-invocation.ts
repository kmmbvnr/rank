import { compiledCalleeTypeKey, type CompiledCalleeType } from './compiled-callee-type.js';
import type { AstNode } from 'langium';
import {
    functionScope, lexicalBinding, findOperation, writtenArrayParameters, availableBuiltin, builtinBindingMessage, expressionFacts, functionBindingPlan, groupExpressions, flattenApplication, isNameExpression, declaredRanks, functionEffects, isReturnStatement,
    type LastArrayUseProof, type FunctionCallSignature, type CallRequirement, type CompiledFunctionType, type Expression, type FunctionBindingStatement, type FunctionStatement, type Program, type Statement, type ValueFacts,
} from '@arrrank/language';
import { isFlatScalarArray, arrayRevision, enterRuntime, leaveRuntime } from './array-storage.js';
import type { CheckedInputContracts } from './checked-input.js';
import type { BindingEnvironment } from './binding-environment.js';
import type { CompiledBlock } from './block-compiler.js';
import { ReturnSignal, TailCallSignal, type PreparedScalarCall } from './control-signals.js';
import type { DebugInspection } from './debug-inspection.js';
import { RankError } from './errors.js';
import { effectiveEnvironment, withEnvironment } from './environment.js';
import { ExecutionStack, completed, mapResult, resume, runExecution, type Evaluation, type Execution } from './execution.js';
import { CallSpecializations } from './call-specializations.js';
import { LocalFrame } from './frame.js';
import { FunctionFrames } from './function-frame.js';
import type { InterpreterOptions } from './interpreter-options.js';
import { checkpoint, inspectionEnabled } from './interrupt.js';
import { BuiltinRegistry } from './modules/builtins.js';
import { prepareFunction } from './prepared-function.js';
import type { ResourceOwnership } from './resource-ownership.js';
import { ReturnContract, argumentRankSignature } from './return-contract.js';
import { compiledArgumentType } from './compiled-argument-type.js';
import { compileScalarFunction } from './scalar-function-kernel.js';
import { compileMembershipFunction, type RankedMembership } from './membership-function.js';
import { compileDistinctFunction } from './distinct-function.js';
import { currentDiagnostics } from './diagnostics.js';
import { prepareCompiledBuiltin } from './typed-native.js';
import { sequence } from './sequence.js';
import type { ExecutionContext } from './statement-control.js';
import {
    MISSING, formatValue, isNativeFunction, isRankArray, isRankDate, isRankLabel,
    type NativeFunction, type RankArray, type RankFile, type RankSequence, type RankValue,
} from './value.js';

/** A user function as its call sites see it. `owner` tells this interpreter's functions from a module child's. */
export interface FunctionDefinition {
    readonly specialization: (arguments_: RankValue[]) => ReturnContract;
    readonly owner: FunctionInvocation;
    readonly statement: FunctionStatement;
    readonly context: LocalFrame | undefined;
    readonly direct: (() => RankValue) | undefined;
}

/** What defining and running a function body needs from execution and the fast-path owner. */
export interface FunctionHost {
    resolve(name: string): RankValue;
    apply(fn: NativeFunction, arguments_: RankValue[]): Evaluation<RankValue>;
    readonly inputs?: Pick<CheckedInputContracts, 'pending' | 'call' | 'tail'>;
    /** A synchronous closure for an expression that cannot call Rank code, when one exists. */
    compileDirect(expression: Expression): (() => RankValue) | undefined;
    /** A compiled body for these argument types, when the block compiler accepts it. */
    compiled(statement: FunctionStatement, arguments_: RankValue[]): CompiledBlock<ExecutionContext> | undefined;
    /** Runs statements as a function body, or as a generator body that may yield. */
    execute(statements: Statement[], generator: boolean): Evaluation<RankValue | undefined>;
    locate(error: unknown, node: AstNode): unknown;
    /** A proven scalar body that the selected argument types may enter directly, when that path is enabled. */
    scalarEntry(statement: FunctionStatement, generator: boolean, types?: readonly CompiledFunctionType[]): { readonly locals: readonly string[]; readonly loops: true } | undefined;
    /** Offers a function to flat combinators; `available` is checked before each use. */
    flatCombine(fn: NativeFunction, statement: FunctionStatement, available: (builtins: ReadonlySet<string>) => boolean): void;
}

// Functions are values that outlive the interpreter that made them, so their
// definitions are found from the function object rather than from a scope.
const functionExecutions = new WeakMap<NativeFunction, (arguments_: RankValue[], inputRequirement?: CallRequirement) => Evaluation<RankValue>>();
const functionDefinitions = new WeakMap<NativeFunction, FunctionDefinition>();
// Declaration ownership also covers memo functions and generators, which must
// not enter the ordinary function-body optimization registry above.
const frozenFunctions = new WeakSet<NativeFunction>();
const functionDeclarations = new WeakMap<NativeFunction, { owner: FunctionInvocation; statement: FunctionStatement; context: LocalFrame | undefined }>();
const scalarCallbacks = new WeakMap<NativeFunction, (arguments_: RankValue[]) => RankValue>();
const arrayBatches = new WeakMap<NativeFunction, (source: RankArray, axes: readonly number[]) =>
    (RankedMembership & { available(): boolean }) | undefined>();

/**
 * Defining and calling user functions: closures over their defining frame,
 * return contracts, memo caches, tail calls, generators and the call depth
 * limit. A call runs its body in a fresh frame linked to the definition's
 * environment, inside its own resource scope.
 */
export class FunctionInvocation {
    readonly maxDepth: number;
    private depth = 0;
    private readonly sources = new WeakMap<NativeFunction, FunctionStatement>();
    private readonly globalScalarCalls = new WeakMap<FunctionStatement, Map<string, PreparedScalarCall>>();
    private readonly localScalarCalls = new WeakMap<LocalFrame, WeakMap<FunctionStatement, Map<string, PreparedScalarCall>>>();
    private readonly frames: FunctionFrames;

    constructor(
        private readonly bindings: BindingEnvironment,
        private readonly resources: ResourceOwnership,
        private readonly builtins: BuiltinRegistry,
        private readonly inspection: DebugInspection,
        private readonly modules: ReadonlySet<string>,
        private readonly options: () => InterpreterOptions,
        private readonly host: FunctionHost,
    ) {
        this.frames = new FunctionFrames(bindings, builtins, (fn, parent) => {
            const helper = functionDefinitions.get(fn);
            return helper?.owner === this && helper.context === parent ? helper.statement : undefined;
        });
        this.maxDepth = options().maxCallDepth ?? 200_000;
        if (!Number.isSafeInteger(this.maxDepth) || this.maxDepth < 1) {
            throw new RankError('maxCallDepth must be a positive safe integer');
        }
    }

    /** Calls a function, through its Rank body when it has one so the call can suspend. */
    invoke(fn: NativeFunction, arguments_: RankValue[]): Evaluation<RankValue> {
        const execution = functionExecutions.get(fn);
        return execution ? execution(arguments_, this.host.inputs?.pending) : completed(fn.call(arguments_));
    }

    /** Consume proven-dead locals only for ordinary, whole-array Rank calls. */
    transferLastUses(fn: NativeFunction, arguments_: RankValue[], names: readonly (LastArrayUseProof | undefined)[]): void {
        if (!names.some(Boolean) || inspectionEnabled()) return;
        const definition = functionDefinitions.get(fn);
        if (definition?.owner !== this || definition.context || definition.statement.memo
            || fn.monadicRank !== 'all' || fn.dyadicRanks !== undefined) return;
        const signature = prepareFunction(definition.statement).signature;
        if (signature.words.length || signature.arity !== arguments_.length) return;
        const writes = writtenArrayParameters(definition.statement);
        if (writes.size) this.frames.transfer(arguments_, names.map((name, index) => writes.has(index) ? name : undefined));
    }

    /** A checked synchronous callback for ranked materialization. The closure
     * belongs to the defining interpreter and revalidates every actual call. */
    scalarCallback(fn: NativeFunction): ((arguments_: RankValue[]) => RankValue) | undefined {
        return inspectionEnabled() ? undefined : scalarCallbacks.get(fn);
    }

    arrayBatch(fn: NativeFunction, source: RankArray, axes: readonly number[]) {
        return inspectionEnabled() ? undefined : arrayBatches.get(fn)?.(source, axes);
    }

    /** A call in tail position to one of this interpreter's own functions unwinds to the active call. */
    throwTailCall(fn: NativeFunction, arguments_: RankValue[]): void {
        const definition = functionDefinitions.get(fn);
        if (definition?.owner === this) throw new TailCallSignal(definition, arguments_, undefined, this.host.inputs?.pending);
    }

    definitionOf(fn: NativeFunction): FunctionDefinition | undefined {
        return functionDefinitions.get(fn);
    }

    /** The declaration behind a function value, for diagnostics and previews. */
    sourceOf(fn: NativeFunction, includeImported = false): FunctionStatement | undefined {
        return this.sources.get(fn) ?? (includeImported ? functionDeclarations.get(fn)?.statement : undefined);
    }

    /** Identity for host replay; it does not expose an imported function's private scope. */
    isDeclaration(fn: NativeFunction, statement: FunctionStatement): boolean {
        return (this.sources.get(fn) ?? functionDeclarations.get(fn)?.statement) === statement;
    }

    adoptSource(fn: NativeFunction, statement: FunctionStatement): void {
        this.sources.set(fn, statement);
    }

    /** Binds a function declaration in the current scope; the definition captures that scope. */
    defineBinding(statement: FunctionBindingStatement, resolve: (name: string) => RankValue, evaluate: (value: Expression) => RankValue): RankValue {
        let plan = functionBindingPlan(statement);
        if (!plan.alias && !plan.value) {
            const signatures = new Map<string, readonly number[] | false>();
            const declarations = new Map<string, FunctionCallSignature>();
            let words: readonly string[] = [];
            for (const part of flattenApplication(statement.value)) {
                if (!isNameExpression(part) || ['rank', 'axis', 'with', ...words].includes(part.name)) continue;
                const value = resolve(part.name);
                signatures.set(part.name, isNativeFunction(value) ? value.arities : false);
                const declaration = isNativeFunction(value) ? value.callSignature : undefined;
                if (declaration) declarations.set(part.name, declaration);
                words = declaration?.words.map(group => group.word) ?? [];
            }
            const copy = { ...statement };
            const program = { $type: 'Program', statements: [copy] } as Program;
            const diagnostic = groupExpressions(program, { bindings: signatures, signatures: declarations }).diagnostics[0];
            if (diagnostic) throw new RankError(diagnostic.message, 'Syntax');
            plan = functionBindingPlan(copy);
        }
        if (plan.error) throw new RankError(plan.error, 'Syntax');
        if (plan.alias || plan.value) {
            const value = plan.alias ? resolve(plan.alias) : evaluate(statement.value);
            if (!isNativeFunction(value)) throw new RankError('A lowercase binding must name a function', 'TypeError');
            this.bindings.assign(statement.name, value);
            return value;
        }
        const stages = plan.stages;
        const context = this.bindings.current;
        const plain = stages?.every(stage => stage.length === 1 && isNameExpression(stage[0]));
        const alternatives = new Map<number, NativeFunction>();
        for (const definition of plain ? [] : plan.definitions) {
            alternatives.set(prepareFunction(definition).signature.arity, this.define(definition, false) as NativeFunction);
        }
        const fn: NativeFunction = {
            kind: 'function', name: statement.name, arities: plan.arities,
            monadicRank: 'all', dyadicRanks: ['all', 'all'],
            monadicResultShape: shape => {
                const definition = plan.definitions.find(item => prepareFunction(item).signature.arity === 1);
                return definition && this.userResultCellShape(definition, context, new Map(), [shape]);
            },
            dyadicResultShape: (left, right) => {
                const definition = plan.definitions.find(item => prepareFunction(item).signature.arity === 2);
                return definition && this.userResultCellShape(definition, context, new Map(), [left, right]);
            },
            captures: this.bindings.current?.captures(),
            call: args => {
                if (plain) return this.bindings.withFrame(context, () => {
                    let operands = args;
                    for (const stage of stages!) {
                        const head = stage[0];
                        if (!isNameExpression(head)) throw new RankError('Pipeline stage must name a function');
                        const operation = resolve(head.name);
                        if (!isNativeFunction(operation)) throw new RankError('Pipeline stage must be a function', 'TypeError');
                        operands = [runExecution(this.host.apply(operation, operands))];
                    }
                    return operands[0];
                });
                const selected = alternatives.get(args.length);
                if (!selected) throw new RankError(`${statement.name} does not accept ${args.length} arguments`);
                return selected.call(args);
            },
        };
        this.bindings.assign(statement.name, fn);
        return fn;
    }

    /** Clone each referenced declaration into its own frozen lexical environment.
     * Separate frames preserve distinct bindings with the same spelling. */
    snapshot(fn: NativeFunction, seen = new Map<NativeFunction, NativeFunction>()): NativeFunction {
        if (frozenFunctions.has(fn)) return fn;
        const previous = seen.get(fn);
        if (previous) return previous;
        const declaration = functionDeclarations.get(fn);
        if (!declaration) return fn;
        if (declaration.owner !== this) return declaration.owner.snapshot(fn, seen);
        const { statement, context } = declaration;
        const scope = functionScope(statement);
        if (!scope) throw new RankError(`cannot determine snapshot dependencies of ${statement.name}`, 'Scope');
        // A function without external data needs no snapshot frame. In particular,
        // a parameter-only memo retains one cache across aliases and lazy passes.
        if (scope.captures.size === 0) return fn;
        const frame = new LocalFrame(undefined);
        const result = this.bindings.withFrame(frame, () => this.define(statement, false)) as NativeFunction;
        seen.set(fn, result);
        frozenFunctions.add(result);
        const bindings = new Set([...scope.reads.values(), ...[...scope.captures].filter(binding =>
            lexicalBinding(scope.scope, binding.name) === binding)]);
        for (const binding of bindings) {
            if (binding.scope.owner === statement && binding.kind !== 'function') continue;
            // Functions declared inside this body are constructed on invocation.
            if (binding.function && binding.scope.owner === statement) continue;
            const value = this.bindings.withFrame(context, () => this.host.resolve(binding.name));
            if (value === undefined) throw new RankError(`snapshot dependency ${binding.name} is not initialized`, 'Scope');
            if (isNativeFunction(value)) frame.set(binding.name, this.snapshot(value, seen));
            else {
                if (typeof value === 'object' && !isRankLabel(value) && !isRankDate(value)
                    && value !== MISSING && !isFlatScalarArray(value)) {
                    throw new RankError(`snapshot capture ${binding.name} does not support value snapshots; pass explicit data or materialize it first`, 'Scope');
                }
                frame.set(binding.name, value);
            }
        }
        return result;
    }

    define(statement: FunctionStatement, constant = true): RankValue {
        const existing = this.bindings.scope.get(statement.name);
        if (this.bindings.isConstant(statement.name)) {
            const declaration = existing && isNativeFunction(existing) ? functionDeclarations.get(existing) : undefined;
            if (!existing || !isNativeFunction(existing) || !this.isDeclaration(existing, statement)) {
                throw new RankError(`cannot redefine function declaration: ${statement.name}`, 'TypeError');
            }
            if (!declaration || declaration.owner === this) return existing!;
            // Running an imported program registers its original declarations in
            // the run's scope, where its top-level values will be evaluated.
            this.bindings.unbind(statement.name);
        }
        if (availableBuiltin(statement.name, this.modules)) {
            throw new RankError(builtinBindingMessage(statement.name), 'TypeError');
        }
        const { generator, signature } = prepareFunction(statement);
        if (statement.memo && generator) throw new RankError('memo functions cannot yield');
        const context = this.bindings.current;
        const only = statement.statements.length === 1 ? statement.statements[0] : undefined;
        const compiled = !inspectionEnabled() && only && isReturnStatement(only) && only.value
            ? this.host.compileDirect(only.value) : undefined;
        const direct = compiled ? () => {
            try { return compiled(); }
            catch (error) { throw this.host.locate(error, only!); }
        } : undefined;
        const proof = this.host.scalarEntry(statement, generator);
        const scalar = proof ? this.prepareScalarCall(statement, context, undefined, proof.loops) : undefined;
        const instances = new CallSpecializations<ReturnContract>();
        const returnRanks = new Map<string, { rank?: number }>();
        const specialization = (arguments_: RankValue[]): ReturnContract => {
            let instance = instances.get(arguments_);
            if (!instance) {
                const rankKey = argumentRankSignature(arguments_);
                let rank = returnRanks.get(rankKey);
                if (!rank) returnRanks.set(rankKey, rank = {});
                instances.set(arguments_, instance = new ReturnContract(statement.name, rank));
            }
            return instance;
        };
        const typedEntries = new CallSpecializations<{
            readonly locals: readonly string[]; readonly call: PreparedScalarCall;
        } | null>();
        const selectScalar = (arguments_: RankValue[]): PreparedScalarCall | undefined => {
            if (inspectionEnabled() || arguments_.length !== signature.arity) return undefined;
            let call = scalar, locals = proof?.locals;
            if (!arguments_.every(value => typeof value === 'bigint')) {
                let types: CompiledFunctionType[] | undefined;
                if (arguments_.some(value => typeof value === 'object')) {
                    // Keep ordinary container calls allocation-free when the
                    // first object is not eligible array storage.
                    if (arguments_.some(value => typeof value === 'object' && !compiledArgumentType(value))) return undefined;
                    const guarded = arguments_.map(compiledArgumentType);
                    if (!guarded.every((type): type is CompiledFunctionType => type !== undefined)) return undefined;
                    types = guarded;
                } else if (arguments_.some(value => typeof value !== 'bigint' && typeof value !== 'number'
                    && typeof value !== 'boolean' && typeof value !== 'string')) return undefined;
                let entry = typedEntries.get(arguments_);
                if (entry === undefined) {
                    types ??= arguments_.map(value => compiledArgumentType(value)!);
                    const typedProof = this.host.scalarEntry(statement, generator, types);
                    const typedCall = typedProof ? this.prepareScalarCall(statement, context, types, typedProof.loops) : undefined;
                    entry = typedCall ? { locals: typedProof!.locals, call: typedCall } : null;
                    typedEntries.set(arguments_, entry);
                }
                call = entry?.call;
                locals = entry?.locals;
            }
            return call && !locals!.some(name => context?.find(name))
                && (!call.available || call.available()) ? call : undefined;
        };
        const membership = !generator && !statement.memo ? compileMembershipFunction(statement) : undefined;
        const distinct = !generator && !statement.memo ? compileDistinctFunction(statement) : undefined;
        const arrayFunction = membership ?? distinct;
        const body = (arguments_: RankValue[]): Evaluation<RankValue> => {
            if (this.frames.hasTransfers(arguments_)) return this.callFunction(statement, arguments_, context);
            if (arrayFunction && !inspectionEnabled() && this.options().arrayFunctionCompilation !== false
                && this.options().tensorFusion !== false && this.modules.has('sequences')
                && !arrayFunction.locals.some(name => context?.find(name))
                && (!distinct || ['unique', 'len'].every(name => {
                    const value = context?.lookup(name) ?? this.bindings.globals.get(name) ?? this.builtins.lookup(name);
                    return value !== undefined && this.builtins.is(name === 'unique' ? 'sequences' : 'core', name, value);
                }))) {
                const fused = arrayFunction.prepare(arguments_, name => context?.lookup(name) ?? this.bindings.globals.get(name));
                if (fused) {
                    if (this.depth >= this.maxDepth) throw new RankError(`function call depth exceeds ${this.maxDepth}`, 'RecursionLimit');
                    this.depth++;
                    try {
                        const diagnostics = currentDiagnostics();
                        if (diagnostics) diagnostics.compiledArrayFunctions++;
                        return completed(fused());
                    } catch (error) {
                        if (error instanceof RankError) this.frames.addCall(error, statement, arguments_);
                        throw this.host.locate(error, statement);
                    } finally { this.depth--; }
                }
            }
            const selected = selectScalar(arguments_);
            if (selected) return completed(selected(arguments_));
            return direct ? completed(this.callDirectFunction(statement, arguments_, context, direct))
                : this.callFunction(statement, arguments_, context);
        };
        const checkReturn = (contract: ReturnContract, arguments_: RankValue[], value: RankValue): RankValue => {
            try { return contract.check(value); }
            catch (error) {
                if (error instanceof RankError) this.frames.addCall(error, statement, arguments_);
                throw this.host.locate(error, statement);
            }
        };
        const checkedBody = (arguments_: RankValue[], inputRequirement?: CallRequirement): Evaluation<RankValue> => {
            const contract = specialization(arguments_);
            const run = () => mapResult(body(arguments_), value => checkReturn(contract, arguments_, value));
            return this.host.inputs ? this.host.inputs.call(statement, inputRequirement, run) : run();
        };
        // Only successful, validated returns enter the closure's memo cache.
        const cache = statement.memo ? new Map<MemoKey, RankValue>() : undefined;
        const memoMiss = cache ? (arguments_: RankValue[], key: MemoKey, inputRequirement?: CallRequirement): Evaluation<RankValue> => {
            const diagnostics = currentDiagnostics();
            if (diagnostics) diagnostics.memoMisses++;
            return mapResult(checkedBody(arguments_, inputRequirement), value => {
                memoValueKey(value);
                cache.set(key, value);
                return value;
            });
        } : undefined;
        const cachedMemoValue = cache ? (key: MemoKey): RankValue | undefined => {
            const value = cache.get(key);
            const diagnostics = currentDiagnostics();
            if (value !== undefined && diagnostics) diagnostics.memoHits++;
            return value;
        } : undefined;
        const executeBound = cache && memoMiss ? (arguments_: RankValue[], inputRequirement?: CallRequirement): Evaluation<RankValue> => {
            const key = memoCallKey(arguments_, signature.arity);
            const cached = cachedMemoValue!(key);
            if (cached !== undefined) return completed(cached);
            return memoMiss(arguments_, key, inputRequirement);
        } : checkedBody;
        const defaults = signature.words.map(word => word.defaultValue
            ? this.host.compileDirect(word.defaultValue)! : () => MISSING);
        const bindArguments = (arguments_: RankValue[]): RankValue[] => {
            const required = signature.leftCount + signature.rightParameters.length;
            if (arguments_.length !== required && arguments_.length !== signature.arity) {
                throw new RankError(`${statement.name} expects ${required} arguments, got ${arguments_.length}`);
            }
            let bound = arguments_;
            for (const [i, word] of signature.words.entries()) {
                if (bound[word.parameter] === undefined || bound[word.parameter] === MISSING) {
                    if (bound === arguments_) bound = [...arguments_];
                    bound[word.parameter] = defaults[i]();
                }
            }
            for (const parameter of signature.rightParameters) {
                if (parameter.kind === 'function' && !isNativeFunction(bound[parameter.index])) {
                    throw new RankError(`${parameter.name} expects a function`, 'TypeError');
                }
            }
            return bound;
        };
        const execute = signature.words.length || signature.rightParameters.some(parameter => parameter.kind === 'function')
            ? (arguments_: RankValue[], inputRequirement?: CallRequirement): Evaluation<RankValue> =>
                executeBound(bindArguments(arguments_), inputRequirement)
            : executeBound;
        const declared = declaredRanks(statement);
        if (typeof declared === 'string') throw this.host.locate(new RankError(declared, 'TypeError'), statement);
        const fn: NativeFunction = {
            kind: 'function',
            name: statement.name,
            arities: [signature.leftCount + signature.rightParameters.length],
            callSignature: signature,
            monadicRank: declared?.ranks.length === 1 ? declared.ranks[0] : 'all',
            // Call-site ranks can lift array results even without header ranks.
            arrayCells: true,
            resultCellShape: generator ? undefined
                : cellShapes => this.userResultCellShape(statement, context, returnRanks, cellShapes),
            monadicResultShape: generator ? undefined
                : cellShape => this.userResultCellShape(statement, context, returnRanks, [cellShape]),
            dyadicResultShape: generator ? undefined
                : (left, right) => this.userResultCellShape(statement, context, returnRanks, [left, right]),
            dyadicRanks: signature.dataParameters.length === 2
                ? declared?.ranks.length === 2 ? [declared.ranks[0], declared.ranks[1]] : ['all', 'all']
                : undefined,
            captures: context?.captures(),
            snapshot: () => this.snapshot(fn),
            // What a caller outside the runtime reaches. A Rank call made from a
            // Rank body takes a shorter path, so the stretch this opens is the
            // work our embedder asked for; readers over storage we cannot track
            // keep their cells for exactly that long. See enterRuntime.
            call: arguments_ => {
                enterRuntime();
                try {
                    if (generator && !frozenFunctions.has(fn)) {
                        const frozen = this.snapshot(fn);
                        if (frozen !== fn) return frozen.call(arguments_);
                    }
                    return generator
                        ? this.callGeneratorFunction(statement, bindArguments(arguments_), context)
                        : runExecution(execute(arguments_));
                } finally { leaveRuntime(); }
            },
        };
        this.sources.set(fn, statement);
        functionDeclarations.set(fn, { owner: this, statement, context });
        if (membership) {
            const originalCall = fn.call;
            const enabled = () => !inspectionEnabled() && fn.call === originalCall
                && this.options().arrayFunctionCompilation !== false && this.options().tensorFusion !== false
                && this.options().rankedArrayCompilation !== false && this.modules.has('sequences')
                && this.depth < this.maxDepth && !membership.locals.some(name => context?.find(name));
            const lookup = (name: string) => context?.lookup(name) ?? this.bindings.globals.get(name);
            arrayBatches.set(fn, (source, axes) => {
                if (!enabled()) return undefined;
                const captureValues = membership.captures.map(lookup);
                const captures = captureValues.map(value => ({ value, revision: value && isRankArray(value) ? arrayRevision(value) : undefined }));
                const revision = arrayRevision(source);
                const kernel = membership.prepareRanked(source, axes, lookup);
                if (!kernel) return undefined;
                return { ...kernel, available: () => enabled() && arrayRevision(source) === revision
                    && membership.captures.every((name, i) => {
                        const value = lookup(name), old = captures[i];
                        return value === old.value && (!value || !isRankArray(value) || arrayRevision(value) === old.revision);
                    }) };
            });
        }
        if (!generator) {
            functionExecutions.set(fn, execute);
            // A memo call must return through its cache writer. Do not bypass it
            // via the tail-call path that enters an ordinary function body.
            if (!statement.memo) functionDefinitions.set(fn, { owner: this, statement, context, direct, specialization });
            // Hits already passed the return contract. Misses retain the same
            // execution stack, validation and cache writer as ordinary calls.
            if (cache && memoMiss && this.options().scalarFunctionCompilation !== false
                && this.options().scalarEntryCompilation !== false) scalarCallbacks.set(fn, arguments_ => {
                const key = memoCallKey(arguments_, signature.arity);
                const cached = cachedMemoValue!(key);
                if (cached !== undefined) return cached;
                enterRuntime();
                try { return runExecution(memoMiss(arguments_, key)); }
                finally { leaveRuntime(); }
            });
            if (!statement.memo && this.options().scalarFunctionCompilation !== false
                && this.options().scalarEntryCompilation !== false) scalarCallbacks.set(fn, arguments_ => {
                // The caller already read the operands. A declined guard uses
                // those same values and keeps memo/generator paths untouched.
                const selected = selectScalar(arguments_);
                if (!selected) return fn.call(arguments_);
                enterRuntime();
                try {
                    const contract = specialization(arguments_);
                    return checkReturn(contract, arguments_, selected(arguments_));
                } finally { leaveRuntime(); }
            });
        }
        if (!generator && !statement.memo) {
            this.host.flatCombine(fn, statement, builtins => {
                if (this.depth >= this.maxDepth) return false;
                for (const name of builtins) {
                    // Rank locals cannot hide core names; only host-injected globals need a guard.
                    const bound = this.bindings.globals.get(name);
                    if (bound !== undefined) {
                        if (!this.builtins.is('core', name, bound)) return false;
                    }
                }
                return true;
            });
        }
        this.bindings.assign(statement.name, fn);
        if (constant) this.bindings.lockFunction(statement.name);
        return fn;
    }

    /**
     * The result cell shape of a user function over an empty frame, found
     * without calling it: its body may print or loop. Static result facts for
     * an integer cell of that shape come first, then a return rank that earlier
     * calls settled. Lengths the facts leave open are zero.
     */
    private userResultCellShape(
        statement: FunctionStatement,
        context: LocalFrame | undefined,
        returnRanks: ReadonlyMap<string, { rank?: number }>,
        cellShapes: readonly (readonly number[])[],
    ): readonly number[] | undefined {
        const valueOf = (name: string) => context?.lookup(name) ?? this.bindings.globals.get(name);
        const functionValue = (name: string) => {
            const value = valueOf(name);
            return value !== undefined && isNativeFunction(value) ? value : undefined;
        };
        const cells = cellShapes.map((cellShape): ValueFacts => cellShape.length === 0
            ? { types: ['integer'], rank: 0, shape: [] }
            : { types: ['array'], rank: cellShape.length, shape: cellShape,
                elements: ['integer'], eagerScalarCells: true });
        let result = functionEffects(
            name => name === statement.name ? statement : this.sources.get(functionValue(name)!),
            name => functionValue(name) !== undefined,
            name => valueOf(name) !== undefined,
        )(statement.name, cells).result;
        // Synthetic bound pipelines do not have linked effect-analysis bodies.
        // Their single expression can still determine a shape without execution.
        const only = statement.statements.length === 1 ? statement.statements[0] : undefined;
        if (!result && only && isReturnStatement(only) && only.value) {
            result = expressionFacts(only.value, name => {
                const index = statement.parameters.indexOf(name);
                if (index >= 0) return cells[index];
                const fn = functionValue(name);
                const operation = fn && BuiltinRegistry.operationOf(fn);
                return operation ? { types: ['function'], builtinOperation: operation.name } : undefined;
            });
        }
        // Like a called cell, a non-array result leaves only the frame.
        if (result?.types.length && !result.types.some(type => ['array', 'bytes'].includes(type))) return [];
        if (result?.types.join() === 'array' && result.shape?.length === result.rank) {
            return result.shape!.map(dimension => dimension ?? 0);
        }
        const settled = new Set<number>();
        for (const [key, contract] of returnRanks) {
            const arguments_ = JSON.parse(key) as [string, number, unknown][];
            if (contract.rank === undefined || arguments_.length !== cellShapes.length
                || arguments_.some((argument, index) => argument[1] !== cellShapes[index].length
                    || cellShapes[index].length > 0 && argument[0] !== 'array')) continue;
            settled.add(contract.rank);
        }
        return settled.size === 1 ? Array<number>([...settled][0]).fill(0) : undefined;
    }

    /** A proven scalar body compiled to a direct call, counted against the call depth. */
    prepareScalarCall(statement: FunctionStatement, context?: LocalFrame, types?: readonly CompiledCalleeType[], loops = false): PreparedScalarCall | undefined {
        if (this.options().scalarFunctionCompilation === false) return undefined;
        let cache = context ? this.localScalarCalls.get(context) : this.globalScalarCalls;
        if (!cache) this.localScalarCalls.set(context!, cache = new WeakMap());
        let instances = cache.get(statement);
        if (!instances) cache.set(statement, instances = new Map());
        const key = `${loops ? 'loops:' : ''}${types?.map(compiledCalleeTypeKey).join(',') ?? ''}`;
        const cached = instances.get(key);
        if (cached) return cached;
        const kernel = compileScalarFunction(statement, types, loops);
        if (!kernel) return undefined;
        const locate = (error: unknown, index: number) => this.host.locate(error, kernel.locations[index] ?? statement);
        const binders = kernel.calls.map(({ operation, inputs }) => prepareCompiledBuiltin({
            modules: this.modules, builtins: this.builtins, options: this.options,
            resolve: name => context?.lookup(name) ?? this.bindings.globals.get(name)
                ?? this.builtins.lookup(name) ?? (() => { throw this.builtins.unknown(name); })(),
        }, operation.module, operation.name, inputs));
        const calls: ((arguments_: RankValue[]) => RankValue)[] = [];
        const run: PreparedScalarCall = (arguments_, tail = false) => {
            if (!tail && this.depth >= this.maxDepth) {
                throw new RankError(`function call depth exceeds ${this.maxDepth}`, 'RecursionLimit');
            }
            if (!tail) this.depth += 1;
            try {
                this.options().onScalarFunctionExecuted?.();
                return kernel.run(arguments_, locate, calls);
            } catch (error) {
                if (error instanceof RankError) this.frames.addCall(error, statement, arguments_);
                throw error;
            } finally { if (!tail) this.depth -= 1; }
        };
        if (binders.length || kernel.guards.length || kernel.modules.length) Object.defineProperty(run, 'available', { value: () => {
            if (kernel.modules.some(module => !this.modules.has(module))) return false;
            for (const name of kernel.guards) {
                const operation = findOperation(name);
                const value = context?.lookup(name) ?? this.bindings.globals.get(name) ?? this.builtins.lookup(name);
                if (!operation || !this.modules.has(operation.module) || !value || !this.builtins.is(operation.module, name, value)) return false;
            }
            for (let index = 0; index < binders.length; index++) {
                const call = binders[index]();
                if (!call) return false;
                calls[index] = call;
            }
            return true;
        } });
        instances.set(key, run);
        return run;
    }

    // A single return whose expression contains no applications cannot make a
    // direct Rank call. It needs a lexical/resource frame, but no suspended task.
    private callDirectFunction(
        statement: FunctionStatement,
        arguments_: RankValue[],
        context: LocalFrame | undefined,
        direct: () => RankValue,
    ): RankValue {
        if (this.depth >= this.maxDepth) {
            throw new RankError(`function call depth exceeds ${this.maxDepth}`, 'RecursionLimit');
        }
        const frame = this.frames.create(statement, arguments_, context);
        this.depth += 1;
        return this.resources.withResourceScope(() => {
            try {
                return this.bindings.withFrame(frame, direct);
            } catch (error) {
                if (error instanceof RankError) this.frames.addCall(error, statement, arguments_);
                throw error;
            } finally {
                this.depth -= 1;
            }
        });
    }

    private *callFunction(
        statement: FunctionStatement,
        arguments_: RankValue[],
        context: LocalFrame | undefined,
    ): Execution<RankValue> {
        if (this.depth >= this.maxDepth) {
            throw new RankError(`function call depth exceeds ${this.maxDepth}`, 'RecursionLimit');
        }
        let frame = this.frames.create(statement, arguments_, context);
        const callerStatement = this.inspection.statement;
        const caller = this.bindings.current;
        const scope = new Set<RankFile>();
        this.resources.pushScope(scope);
        this.bindings.current = frame;
        this.depth += 1;
        if (inspectionEnabled()) this.inspection.enter(statement.name, frame);
        let result: RankValue | undefined;
        let pending: unknown;
        let compiledTail = false;
        const tailContracts = new Set<ReturnContract>();
        try {
            while (true) {
                checkpoint();
                try {
                    this.bindings.current = frame;
                    if (inspectionEnabled()) this.inspection.replace(statement.name, frame);
                    for (const local of prepareFunction(statement).locals) this.define(local);
                    const body = this.host.compiled(statement, arguments_);
                    if (body) {
                        result = yield* resume(body({ assertBooleanExpressions: false, insideLoop: false,
                            insideFinally: false, insideGenerator: false }));
                        break;
                    }
                    yield* resume(this.host.execute(statement.statements, false));
                    throw new RankError(`function ${statement.name} reached end without return`);
                } catch (error) {
                    if (error instanceof TailCallSignal) {
                        this.host.inputs?.tail(error.definition.statement, error.inputRequirement);
                        tailContracts.add(error.definition.specialization(error.arguments_));
                        if (error.compiled && (!error.compiled.available || error.compiled.available())) {
                            compiledTail = true;
                            // Keep the tail driver's logical depth and resource scope;
                            // this proven scalar body needs no new lexical frame.
                            try { result = error.compiled(error.arguments_, true); }
                            catch (error) { pending = error; }
                            break;
                        }
                        const reusable = statement === error.definition.statement
                            && frame.parent === error.definition.context ? frame : undefined;
                        statement = error.definition.statement;
                        arguments_ = error.arguments_;
                        frame = this.frames.create(statement, error.arguments_, error.definition.context, reusable);
                        if (error.definition.direct) {
                            this.bindings.current = frame;
                            try {
                                result = error.definition.direct();
                            } catch (error) {
                                pending = error;
                            }
                            break;
                        }
                        continue;
                    }
                    if (error instanceof ReturnSignal && error.value !== undefined) result = error.value;
                    else pending = error;
                    break;
                }
            }
        } finally {
            this.depth -= 1;
            this.bindings.current = caller;
            if (inspectionEnabled()) this.inspection.leave(callerStatement);
            if (pending instanceof RankError && !compiledTail) this.frames.addCall(pending, statement, arguments_);
            if (pending === undefined && result !== undefined) {
                try { for (const contract of tailContracts) result = contract.check(result); }
                catch (error) { pending = error; }
            }
            this.resources.finishResourceScope(scope, result, pending);
        }
        return result!;
    }

    private callGeneratorFunction(
        statement: FunctionStatement,
        arguments_: RankValue[],
        context: LocalFrame | undefined,
    ): RankSequence {
        const frame = this.frames.create(statement, arguments_, context);
        const invocation = this;
        const environment = effectiveEnvironment(this.options().environment!);
        let consumed = false;

        this.bindings.withFrame(frame, () => {
            for (const local of prepareFunction(statement).locals) this.define(local);
        });

        return this.singlePass({
            name: statement.name,
            size: { kind: 'unknown' },
            captures: frame.captures(),
            *iterate() {
                if (consumed) {
                    throw new RankError(
                        `generator sequence ${statement.name} has already been consumed`,
                        'ConsumedSequence',
                    );
                }
                consumed = true;

                const resources = new Set<RankFile>();
                let suspendedFrame = frame;
                const inFrame = <T>(operation: () => T): T => invocation.withGeneratorFrame(suspendedFrame, resources, () => {
                    try { return operation(); }
                    finally { suspendedFrame = invocation.bindings.current!; }
                });
                invocation.resources.addGeneratorScope(resources);
                const execution = new ExecutionStack((function* (): Execution<RankValue | undefined> {
                    return yield* resume(invocation.host.execute(statement.statements, true));
                })());
                try {
                    while (true) {
                        let next: IteratorResult<RankValue, RankValue | undefined>;
                        try {
                            next = inFrame(
                                () => {
                                    if (!inspectionEnabled()) return withEnvironment(effectiveEnvironment(environment), () => execution.next());
                                    const callerStatement = invocation.inspection.statement;
                                    invocation.inspection.enter(statement.name, frame);
                                    try { return withEnvironment(effectiveEnvironment(environment), () => execution.next()); }
                                    finally { invocation.inspection.leave(callerStatement); }
                                },
                            );
                        } catch (error) {
                            if (error instanceof ReturnSignal && error.value === undefined) return;
                            if (error instanceof RankError) error.addCall(statement.name, statement.parameters, arguments_);
                            throw error;
                        }
                        if (next.done) return;
                        yield next.value;
                    }
                } finally {
                    try {
                        inFrame(
                            () => {
                                withEnvironment(effectiveEnvironment(environment), () => {
                                    let result = execution.return(undefined);
                                    while (!result.done) result = execution.next();
                                });
                            },
                        );
                    } finally {
                        invocation.resources.deleteGeneratorScope(resources);
                        invocation.resources.closeResources(resources, new Set());
                    }
                }
            },
        });
    }

    private withGeneratorFrame<T>(
        frame: LocalFrame,
        resources: Set<RankFile>,
        operation: () => T,
    ): T {
        this.resources.pushScope(resources);
        try {
            return this.bindings.withFrame(frame, operation);
        } finally {
            this.resources.popScope();
        }
    }

    private singlePass(plan: RankSequence['plan']): RankSequence {
        const source = sequence({ ...plan, singlePass: true });
        return this.options().wrapSinglePassSequence?.(source) ?? source;
    }
}

type MemoKey = string | bigint | number | boolean | symbol;
const memoNegativeZero = Symbol('memo negative zero');

function memoCallKey(arguments_: RankValue[], arity: number): MemoKey {
    return arity === 1 && arguments_.length === 1
        ? memoValueKey(arguments_[0]) : JSON.stringify(arguments_.map(memoScalarKey));
}

/** One scalar needs no tuple serialization. Map preserves primitive types,
 * except signed zero, which needs its own key. Text and value objects retain
 * tagged keys so labels/dates cannot collide with text of the same spelling. */
function memoValueKey(value: RankValue): MemoKey {
    if (typeof value === 'bigint' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Object.is(value, -0) ? memoNegativeZero : value;
    return memoScalarKey(value);
}

function memoScalarKey(value: RankValue): string {
    if (typeof value === 'number' && Object.is(value, -0)) return 'number:-0';
    if (typeof value !== 'object') return `${typeof value}:${value}`;
    if (isRankLabel(value)) return `label:${value.name}`;
    if (isRankDate(value)) return `${value.kind}:${formatValue(value)}`;
    throw new RankError('memo arguments and results must be scalar values');
}
