import type { RankInput, RankIo } from './io.js';
import type { RankEnvironment } from './environment.js';
import type { RankSequence } from './value.js';

export interface LoadedModule {
    readonly id: string;
    readonly source: string;
}

export interface LoopCompilerCapabilities {
    readonly integer?: boolean;
    readonly number?: boolean;
    readonly generator?: boolean;
    readonly arrays?: boolean;
    readonly arrayIteration?: boolean;
    readonly arrayLocals?: boolean;
    readonly arrayWrites?: boolean;
    readonly text?: boolean;
    readonly textArrays?: boolean;
    readonly booleans?: boolean;
    readonly booleanArrays?: boolean;
    readonly booleanSelection?: boolean;
    readonly boundWrites?: boolean;
    readonly compoundWrites?: boolean;
    readonly scalarAddress?: boolean;
    readonly nested?: boolean;
    readonly returns?: boolean;
    readonly yields?: boolean;
    readonly extrema?: boolean;
    readonly reals?: boolean;
    readonly absolute?: boolean;
    readonly provenTypes?: boolean;
    readonly directIteration?: boolean;
    readonly directTextIteration?: boolean;
    readonly directLoopControl?: boolean;
    readonly nativeCalls?: boolean;
    readonly preparation?: boolean;
}

export interface TensorCompilerCapabilities {
    readonly fusion?: boolean;
    readonly readHoisting?: boolean;
    readonly cells?: boolean;
    readonly textDigits?: boolean;
}

export interface ScalarCompilerCapabilities {
    readonly expressions?: boolean;
    readonly functions?: boolean;
    readonly entries?: boolean;
    readonly calls?: boolean;
    readonly blockCalls?: boolean;
    readonly text?: boolean;
    readonly tailCalls?: boolean;
    readonly sequenceMembership?: boolean;
}

export interface FunctionCompilerCapabilities {
    readonly bodies?: boolean;
    readonly directControl?: boolean;
    readonly arrayFunctions?: boolean;
    readonly rankedArrays?: boolean;
}

export interface BlockCompilerCapabilities {
    readonly blocks?: boolean;
}

export interface CompilerDiagnosticsHooks {
    readonly onBlockCompiled?: (source: string) => void;
    readonly onBlockExecuted?: () => void;
    readonly onFunctionBodyCompiled?: (source: string) => void;
    readonly onFunctionBodyExecuted?: () => void;
    readonly onGeneratorLoopCompiled?: (source: string) => void;
    readonly onGeneratorLoopExecuted?: () => void;
    readonly onIntegerLoopCompiled?: (source: string) => void;
    readonly onIntegerLoopExecuted?: () => void;
    readonly onScalarCompiled?: (source: string) => void;
    readonly onScalarExecuted?: () => void;
    readonly onScalarFunctionExecuted?: () => void;
    readonly onTensorKernelCompiled?: (source: string) => void;
    readonly onTensorKernelExecuted?: () => void;
}

export interface CompilerCapabilitiesConfig {
    readonly loops?: LoopCompilerCapabilities;
    readonly tensors?: TensorCompilerCapabilities;
    readonly scalars?: ScalarCompilerCapabilities;
    readonly functions?: FunctionCompilerCapabilities;
    readonly blocks?: BlockCompilerCapabilities;
    readonly typedNativeCalls?: boolean;
    readonly hooks?: CompilerDiagnosticsHooks;
}

export interface CompilerCapabilities {
    readonly enabled: boolean;
    readonly loops: Required<LoopCompilerCapabilities>;
    readonly tensors: Required<TensorCompilerCapabilities>;
    readonly scalars: Required<ScalarCompilerCapabilities>;
    readonly functions: Required<FunctionCompilerCapabilities>;
    readonly blocks: Required<BlockCompilerCapabilities>;
    readonly typedNativeCalls: boolean;
    readonly hooks: CompilerDiagnosticsHooks;
}

/** Copy compiler configuration once; host services and callback state stay live. */
export function snapshotCompilerOptions(options: InterpreterOptions): InterpreterOptions {
    const compiler = options.compiler;
    return Object.freeze({
        ...options,
        compiler: compiler && Object.freeze({
            ...compiler,
            loops: compiler.loops && Object.freeze({ ...compiler.loops }),
            tensors: compiler.tensors && Object.freeze({ ...compiler.tensors }),
            scalars: compiler.scalars && Object.freeze({ ...compiler.scalars }),
            functions: compiler.functions && Object.freeze({ ...compiler.functions }),
            blocks: compiler.blocks && Object.freeze({ ...compiler.blocks }),
            hooks: compiler.hooks && Object.freeze({ ...compiler.hooks }),
        }),
    });
}

