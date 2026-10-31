import { selectValues } from './value-selection.js';
import { sumCounterTensor } from './collections.js';
import type { LoopHost, LoopContinuation, LoopCallable } from './jit/integer-loop-plan.js';
import { prepareEffectCall } from './effect-call.js';
import { isCompiledContainer, type CompiledCalleeType } from './jit/compiled-callee-type.js';
import type { CompiledCallee } from './jit/compiled-callee.js';
import type { AstNode } from 'langium';
import {
    findOperation, isBinaryExpression, isNameExpression, isUnaryExpression, isForStatement, isFunctionStatement,
    type ApplicationForm, type Operation, isAssignmentStatement,
    isReturnStatement, type Expression, type ForStatement, type FunctionStatement, type Statement,
} from '@arrrank/language';
import { compileBlock, type CompiledBlock } from './jit/block-compiler.js';
import { TailCallSignal } from './control-signals.js';
import { registerFlatCombine } from './flat-combine.js';
import { compileFusedReduction, compileFusedSum } from './jit/fused-reduction.js';
import type { Operators } from './operators.js';
import { compileScalarExpression, compileResumableScalarExpression } from './jit/scalar-compiler.js';
import { scalarFunctionResult, type ScalarCaptureTypes } from './jit/scalar-function-proof.js';
import { currentDiagnostics } from './diagnostics.js';
import { completed, runExecution, type Evaluation, type Execution } from './execution.js';
import { CallSpecializations } from './jit/call-specializations.js';
import type { ExecutionContext, PreparedStatement, TensorStep } from './statement-control.js';
import { compileTensorKernel, compileTensorReduction, type TensorCodeCache, type TensorKernelHost } from './jit/tensor-kernel.js';
import { hasNativeImplementation } from './native-implementation.js';
import { tensorPlanScope } from './jit/tensor-map.js';
import type { BindingEnvironment } from './binding-environment.js';
import { recordFallback } from './diagnostics.js';
import { checkedArrayDimension } from './eval/expressions.js';
import { forIteration, iterationAtoms, declareIterationTypes, type ForBinding } from './eval/loops.js';
import type { FunctionInvocation } from './function-invocation.js';
import { ReturnSignal } from './control-signals.js';
import { compileIntegerLoop, compileIntegerFunctionPrefix } from './jit/integer-loop.js';
import { resolveCompilerCapabilities, type CompilerCapabilities, type InterpreterOptions } from './interpreter-options.js';
import type { BuiltinRegistry } from './modules/builtins.js';
import { copyArray } from './modules/sequences.js';
import { ALL_AXIS, atArray, sliceArray, scalarArrayWriteOffset, tensorSelection } from './selectors.js';
import { preparePositionalBuiltin } from './jit/typed-native.js';
import { textAt } from './text-storage.js';
import { isRankArray, isRankCounter, isNativeFunction, type NativeFunction, type RankArray, type RankValue } from './value.js';
import type { ReductionEvaluator } from './reduction.js';

export type CompiledLoop = NonNullable<ReturnType<typeof compileIntegerLoop>>;

/** What choosing and running specialized paths needs. */
export interface FastPathContext {
    readonly bindings: BindingEnvironment;
    readonly modules: ReadonlySet<string>;
    readonly builtins: BuiltinRegistry;
    readonly functions: FunctionInvocation;
    checkMutation(statement: Statement): void;
    resolve(name: string): RankValue;
    compileAssign(name: string): (value: RankValue) => void;
    locate(error: unknown, node: AstNode): unknown;
    options(): InterpreterOptions;
    compiler?(): CompilerCapabilities;
    evaluate(expression: Expression): Evaluation<RankValue>;
    evaluateReturn(expression: Expression, tail?: boolean): Evaluation<RankValue>;
    compileDirect(expression: Expression): (() => RankValue) | undefined;
    /** Builtin identity a name is bound to, or false for a user value. */
    operationOf(name: string): Operation | undefined | false;
    readonly operators: Operators;
    readonly reductions: ReductionEvaluator;
}

