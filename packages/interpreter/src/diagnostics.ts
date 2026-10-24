import type { CompilerRejection } from './compiler-rejection.js';

/** Optional counters and bounded compilation-failure syntax snapshots. */
export class RuntimeDiagnostics {
    memoHits = 0;
    memoMisses = 0;
    indexReads = 0;
    indexReadHits = 0;
    indexReadMisses = 0;
    indexWrites = 0;
    sequencePredicateCalls = 0;
    cellsComputed = 0;
    hoistedReaders = 0;
    loopElementScans = 0;
    compiledLoops = 0;
    compiledGeneratorLoops = 0;
    integerMembershipFilters = 0;
    compiledGraphAdds = 0;
    compiledEffectCalls = 0;
    numericSorts = 0;
    numericInPlaceSorts = 0;
    numericDistincts = 0;
    numericUniqueSorts = 0;
    numericSearches = 0;
    numericSearchIndexes = 0;
    numberLoops = 0;
    mixedIntegerLoops = 0;
    numberLoopOverflows = 0;
    compiledTensors = 0;
    compiledArrayFunctions = 0;
    rankedArrayBatches = 0;
    /** Full materialization attempts over a prepared scalar callback. */
    rankedBatches = 0;
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
    /** Typed buffers turned back into boxed cells, which costs 4 to 8 times the memory. */
    typedUnpacks = 0;
    typedUnpackedCells = 0;
    readonly fallbacks: Record<string, number> = Object.create(null);
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
export function recordFallback(reason: string): undefined {
    if (active) active.fallbacks[reason] = (active.fallbacks[reason] ?? 0) + 1;
    return undefined;
}