/** A readonly result is reused on every execution step, including reference steps. */
export function fixedCompilerCapabilities(options: InterpreterOptions): CompilerCapabilities {
    const capabilities = resolveCompilerCapabilities(options);
    for (const group of [capabilities.loops, capabilities.tensors, capabilities.scalars,
        capabilities.functions, capabilities.blocks, capabilities.hooks]) Object.freeze(group);
    return Object.freeze(capabilities);
}

export function resolveCompilerCapabilities(options: InterpreterOptions): CompilerCapabilities {
    const globalEnabled = options.compilation !== false;
    const compiler = options.compiler;

    const flag = (flat: boolean | undefined, grouped: boolean | undefined): boolean => {
        if (!globalEnabled) return flat ?? grouped ?? false;
        return flat ?? grouped ?? true;
    };

    return {
        enabled: globalEnabled,
        loops: {
            integer: flag(options.integerLoopCompilation, compiler?.loops?.integer),
            number: flag(options.numberLoopCompilation, compiler?.loops?.number),
            generator: flag(options.generatorLoopCompilation, compiler?.loops?.generator),
            arrays: flag(options.arrayLoopCompilation, compiler?.loops?.arrays),
            arrayIteration: flag(options.arrayIterationCompilation, compiler?.loops?.arrayIteration),
            arrayLocals: flag(options.arrayLocalCompilation, compiler?.loops?.arrayLocals),
            arrayWrites: flag(options.arrayWriteCompilation, compiler?.loops?.arrayWrites),
            text: flag(options.textLoopCompilation, compiler?.loops?.text),
            textArrays: flag(options.textArrayLoopCompilation, compiler?.loops?.textArrays),
            booleans: flag(options.booleanLoopCompilation, compiler?.loops?.booleans),
            booleanArrays: flag(options.booleanArrayCompilation, compiler?.loops?.booleanArrays),
            booleanSelection: flag(options.booleanSelectionCompilation, compiler?.loops?.booleanSelection),
            boundWrites: flag(options.boundIntegerWrites, compiler?.loops?.boundWrites),
            compoundWrites: flag(options.compoundArrayCompilation, compiler?.loops?.compoundWrites),
            scalarAddress: flag(options.scalarAddressCompilation, compiler?.loops?.scalarAddress),
            nested: flag(options.nestedLoopCompilation, compiler?.loops?.nested),
            returns: flag(options.loopReturnCompilation, compiler?.loops?.returns),
            yields: flag(options.loopYieldCompilation, compiler?.loops?.yields),
            extrema: flag(options.extremaLoopCompilation, compiler?.loops?.extrema),
            reals: flag(options.realLoopCompilation, compiler?.loops?.reals),
            absolute: flag(options.absoluteLoopCompilation, compiler?.loops?.absolute),
            provenTypes: flag(options.provenIterationTypes, compiler?.loops?.provenTypes),
            directIteration: flag(options.directIteration, compiler?.loops?.directIteration),
            directTextIteration: flag(options.directTextIteration, compiler?.loops?.directTextIteration),
            directLoopControl: flag(options.directLoopControl, compiler?.loops?.directLoopControl),
            nativeCalls: flag(options.nativeLoopCompilation, compiler?.loops?.nativeCalls),
            preparation: flag(options.loopPreparation, compiler?.loops?.preparation),
        },
        tensors: {
            fusion: flag(options.tensorFusion, compiler?.tensors?.fusion),
            readHoisting: flag(options.tensorReadHoisting, compiler?.tensors?.readHoisting),
            cells: flag(options.tensorCellCompilation, compiler?.tensors?.cells),
            textDigits: flag(options.tensorTextDigits, compiler?.tensors?.textDigits),
        },
        scalars: {
            expressions: flag(options.scalarCompilation, compiler?.scalars?.expressions),
            functions: flag(options.scalarFunctionCompilation, compiler?.scalars?.functions),
            entries: flag(options.scalarEntryCompilation, compiler?.scalars?.entries),
            calls: flag(options.scalarCallCompilation, compiler?.scalars?.calls),
            blockCalls: flag(options.scalarBlockCalls, compiler?.scalars?.blockCalls),
            text: flag(options.scalarTextCompilation, compiler?.scalars?.text),
            tailCalls: flag(options.compiledScalarTailCalls, compiler?.scalars?.tailCalls),
            sequenceMembership: flag(options.sequenceMembershipCompilation, compiler?.scalars?.sequenceMembership),
        },
        functions: {
            bodies: flag(options.functionBodyCompilation, compiler?.functions?.bodies),
            directControl: flag(options.directFunctionControl, compiler?.functions?.directControl),
            arrayFunctions: flag(options.arrayFunctionCompilation, compiler?.functions?.arrayFunctions),
            rankedArrays: flag(options.rankedArrayCompilation, compiler?.functions?.rankedArrays),
        },
        blocks: {
            blocks: flag(options.blockCompilation, compiler?.blocks?.blocks),
        },
        typedNativeCalls: flag(options.typedNativeCalls, compiler?.typedNativeCalls),
        hooks: {
            onBlockCompiled: options.onBlockCompiled ?? compiler?.hooks?.onBlockCompiled,
            onBlockExecuted: options.onBlockExecuted ?? compiler?.hooks?.onBlockExecuted,
            onFunctionBodyCompiled: options.onFunctionBodyCompiled ?? compiler?.hooks?.onFunctionBodyCompiled,
            onFunctionBodyExecuted: options.onFunctionBodyExecuted ?? compiler?.hooks?.onFunctionBodyExecuted,
            onGeneratorLoopCompiled: options.onGeneratorLoopCompiled ?? compiler?.hooks?.onGeneratorLoopCompiled,
            onGeneratorLoopExecuted: options.onGeneratorLoopExecuted ?? compiler?.hooks?.onGeneratorLoopExecuted,
            onIntegerLoopCompiled: options.onIntegerLoopCompiled ?? compiler?.hooks?.onIntegerLoopCompiled,
            onIntegerLoopExecuted: options.onIntegerLoopExecuted ?? compiler?.hooks?.onIntegerLoopExecuted,
            onScalarCompiled: options.onScalarCompiled ?? compiler?.hooks?.onScalarCompiled,
            onScalarExecuted: options.onScalarExecuted ?? compiler?.hooks?.onScalarExecuted,
            onScalarFunctionExecuted: options.onScalarFunctionExecuted ?? compiler?.hooks?.onScalarFunctionExecuted,
            onTensorKernelCompiled: options.onTensorKernelCompiled ?? compiler?.hooks?.onTensorKernelCompiled,
            onTensorKernelExecuted: options.onTensorKernelExecuted ?? compiler?.hooks?.onTensorKernelExecuted,
        },
    };
}