/** The reference evaluation an application fast path falls back to. */
export interface ApplicationReference {
    reduce(operator: string, value: RankValue): RankValue;
    apply(values: RankValue[]): Evaluation<RankValue>;
}

/** How a compiled block reaches statement preparation and resumes after a suspension. */
export interface BlockSteps {
    preparedStatement(statements: Statement[], index: number): PreparedStatement;
    continueCompiledBlock(
        statements: Statement[], index: number, task: Execution<RankValue | undefined>,
        context: ExecutionContext, block: CompiledBlock<ExecutionContext>,
    ): Execution<RankValue | undefined>;
}

/**
 * Every place the runtime trades the reference path for a specialized one.
 * Each path is chosen once per syntax node from its form, guards its entry
 * against the values it meets, and falls back to the reference path when a
 * guard fails. Options can disable each path; inspection disables them all.
 */
export class FastPaths {
    private readonly tensorPlanCode = new WeakMap<Expression, TensorCodeCache>();
    private readonly blocks = new WeakMap<Statement[], CompiledBlock<ExecutionContext> | null>();
    private readonly functionBodies = new WeakMap<FunctionStatement, CallSpecializations<CompiledBlock<ExecutionContext> | null>>();

    constructor(private readonly context: FastPathContext) {}

    private get compiler(): CompilerCapabilities {
        return this.context.compiler ? this.context.compiler() : resolveCompilerCapabilities(this.context.options());
    }

    /** A block of 2 to 64 statements compiled to one closure that steps through them. */
    block(statements: Statement[], steps: BlockSteps): CompiledBlock<ExecutionContext> | undefined {
        if (this.compiler.blocks.blocks && statements.length >= 2 && statements.length <= 64) {
            let block = this.blocks.get(statements);
            if (block === undefined) {
                block = compileBlock<ExecutionContext>(statements.length, {
                    prepare: index => steps.preparedStatement(statements, index),
                    locate: (error, index) => this.context.locate(error, statements[index]),
                    pause: (index, task, context, compiled) => steps.continueCompiledBlock(
                        statements, index, task, context, compiled),
                    compiled: this.compiler.hooks.onBlockCompiled,
                    executed: this.compiler.hooks.onBlockExecuted,
                }) ?? null;
                this.blocks.set(statements, block);
            }
            return block ?? undefined;
        }
        return undefined;
    }

    /** A function body ending in `return` compiled per argument signature, its return a terminal step. */
    functionBody(
        statement: FunctionStatement, arguments_: RankValue[], steps: BlockSteps,
    ): CompiledBlock<ExecutionContext> | undefined {
        if (!this.compiler.functions.bodies) return undefined;
        let instances = this.functionBodies.get(statement);
        if (!instances) this.functionBodies.set(statement, instances = new CallSpecializations());
        let body = instances.get(arguments_);
        if (body === undefined) {
            const commands = statement.statements;
            const last = commands.at(-1);
            body = last && isReturnStatement(last) && last.value ? compileBlock<ExecutionContext>(commands.length, {
                prepare: index => {
                    if (index !== commands.length - 1) return steps.preparedStatement(commands, index);
                    const tensor = steps.preparedStatement(commands, index).tensor;
                    const direct = this.context.compileDirect(last.value!);
                    if (direct) return { run: () => {
                        this.context.checkMutation(last);
                        return runExecution(this.context.evaluateReturn(last.value!));
                    }, tensor };
                    const value = () => {
                        this.context.checkMutation(last);
                        return this.context.evaluateReturn(last.value!, true);
                    };
                    return { stream: value, tensor };
                },
                locate: (error, index) => this.context.locate(error, commands[index]),
                pause: (index, task, context, compiled) => steps.continueCompiledBlock(commands, index, task, context, compiled),
                compiled: this.compiler.hooks.onFunctionBodyCompiled,
                executed: this.compiler.hooks.onFunctionBodyExecuted,
            }) ?? null : null;
            // A single outer loop can contain all the work (including nested
            // loops). Join its fresh allocations too: compiling it separately
            // would treat the local arrays as external speculative copies.
            if (body && commands.slice(0, -1).some(isForStatement)) {
                const prefix = this.compileLoop(statement, undefined);
                if (prefix) {
                    const ordinary = body;
                    body = (context, index = 0, previous) => {
                        if (index === 0 && !context.insideFinally && !context.insideGenerator) {
                            const result = prefix.run();
                            if (result) return ordinary(context, commands.length - 1, runExecution(result));
                        }
                        return ordinary(context, index, previous);
                    };
                }
            }
            instances.set(arguments_, body);
        }
        return body ?? undefined;
    }

