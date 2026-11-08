import type { CompilerRejection } from './compiler-rejection.js';

/** Reasons describe the missing proof, not the source program. */
export type FallbackCategory = 'effects' | 'representation' | 'aliasing'
    | 'proof' | 'cost' | 'unclassified';
export interface ExecutionCost {
    calls: number;
    milliseconds: number;
    allocatedBytes: number;
    copiedBytes: number;
    boxedCells: number;
    unboxedCells: number;
    discardedAttempts: number;
    discardedMilliseconds: number;
}

/** Optional counters and bounded compilation-failure syntax snapshots. */
export class RuntimeDiagnostics {
    memoHits = 0;
    memoMisses = 0;
    indexReads = 0;
    indexReadHits = 0;
    indexReadMisses = 0;
    indexWrites = 0;
    sequencePredicateCalls = 0;
    primeRunSieves = 0;
    cellsComputed = 0;
    hoistedReaders = 0;
    loopElementScans = 0;
    nativeSequenceCopies = 0;
    nativeFirstSearches = 0;
    nativeFirstSearchCells = 0;
    compiledLoops = 0;
    compiledFunctionFolds = 0;
    nativeIntegerSums = 0;
    nativeIntegerSumCells = 0;
    weightedAxisSums = 0;
    weightedAxisSumCells = 0;
    fusedArrayRegions = 0;
    fusedArrayRegionCells = 0;
    compiledGeneratorLoops = 0;
    integerMembershipFilters = 0;
    integerKeyedFolds = 0;
    realKeyedFolds = 0;
    keyedNativeReaders = 0;
    compiledGraphAdds = 0;
    compiledEffectCalls = 0;
    numericSorts = 0;
    numericInPlaceSorts = 0;
    numericDistincts = 0;
    compiledDistincts = 0;
    numericUniqueSorts = 0;
    numericSmallestSelections = 0;
    numericUniqueSums = 0;
    sortedIndexBatches = 0;
    sortedIndexBatchQueries = 0;
    numericSearches = 0;
    numericSearchIndexes = 0;
    numberLoops = 0;
    numberLoopUnpolled = 0;
    numberLoopBatched = 0;
    numberFunctions = 0;
    numberFunctionFallbacks = 0;
    numberFunctionSkips = 0;
    numberFunctionArrayBorrows = 0;
    exactLoopWorkSamples = 0;
    exactLoopWorkPromotions = 0;
    numberLoopCopyProbes = 0;
    numberLoopCopyAmortized = 0;
    mixedIntegerLoops = 0;
    numberLoopOverflows = 0;
    numberLoopSliceCopies = 0;
    numberLoopSliceCopyCells = 0;
    numberLoopSliceDirectCells = 0;
    numberLoopReadBuffers = 0;
    numberLoopReadBufferCells = 0;
    numberLoopReadBufferHits = 0;
    /** Packed read-only integer inputs validated at their actual scalar loads. */
    numberLoopBorrowedIntegerBuffers = 0;
    numberLoopBorrowedIntegerCells = 0;
    numberLoopBorrowedRealBuffers = 0;
    numberLoopBorrowedRealCells = 0;
    modularMatrixPowers = 0;
    nativeModularMatrixPowers = 0;
    nativeModularMatrixBatches = 0;
    modularCallbackScans = 0;
    compiledTensors = 0;
    packedBooleanGathers = 0;
    packedBooleanGatherCells = 0;
    tensorRangeScans = 0;
    tensorRangeScannedCells = 0;
    numberTensors = 0;
    compiledCounterBuilds = 0;
    compiledCounterSums = 0;
    compiledCounterKeys = 0;
    /** Native recipe graphs lowered for a consumer, including reusable axis folds. */
    tensorMapPreparations = 0;
    compiledArrayFunctions = 0;
    numericFunctionPreparations = 0;
    numericFunctionPlanHits = 0;
    compiledNumericCallLoops = 0;
    numericLoopCalls = 0;
    rankedArrayBatches = 0;
    /** Full materialization attempts over a prepared scalar callback. */
    rankedBatches = 0;
    maskMaterializations = 0;
    maskMaterializedCells = 0;
    bulkArrayWrites = 0;
    bulkArrayWriteCells = 0;
    fusedArrayUpdates = 0;
    fusedArrayUpdateCells = 0;
    fusedArrayUpdateWidenings = 0;
    reusedTensorBuffers = 0;
    reusedTensorBufferCells = 0;
    cowCopies = 0;
    cowCopiedCells = 0;
    elementTypeScans = 0;
    elementTypeScannedCells = 0;
    /** Inline range-array selectors consumed without an index-cell buffer. */
    rangeSelectorViews = 0;
    selectionSnapshots = 0;
    selectionSnapshotCells = 0;
    /** Completed typed buffers published through the ownership-taking API.
     * Excludes private scratch buffers and shared stored views. */
    typedArrayPublications = 0;
    typedArrayPublishedCells = 0;
    /** Typed buffers turned back into boxed cells, which costs 4 to 8 times the memory. */
    typedUnpacks = 0;
    typedUnpackedCells = 0;
    readonly fallbacks: Record<string, number> = Object.create(null);
    readonly fallbackCategories: Record<FallbackCategory, Record<string, number>> = {
        effects: Object.create(null), representation: Object.create(null),
        aliasing: Object.create(null), proof: Object.create(null),
        cost: Object.create(null), unclassified: Object.create(null),
    };
    /** Inclusive timings and known buffer payloads; not retained heap size. */
    readonly costs: Record<string, ExecutionCost> = Object.create(null);
    cost(stage: string): ExecutionCost {
        return this.costs[stage] ??= { calls: 0, milliseconds: 0,
            allocatedBytes: 0, copiedBytes: 0, boxedCells: 0, unboxedCells: 0, discardedAttempts: 0, discardedMilliseconds: 0 };
    }
    measure<T>(stage: string, operation: () => T): T {
        const cost = this.cost(stage), start = performance.now();
        cost.calls++;
        try { return operation(); }
        finally { cost.milliseconds += performance.now() - start; }
    }
    readonly compilerRejections: CompilerRejection[] = [];