export function referenceCompilerOptions(options: InterpreterOptions): InterpreterOptions {
    return {
        ...options,
        compilation: false,
        tensorFusion: false,
        scalarCompilation: false,
        blockCompilation: false,
        integerLoopCompilation: false,
        numberLoopCompilation: false,
        generatorLoopCompilation: false,
        functionBodyCompilation: false,
        scalarFunctionCompilation: false,
        arrayFunctionCompilation: false,
        rankedArrayCompilation: false,
        tensorCellCompilation: false,
        compiledScalarTailCalls: false,
        scalarEntryCompilation: false,
        scalarCallCompilation: false,
        sequenceMembershipCompilation: false,
        scalarTextCompilation: false,
        textArrayLoopCompilation: false,
        textLoopCompilation: false,
        absoluteLoopCompilation: false,
        realLoopCompilation: false,
        loopReturnCompilation: false,
        loopYieldCompilation: false,
        arrayLocalCompilation: false,
        booleanArrayCompilation: false,
        booleanSelectionCompilation: false,
        booleanLoopCompilation: false,
        scalarAddressCompilation: false,
        extremaLoopCompilation: false,
        compoundArrayCompilation: false,
        arrayIterationCompilation: false,
        arrayWriteCompilation: false,
        arrayLoopCompilation: false,
        nestedLoopCompilation: false,
        nativeLoopCompilation: false,
    };
}