    private tensorHost(): TensorKernelHost {
        return {
            textDigits: this.compiler.tensors.textDigits,
            lookup: name => this.context.bindings.find(name),
            compiled: this.compiler.hooks.onTensorKernelCompiled,
            builtin: name => {
                const module = findOperation(name)?.module;
                if (module === undefined || !this.context.modules.has(module)) return false;
                const value = this.context.resolve(name);
                return isNativeFunction(value) && hasNativeImplementation(value)
                    && this.context.builtins.is(module, name, value);
            },
        };
    }

    private tensorExecuted(): void {
        this.compiler.hooks.onTensorKernelExecuted?.();
        const diagnostics = currentDiagnostics();
        if (diagnostics) diagnostics.compiledTensors++;
    }

    /** Called at the ordinary postfix gather, before resolving its consumer.
     * Unsupported readers must finish gathering before user reducer dispatch. */
    counterSum(receiver: RankValue, keys: RankValue): bigint | undefined {
        if (!this.compiler.tensors.fusion || !isRankCounter(receiver)) return undefined;
        const identity = this.context.operationOf('sum');
        if (!identity || identity.module !== 'core' || identity.name !== 'sum') return undefined;
        const fn = this.context.resolve('sum');
        if (!isNativeFunction(fn) || !this.context.builtins.is('core', 'sum', fn)
            || !Object.getOwnPropertyDescriptor(fn, 'call')?.value || !hasNativeImplementation(fn)) return undefined;
        return sumCounterTensor(receiver, keys);
    }

    planReduction(expression: Expression): (() => RankValue | undefined) | undefined {
        if (!this.compiler.tensors.fusion) return undefined;
        const kernel = compileTensorReduction(expression, this.tensorHost());
        if (!kernel) return undefined;
        return () => {
            // Inspection can disable compilation after the plan was captured.
            if (!this.compiler.tensors.fusion) return undefined;
            const value = kernel.run();
            if (value !== undefined) this.tensorExecuted();
            return value;
        };
    }

    tensorPlanScope(expression: Expression): <T>(run: () => T) => T {
        let code = this.tensorPlanCode.get(expression);
        if (!code) this.tensorPlanCode.set(expression, code = new Map());
        return tensorPlanScope(this.tensorHost(), () => this.compiler.tensors.fusion,
            () => this.tensorExecuted(), code);
    }

    tensorStatement(statement: Statement): TensorStep | undefined {
        if (!isAssignmentStatement(statement) && !isReturnStatement(statement)) return undefined;
        const kernel = compileTensorKernel(statement, this.tensorHost());
        if (!kernel) return undefined;
        const assign = isAssignmentStatement(statement) ? this.context.compileAssign(statement.name) : undefined;
        return { run: () => {
            if (!assign && !this.context.bindings.insideFunction) return undefined;
            this.context.checkMutation(statement);
            const value = kernel.run();
            if (value === undefined) return undefined;
            try { assign?.(value); }
            catch (error) { throw this.context.locate(error, statement); }
            this.tensorExecuted();
            if (!assign) throw new ReturnSignal(value);
            return value;
        } };
    }

