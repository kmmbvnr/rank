import type { AstNode } from 'langium';
import { flattenApplication, type ForStatement } from '@arrrank/language';
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
}

/**
 * Every place the runtime trades the reference path for a specialized one.
 * Each path is chosen once per syntax node from its form, guards its entry
 * against the values it meets, and falls back to the reference path when a
 * guard fails. Options can disable each path; inspection disables them all.
 */
export class FastPaths {
    constructor(private readonly context: FastPathContext) {}

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
