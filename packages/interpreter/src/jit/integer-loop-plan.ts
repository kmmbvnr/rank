import type { RankDeque } from '../containers.js';
import type { Expression, ForStatement, FunctionStatement, Statement, CompiledLoopType } from '@arrrank/language';
import type { CompiledCalleeType } from './compiled-callee-type.js';
import type { CompiledCallee } from './compiled-callee.js';
import type { Evaluation } from '../execution.js';
import { isRankBytes, type RankArray, type RankSet, type RankValue } from '../value.js';

export interface IterationBinding {
    readonly names: readonly string[];
    readonly iterable: Expression;
}
/** The remaining traversal of a loop already running in the interpreter. */
export type LoopContinuation = {
    readonly result: RankValue | undefined;
} & ({
    readonly values: Iterable<RankValue>;
    readonly ordinal: bigint;
} | { readonly condition: true });
export interface LoopHost {
    readonly continuation?: LoopContinuation;
    readonly observableEntry?: boolean;
    canDeferWrites?(bindings: readonly [string, 'integer' | 'real' | 'boolean' | 'array', number?][]): boolean;
    readonly tensorReadHoisting: boolean;
    readonly textLoops: boolean;
    readonly textArrayLoops: boolean;
    readonly nestedLoops: boolean;
    readonly arrayReads: boolean;
    readonly arrayIteration: boolean;
    declareIteration?(binding: IterationBinding, source: RankArray): void;
    iterationValues(binding: IterationBinding, source: RankArray | RankDeque | RankSet | string, elementType?: 'integer' | 'text'): Iterable<RankValue>;
    readonly arrayWrites: boolean;
    readonly inlineWriteOffsets: boolean;
    readonly compoundWrites: boolean;
    readonly extrema: boolean;
    readonly absolute: boolean;
    readonly reals: boolean;
    readonly scalarText: boolean;
    /** Binds a positional call `(a, b, ...)`: generated code passes registers
     * directly, so a compiled call site allocates no argument array. */
    prepareBuiltinCall(module: string, name: string, types: readonly string[], numberMode?: boolean): () => LoopCallable | undefined;
    prepareEffectCall(name: string, receiver: string, types: readonly string[]): () => ((arguments_: RankValue[]) => RankValue) | undefined;
    readonly nativeCalls: boolean;
    readonly sequenceMembership: boolean;
    scalarFunction(name: string, arity: number): ((types: readonly CompiledCalleeType[]) => CompiledCallee | undefined) | undefined;
    readonly booleanLocals: boolean;
    readonly booleanArrays: boolean;
    readonly arrayLocals: boolean;
    readonly returns: boolean;
    readonly yields: boolean;
    canReturn(): boolean;
    returnValue(value: RankValue): never;
    dimension(value: bigint): number;
    arrayOffset(source: RankArray, indices: readonly bigint[]): number;
    arrayRead(source: RankArray, indices: readonly bigint[]): RankValue;
    textRead(source: string, index: bigint): string;
    copySlice(source: RankArray, start: bigint, end: bigint, axis: number, inclusive: boolean, view?: boolean): RankArray;
    readonly arrayValues?: {
        range(start: bigint, end: bigint, inclusive: boolean, step?: bigint): RankValue;
        select(source: RankValue, selector: RankValue): RankArray;
        copy(value: RankValue): RankArray;
        binary(operator: string, left: RankValue, right: RankValue): RankValue;
        reduceAxis(operation: string, source: RankValue, axes: readonly number[]): RankArray;
    };
    iteration(condition: Expression | undefined): IterationBinding | undefined;
    read(name: string): RankValue | undefined;
    writer(name: string): (value: RankValue) => void;
    prepareWriter?(name: string, checked: (value: RankValue) => void): (value: RankValue) => void;
    locate(error: unknown, statement: Statement): unknown;
    module(name: string): boolean;
    builtin(module: string, name: string): boolean;
    evaluate?(expression: Expression): RankValue;
    callout?(expression: Expression): () => RankValue;
    compiled?(source: string): void;
    executed?(): void;
}
/** A bound call slot. Its calling convention belongs to the code that emitted
 * the call site: positional registers for builtins and memberships, an
 * argument array (plus tail flag) for user scalar functions. */
export type LoopCallable = (...arguments_: never[]) => RankValue;
export interface LoopTerm { code: string; type: CompiledLoopType; ascii?: boolean; selection?: boolean }

/** The loop register type of a runtime value: one mapping for entry
 * guards, cell scans and type selection. */
export function loopValueType(value: RankValue | undefined): CompiledLoopType | undefined {
    if (typeof value === 'bigint') return 'integer';
    if (typeof value === 'number') return 'real';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'string') return 'text';
    if (value !== undefined && isRankBytes(value)) return 'bytes';
    return undefined;
}

/** Per-region backend feedback; contains no language values or cached results. */
export interface LoopWorkFeedback { cells: number; allow: boolean }

/** Whole numeric loop: keep reads in local registers and commit every assignment.
 * Writers retain fixed-type checks and partial state on errors; optional bound
 * writers specialize repeated known-value stores within one invocation. */
export type CompiledLoop = {
    run(insideFinally?: boolean, insideGenerator?: boolean, tailCallsAllowed?: boolean): Evaluation<RankValue | undefined> | undefined;
};


/** Analyzed loop requirements and lowered body; runtime binding never infers syntax. */
export interface IntegerLoopPlan {
    statement: ForStatement | FunctionStatement;
    names: string[];
    wideScalars: ReadonlySet<string>;
    /** Audited integer operands consumed exactly, without a numeric result. */
    exactInputs: ReadonlySet<Expression>;
    arrays: Map<string, { slot: number; rank: number; type: LoopTerm['type'] }>;
    destinations: Map<string, { slot: number; rank: number; compound: boolean; type?: LoopTerm['type']; slice?: boolean }>;
    root: { setup: string; header: string; bindings: string };
    body: string[];
    locations: Statement[];
    required: Set<number>;
    localTypes: Map<string, LoopTerm['type']>;
    containers: Map<string, { slot: number; kind: 'index' | 'deque' | 'set'; integers: boolean; mode?: RankDeque['mode']; array?: { rank: number; type: LoopTerm['type'] } }>;
    builtins: Map<string, string>;
    calls: { numberSafe?: boolean; name: string; receiver?: string; locals: readonly string[]; stableArrayReads: boolean; bind(): LoopCallable | undefined }[];
    vectorIterations: { slot: number; binding: IterationBinding }[];
    iterators: ((source: RankArray | RankDeque | RankSet | string) => Iterable<RankValue>)[];
    writerNames: string[];
    binderNames: string[];
    writers: ((value: RankValue) => void)[];
    binders: ((value: RankValue) => void)[];
    arrayInputs: Set<string>;
    calleeArrays: Set<string>;
    indexedReads: Map<string, string | undefined>;
    hasControl: boolean;
    hasReturn: boolean;
    hasYield: boolean;
    needsAlgo: boolean;
    arrayDefinitions: Set<string>;
    writable: Set<string>;
    iteration: IterationBinding | undefined;
    workCounting?: boolean;
    callouts?: { expression: Expression; expectedType?: LoopTerm['type'] }[];
}

/** Unified Region plan and host definitions over shared typed IR. */
export type RegionPlan = IntegerLoopPlan;
export type RegionHost = LoopHost;
