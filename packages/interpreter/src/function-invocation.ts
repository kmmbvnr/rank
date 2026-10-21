import { materializeArguments } from './materialize.js';
import {
    functionArgumentBinder, functionReturnSpecializations, memoizedFunctionBody, memoCallKey,
} from './function-definition.js';
import { membershipLookup } from './membership-lookup.js';
import { isPureLazyFunction } from './lazy-function.js';
import { compiledIntegerMembership } from './integer-membership.js';
import { capturedIntegerReader } from './scalar-selection.js';
import { compiledCalleeTypeKey, type CompiledCalleeType } from './compiled-callee-type.js';
import type { AstNode } from 'langium';
import {
    functionScope, lazyFunctionFailure, lazyBuiltinDependencies, lexicalBinding, findOperation,
    writtenArrayParameters, availableBuiltin, builtinBindingMessage, expressionFacts, functionBindingPlan,
    groupExpressions, flattenApplication, isNameExpression, declaredRanks, functionEffects,
    isReturnStatement, type LastArrayUseProof, type FunctionCallSignature, type CallRequirement,
    type CompiledFunctionType, type Expression, type FunctionBindingStatement, type FunctionStatement,
    type Program, type Statement, type ValueFacts,
} from '@arrrank/language';
import { isFlatScalarArray, arrayRevision, enterRuntime, leaveRuntime } from './array-storage.js';
import type { CheckedInputContracts } from './checked-input.js';
import type { BindingEnvironment } from './binding-environment.js';
import type { CompiledBlock } from './block-compiler.js';
import { ReturnSignal, TailCallSignal, type PreparedScalarCall, type FunctionControl } from './control-signals.js';
import type { DebugInspection } from './debug-inspection.js';
import { RankError } from './errors.js';
import { effectiveEnvironment, withEnvironment } from './environment.js';
import {
    ExecutionStack, completed, mapResult, resume, runExecution, type Evaluation, type Execution,
} from './execution.js';
import { CallSpecializations } from './call-specializations.js';
import { LocalFrame } from './frame.js';
import { FunctionFrames } from './function-frame.js';
import type { InterpreterOptions } from './interpreter-options.js';
import { checkpoint, inspectionEnabled, privateLoopPolling } from './interrupt.js';
import { BuiltinRegistry } from './modules/builtins.js';
import { prepareFunction } from './prepared-function.js';
import type { ResourceOwnership } from './resource-ownership.js';
import { ReturnContract } from './return-contract.js';
import { compiledArgumentType, compiledScalarType } from './compiled-argument-type.js';
import { scalarCaptureKey, type ScalarCaptureTypes } from './scalar-function-proof.js';
import { compileScalarFunction } from './scalar-function-kernel.js';
import { compileMembershipFunction, type RankedMembership } from './membership-function.js';
import { compileDistinctFunction } from './distinct-function.js';
import { currentDiagnostics } from './diagnostics.js';
import { prepareCompiledBuiltin } from './typed-native.js';
import { sequence } from './sequence.js';
import type { ExecutionContext } from './statement-control.js';
import {
    MISSING, isNativeFunction, isRankArray, isRankDate, isRankLabel, type NativeFunction, type RankArray,
    type RankFile, type RankSequence, type RankValue,
} from './value.js';

/** A user function as its call sites see it. `owner` tells this interpreter's functions from a module child's. */
export interface FunctionDefinition {
    readonly specialization: (arguments_: RankValue[]) => ReturnContract;
    readonly bindParameters: (arguments_: RankValue[]) => RankValue[];
    readonly owner: FunctionInvocation;
    readonly statement: FunctionStatement;
    readonly context: LocalFrame | undefined;
    readonly direct: (() => RankValue) | undefined;
}

/** What defining and running a function body needs from execution and the fast-path owner. */
export interface FunctionHost {
    resolve(name: string): RankValue;
    evaluateReturn(expression: Expression): Evaluation<RankValue>;
    apply(fn: NativeFunction, arguments_: RankValue[]): Evaluation<RankValue>;
    readonly inputs?: Pick<CheckedInputContracts, 'pending' | 'call' | 'tail'>;
    /** A synchronous closure for an expression that cannot call Rank code, when one exists. */
    compileDirect(expression: Expression): (() => RankValue) | undefined;
    /** A compiled body for these argument types, when the block compiler accepts it. */
    compiled(statement: FunctionStatement, arguments_: RankValue[]): CompiledBlock<ExecutionContext> | undefined;
    /** Runs statements as a function body, or as a generator body that may yield. */
    execute(statements: Statement[], generator: boolean, control?: FunctionControl): Evaluation<RankValue | undefined>;
    locate(error: unknown, node: AstNode): unknown;
    /** A proven scalar body that the selected argument types may enter directly, when that path is enabled. */
    scalarEntry(statement: FunctionStatement, generator: boolean, types?: readonly CompiledFunctionType[], captures?: ScalarCaptureTypes): { readonly locals: readonly string[]; readonly loops: true } | undefined;
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
    private control: FunctionControl<FunctionDefinition> | undefined;
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

