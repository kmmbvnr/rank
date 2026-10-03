import type { AstNode } from 'langium';
import {
    findOperation, flattenApplication, isBinaryExpression, isNameExpression, isUnaryExpression,
    type ApplicationForm, type Operation, type CompiledScalarType, isApplicationExpression, isAssignmentStatement, isParenthesizedExpression,
    isReturnStatement, type Expression, type ForStatement, type FunctionStatement, type Statement,
} from '@arrrank/language';
import { compileBlock, type CompiledBlock } from './block-compiler.js';
import { TailCallSignal } from './control-signals.js';
import { registerFlatCombine } from './flat-combine.js';
import { compileFusedReduction, compileFusedSum } from './fused-reduction.js';
import type { Operators } from './operators.js';
import { compileScalarExpression, compileResumableScalarExpression } from './scalar-compiler.js';
import { scalarFunctionResult } from './scalar-function-proof.js';
import { currentDiagnostics } from './diagnostics.js';
import { completed, type Evaluation, type Execution } from './execution.js';
import { CallSpecializations } from './call-specializations.js';
import type { ExecutionContext, PreparedStatement, TensorGroup } from './statement-control.js';
import { compileTensorKernel } from './tensor-kernel.js';
import type { BindingEnvironment } from './binding-environment.js';
import { recordFallback } from './diagnostics.js';
import { checkedArrayDimension } from './eval/expressions.js';
import { forIteration, iterationAtoms, type ForBinding } from './eval/loops.js';
import type { FunctionInvocation } from './function-invocation.js';
import { ReturnSignal } from './control-signals.js';
import { compileIntegerLoop } from './integer-loop.js';
import type { InterpreterOptions } from './interpreter-options.js';
import type { BuiltinRegistry } from './modules/builtins.js';
import { atArray, scalarArrayWriteOffset, tensorSelection } from './selectors.js';
import { prepareCompiledBuiltin } from './typed-native.js';
import { applySelectors } from './value-selection.js';
import { isRankArray, isNativeFunction, type NativeFunction, type RankValue } from './value.js';

export type CompiledLoop = NonNullable<ReturnType<typeof compileIntegerLoop>>;

/** What choosing and running specialized paths needs. */
export interface FastPathContext {
    readonly bindings: BindingEnvironment;
    readonly modules: ReadonlySet<string>;
    readonly builtins: BuiltinRegistry;
    readonly functions: FunctionInvocation;
    resolve(name: string): RankValue;
    compileAssign(name: string): (value: RankValue) => void;
    locate(error: unknown, node: AstNode): unknown;
    options(): InterpreterOptions;
    evaluate(expression: Expression): Evaluation<RankValue>;
    compileDirect(expression: Expression): (() => RankValue) | undefined;
    /** Evaluation of a returned application that may become a tail call. */
    compileTail(expression: Expression): () => Evaluation<RankValue>;
    /** Builtin identity a name is bound to, or false for a user value. */
    operationOf(name: string): Operation | undefined | false;
    readonly operators: Operators;
}

/** The reference evaluation an application fast path falls back to. */
export interface ApplicationReference {
    reduce(operator: string, value: RankValue): RankValue;
    apply(values: RankValue[]): Evaluation<RankValue>;
}

/** A compiled loop's view of a user function it may call without leaving the loop. */
export interface ScalarCallSite {
    readonly type: CompiledScalarType;
    readonly locals: readonly string[];
    bind(): ((arguments_: RankValue[], tail?: boolean) => RankValue) | undefined;
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
    private readonly blocks = new WeakMap<Statement[], CompiledBlock<ExecutionContext> | null>();
    private readonly functionBodies = new WeakMap<FunctionStatement, CallSpecializations<CompiledBlock<ExecutionContext> | null>>();

    constructor(private readonly context: FastPathContext) {}

    /** A block of 2 to 64 statements compiled to one closure that steps through them. */
    block(statements: Statement[], steps: BlockSteps): CompiledBlock<ExecutionContext> | undefined {
        if (this.context.options().blockCompilation !== false && statements.length >= 2 && statements.length <= 64) {
            let block = this.blocks.get(statements);
            if (block === undefined) {
                block = compileBlock<ExecutionContext>(statements.length, {
                    prepare: index => steps.preparedStatement(statements, index),
                    locate: (error, index) => this.context.locate(error, statements[index]),
                    pause: (index, task, context, compiled) => steps.continueCompiledBlock(
                        statements, index, task, context, compiled),
                    compiled: this.context.options().onBlockCompiled,
                    executed: this.context.options().onBlockExecuted,
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
        if (this.context.options().functionBodyCompilation === false) return undefined;
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
                    if (direct) return { run: direct, tensor };
                    let candidate = last.value!;
                    while (isParenthesizedExpression(candidate)) candidate = candidate.value;
                    const value = isApplicationExpression(candidate)
                        ? this.context.compileTail(last.value!)
                        : () => this.context.evaluate(last.value!);
                    return { stream: value, tensor };
                },
                locate: (error, index) => this.context.locate(error, commands[index]),
                pause: (index, task, context, compiled) => steps.continueCompiledBlock(commands, index, task, context, compiled),
                compiled: this.context.options().onFunctionBodyCompiled,
                executed: this.context.options().onFunctionBodyExecuted,
            }) ?? null : null;
            instances.set(arguments_, body);
        }
        return body ?? undefined;
    }

