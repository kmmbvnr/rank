import type { RankDeque } from './containers.js';
import type { Expression, ForStatement, Statement, CompiledLoopType } from '@arrrank/language';
import type { CompiledCalleeType } from './compiled-callee-type.js';
import type { CompiledCallee } from './compiled-callee.js';
import type { Completed } from './execution.js';
import { isRankBytes, type RankArray, type RankValue } from './value.js';

export interface IterationBinding {
    readonly names: readonly string[];
    readonly iterable: Expression;
}
export interface LoopHost {
    readonly observableEntry?: boolean;
    canDeferWrites?(bindings: readonly [string, 'integer' | 'boolean'][]): boolean;
    readonly tensorReadHoisting: boolean;
    readonly textLoops: boolean;
    readonly textArrayLoops: boolean;
    readonly nestedLoops: boolean;
    readonly arrayReads: boolean;
    readonly arrayIteration: boolean;
    declareIteration?(binding: IterationBinding, source: RankArray): void;
    iterationValues(binding: IterationBinding, source: RankArray | RankDeque | string, elementType?: 'integer' | 'text'): Iterable<RankValue>;
    readonly arrayWrites: boolean;
    readonly inlineWriteOffsets: boolean;
    readonly compoundWrites: boolean;
    readonly extrema: boolean;
    readonly absolute: boolean;
    readonly reals: boolean;
    readonly scalarText: boolean;
    prepareBuiltinCall(module: string, name: string, types: readonly string[]): () => ((arguments_: RankValue[]) => RankValue) | undefined;
    readonly nativeCalls: boolean;
    readonly sequenceMembership: boolean;
    scalarFunction(name: string, arity: number): ((types: readonly CompiledCalleeType[]) => CompiledCallee | undefined) | undefined;
    readonly booleanLocals: boolean;
    readonly booleanArrays: boolean;
    readonly arrayLocals: boolean;
    readonly returns: boolean;
    canReturn(): boolean;
    returnValue(value: RankValue): never;
    dimension(value: bigint): number;
    extremeParts(expression: Expression): Expression[] | undefined;
    arrayOffset(source: RankArray, indices: readonly bigint[]): number;
    arrayRead(source: RankArray, indices: readonly bigint[]): RankValue;
    textRead(source: string, index: bigint): string;
    iteration(condition: Expression | undefined): IterationBinding | undefined;
    read(name: string): RankValue | undefined;
    writer(name: string): (value: RankValue) => void;
    prepareWriter?(name: string, checked: (value: RankValue) => void): (value: RankValue) => void;
    locate(error: unknown, statement: Statement): unknown;
    module(name: string): boolean;
    builtin(module: string, name: string): boolean;
    compiled?(source: string): void;
    executed?(): void;
}
export interface LoopTerm { code: string; type: CompiledLoopType; ascii?: boolean }

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

/** Whole numeric loop: keep reads in local registers and commit every assignment.
 * Writers retain fixed-type checks and partial state on errors; optional bound
 * writers specialize repeated known-value stores within one invocation. */
export type CompiledLoop = {
    run(insideFinally?: boolean, insideGenerator?: boolean, tailCallsAllowed?: boolean): Completed<RankValue | undefined> | undefined;
};


/** Analyzed loop requirements and lowered body; runtime binding never infers syntax. */
export interface IntegerLoopPlan {
    statement: ForStatement;
    names: string[];
    arrays: Map<string, { slot: number; rank: number; type: LoopTerm['type'] }>;
    destinations: Map<string, { slot: number; rank: number; compound: boolean; type?: LoopTerm['type'] }>;
    root: { setup: string; header: string; bindings: string };
    body: string[];
    locations: Statement[];
    required: Set<number>;
    localTypes: Map<string, LoopTerm['type']>;
    containers: Map<string, { slot: number; kind: 'index' | 'deque'; integers: boolean; mode?: RankDeque['mode'] }>;
    builtins: Map<string, string>;
    calls: { name: string; locals: readonly string[]; stableArrayReads: boolean; bind(): ((arguments_: RankValue[], tail?: boolean) => RankValue) | undefined }[];
    graphMutations: string[];
    vectorIterations: { slot: number; binding: IterationBinding }[];
    iterators: ((source: RankArray | RankDeque | string) => Iterable<RankValue>)[];
    writerNames: string[];
    binderNames: string[];
    writers: ((value: RankValue) => void)[];
    binders: ((value: RankValue) => void)[];
    arrayInputs: Set<string>;
    calleeArrays: Set<string>;
    hasControl: boolean;
    hasReturn: boolean;
    needsAlgo: boolean;
    arrayDefinitions: Set<string>;
    writable: Set<string>;
    iteration: IterationBinding | undefined;
}
