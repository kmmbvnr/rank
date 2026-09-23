/** Optional synchronous instrumentation. No tracing events are allocated. */
export class RuntimeDiagnostics {
    validationRequests = 0;
    dependencyValidations = 0;
    cacheHits = 0;
    cacheMisses = 0;
    cellsComputed = 0;
    invalidations = 0;
    hoistedReaders = 0;
    compiledLoops = 0;
    compiledTensors = 0;
    cowCopies = 0;
    cowCopiedCells = 0;
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
