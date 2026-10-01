import type { RankInput, RankIo } from './io.js';
import type { RankSequence } from './value.js';

export interface LoadedModule {
    readonly id: string;
    readonly source: string;
}

export interface InterpreterOptions {
    /** Optional host MD5 implementation; portable hashing is the default.
     * Use pureHostFunction only for implementations that satisfy its contract. */
    readonly md5?: (value: string | Uint8Array) => Uint8Array;
    /** Host-owned buffering for single-pass sources, installed only at creation. */
    readonly wrapSinglePassSequence?: (source: RankSequence) => RankSequence;
    /** Optional host cursors for repeatable sequence values saved by assignment. */
    readonly wrapStoredSequence?: (source: RankSequence) => RankSequence;
    readonly tensorReadHoisting?: boolean;
    readonly scalarEntryCompilation?: boolean;
    readonly compiledScalarTailCalls?: boolean;
    readonly scalarFunctionCompilation?: boolean;
    readonly onScalarFunctionExecuted?: () => void;
    readonly scalarBlockCalls?: boolean;
    readonly scalarCallCompilation?: boolean;
    readonly tensorTextDigits?: boolean;
    readonly scalarTextCompilation?: boolean;
    readonly directTextIteration?: boolean;
    readonly textArrayLoopCompilation?: boolean;
    readonly textLoopCompilation?: boolean;
    readonly absoluteLoopCompilation?: boolean;
    readonly provenIterationTypes?: boolean;
    readonly loopReturnCompilation?: boolean;
    readonly arrayLocalCompilation?: boolean;
    readonly booleanArrayCompilation?: boolean;
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
    /** Iterate scalar streams without per-element entry wrappers. */
    readonly directIteration?: boolean;
    /** Carry ordinary loop jumps through blocks without throwing signals. */
    readonly directLoopControl?: boolean;
    /** Compile guarded synchronous text/byte builtin calls inside loops. */
    readonly nativeLoopCompilation?: boolean;
    /** Use checked native wrappers even in typed loops when false. */
    readonly typedNativeCalls?: boolean;
    /** Compile function bodies with a terminal return continuation. */
    readonly functionBodyCompilation?: boolean;
    readonly onFunctionBodyCompiled?: (source: string) => void;
    readonly onFunctionBodyExecuted?: () => void;
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
    const { wrapSinglePassSequence: _singlePass, wrapStoredSequence: _stored, maxCallDepth: _depth,
        ...inherited } = moduleOptions(options);
    return inherited;
}