    /** Scopes nest safely, including exceptions. Lazy readers retain their owner. */
    run<T>(operation: () => T): T {
        const previous = active;
        active = this;
        try { return operation(); }
        finally { active = previous; }
    }
}
let active: RuntimeDiagnostics | undefined;
export function currentDiagnostics(): RuntimeDiagnostics | undefined { return active; }
export function recordFallback(reason: string, category?: FallbackCategory): undefined {
    if (active) {
        active.fallbacks[reason] = (active.fallbacks[reason] ?? 0) + 1;
        const reasons = active.fallbackCategories[category ?? fallbackCategory(reason)];
        reasons[reason] = (reasons[reason] ?? 0) + 1;
    }
    return undefined;
}

/** Legacy reasons stay readable; unknown details remain explicitly unclassified. */
export function fallbackCategory(reason: string): FallbackCategory {
    const detail = reason.split(':')[1];
    if (['statement-budget', 'temporary-budget', 'specialization-budget'].includes(detail)) return 'cost';
    if (['unsupported-type', 'storage-or-cell-type', 'unsafe-input', 'unsafe-cell'].includes(detail)) return 'representation';
    if (['mutable-array-alias', 'array-alias-call', 'rebound-array-alias', 'mutable-slice-result',
        'deque-array-write'].includes(detail)) return 'aliasing';
    if (['unsupported-op', 'unsupported-node', 'unsupported-effect', 'unstable-effect-receiver',
        'array-call-write-region'].includes(detail)) return 'effects';
    if (['unstable-bindings', 'escaping-rebound-array', 'rebound-array-selection',
        'code-generation', 'binding-contract'].includes(detail)) return 'proof';
    return 'unclassified';
}