    /** Transfer to this interpreter's active call; protected/compiled paths still unwind. */
    transferTailCall(fn: NativeFunction, arguments_: RankValue[]): boolean {
        const definition = functionDefinitions.get(fn);
        if (definition?.owner !== this) return false;
        const bound = definition.bindParameters(arguments_);
        const transfer = new TailCallSignal(definition, bound, undefined, this.host.inputs?.pending);
        if (!this.control) throw transfer;
        this.control.returned = true;
        this.control.tail = transfer;
        return true;
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
        const snapshot = (): NativeFunction => {
            const operations = plain ? this.bindings.withFrame(context, () => stages!.map(stage => {
                const head = stage[0];
                if (!isNameExpression(head)) throw new RankError('Pipeline stage must name a function');
                const operation = resolve(head.name);
                if (!isNativeFunction(operation)) throw new RankError('Pipeline stage must be a function', 'TypeError');
                return operation.snapshot?.() ?? operation;
            })) : [...alternatives.values()].map(operation => operation.snapshot?.() ?? operation);
            const frozen: NativeFunction = {
                ...fn,
                snapshot: () => frozen,
                lazySafe: () => operations.every(isPureLazyFunction),
                call: args => {
                    if (plain) {
                        let operands = args;
                        for (const operation of operations) operands = [runExecution(this.host.apply(operation, operands))];
                        return operands[0];
                    }
                    const selected = operations.find(operation => operation.arities.includes(args.length));
                    if (!selected) throw new RankError(`${statement.name} does not accept ${args.length} arguments`);
                    return selected.call(args);
                },
            };
            return frozen;
        };
        const bound = { ...fn, snapshot, lazySafe: () => isPureLazyFunction(snapshot()) };
        this.bindings.assign(statement.name, bound);
        return bound;
    }

