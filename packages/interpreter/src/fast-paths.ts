import { compileOperands, type Operand } from './jit/compiled-operands.js';
import { compileValueExpression } from './jit/value-expression.js';
import { withCompilerSource, observeCompiler, declineCompiler } from './compiler-observation.js';
import { prepareNativeIntegerSum } from './native-integer-sum.js';
import { compileRealArrayFunction, type RealArrayArgument } from './jit/real-array-function.js';
import { compileIntegerArrayFunction } from './jit/integer-array-function.js';
import { interruptsEnabled, privateLoopPolling } from './interrupt.js';
import { borrowIntegerBuffer } from './jit/borrowed-integer-buffer.js';
import { mapStoredIntegers } from './integer-array-kernel.js';
import { strictDataCall, wholeDeclaredCall } from './jit/declared-scalar-call.js';
import { selectValues } from './value-selection.js';
import { sumCounterTensor } from './collections.js';
import type { LoopHost, LoopContinuation, LoopCallable } from './jit/integer-loop-plan.js';
import { prepareEffectCall } from './effect-call.js';
import { isCompiledContainer, isCompiledArray, type CompiledCalleeType } from './jit/compiled-callee-type.js';
import type { CompiledCallee } from './jit/compiled-callee.js';
import { AstUtils, type AstNode } from 'langium';
import {
    forAxes, findOperation, isBinaryExpression, isNameExpression, isUnaryExpression, isForStatement, isFunctionStatement, isArrayAssignmentStatement,
    type ApplicationForm, type Operation, type ArrayAssignmentStatement, isAssignmentStatement,
    isRecordExpression, isRecordUpdateExpression, isTupleExpression, isUnpackStatement, isPushStatement,
    isDeclaredCallExpression, isStdinExpression, isIfStatement, isTryStatement, isReturnStatement, type Expression, type ForStatement, type FunctionStatement, type Statement,
} from '@arrrank/language';
import { compileFramedFunction, compileValueBlock } from './jit/framed-function.js';
import { compileBlock, type CompiledBlock } from './jit/block-compiler.js';
import { compileTensorRegion } from './jit/tensor-region.js';
import { compileNumericFunction } from './jit/numeric-function.js';
import { compileNumericCallLoop } from './jit/numeric-call-loop.js';
import { TailCallSignal } from './control-signals.js';
import { registerFlatCombine } from './flat-combine.js';
import { compileFusedReduction, compileFusedSum } from './jit/fused-reduction.js';
import type { Operators } from './operators.js';
import { compileScalarExpression, compileResumableScalarExpression } from './jit/scalar-compiler.js';
import { scalarFunctionResult, hasNativeCompletion, privateScalarFunction, scalarFunctionEffects, type ScalarCaptureTypes } from './jit/scalar-function-proof.js';
import { currentDiagnostics } from './diagnostics.js';
import { completed, flatMapResult, runExecution, type Evaluation, type Execution } from './execution.js';
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
import { ReturnSignal, returnFunctionValue } from './control-signals.js';
import { compileIntegerLoop, compileIntegerFunctionPrefix } from './jit/integer-loop.js';
import { resolveCompilerCapabilities, type CompilerCapabilities, type InterpreterOptions } from './interpreter-options.js';
import type { BuiltinRegistry } from './modules/builtins.js';
import { copyArray } from './modules/sequences.js';
import { ALL_AXIS, atArray, sliceArray, scalarArrayWriteOffset, tensorSelection } from './selectors.js';
import { preparePositionalBuiltin } from './jit/typed-native.js';
import { textAt } from './text-storage.js';
import { isRankArray, isRankCounter, isNativeFunction, type NativeFunction, type RankArray, type RankValue } from './value.js';
import type { ReductionEvaluator } from './reduction.js';

/** Admission hint only: these sites retain ordinary checked calls and live
 * bindings. It is never used as a purity or operand-domain proof. */
function hasCallBoundary(node: AstNode): boolean {
    if (isTryStatement(node) || isStdinExpression(node) || isDeclaredCallExpression(node)) return true;
    if (!isNameExpression(node) || !/^[a-z]/.test(node.name)) return false;
    const operation = findOperation(node.name);
    return !operation || !!operation.effects?.length;
}

export type CompiledLoop = NonNullable<ReturnType<typeof compileIntegerLoop>>;