    /** A numeric loop compiled to straight-line code over local registers. */
    compileLoop(statement: ForStatement | FunctionStatement, binding: ForBinding | undefined, continuation?: LoopContinuation): CompiledLoop | undefined {
        const compile = (host: LoopHost) => isFunctionStatement(statement)
            ? compileIntegerFunctionPrefix(statement, host) : compileIntegerLoop(statement, host, binding);
        const { loops, tensors, scalars, hooks } = this.compiler;
        const compiled = loops.integer ? compile({
            continuation,
            observableEntry: hooks.onIntegerLoopExecuted !== undefined,
            canDeferWrites: bindings => loops.number && this.context.bindings.canDeferWrites(bindings),
            tensorReadHoisting: tensors.readHoisting,
            read: name => {
                const value = this.context.bindings.find(name);
                if (value !== undefined) return value;
                // Collection values live in the builtin registry, not among
                // variable bindings. Only callback-free, effect-free integer
                // sequences may be inspected here; entry rechecks the name.
                const operation = findOperation(name);
                if (operation?.result !== 'sequence' || operation.arities.length
                    || operation.valueElements !== 'integer' || !operation.valueCallbackFree
                    || operation.effects?.length || !this.context.modules.has(operation.module)) return undefined;
                return this.context.builtins.lookup(name);
            },
            writer: name => this.context.compileAssign(name),
            prepareWriter: loops.boundWrites ? (name, checked) => {
                let direct: ((value: RankValue) => void) | undefined;
                return value => {
                    if (direct) { direct(value); return; }
                    checked(value);
                    const frame = this.context.bindings.current?.find(name);
                    direct = frame ? frame.bindStore(name) : next => {
                        if (isRankArray(next)) this.context.bindings.globals.set(name, next);
                        else this.context.bindings.globals.values.set(name, next);
                    };
                };
            } : undefined,
            textLoops: loops.text,
            textArrayLoops: loops.textArrays,
            nestedLoops: loops.nested,
            arrayRead: atArray,
            copySlice: (source, start, end, axis, inclusive, view) => {
                const selectors: RankValue[] = Array(axis).fill(ALL_AXIS);
                selectors.push(this.context.operators.evaluateBinary(inclusive ? 'to' : 'till', start, end));
                // Stores in this region already borrowed their destination storage.
                // A new snapshot must own its cells rather than rely on later COW.
                const selected = sliceArray(source, tensorSelection(source, selectors));
                // A bulk slice write snapshots its operand itself, so it takes the view.
                return view && isRankArray(selected) ? selected : copyArray(selected, false);
            },
            arrayValues: {
                range: (start, end, inclusive, step) => this.context.operators.evaluateBinary(inclusive ? 'to' : 'till', start, end, step),
                select: (source, selector) => copyArray(selectValues(this.context.modules, [source, selector]), false),
                copy: source => copyArray(source, false),
                binary: (operator, left, right) => this.context.operators.evaluateBinary(operator, left, right),
                reduceAxis: (operation, source, axes) => copyArray(
                    this.context.reductions.evaluateAxisReduction(operation, source, axes) as RankArray, false),
            },
            textRead: textAt,
            returns: loops.returns,
            yields: loops.yields,
            canReturn: () => this.context.bindings.insideFunction,
            returnValue: value => { throw new ReturnSignal(value); },
            arrayLocals: loops.arrayLocals,
            dimension: checkedArrayDimension,
            booleanArrays: loops.booleanArrays,
            booleanLocals: loops.booleans,
            scalarText: scalars.text,
            evaluate: expression => runExecution(this.context.evaluate(expression)),
            callout: expression => () => runExecution(this.context.evaluate(expression)),
            nativeCalls: loops.nativeCalls,
            prepareBuiltinCall: (module, name, types, numberMode) => preparePositionalBuiltin(this.context, module, name, types, numberMode),
            prepareEffectCall: (name, receiver, types) => prepareEffectCall({
                read: name => this.context.bindings.find(name), module: name => this.context.modules.has(name),
            }, name, receiver, types),
            scalarFunction: (name, arity) => this.scalarCall(name, arity),
            sequenceMembership: scalars.sequenceMembership,
            absolute: loops.absolute,
            reals: loops.reals,
            extrema: loops.extrema,
            compoundWrites: loops.compoundWrites,
            arrayIteration: loops.arrayIteration,
            declareIteration: (binding, source) => declareIterationTypes(this.context.bindings, binding, source, 'integer'),
            // The region guards cell types before entry and preserves them.
            iterationValues: (binding, source, elementType = 'integer') => iterationAtoms(this.context.bindings, binding, source,
                loops.provenTypes ? elementType : undefined,
                loops.directTextIteration),
            arrayWrites: loops.arrayWrites,
            inlineWriteOffsets: loops.scalarAddress,
            arrayOffset: loops.scalarAddress
                ? scalarArrayWriteOffset
                : (source, indices) => tensorSelection(source, indices).offsetAt(0),
            arrayReads: loops.arrays,
            iteration: forIteration,
            module: name => this.context.modules.has(name),
            builtin: (module, name) => {
                if (!this.context.modules.has(module)) return false;
                try { return this.context.builtins.is(module, name, this.context.resolve(name)); }
                catch { return false; }
            },
            locate: (error, command) => this.context.locate(error, command),
            compiled: hooks.onIntegerLoopCompiled,
            executed: hooks.onIntegerLoopExecuted,
        }) : undefined;
        if (!loops.integer) recordFallback('loop:disabled');
        return compiled && { run: (...context) => {
            this.context.checkMutation(statement);
            return compiled.run(...context);
        } };
    }