    tensorGroup(statements: Statement[], index: number): TensorGroup | undefined {
        const kernel = compileTensorKernel(statements.slice(index), {
            textDigits: this.context.options().tensorTextDigits !== false,
            lookup: name => this.context.bindings.find(name),
            compiled: this.context.options().onTensorKernelCompiled,
            builtin: name => {
                const module = findOperation(name)?.module;
                if (module === undefined || !this.context.modules.has(module)) return false;
                return this.context.builtins.is(module, name, this.context.resolve(name));
            },
        });
        if (!kernel) return undefined;
        const last = statements[index + kernel.count - 1];
        if (!isAssignmentStatement(last) && !isReturnStatement(last)) return undefined;
        const assign = isAssignmentStatement(last) ? this.context.compileAssign(last.name) : undefined;
        return { count: kernel.count, run: () => {
            if (!assign && this.context.bindings.current === undefined) return undefined;
            const value = kernel.run();
            if (value === undefined) return undefined;
            try { assign?.(value); }
            catch (error) { throw this.context.locate(error, last); }
            this.context.options().onTensorKernelExecuted?.();
            const diagnostics = currentDiagnostics();
            if (diagnostics) diagnostics.compiledTensors++;
            if (!assign) throw new ReturnSignal(value);
            return value;
        } };
    }

    /** A numeric loop compiled to straight-line code over local registers. */
    compileLoop(statement: ForStatement, binding: ForBinding | undefined): CompiledLoop | undefined {
        const compiled = this.context.options().integerLoopCompilation !== false ? compileIntegerLoop(statement, {
            tensorReadHoisting: this.context.options().tensorReadHoisting !== false,
            read: name => this.context.bindings.find(name),
            writer: name => this.context.compileAssign(name),
            prepareWriter: this.context.options().boundIntegerWrites !== false ? (name, checked) => {
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
            textLoops: this.context.options().textLoopCompilation !== false,
            textArrayLoops: this.context.options().textArrayLoopCompilation !== false,
            nestedLoops: this.context.options().nestedLoopCompilation !== false,
            arrayRead: atArray,
            textRead: (source, index) => applySelectors([source, index]) as string,
            returns: this.context.options().loopReturnCompilation !== false,
            canReturn: () => this.context.bindings.current !== undefined,
            returnValue: value => { throw new ReturnSignal(value); },
            arrayLocals: this.context.options().arrayLocalCompilation !== false,
            dimension: checkedArrayDimension,
            booleanArrays: this.context.options().booleanArrayCompilation !== false,
            booleanLocals: this.context.options().booleanLoopCompilation !== false,
            scalarText: this.context.options().scalarTextCompilation !== false,
            nativeCalls: this.context.options().nativeLoopCompilation !== false,
            prepareBuiltinCall: (module, name, types) => prepareCompiledBuiltin(this.context, module, name, types),
            scalarFunction: (name, arity) => this.scalarCall(name, arity),
            absolute: this.context.options().absoluteLoopCompilation !== false,
            extrema: this.context.options().extremaLoopCompilation !== false,
            extremeParts: flattenApplication,
            compoundWrites: this.context.options().compoundArrayCompilation !== false,
            arrayIteration: this.context.options().arrayIterationCompilation !== false,
            // The region guards cell types before entry and preserves them.
            iterationValues: (binding, source, elementType = 'integer') => iterationAtoms(this.context.bindings, binding, source,
                this.context.options().provenIterationTypes !== false ? elementType : undefined,
                this.context.options().directTextIteration !== false),
            arrayWrites: this.context.options().arrayWriteCompilation !== false,
            inlineWriteOffsets: this.context.options().scalarAddressCompilation !== false,
            arrayOffset: this.context.options().scalarAddressCompilation !== false
                ? scalarArrayWriteOffset
                : (source, indices) => tensorSelection(source, indices).offsetAt(0),
            arrayReads: this.context.options().arrayLoopCompilation !== false,
            iteration: forIteration,
            module: name => this.context.modules.has(name),
            builtin: (module, name) => {
                if (!this.context.modules.has(module)) return false;
                try { return this.context.builtins.is(module, name, this.context.resolve(name)); }
                catch { return false; }
            },
            locate: (error, command) => this.context.locate(error, command),
            compiled: this.context.options().onIntegerLoopCompiled,
            executed: this.context.options().onIntegerLoopExecuted,
        }, binding) : undefined;
        if (!compiled) recordFallback(this.context.options().integerLoopCompilation === false ? 'loop:disabled' : 'loop:unsupported');
        return compiled;
    }

    /** A binary or unary expression over direct leaves compiled to one closure. */
    scalarExpression(
        expression: Expression, leaf: (expression: Expression) => (() => RankValue) | undefined,
    ): (() => RankValue) | undefined {
        if (this.context.options().scalarCompilation === false
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
            compiled: this.context.options().onScalarCompiled,
            executed: this.context.options().onScalarExecuted,
        });
    }