/** What choosing and running specialized paths needs. */
export interface FastPathContext {
    readonly bindings: BindingEnvironment;
    readonly modules: ReadonlySet<string>;
    readonly builtins: BuiltinRegistry;
    readonly functions: FunctionInvocation;
    checkMutation(statement: Statement): void;
    resolve(name: string): RankValue;
    prepareArrayWrite(statement: ArrayAssignmentStatement): (selectors: RankValue[], rhs: () => RankValue) => { target: RankValue; result: RankValue | undefined };
    prepareDeferredBinding(statement: import('@arrrank/language').AssignmentStatement): () => RankValue;
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
    executeIn(statements: Statement[], context: ExecutionContext): Evaluation<RankValue | undefined>;
    preparedStatement(statements: Statement[], index: number): PreparedStatement;
    scopeStatement(statement: Statement, prepared: PreparedStatement): PreparedStatement;
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
    private readonly valueBlocks = new WeakMap<Statement[], CompiledBlock<ExecutionContext> | null>();
    private readonly framedBodies = new WeakMap<FunctionStatement, CompiledBlock<ExecutionContext> | null>();
    private readonly valueExpressions = new WeakMap<Expression, (() => RankValue) | null>();
    private readonly valueBodies = new WeakMap<FunctionStatement, boolean>();
    private readonly functionBodies = new WeakMap<FunctionStatement, CallSpecializations<CompiledBlock<ExecutionContext> | null>>();

    constructor(private readonly context: FastPathContext) {}

    private get compiler(): CompilerCapabilities {
        return this.context.compiler ? this.context.compiler() : resolveCompilerCapabilities(this.context.options());
    }

    selection(expression: Expression, operands: readonly Operand<RankValue>[], apply: (values: RankValue[]) => Evaluation<RankValue>) {
        if (!this.compiler.scalars.expressions) return undefined;
        return compileOperands(expression, 'selection-expression', operands, apply, 'native-selection');
    }

    valueExpression(expression: Expression, direct: (expression: Expression) => (() => RankValue) | undefined,
        select: (values: RankValue[]) => RankValue) {
        if (!this.compiler.scalars.expressions) return undefined;
        let run = this.valueExpressions.get(expression);
        if (run === undefined) {
            run = compileValueExpression(expression, { direct, operators: this.context.operators, select }) ?? null;
            this.valueExpressions.set(expression, run);
        }
        return run ?? undefined;
    }

    /** A block of 2 to 64 statements compiled to one closure that steps through them. */
    block(statements: Statement[], steps: BlockSteps): CompiledBlock<ExecutionContext> | undefined {
        return observeCompiler(statements[0], 'block-routing', 'prepare', () => this.blockCandidate(statements, steps));
    }