    /** A binary or unary expression over direct leaves compiled to one closure. */
    scalarExpression(
        expression: Expression, leaf: (expression: Expression) => (() => RankValue) | undefined,
    ): (() => RankValue) | undefined {
        if (!this.compiler.scalars.expressions
            || !(isBinaryExpression(expression) || isUnaryExpression(expression))) return undefined;
        return compileScalarExpression(expression, {
            leaf,
            binary: (op, left, right) => {
                if (currentDiagnostics()) recordFallback(`scalar-expression:operator-guard:${op}`);
                return this.context.operators.evaluateBinary(op, left, right);
            },
            unary: (op, value) => {
                if (currentDiagnostics()) recordFallback(`scalar-expression:operator-guard:${op}`);
                return this.context.operators.evaluateUnary(op, value);
            },
            compiled: this.compiler.hooks.onScalarCompiled,
            executed: this.compiler.hooks.onScalarExecuted,
        });
    }

    /** Arithmetic around effectful or suspended children, without replaying them. */
    scalarEvaluation(expression: Expression, leaf: (expression: Expression) => () => Evaluation<RankValue>): (() => Evaluation<RankValue>) | undefined {
        if (!this.compiler.scalars.expressions
            || !(isBinaryExpression(expression) || isUnaryExpression(expression))) return undefined;
        return compileResumableScalarExpression(expression, {
            leaf,
            binary: (op, left, right) => {
                if (currentDiagnostics()) recordFallback(`scalar-expression:operator-guard:${op}`);
                return this.context.operators.evaluateBinary(op, left, right);
            },
            unary: (op, value) => {
                if (currentDiagnostics()) recordFallback(`scalar-expression:operator-guard:${op}`);
                return this.context.operators.evaluateUnary(op, value);
            },
            compiled: this.compiler.hooks.onScalarCompiled,
            executed: this.compiler.hooks.onScalarExecuted,
        });
    }

