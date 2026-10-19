/** Optional synchronous instrumentation. No tracing events are allocated. */
export class RuntimeDiagnostics {
    validationRequests = 0;
    dependencyValidations = 0;
    cacheHits = 0;
    cacheMisses = 0;
    memoHits = 0;
    memoMisses = 0;
    sequenceReplayHits = 0;
    sequencePredicateCalls = 0;
    sequenceCachedValues = 0;
    /** Accounted payload minus explicit evictions, without observing host GC.
     * Use heap/RSS measurements for actual process memory. */
    sequenceCacheBytes = 0;
    sequenceCachePeakBytes = 0;
    sequenceCacheEvictions = 0;
    cellsComputed = 0;
    invalidations = 0;
    hoistedReaders = 0;
    loopElementScans = 0;
    compiledLoops = 0;
    integerMembershipFilters = 0;
    numericSorts = 0;
    numericDistincts = 0;
    numericSearches = 0;
    numericSearchIndexes = 0;
    numberLoops = 0;
    numberLoopOverflows = 0;
    compiledTensors = 0;
    compiledArrayFunctions = 0;
    rankedArrayBatches = 0;
    /** Full materialization attempts over a prepared scalar callback. */
    rankedBatches = 0;
    maskPositionReuses = 0;
    maskMaterializations = 0;
    maskMaterializedCells = 0;
    bulkArrayWrites = 0;
    bulkArrayWriteCells = 0;
    cowCopies = 0;
    cowCopiedCells = 0;
    elementTypeScans = 0;
    elementTypeScannedCells = 0;
    selectionSnapshots = 0;
    selectionSnapshotCells = 0;
    readonly fallbacks: Record<string, number> = Object.create(null);

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
export function recordFallback(reason: string): undefined {
    if (active) active.fallbacks[reason] = (active.fallbacks[reason] ?? 0) + 1;
    return undefined;
}