    private blockCandidate(statements: Statement[], steps: BlockSteps): CompiledBlock<ExecutionContext> | undefined {
        if (this.compiler.blocks.blocks && statements.length && isForStatement(statements[0].$container)) {
            let block = this.valueBlocks.get(statements);
            if (block === undefined) {
                const structured = (node: AstNode) => hasCallBoundary(node) || isRecordExpression(node) || isRecordUpdateExpression(node)
                    || isTupleExpression(node) || isUnpackStatement(node) || isPushStatement(node)
                    || isArrayAssignmentStatement(node)
                    || isAssignmentStatement(node) && (node.deferred || node.name.includes('.'));
                const iteration = forIteration(statements[0].$container.condition);
                const arrayTraversal = iteration && (isNameExpression(iteration.iterable) || forAxes(iteration.iterable));
                const structural = !!arrayTraversal
                    || statements.some(statement => structured(statement) || AstUtils.streamAllContents(statement).some(structured));
                block = structural ? compileValueBlock(statements, {
                    prepare: (commands, index) => steps.preparedStatement(commands, index),
                    scope: (statement, prepared) => steps.scopeStatement(statement, prepared),
                    direct: expression => this.context.compileDirect(expression),
                    evaluate: expression => this.context.evaluate(expression),
                    locate: (error, statement) => this.context.locate(error, statement),
                    compiled: this.compiler.hooks.onBlockCompiled,
                    executed: () => {
                        this.compiler.hooks.onBlockExecuted?.();
                        const diagnostics = currentDiagnostics();
                        if (diagnostics) diagnostics.compiledValueBlocks++;
                    },
                }) ?? null : null;
                this.valueBlocks.set(statements, block);
            }
            if (block) return block;
        }
        if (this.compiler.blocks.blocks && statements.length >= 2 && statements.length <= 64) {
            let block = this.blocks.get(statements);
            if (block === undefined) {
                const regions = new Map<number, ReturnType<typeof compileTensorRegion>>();
                const regionWriters = new Map<Statement, (value: RankValue) => void>();
                block = compileBlock<ExecutionContext>(statements.length, {
                    source: statements[0],
                    prepare: index => steps.preparedStatement(statements, index),
                    region: index => {
                        if (!this.compiler.tensors.fusion) return undefined;
                        if (!regions.has(index)) {
                            const region = compileTensorRegion(statements, index, {
                                lookup: name => this.context.bindings.find(name),
                                commit: (statement, value) => {
                                    let write = regionWriters.get(statement);
                                    if (!write) regionWriters.set(statement, write = this.context.compileAssign(statement.name));
                                    try { this.context.checkMutation(statement); write(value); }
                                    catch (error) { throw this.context.locate(error, statement); }
                                },
                                compiled: source => this.compiler.hooks.onTensorKernelCompiled?.(source),
                                executed: () => this.tensorExecuted(),
                            });
                            regions.set(index, region);
                            if (region) for (let next = index + 1; next < index + region.length; next++) regions.set(next, undefined);
                        }
                        return regions.get(index);
                    },
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
        return declineCompiler(this.compiler.blocks.blocks ? 'statement-budget' : 'disabled', statements[0]);
    }

    /** Compile function control flow per argument signature, retaining runtime call boundaries. */
    functionBody(
        statement: FunctionStatement, arguments_: RankValue[], steps: BlockSteps,
    ): CompiledBlock<ExecutionContext> | undefined {
        return observeCompiler(statement, 'function-body-routing', 'prepare', () => this.functionBodyCandidate(statement, arguments_, steps));
    }

    private functionBodyCandidate(
        statement: FunctionStatement, arguments_: RankValue[], steps: BlockSteps,
    ): CompiledBlock<ExecutionContext> | undefined {
        if (!this.compiler.functions.bodies) return declineCompiler('disabled', statement);
        let instances = this.functionBodies.get(statement);
        if (!instances) this.functionBodies.set(statement, instances = new CallSpecializations());
        let body = instances.get(arguments_);
        if (body === undefined) {
            const commands = statement.statements;
            const last = commands.at(-1);
            const prepare = (index: number): PreparedStatement => {
                if (index !== commands.length - 1 || !last || !isReturnStatement(last) || !last.value) return steps.preparedStatement(commands, index);
                const tensor = steps.preparedStatement(commands, index).tensor;
                const direct = this.context.compileDirect(last.value);
                if (direct) return { run: () => {
                    this.context.checkMutation(last);
                    return runExecution(this.context.evaluateReturn(last.value!));
                }, tensor };
                const value = () => {
                    this.context.checkMutation(last);
                    return this.context.evaluateReturn(last.value!, true);
                };
                return { stream: value, tensor };
            };
            const ordinaryBody = () => last && isReturnStatement(last) && last.value ? compileBlock<ExecutionContext>(commands.length, {
                source: statement,
                prepare,
                locate: (error, index) => this.context.locate(error, commands[index]),
                pause: (index, task, context, compiled) => steps.continueCompiledBlock(commands, index, task, context, compiled),
                compiled: this.compiler.hooks.onFunctionBodyCompiled,
                executed: this.compiler.hooks.onFunctionBodyExecuted,
            }) ?? null : null;
            let values = this.valueBodies.get(statement);
            if (values === undefined) {
                values = AstUtils.streamAllContents(statement).some(node => hasCallBoundary(node) || isRecordExpression(node)
                    || isRecordUpdateExpression(node) || isTupleExpression(node) || isUnpackStatement(node)
                    || isPushStatement(node) || isArrayAssignmentStatement(node)
                    || isAssignmentStatement(node) && (node.deferred || node.name.includes('.')));
                this.valueBodies.set(statement, values);
            }
            // Generic frame code is independent of element/field domains. It
            // carries boxed values through normal contracts, never integer registers.
            if (values || arguments_.some(value => typeof value === 'object')
                || commands.some(command => isFunctionStatement(command) || isIfStatement(command) || isTryStatement(command))) {
                let framed = this.framedBodies.get(statement);
                if (framed === undefined) framed = compileFramedFunction(statement, {
                    prepare: (statements, index) => statements === commands ? prepare(index) : steps.preparedStatement(statements, index),
                    scope: (statement, prepared) => steps.scopeStatement(statement, prepared),
                    direct: expression => this.context.compileDirect(expression),
                    evaluate: expression => this.context.evaluate(expression),
                    locate: (error, statement) => this.context.locate(error, statement),
                    compiled: this.compiler.hooks.onFunctionBodyCompiled,
                    executed: () => {
                        this.compiler.hooks.onFunctionBodyExecuted?.();
                        const diagnostics = currentDiagnostics();
                        if (diagnostics) diagnostics.compiledFramedFunctions++;
                    },
                }) ?? null;
                this.framedBodies.set(statement, framed);
                if (framed) {
                    const run = framed;
                    let ordinary: CompiledBlock<ExecutionContext> | null | undefined;
                    body = (context, index = 0, previous) => {
                        if (index) {
                            if (ordinary === undefined) ordinary = ordinaryBody();
                            return ordinary ? ordinary(context, index, previous)
                                : steps.executeIn(commands.slice(index), context);
                        }
                        return run(context);
                    };
                }
            }
            body ??= ordinaryBody();
            if (!body && (!last || !isReturnStatement(last) || !last.value)) declineCompiler('terminal-return-required', statement);
            // Join fresh writes or scalar vector reductions in one private
            // prefix. Helpers need no wrapper loop to keep scratch storage
            // private; the numeric-function backend below keeps first choice.
            const scalarReduction = arguments_.every(value => typeof value === 'bigint')
                && AstUtils.streamAllContents(statement).some(node => isNameExpression(node) && node.name === 'sum');
            if (last && isReturnStatement(last) && last.value
                && (scalarReduction || commands.slice(0, -1).some(command => isForStatement(command) || isArrayAssignmentStatement(command)))) {
                const prefix = this.compileLoop(statement, undefined);
                if (prefix) {
                    // Numeric-region eligibility has its own bounded proof.
                    // A large helper need not fit the generic block dispatcher;
                    // failed numeric guards still execute its ordinary body.
                    const terminal = commands.slice(-1);
                    const ordinary = body ?? ((context: ExecutionContext, index = 0) =>
                        steps.executeIn(index === 0 ? commands : index === commands.length - 1 ? terminal : commands.slice(index), context));
                    body = (context, index = 0, previous) => {
                        if (index === 0 && !context.insideFinally && !context.insideGenerator) {
                            const result = prefix.run();
                            if (result) return ordinary(context, commands.length - 1, runExecution(result));
                        }
                        return ordinary(context, index, previous);
                    };
                }
            }
            if (body && this.compiler.functions.arrayFunctions) {
                const numeric = compileNumericFunction(statement, {
                    lookup: name => this.context.bindings.find(name),
                    builtin: name => name === 'concat' ? this.context.modules.has('sequences') : this.nativeBuiltin(name),
                    compiled: source => this.compiler.hooks.onFunctionBodyCompiled?.(source),
                    executed: () => {
                        this.compiler.hooks.onFunctionBodyExecuted?.();
                        const diagnostics = currentDiagnostics();
                        if (diagnostics) diagnostics.compiledArrayFunctions++;
                    },
                });
                if (numeric) {
                    const ordinary = body;
                    body = (context, index = 0, previous) => {
                        if (index === 0 && this.compiler.functions.arrayFunctions && !context.insideFinally && !context.insideGenerator) {
                            const value = numeric.run();
                            if (value !== undefined) { returnFunctionValue(context.functionControl, value); return completed(value); }
                        }
                        return ordinary(context, index, previous);
                    };
                }
            }
            instances.set(arguments_, body);
        }
        return body ?? undefined;
    }

    private nativeBuiltin(name: string): boolean {
        const module = findOperation(name)?.module;
        if (module === undefined || !this.context.modules.has(module)) return false;
        const value = this.context.resolve(name);
        return isNativeFunction(value) && hasNativeImplementation(value)
            && this.context.builtins.is(module, name, value);
    }

    private tensorHost(): TensorKernelHost {
        return {
            textDigits: this.compiler.tensors.textDigits,
            lookup: name => this.context.bindings.find(name),
            compiled: this.compiler.hooks.onTensorKernelCompiled,
            builtin: name => this.nativeBuiltin(name),
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

    weightedAxisSumsEnabled(): boolean {
        return this.compiler.tensors.fusion && this.compiler.tensors.cells && this.nativeBuiltin('sum');
    }

    nativeTensorPlansEnabled(): boolean {
        return this.compiler.tensors.fusion && this.compiler.tensors.cells && privateLoopPolling() && !interruptsEnabled();
    }

    tensorPlanScope(expression: Expression): <T>(run: () => T) => T {
        let code = this.tensorPlanCode.get(expression);
        if (!code) this.tensorPlanCode.set(expression, code = new Map());
        const scope = tensorPlanScope(this.tensorHost(), () => this.compiler.tensors.fusion,
            () => this.tensorExecuted(), code);
        return run => withCompilerSource(expression, () => scope(run));
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
        return observeCompiler(statement, 'loop-routing', 'prepare', () => this.compileLoopCandidate(statement, binding, continuation));
    }

    private compileLoopCandidate(statement: ForStatement | FunctionStatement, binding: ForBinding | undefined, continuation?: LoopContinuation): CompiledLoop | undefined {
        const compile = (host: LoopHost) => isFunctionStatement(statement)
            ? compileIntegerFunctionPrefix(statement, host) : compileIntegerLoop(statement, host, binding);
        const { loops, tensors, scalars, hooks } = this.compiler;
        if (!loops.integer) declineCompiler('integer-loops-disabled', statement);
        const ordinary = loops.integer ? compile({
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
            arrayRegions: this.compiler.tensors.fusion,
            prepareArrayWrite: statement => this.context.prepareArrayWrite(statement),
            arrayValues: {
                call: (name, operands) => {
                    const fn = this.context.builtins.lookup(name);
                    if (!isNativeFunction(fn!)) throw new Error('expected builtin');
                    return (name === 'min' || name === 'max'
                        ? mapStoredIntegers(operands[0], operands[1], name) : undefined) ?? fn.call(operands);
                },
                range: (start, end, inclusive, step) => this.context.operators.evaluateBinary(inclusive ? 'to' : 'till', start, end, step),
                select: (source, selector) => copyArray(selectValues(this.context.modules, [source, selector]), false),
                selectBinding: (name, selector) => selectValues(this.context.modules, [this.context.resolve(name), selector]),
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
            evaluateReturn: expression => runExecution(this.context.evaluateReturn(expression)),
            prepareDeferredBinding: statement => this.context.prepareDeferredBinding(statement),
            nativeCalls: loops.nativeCalls,
            prepareBuiltinCall: (module, name, types, numberMode) => preparePositionalBuiltin(this.context, module, name, types, numberMode),
            prepareEffectCall: (name, receiver, types) => prepareEffectCall({
                read: name => this.context.bindings.find(name), module: name => this.context.modules.has(name),
            }, name, receiver, types),
            scalarFunction: (name, arity, strictData, consumed) => this.scalarCall(name, arity, strictData, consumed),
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
                try {
                    const value = this.context.resolve(name);
                    // Catalogued sequences are values, not callable intrinsics.
                    return this.context.builtins.is(module, name, value)
                        && (!isNativeFunction(value) || hasNativeImplementation(value));
                }
                catch { return false; }
            },
            locate: (error, command) => this.context.locate(error, command),
            compiled: hooks.onIntegerLoopCompiled,
            executed: hooks.onIntegerLoopExecuted,
        }) : undefined;
        const numeric = isForStatement(statement) && !continuation && loops.integer && loops.number
            && this.compiler.functions.arrayFunctions && this.compiler.functions.bodies
            ? compileNumericCallLoop(statement, {
                read: name => this.context.bindings.find(name),
                callee: name => {
                    const fn = this.context.bindings.find(name);
                    if (!fn || !isNativeFunction(fn)) return undefined;
                    const definition = this.context.functions.definitionOf(fn);
                    const call = Object.getOwnPropertyDescriptor(fn, 'call')?.value;
                    return definition?.owner === this.context.functions && !definition.context
                        && typeof call === 'function' && call === definition.call
                        ? { identity: fn, statement: definition.statement,
                            available: () => Object.getOwnPropertyDescriptor(fn, 'call')?.value === call
                                && fn.arities.length === 1 && fn.arities[0] === definition.statement.parameters.length
                                && fn.monadicRank === 'all' && (fn.dyadicRanks === undefined || fn.dyadicRanks.every(rank => rank === 'all')),
                            check: (arguments_, result) => { definition.specialization(definition.bindParameters(arguments_)).check(result); },
                        } : undefined;
                },
                builtin: name => name === 'concat' ? this.context.modules.has('sequences') : this.nativeBuiltin(name),
                enabled: () => this.compiler.loops.number && this.compiler.loops.arrayLocals && this.compiler.loops.arrays
                    && this.compiler.functions.arrayFunctions && this.compiler.functions.bodies
                    && !Object.values(this.compiler.hooks).some(Boolean),
                canDeferWrites: bindings => this.context.bindings.canDeferWrites(bindings),
                commit: (name, source, value) => {
                    this.context.checkMutation(source);
                    try { this.context.compileAssign(name)(value); }
                    catch (error) { throw this.context.locate(error, source); }
                },
            }) : undefined;
        const compiled = numeric ? { run: (...args: Parameters<CompiledLoop['run']>) => numeric.run(...args) ?? ordinary?.run(...args) } : ordinary;
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
                return op === 'and' || op === 'or'
                    ? this.context.operators.evaluateGuard(op, left, right)
                    : this.context.operators.evaluateBinary(op, left, right);
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
                return op === 'and' || op === 'or'
                    ? this.context.operators.evaluateGuard(op, left, right)
                    : this.context.operators.evaluateBinary(op, left, right);
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
                // Keep supported arithmetic on the compiled tensor path.
                // The native interpreter is for reference execution and trees
                // (notably floor division) that this compiler cannot lower.
                if (fused && this.compiler.tensors.fusion) return fused;
                const native = prepareNativeIntegerSum(parts[0], name => this.context.bindings.find(name));
                if (!native) return fused;
                return () => {
                    const fn = this.context.bindings.find(operation.name) ?? this.context.builtins.lookup(operation.name);
                    if (fn !== undefined && fn === this.context.builtins.standard('core', 'sum')
                        && Object.getOwnPropertyDescriptor(fn, 'call')?.value !== undefined
                        && hasNativeImplementation(fn as NativeFunction)) {
                        const value = native();
                        if (value !== undefined) return completed(value);
                    }
                    return fused ? fused() : flatMapResult(this.context.evaluate(parts[0]), value =>
                        reference.apply([value, this.context.resolve(operation.name)]));
                };
            }
            default: return undefined;
        }
    }

    /** A proven scalar body that the selected argument types may enter without a frame. */
    scalarEntry(statement: FunctionStatement, generator: boolean, types?: readonly CompiledCalleeType[], captures?: ScalarCaptureTypes): { readonly locals: readonly string[]; readonly nonnegative: readonly number[]; readonly loops: true } | undefined {
        return observeCompiler(statement, 'scalar-entry', 'prepare', () => this.scalarEntryCandidate(statement, generator, types, captures));
    }

    private scalarEntryCandidate(statement: FunctionStatement, generator: boolean, types?: readonly CompiledCalleeType[], captures?: ScalarCaptureTypes): { readonly locals: readonly string[]; readonly nonnegative: readonly number[]; readonly loops: true } | undefined {
        if (!this.compiler.scalars.entries) return declineCompiler('disabled', statement);
        if (generator) return declineCompiler('generator-function', statement);
        const proof = scalarFunctionResult(statement, true, types, true, [], captures);
        // Entry arguments admit scalars, checked arrays and tracked integer indices/deques.
        // Container storage is integer-only; checked reference returns keep
        // their identity without a resource frame. Constructor-owned array writes can
        // enter here; writes through arguments or aliases still need a frame.
        // Array-only bodies retain the private Number loop tier. Containers
        // already require exact, publishing loops. Recursive owned-array bodies also
        // need the linked exact tier; their invocation-local writes are proved above.
        // A newly admitted stored-array loop must not steal an ordinary
        // array-only helper from its existing private Number loop backend.
        // Explicit finite native completion cannot use the private Number
        // body. Its owned arrays may enter the exact function tier instead.
        const nativeCompletion = proof && hasNativeCompletion(proof);
        // A scalar entry would complete each bound range in the exact tier.
        // Keep its existing fused numeric-function consumer instead.
        const rangeReduction = this.compiler.loops.number && this.compiler.functions.bodies
            && proof && proof.type === 'integer' && !proof.recursive && !proof.containers
            && !nativeCompletion && !proof.arrayWrites.size && proof.nativeReads.includes('sum')
            && [...proof.expressions.values()].some(expression => expression.kind === 'input'
                && expression.input.operation === 'range-array');
        if (rangeReduction) return declineCompiler('prefer-numeric-function', statement);
        const boundLoopRange = proof && !nativeCompletion && [...proof.expressions].some(([source, expression]) => {
            if (expression.kind !== 'input' || expression.input.operation !== 'range-array') return false;
            for (let owner = source.$container; owner && owner !== statement; owner = owner.$container) {
                if (isForStatement(owner)) return true;
            }
            return false;
        });
        if (proof && !proof.recursive && !proof.containers && !nativeCompletion
            && ([...proof.loopIterables.values()].some(loop => loop.kind === 'literal' && isNameExpression(loop.expression))
                // Bound range loops also have an analytic Number consumer;
                // do not replace it with completed arrays in the exact tier.
                || boundLoopRange)) return declineCompiler('prefer-numeric-loop', statement);
        // A caller can hide fresh-array writes in a helper. Apply the same
        // backend preference transitively, so an exact scalar call graph does
        // not steal that helper from its private Number loop implementation.
        if (!proof) return declineCompiler('function-proof-unavailable', statement);
        if (!proof.localArrayWrites) return declineCompiler('external-array-writes', statement);
        if (scalarFunctionEffects(proof).localWrites && !proof.containers && !proof.recursive && !nativeCompletion)
            return declineCompiler('prefer-numeric-loop', statement);
        if (proof.planReturn && typeof proof.type === 'string') return declineCompiler('deferred-scalar-return', statement);
        return { locals: proof.locals, nonnegative: proof.nonnegative, loops: true };
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
    scalarCall(name: string, arity: number, strictData = false, consumed = false): ((types: readonly CompiledCalleeType[]) => CompiledCallee | undefined) | undefined {
        if (!this.compiler.scalars.calls) return undefined;
        const value = this.context.bindings.find(name);
        const definition = value && isNativeFunction(value) ? this.context.functions.definitionOf(value) : undefined;
        if (!definition || definition.statement.parameters.length !== arity) return undefined;
        const statement = definition.statement;
        if (strictData && !strictDataCall(statement)) return undefined;
        if (statement.memo) return undefined;
        return types => {
            if (!wholeDeclaredCall(statement, types)) return undefined;
            const scalarTypes = definition.owner.scalarCaptureTypes(statement, definition.context);
            const proof = scalarFunctionResult(statement, this.compiler.scalars.blockCalls, types, true, [], scalarTypes);
            // Whole-loop registers do not yet accept returned containers.
            // Scalar helper chains retain their reference-valued result.
            if (!proof || typeof proof.type !== 'string' && !isCompiledArray(proof.type) || proof.planReturn && typeof proof.type === 'string' && !consumed || proof.nonnegative.length) return undefined;
            const captures = definition.context !== undefined;
            const isScalarType = (type: CompiledCalleeType): boolean =>
                type === 'integer' || type === 'real' || type === 'boolean' || type === 'text';
            const effects = scalarFunctionEffects(proof);
            const stableReads = privateScalarFunction(proof, consumed) || typeof proof.type === 'string'
                && !proof.containers && !proof.arrayWrites.size && !proof.observableCaptures;
            const numberArrays = types.some(type => typeof type !== 'string');
            const integerArrayKernel = this.compiler.scalars.functions && !captures && typeof proof.type !== 'string'
                && Object.getOwnPropertyDescriptor(value!, 'call')?.value === definition.call
                ? compileIntegerArrayFunction(statement, types) : undefined;
            const realArrayKernel = !integerArrayKernel && this.compiler.scalars.functions && !captures && typeof proof.type !== 'string'
                && Object.getOwnPropertyDescriptor(value!, 'call')?.value === definition.call
                ? compileRealArrayFunction(statement, types) : undefined;
            const arrayKernel = integerArrayKernel ?? realArrayKernel;
            const numberSafe = !!arrayKernel || stableReads && isScalarType(proof.type) && types.every(type => isScalarType(type)
                || isCompiledArray(type) && typeof type !== 'string' && type.rank === 1 && type.element === 'integer');
            return {
                parameters: types,
                effects: {
                    writes: effects.unknown ? types.flatMap((type, index) => isCompiledContainer(type) ? [index] : [])
                        : [...effects.parameters],
                    stableArrayReads: !!arrayKernel || stableReads,
                    localWrites: effects.localWrites,
                    // Reuse the scalar proof, retaining its live call guards.
                    // The Number ABI borrows current integer buffers only for
                    // read-only scalar callees; no reference escapes. Captures
                    // and unclassified dependencies retain their own boundary.
                    privateStateSafe: !!arrayKernel || numberSafe && privateScalarFunction(proof, consumed),
                },
                type: proof.type,
                numberSafe,
                numberArrayResult: !!arrayKernel,
                numberArrayPool: !!realArrayKernel,
                locals: [...(captures ? proof.locals : []), ...proof.nativeReads, ...proof.dependencies],
                bind: work => {
                    const current = this.context.bindings.find(name);
                    if (!current || !isNativeFunction(current)) return undefined;
                    const active = this.context.functions.definitionOf(current);
                    if (active?.statement !== statement || (active.context !== undefined) !== captures
                        || proof.locals.some(local => active.context?.find(local))) return undefined;
                    if (arrayKernel && Object.getOwnPropertyDescriptor(current, 'call')?.value !== active.call) return undefined;
                    // If speculative array evaluation declines, preserve the
                    // ordinary callee's demand and call-site error boundary.
                    if (arrayKernel) return ((...args: RankValue[]) => current.call(
                        args.length === 2 && Array.isArray(args[0]) && typeof args[1] === 'boolean'
                            ? args[0] as RankValue[] : args)) as LoopCallable;
                    const compiled = active.owner.prepareScalarCall(statement, active.context, types, true, scalarTypes, work);
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
                bindNumber: numberSafe ? work => {
                    const current = this.context.bindings.find(name);
                    if (!current || !isNativeFunction(current)) return undefined;
                    const active = this.context.functions.definitionOf(current);
                    if (active?.statement !== statement || (active.context !== undefined) !== captures
                        || proof.locals.some(local => active.context?.find(local))) return undefined;
                    if (arrayKernel) {
                        if (Object.getOwnPropertyDescriptor(current, 'call')?.value !== active.call) return undefined;
                        if (proof.nativeReads.length || proof.dependencies.length) {
                            const guarded = active.owner.prepareScalarCall(statement, active.context, types, true, scalarTypes);
                            if (!guarded || guarded.available && !guarded.available()) return undefined;
                        }
                        // A new private consumer must not move observable
                        // demand or cancellation boundaries into the callee.
                        if (interruptsEnabled()) return undefined;
                        return ((...args: unknown[]) => {
                            const result = realArrayKernel ? realArrayKernel(...args as RealArrayArgument[])
                                : integerArrayKernel!(...args as (number | ArrayLike<number | bigint>)[]);
                            if (work) work.value += result.cells.length;
                            return result;
                        }) as unknown as LoopCallable;
                    }
                    const compiled = active.owner.prepareScalarCall(statement, active.context, types, true, scalarTypes, work);
                    if ((proof.nativeReads.length || proof.dependencies.length) && !compiled || compiled?.available && !compiled.available()) return undefined;
                    if (compiled?.numberRegion && privateScalarFunction(proof, consumed)) {
                        const region = compiled.numberRegion();
                        if (region) return region as unknown as LoopCallable;
                    }
                    if (compiled?.numberDirect) return compiled.numberDirect as unknown as LoopCallable;
                    // Exact kernels borrow a call-scoped read view only when
                    // the complete helper graph cannot mutate or retain it.
                    if (numberArrays && (!compiled || !privateScalarFunction(proof, consumed))) return undefined;
                    const direct = compiled?.direct ?? ((...args: RankValue[]) => compiled ? compiled(args) : current.call(args));
                    const widen = types.map(t => t === 'integer');
                    const narrow = proof.type === 'integer' ? (v: RankValue) => typeof v === 'bigint' ? Number(v) : v : (v: RankValue) => v;
                    if (numberArrays) return ((...arguments_: (number | boolean | ArrayLike<number | bigint>)[]) =>
                        narrow(direct(...arguments_.map((value, index) => typeof types[index] !== 'string'
                            ? borrowIntegerBuffer(value as ArrayLike<number | bigint>)
                            : widen[index] ? BigInt(value as number) : value as RankValue)))) as unknown as LoopCallable;
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