    /**
     * A specialized evaluation of a classified application, chosen by form
     * kind. An operation is recognized by the identity its name is bound to,
     * never by spelling; the caller recompiles when that identity changes.
     */
    application(
        form: ApplicationForm, parts: readonly Expression[], reference: ApplicationReference,
    ): (() => Evaluation<RankValue>) | undefined {
        let scope: (<T>(run: () => T) => T) | undefined;
        const arithmetic = {
            tensorBinary: (operator: string, a: RankValue, b: RankValue) => {
                scope ??= this.tensorPlanScope(form.kind === 'reduce' ? form.source : parts[0]);
                return scope(() => this.context.operators.evaluateBinary(operator, a, b));
            },
            compilation: () => this.compiler.tensors.fusion,
            prepareLeaf: (source: Expression) => this.context.compileDirect(source),
            binary: (operator: string, a: RankValue, b: RankValue) => this.context.operators.evaluateBinary(operator, a, b),
        };
        switch (form.kind) {
            case 'reduce': {
                // A literal rank or a seed takes the reference reduction.
                if (form.rank !== undefined || form.axes !== undefined || form.seed !== undefined) return undefined;
                const fused = compileFusedReduction(form.source, form.operator, {
                    ...arithmetic, reduce: value => reference.reduce(form.operator, value),
                });
                return fused && (() => completed(fused()));
            }
            case 'plain': {
                const operation = parts.length === 2 ? parts[1] : undefined;
                if (!operation || !isNameExpression(operation)) return undefined;
                const identity = this.context.operationOf(operation.name);
                if (!identity || identity.module !== 'core' || identity.name !== 'sum') return undefined;
                const fused = compileFusedSum(parts[0], arithmetic, (value, sum) => {
                    // A host can still bind the name to something else between runs.
                    const fn = this.context.resolve(operation.name);
                    if (isNativeFunction(fn) && hasNativeImplementation(fn) && this.context.builtins.is('core', 'sum', fn)) {
                        return completed(sum ? sum() : fn.call([value]));
                    }
                    return reference.apply([value, fn]);
                });
                return fused;
            }
            default: return undefined;
        }
    }

    /** A proven scalar body that the selected argument types may enter without a frame. */
    scalarEntry(statement: FunctionStatement, generator: boolean, types?: readonly CompiledCalleeType[], captures?: ScalarCaptureTypes): { readonly locals: readonly string[]; readonly nonnegative: readonly number[]; readonly loops: true } | undefined {
        if (!this.compiler.scalars.entries || generator) return undefined;
        const proof = scalarFunctionResult(statement, true, types, true, [], captures);
        // Entry arguments admit scalars, checked arrays and tracked integer indices/deques.
        // Container storage is integer-only, cannot escape through a scalar return,
        // and needs no resource frame. Only constructor-owned array writes can
        // enter here; writes through arguments or aliases still need a frame.
        // Array-only bodies retain the private Number loop tier. Containers
        // already require exact, publishing loops, so compile that body together.
        return proof && proof.localArrayWrites && (!proof.arrayWrites.size || proof.containers) && !proof.planReturn
            ? { locals: proof.locals, nonnegative: proof.nonnegative, loops: true } : undefined;
    }

    /** Lets flat combinators run a scalar user function without entering Rank. */
    flatCombine(
        fn: NativeFunction, statement: FunctionStatement, available: (builtins: ReadonlySet<string>) => boolean,
    ): void {
        if (this.compiler.scalars.functions) registerFlatCombine(fn, statement, available);
    }