/** Readonly constructor options; compiler flags/hooks are snapshotted, callback state remains live. */
export interface InterpreterOptions {
    /** Disable every generated-code tier, including in child modules and tests. */
    readonly compilation?: boolean;
    /** Grouped compiler capabilities. Flags and hooks are captured at interpreter creation. */
    readonly compiler?: CompilerCapabilitiesConfig;
    readonly environment?: RankEnvironment;
    /** Optional host MD5 implementation; portable hashing is the default.
     * Use pureHostFunction only for implementations that satisfy its contract. */
    readonly md5?: (value: string | Uint8Array) => Uint8Array;
    /** Host-owned buffering for single-pass sources, installed only at creation. */
    readonly wrapSinglePassSequence?: (source: RankSequence) => RankSequence;
    readonly tensorReadHoisting?: boolean;
    readonly scalarEntryCompilation?: boolean;
    readonly compiledScalarTailCalls?: boolean;
    readonly scalarFunctionCompilation?: boolean;
    readonly onScalarFunctionExecuted?: () => void;
    readonly scalarBlockCalls?: boolean;
    readonly scalarCallCompilation?: boolean;
    readonly sequenceMembershipCompilation?: boolean;
    readonly tensorTextDigits?: boolean;
    readonly scalarTextCompilation?: boolean;
    readonly directTextIteration?: boolean;
    readonly textArrayLoopCompilation?: boolean;
    readonly textLoopCompilation?: boolean;
    readonly absoluteLoopCompilation?: boolean;
    /** Real arithmetic, powers, `sqrt`, `floor` and `ceil` in compiled loops. */
    readonly realLoopCompilation?: boolean;
    readonly provenIterationTypes?: boolean;
    readonly loopReturnCompilation?: boolean;
    /** Scalar `yield` from exact compiled loops in a generator body. */
    readonly loopYieldCompilation?: boolean;
    readonly arrayLocalCompilation?: boolean;
    readonly booleanArrayCompilation?: boolean;
    /** Commit scalar boolean selection fills without per-cell contract checks. */
    readonly booleanSelectionCompilation?: boolean;
    /** Compile iterable loop control flow that suspends at yield statements. */
    readonly generatorLoopCompilation?: boolean;
    readonly onGeneratorLoopCompiled?: (source: string) => void;
    readonly onGeneratorLoopExecuted?: () => void;
    readonly booleanLoopCompilation?: boolean;
    readonly boundIntegerWrites?: boolean;
    readonly scalarAddressCompilation?: boolean;
    readonly extremaLoopCompilation?: boolean;
    readonly compoundArrayCompilation?: boolean;
    readonly arrayIterationCompilation?: boolean;
    readonly arrayWriteCompilation?: boolean;
    readonly arrayLoopCompilation?: boolean;
    readonly nestedLoopCompilation?: boolean;
    readonly tensorCellCompilation?: boolean;
    /** Fuse pure integer-vector membership and distinct-count functions. */
    readonly arrayFunctionCompilation?: boolean;
    /** Prepare pure vector callbacks once for ranked materialization. */
    readonly rankedArrayCompilation?: boolean;
    /** Iterate scalar streams without per-element entry wrappers. */
    readonly directIteration?: boolean;
    /** Carry ordinary loop jumps through blocks without throwing signals. */
    readonly directLoopControl?: boolean;
    /** Carry ordinary function returns and tail transfers without throwing signals. */
    readonly directFunctionControl?: boolean;
    /** Compile guarded synchronous numeric/text/byte builtin calls inside loops. */
    readonly nativeLoopCompilation?: boolean;
    /** Use checked native wrappers even in typed loops when false. */
    readonly typedNativeCalls?: boolean;
    /** Compile function bodies with a terminal return continuation. */
    readonly functionBodyCompilation?: boolean;
    readonly onFunctionBodyCompiled?: (source: string) => void;
    readonly onFunctionBodyExecuted?: () => void;
    /** Use private safe-Number registers and staged cells in replay-safe integer loops. */
    readonly numberLoopCompilation?: boolean;
    readonly integerLoopCompilation?: boolean;
    readonly onIntegerLoopCompiled?: (source: string) => void;
    readonly onIntegerLoopExecuted?: () => void;
    /** Reuse compiled loop bodies and their execution contexts. */
    readonly loopPreparation?: boolean;
    /** Compiled command blocks; false retains statement dispatch. */
    readonly blockCompilation?: boolean;
    readonly onBlockCompiled?: (source: string) => void;
    readonly onBlockExecuted?: () => void;
    /** Compound scalar expression compilation; false retains prepared operators. */
    readonly scalarCompilation?: boolean;
    readonly onScalarCompiled?: (source: string) => void;
    readonly onScalarExecuted?: () => void;
    /** General tensor fusion; false selects the reference statement path. */
    readonly tensorFusion?: boolean;
    readonly onTensorKernelCompiled?: (source: string) => void;
    readonly onTensorKernelExecuted?: () => void;
    readonly args?: readonly string[];
    readonly sourceId?: string;
    readonly testing?: boolean;
    readonly input?: RankInput;
    readonly io?: RankIo;
    readonly random?: () => number;
    readonly persistentResources?: boolean;
    readonly maxCallDepth?: number;
    readonly loadModule?: (specifier: string, fromId?: string) => LoadedModule;
    readonly onTestResult?: (result: RankTestResult) => void;
}

export interface RankTestResult {
    readonly name: string;
    readonly passed: boolean;
    readonly output: readonly string[];
    readonly error?: string;
    readonly durationMs?: number;
}

/**
 * What a module loaded by `use "file"` inherits from its importer: every
 * option except those that belong to the importer's own run.
 */
export function moduleOptions(options: InterpreterOptions): InterpreterOptions {
    const { args: _args, testing: _testing, persistentResources: _persistent, onTestResult: _onTestResult,
        ...inherited } = options;
    return inherited;
}

/** What a `test` block inherits: a module's options, without host buffering or the host's call limit. */
export function testOptions(options: InterpreterOptions): InterpreterOptions {
    const { wrapSinglePassSequence: _singlePass, maxCallDepth: _depth,
        ...inherited } = moduleOptions(options);
    return inherited;
}