    /** Clone each referenced declaration into its own frozen lexical environment.
     * Separate frames preserve distinct bindings with the same spelling. */
    snapshot(fn: NativeFunction, seen = new Map<NativeFunction, NativeFunction>()): NativeFunction {
        if (frozenFunctions.has(fn)) return fn;
        const previous = seen.get(fn);
        if (previous) return previous;
        const declaration = functionDeclarations.get(fn);
        if (!declaration) return fn.snapshot?.() ?? fn;
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

    private lazySafe(fn: NativeFunction, seen = new Set<NativeFunction>(), checkParameters = true): boolean {
        if (seen.has(fn)) return true;
        const builtin = BuiltinRegistry.operationOf(fn);
        if (builtin) return !builtin.effects?.length && (fn.lazySafe?.() ?? true);
        const declaration = functionDeclarations.get(fn);
        if (!declaration) return fn.lazySafe?.() ?? false;
        if (declaration.owner !== this) return declaration.owner.lazySafe(fn, seen, checkParameters);
        seen.add(fn);
        const { statement, context } = declaration;
        if (lazyFunctionFailure(statement, undefined, checkParameters)) return false;
        for (const name of lazyBuiltinDependencies(statement)) {
            const value = this.bindings.withFrame(context, () => this.host.resolve(name));
            if (isNativeFunction(value) && BuiltinRegistry.operationOf(value)
                && value.lazySafe && !value.lazySafe()) return false;
        }
        const scope = functionScope(statement)!;
        for (const binding of new Set([...scope.reads.values(), ...scope.captures])) {
            if (binding.scope.owner === statement) continue;
            const value = this.bindings.withFrame(context, () => this.host.resolve(binding.name));
            if (isNativeFunction(value) && !this.lazySafe(value, seen, false)) return false;
        }
        return true;
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
        const returnExpression = only && isReturnStatement(only) ? only.value : undefined;
        const compiled = !inspectionEnabled() && returnExpression
            ? this.host.compileDirect(returnExpression) : undefined;
        const direct = compiled ? () => {
            try { return runExecution(this.host.evaluateReturn(returnExpression!)); }
            catch (error) { throw this.host.locate(error, only!); }
        } : undefined;
        const { specialization, returnRanks } = functionReturnSpecializations(statement.name);
        const selectScalar = this.scalarEntrySelector(statement, context, generator, signature.arity);
        const membership = !generator && !statement.memo ? compileMembershipFunction(statement) : undefined;
        const distinct = !generator && !statement.memo ? compileDistinctFunction(statement) : undefined;
        const arrayFunction = membership ?? distinct;
        const body = (arguments_: RankValue[]): Evaluation<RankValue> => {
            if (this.frames.hasTransfers(arguments_)) return this.callFunction(statement, arguments_, context);
            const fused = arrayFunction && this.tryArrayFunction(statement, arguments_, context, arrayFunction, distinct);
            if (fused) return fused;
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
        const { executeBound, memoMiss, cachedMemoValue } = memoizedFunctionBody(statement.memo, signature.arity, checkedBody);
        const bindArguments = functionArgumentBinder(statement.name, signature, value => this.host.compileDirect(value));
        const bindParameters = (arguments_: RankValue[]): RankValue[] => materializeArguments(
            signature.parameters, bindArguments(arguments_),
        );
        const execute = (arguments_: RankValue[], inputRequirement?: CallRequirement): Evaluation<RankValue> =>
            executeBound(bindParameters(arguments_), inputRequirement);
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
            lazySafe: () => this.lazySafe(fn),
            // What a caller outside the runtime reaches. A Rank call made from a
            // Rank body takes a shorter path, so the stretch this opens is the
            // work our embedder asked for; readers over storage we cannot track
            // keep their cells for exactly that long. See enterRuntime.
            call: arguments_ => {
                enterRuntime(this.bindings);
                try {
                    if (generator && !frozenFunctions.has(fn)) {
                        const frozen = this.snapshot(fn);
                        if (frozen !== fn) return frozen.call(arguments_);
                    }
                    return generator
                        ? this.callGeneratorFunction(statement, bindParameters(arguments_), context)
                        : runExecution(execute(arguments_));
                } finally { leaveRuntime(); }
            },
        };
        this.sources.set(fn, statement);
        functionDeclarations.set(fn, { owner: this, statement, context });
        if (membership) this.registerRankedMembership(fn, membership, context);
        if (!generator) {
            functionExecutions.set(fn, execute);
            // A memo call must return through its cache writer. Do not bypass it
            // via the tail-call path that enters an ordinary function body.
            if (!statement.memo) functionDefinitions.set(fn, { owner: this, statement, context, direct, specialization, bindParameters });
            // Hits already passed the return contract. Misses retain the same
            // execution stack, validation and cache writer as ordinary calls.
            if (memoMiss && this.options().scalarFunctionCompilation !== false
                && this.options().scalarEntryCompilation !== false) scalarCallbacks.set(fn, arguments_ => {
                const key = memoCallKey(arguments_, signature.arity);
                const cached = cachedMemoValue!(key);
                if (cached !== undefined) return cached;
                enterRuntime(this.bindings);
                try { return runExecution(memoMiss(arguments_, key)); }
                finally { leaveRuntime(); }
            });
            if (!statement.memo && this.options().scalarFunctionCompilation !== false
                && this.options().scalarEntryCompilation !== false) scalarCallbacks.set(fn, arguments_ => {
                // The caller already read the operands. A declined guard uses
                // those same values and keeps memo/generator paths untouched.
                const selected = selectScalar(arguments_);
                if (!selected) return fn.call(arguments_);
                enterRuntime(this.bindings);
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

    /** Enters a synthesized array function only while its bindings and modules still match. */
    private tryArrayFunction(statement: FunctionStatement, arguments_: RankValue[], context: LocalFrame | undefined,
        arrayFunction: ReturnType<typeof compileMembershipFunction> | ReturnType<typeof compileDistinctFunction>,
        distinct: ReturnType<typeof compileDistinctFunction>): Evaluation<RankValue> | undefined {
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
        return undefined;
    }

    private registerRankedMembership(fn: NativeFunction, membership: NonNullable<ReturnType<typeof compileMembershipFunction>>, context: LocalFrame | undefined): void {
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

    /** Capture only scalar domains; cached proofs never retain their values. */
    scalarCaptureTypes(statement: FunctionStatement, context?: LocalFrame): ScalarCaptureTypes {
        const types = new Map<string, NonNullable<ReturnType<typeof compiledScalarType>>>();
        for (const capture of functionScope(statement)?.captures ?? []) {
            const type = compiledScalarType(context?.lookup(capture.name) ?? this.bindings.globals.get(capture.name));
            if (type) types.set(capture.name, type);
        }
        return types;
    }

    /** Selects per-argument scalar entries without retaining invocation frames. */
    private scalarEntrySelector(statement: FunctionStatement, context: LocalFrame | undefined, generator: boolean, arity: number) {
        if (!functionScope(statement)?.captures.size) return this.scalarEntryForCaptures(statement, context, generator, arity, new Map());
        const variants = new Map<string, (arguments_: RankValue[]) => PreparedScalarCall | undefined>();
        return (arguments_: RankValue[]) => {
            const captures = this.scalarCaptureTypes(statement, context), key = scalarCaptureKey(captures);
            let entry = variants.get(key);
            if (!entry) {
                if (variants.size >= 8) return undefined;
                entry = this.scalarEntryForCaptures(statement, context, generator, arity, captures);
                variants.set(key, entry);
            }
            return entry(arguments_);
        };
    }

    private scalarEntryForCaptures(statement: FunctionStatement, context: LocalFrame | undefined, generator: boolean,
        arity: number, captures: ScalarCaptureTypes) {
        const proof = this.host.scalarEntry(statement, generator, undefined, captures);
        const scalar = proof ? this.prepareScalarCall(statement, context, undefined, proof.loops, captures) : undefined;
        const typedEntries = new CallSpecializations<{
            readonly locals: readonly string[]; readonly call: PreparedScalarCall;
        } | null>();
        return (arguments_: RankValue[]): PreparedScalarCall | undefined => {
            if (inspectionEnabled() || arguments_.length !== arity) return undefined;
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
                    const typedProof = this.host.scalarEntry(statement, generator, types, captures);
                    const typedCall = typedProof ? this.prepareScalarCall(statement, context, types, typedProof.loops, captures) : undefined;
                    entry = typedCall ? { locals: typedProof!.locals, call: typedCall } : null;
                    typedEntries.set(arguments_, entry);
                }
                call = entry?.call;
                locals = entry?.locals;
            }
            return call && !locals!.some(name => context?.find(name))
                && (!call.available || call.available()) ? call : undefined;
        };
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
    prepareScalarCall(statement: FunctionStatement, context?: LocalFrame, types?: readonly CompiledCalleeType[], loops = false, capturedTypes?: ScalarCaptureTypes): PreparedScalarCall | undefined {
        if (this.options().scalarFunctionCompilation === false) return undefined;
        let cache = context ? this.localScalarCalls.get(context) : this.globalScalarCalls;
        if (!cache) this.localScalarCalls.set(context!, cache = new WeakMap());
        let instances = cache.get(statement);
        if (!instances) cache.set(statement, instances = new Map());
        const scalarTypes = capturedTypes ?? this.scalarCaptureTypes(statement, context);
        const key = `${loops ? 'loops:' : ''}${types?.map(compiledCalleeTypeKey).join(',') ?? ''}|${scalarCaptureKey(scalarTypes)}`;
        const cached = instances.get(key);
        if (cached) return cached;
        const kernel = compileScalarFunction(statement, types, loops, scalarTypes);
        if (!kernel || kernel.userCalls.length && this.options().scalarCallCompilation === false
            || kernel.memberships.length && this.options().sequenceMembershipCompilation === false
            || kernel.userCalls.some(call => call.tail) && this.options().compiledScalarTailCalls === false) return undefined;
        const resolve = (name: string) => context?.lookup(name) ?? this.bindings.globals.get(name) ?? this.builtins.lookup(name);
        const userBinders = kernel.userCalls.map(call => () => {
            const value = resolve(call.name);
            const definition = value && isNativeFunction(value) ? this.definitionOf(value) : undefined;
            if (!definition || definition.statement !== call.statement
                || call.locals.some(name => definition.context?.find(name))) return undefined;
            const compiled = definition.owner.prepareScalarCall(call.statement, definition.context, call.types, true);
            if (!compiled || compiled.available && !compiled.available()) return undefined;
            return (arguments_: RankValue[], tail = false) => {
                if (tail && definition.owner === this) throw new TailCallSignal(definition, arguments_, compiled);
                return compiled(arguments_);
            };
        });
        const users: ((arguments_: RankValue[], tail?: boolean) => RankValue)[] = [];
        const memberships: ((value: bigint) => boolean)[] = [];
        const captures: ((indices: bigint[]) => bigint)[] = [];
        const scalars = kernel.scalarCaptures.map(({ name }) => () => resolve(name)!);
        const captureReaders: ReturnType<typeof capturedIntegerReader>[] = [];
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
                return kernel.run(arguments_, locate, calls, users, memberships, captures, scalars);
            } catch (error) {
                // A scalar tail callee replaces this logical frame. Errors from
                // it must not acquire the discarded caller's stack entry.
                if (error instanceof TailCallSignal && error.compiled) return error.compiled(error.arguments_, true);
                if (error instanceof RankError) this.frames.addCall(error, statement, arguments_);
                throw error;
            } finally { if (!tail) this.depth -= 1; }
        };
        if (kernel.scalarCaptures.length || binders.length || userBinders.length || kernel.memberships.length || kernel.captures.length || kernel.guards.length || kernel.modules.length) Object.defineProperty(run, 'available', { value: () => {
            if (inspectionEnabled()) return false;
            if (kernel.scalarCaptures.length && (!privateLoopPolling()
                || kernel.scalarCaptures.some(({ name, type }) => compiledScalarType(resolve(name)) !== type))) return false;
            if (kernel.modules.some(module => !this.modules.has(module))) return false;
            for (let index = 0; index < userBinders.length; index++) {
                const bound = userBinders[index]();
                if (!bound) return false;
                users[index] = bound;
            }
            for (let index = 0; index < kernel.memberships.length; index++) {
                const name = kernel.memberships[index], value = resolve(name);
                const contains = compiledIntegerMembership(value);
                if (!contains) return false;
                // Captured array bindings may receive a COW replacement inside
                // a linked caller. Resolve them at the actual expression, not entry.
                memberships[index] = value && isRankArray(value)
                    ? integer => membershipLookup(resolve(name) as RankArray)(integer) : contains;
            }
            for (let index = 0; index < kernel.captures.length; index++) {
                const { name, rank } = kernel.captures[index];
                const reader = captureReaders[index]?.current()
                    ? captureReaders[index] : capturedIntegerReader(() => resolve(name), rank);
                if (!reader) return false;
                captureReaders[index] = reader;
                captures[index] = reader.read;
            }
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
        const callerControl = this.control;
        const control: FunctionControl<FunctionDefinition> | undefined = this.options().directFunctionControl !== false ? {} : undefined;
        this.control = control;
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
                let transfer: TailCallSignal<FunctionDefinition> | undefined;
                if (control) { control.returned = false; control.value = undefined; control.tail = undefined; }
                try {
                    this.bindings.current = frame;
                    if (inspectionEnabled()) this.inspection.replace(statement.name, frame);
                    for (const local of prepareFunction(statement).locals) this.define(local);
                    const body = this.host.compiled(statement, arguments_);
                    if (body) {
                        const value = yield* resume(body({ assertBooleanExpressions: false, insideLoop: false,
                            insideFinally: false, insideGenerator: false, functionControl: control }));
                        if (!control?.returned) { result = value; break; }
                    } else {
                        yield* resume(this.host.execute(statement.statements, false, control));
                        if (!control?.returned) throw new RankError(`function ${statement.name} reached end without return`);
                    }
                    if (!control?.tail) { result = control?.value; break; }
                    transfer = control.tail;
                } catch (error) {
                    if (error instanceof TailCallSignal) transfer = error;
                    else {
                        if (error instanceof ReturnSignal && error.value !== undefined) result = error.value;
                        else pending = error;
                        break;
                    }
                }
                if (transfer) {
                    this.host.inputs?.tail(transfer.definition.statement, transfer.inputRequirement);
                    tailContracts.add(transfer.definition.specialization(transfer.arguments_));
                    if (transfer.compiled && (!transfer.compiled.available || transfer.compiled.available())) {
                        compiledTail = true;
                        // Keep the tail driver's logical depth and resource scope;
                        // this proven scalar body needs no new lexical frame.
                        try { result = transfer.compiled(transfer.arguments_, true); }
                        catch (error) { pending = error; }
                        break;
                    }
                    const reusable = statement === transfer.definition.statement
                        && frame.parent === transfer.definition.context ? frame : undefined;
                    statement = transfer.definition.statement;
                    arguments_ = transfer.arguments_;
                    frame = this.frames.create(statement, transfer.arguments_, transfer.definition.context, reusable);
                    if (transfer.definition.direct) {
                        this.bindings.current = frame;
                        try {
                            result = transfer.definition.direct();
                        } catch (error) {
                            pending = error;
                        }
                        break;
                    }
                    continue;
                }
            }
        } finally {
            this.depth -= 1;
            this.bindings.current = caller;
            this.control = callerControl;
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
        enterRuntime(this.bindings);
        const callerControl = this.control;
        this.control = undefined;
        this.resources.pushScope(resources);
        try {
            return this.bindings.withFrame(frame, operation);
        } finally {
            this.resources.popScope();
            this.control = callerControl;
            leaveRuntime();
        }
    }

    private singlePass(plan: RankSequence['plan']): RankSequence {
        const source = sequence({ ...plan, singlePass: true });
        return this.options().wrapSinglePassSequence?.(source) ?? source;
    }
}