    /**
     * A compiled loop calling `name` with proven argument types may compile the call
     * when the callee's body has a proven scalar or array result. `bind` rechecks the
     * binding at loop entry, since the name can be rebound between runs.
     */
    scalarCall(name: string, arity: number): ((types: readonly CompiledCalleeType[]) => CompiledCallee | undefined) | undefined {
        if (!this.compiler.scalars.calls) return undefined;
        const value = this.context.bindings.find(name);
        const definition = value && isNativeFunction(value) ? this.context.functions.definitionOf(value) : undefined;
        if (!definition || definition.statement.parameters.length !== arity) return undefined;
        const statement = definition.statement;
        if (statement.memo || statement.ranks.some(rank => rank !== 'all')) return undefined;
        return types => {
            const scalarTypes = definition.owner.scalarCaptureTypes(statement, definition.context);
            const proof = scalarFunctionResult(statement, this.compiler.scalars.blockCalls, types, true, [], scalarTypes);
            if (!proof || proof.planReturn || proof.nonnegative.length) return undefined;
            const captures = definition.context !== undefined;
            const isScalarType = (type: CompiledCalleeType): boolean =>
                type === 'integer' || type === 'real' || type === 'boolean' || type === 'text';
            const stableReads = typeof proof.type === 'string' && !proof.containers && !proof.arrayWrites.size;
            const numberSafe = stableReads && isScalarType(proof.type) && types.every(isScalarType);
            return {
                parameters: types,
                effects: {
                    writes: types.flatMap((type, index) => isCompiledContainer(type) ? [index] : []),
                    stableArrayReads: stableReads,
                },
                type: proof.type,
                numberSafe,
                locals: [...(captures ? proof.locals : []), ...proof.nativeReads, ...proof.dependencies],
                bind: () => {
                    const current = this.context.bindings.find(name);
                    if (!current || !isNativeFunction(current)) return undefined;
                    const active = this.context.functions.definitionOf(current);
                    if (active?.statement !== statement || (active.context !== undefined) !== captures
                        || proof.locals.some(local => active.context?.find(local))) return undefined;
                    const compiled = active.owner.prepareScalarCall(statement, active.context, types, true, scalarTypes);
                    if ((proof.nativeReads.length || proof.dependencies.length) && !compiled || compiled?.available && !compiled.available()) return undefined;
                    return ((...arguments_: RankValue[]) => {
                        if (arguments_.length === 2 && Array.isArray(arguments_[0]) && typeof arguments_[1] === 'boolean') {
                            const [args, tail] = arguments_ as unknown as [RankValue[], boolean];
                            if (tail && active.owner === this.context.functions) {
                                throw new TailCallSignal(active, args,
                                    this.compiler.scalars.tailCalls ? compiled : undefined);
                            }
                            return compiled ? (compiled.direct ? compiled.direct(...args) : compiled(args, tail)) : current.call(args);
                        }
                        return compiled?.direct ? compiled.direct(...arguments_) : compiled ? compiled(arguments_) : current.call(arguments_);
                    }) as LoopCallable;
                },
                bindNumber: numberSafe ? () => {
                    const current = this.context.bindings.find(name);
                    if (!current || !isNativeFunction(current)) return undefined;
                    const active = this.context.functions.definitionOf(current);
                    if (active?.statement !== statement || (active.context !== undefined) !== captures
                        || proof.locals.some(local => active.context?.find(local))) return undefined;
                    const compiled = active.owner.prepareScalarCall(statement, active.context, types, true, scalarTypes);
                    if ((proof.nativeReads.length || proof.dependencies.length) && !compiled || compiled?.available && !compiled.available()) return undefined;
                    if (compiled?.numberDirect) return compiled.numberDirect as unknown as LoopCallable;
                    const direct = compiled?.direct ?? ((...args: RankValue[]) => compiled ? compiled(args) : current.call(args));
                    const widen = types.map(t => t === 'integer');
                    const narrow = proof.type === 'integer' ? (v: RankValue) => typeof v === 'bigint' ? Number(v) : v : (v: RankValue) => v;
                    if (arity === 1) {
                        const w0 = widen[0];
                        return ((a: number) => narrow(direct(w0 ? BigInt(a) : a))) as unknown as LoopCallable;
                    }
                    if (arity === 2) {
                        const w0 = widen[0], w1 = widen[1];
                        return ((a: number, b: number) => narrow(direct(w0 ? BigInt(a) : a, w1 ? BigInt(b) : b))) as unknown as LoopCallable;
                    }
                    return ((...arguments_: number[]) =>
                        narrow(direct(...arguments_.map((v, i) => widen[i] ? BigInt(v) : v)))) as unknown as LoopCallable;
                } : undefined,
            };
        };
    }
}
