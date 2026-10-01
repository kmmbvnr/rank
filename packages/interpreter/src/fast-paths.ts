import type { AstNode } from 'langium';
import {
    findOperation, flattenApplication, isApplicationExpression, isAssignmentStatement, isParenthesizedExpression,
    isReturnStatement, type Expression, type ForStatement, type FunctionStatement, type Statement,
} from '@arrrank/language';
import { compileBlock, type CompiledBlock } from './block-compiler.js';
import { currentDiagnostics } from './diagnostics.js';
import type { Evaluation, Execution } from './execution.js';
import { argumentSignature } from './return-contract.js';
import type { ExecutionContext, PreparedStatement, TensorGroup } from './statement-control.js';
import { compileTensorKernel } from './tensor-kernel.js';
import type { BindingEnvironment } from './binding-environment.js';
import { recordFallback } from './diagnostics.js';
import { checkedArrayDimension } from './eval/expressions.js';
import { forIteration, iterationAtoms, type ForBinding } from './eval/loops.js';
import type { FunctionInvocation } from './function-invocation.js';
import { isPureHostFunction } from './host-effects.js';
import { ReturnSignal } from './control-signals.js';
import { compileIntegerLoop } from './integer-loop.js';
import type { InterpreterOptions } from './interpreter-options.js';
import type { BuiltinRegistry } from './modules/builtins.js';
import { atArray, scalarArrayWriteOffset, tensorSelection } from './selectors.js';
import { typedNativeCall } from './typed-native.js';
import { applySelectors } from './value-selection.js';
import { isNativeFunction, type RankValue } from './value.js';

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
    private readonly functionBodies = new WeakMap<FunctionStatement, Map<string, CompiledBlock<ExecutionContext> | null>>();

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
        if (!instances) this.functionBodies.set(statement, instances = new Map());
        const signature = argumentSignature(arguments_);
        let body = instances.get(signature);
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
            instances.set(signature, body);
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
        if (!kernel) return recordFallback('tensor:unsupported');
        const last = statements[index + kernel.count - 1];
        if (!isAssignmentStatement(last) && !isReturnStatement(last)) return undefined;
        const assign = isAssignmentStatement(last) ? this.context.compileAssign(last.name) : undefined;
        return { count: kernel.count, run: () => {
            if (!assign && this.context.bindings.current === undefined) return undefined;
            const value = kernel.run();
            if (value === undefined) return recordFallback('tensor:entry-guard');
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
                    direct = frame ? frame.bindStore(name) : next => { this.context.bindings.globals.values.set(name, next); };
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
            builtinCall: (module, name, types) => {
                if (!this.context.modules.has(module)) return undefined;
                // Unknown host callbacks may mutate bindings or re-enter Rank.
                const md5 = this.context.options().md5;
                if (module === 'crypto' && name === 'md5' && md5 && !isPureHostFunction(md5)) return undefined;
                try {
                    const value = this.context.resolve(name);
                    return isNativeFunction(value) && this.context.builtins.is(module, name, value)
                        ? this.context.options().typedNativeCalls === false ? value.call : typedNativeCall(value, types)
                        : undefined;
                } catch { return undefined; }
            },
            scalarFunction: (name, arity) => this.context.functions.scalarCall(name, arity),
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
}