    /** Arithmetic around effectful or suspended children, without replaying them. */
    scalarEvaluation(expression: Expression, leaf: (expression: Expression) => () => Evaluation<RankValue>): (() => Evaluation<RankValue>) | undefined {
        if (this.context.options().scalarCompilation === false
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
            compiled: this.context.options().onScalarCompiled,
            executed: this.context.options().onScalarExecuted,
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
        const arithmetic = {
            prepareLeaf: (source: Expression) => this.context.compileDirect(source),
            binary: (operator: string, a: RankValue, b: RankValue) => this.context.operators.evaluateBinary(operator, a, b),
        };
        switch (form.kind) {
            case 'reduce': {
                // A literal rank or a seed takes the reference reduction.
                if (form.rank !== undefined || form.seed !== undefined) return undefined;
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
                return compileFusedSum(parts[0], arithmetic, (value, sum) => {
                    // A host can still bind the name to something else between runs.
                    const fn = this.context.resolve(operation.name);
                    if (isNativeFunction(fn) && this.context.builtins.is('core', 'sum', fn)) {
                        return completed(sum ? sum() : fn.call([value]));
                    }
                    return reference.apply([value, fn]);
                });
            }
            default: return undefined;
        }
    }

    /** A proven scalar body that the selected argument types may enter without a frame. */
    scalarEntry(statement: FunctionStatement, generator: boolean, types?: readonly CompiledScalarType[]): { readonly locals: readonly string[] } | undefined {
        return this.context.options().scalarEntryCompilation !== false && !generator
            ? scalarFunctionResult(statement, true, types) : undefined;
    }

    /** Lets flat combinators run a scalar user function without entering Rank. */
    flatCombine(
        fn: NativeFunction, statement: FunctionStatement, available: (builtins: ReadonlySet<string>) => boolean,
    ): void {
        if (this.context.options().scalarFunctionCompilation !== false) registerFlatCombine(fn, statement, available);
    }

    /**
     * A compiled loop calling `name` with `arity` integer arguments may compile the call
     * when the callee's body is a proven scalar function. `bind` rechecks the
     * binding at loop entry, since the name can be rebound between runs.
     */
    scalarCall(name: string, arity: number): ScalarCallSite | undefined {
        if (this.context.options().scalarCallCompilation === false) return undefined;
        const value = this.context.bindings.find(name);
        const definition = value && isNativeFunction(value) ? this.context.functions.definitionOf(value) : undefined;
        if (!definition || definition.statement.parameters.length !== arity) return undefined;
        const statement = definition.statement;
        const proof = scalarFunctionResult(statement, this.context.options().scalarBlockCalls !== false);
        if (!proof) return undefined;
        const captures = definition.context !== undefined;
        return { type: proof.type, locals: [...(captures ? proof.locals : []), ...proof.nativeReads], bind: () => {
            const current = this.context.bindings.find(name);
            if (!current || !isNativeFunction(current)) return undefined;
            const active = this.context.functions.definitionOf(current);
            if (active?.statement !== statement || (active.context !== undefined) !== captures
                || proof.locals.some(local => active.context?.find(local))) return undefined;
            const compiled = active.owner.prepareScalarCall(statement, active.context);
            if (proof.nativeReads.length && !compiled || compiled?.available && !compiled.available()) return undefined;
            return (arguments_, tail = false) => {
                if (tail && active.owner === this.context.functions) {
                    throw new TailCallSignal(active, arguments_,
                        this.context.options().compiledScalarTailCalls !== false ? compiled : undefined);
                }
                return compiled ? compiled(arguments_) : current.call(arguments_);
            };
        } };
    }
}
