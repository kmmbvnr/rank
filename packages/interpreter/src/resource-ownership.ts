import { RankDeque, RankHeap } from './containers.js';
import { normalizeStackError } from './execution.js';
import { closeFile } from './modules/io.js';
import { isKnownFileFree } from './resource-summary.js';
import {
    isNativeFunction, isRankArray, isRankCounter, isRankErrorValue, isRankFile,
    isRankGroupedTable, isRankIndex, isRankObject, isRankQueue, isRankRecord,
    isRankSegment, isRankSequence, isRankSet, type RankFile, type RankValue,
} from './value.js';

/** Owns file scopes across ordinary calls, suspended functions and generators. */
export class ResourceOwnership {
    private readonly resourceScopes: Set<RankFile>[] = [];
    private readonly generatorResourceScopes = new Set<Set<RankFile>>();

    ensureScope(): void {
        if (this.resourceScopes.length === 0) this.resourceScopes.push(new Set());
    }

    pushScope(scope: Set<RankFile>): void { this.resourceScopes.push(scope); }
    popScope(): void { this.resourceScopes.pop(); }
    currentScopeEmpty(): boolean { return this.resourceScopes.at(-1)?.size === 0; }
    addGeneratorScope(scope: Set<RankFile>): void { this.generatorResourceScopes.add(scope); }
    deleteGeneratorScope(scope: Set<RankFile>): void { this.generatorResourceScopes.delete(scope); }

    dispose(): void {
        for (const scope of this.generatorResourceScopes) this.closeResources(scope, new Set());
        this.generatorResourceScopes.clear();
        while (this.resourceScopes.length > 0) this.closeResources(this.resourceScopes.pop()!, new Set());
    }

    withResourceScope<T extends RankValue | undefined>(
        operation: () => T,
        transferResult = true,
    ): T {
        const scope = new Set<RankFile>();
        this.resourceScopes.push(scope);
        let result: T | undefined;
        let pending: unknown;
        try {
            result = operation();
        } catch (error) {
            pending = normalizeStackError(error);
        }

        return this.finishResourceScope(scope, result, pending, transferResult) as T;
    }

    finishResourceScope(
        scope: Set<RankFile>,
        result: RankValue | undefined,
        pending: unknown,
        transferResult = true,
    ): RankValue | undefined {
        // Resource-free containers need no deep escape scan, just like scalars.
        // Keep the scope itself: nested calls must still transfer files here.
        if (scope.size === 0 && isKnownFileFree(result)) {
            this.resourceScopes.pop();
            if (pending !== undefined) throw pending;
            return result;
        }

        let escaped = new Set<RankFile>();
        if (pending === undefined && transferResult) {
            try {
                escaped = containedFiles(result);
            } catch (error) {
                pending = normalizeStackError(error);
            }
        }
        this.resourceScopes.pop();

        let closeError: unknown;
        try {
            this.closeResources(scope, escaped);
        } catch (error) {
            closeError = error;
        }
        if (transferResult) {
            for (const file of escaped) this.ownFile(file);
        }
        if (pending !== undefined) throw pending;
        if (closeError !== undefined) throw closeError;
        return result;
    }

    ownFile(file: RankFile): void {
        let scope = this.resourceScopes.at(-1);
        if (!scope) {
            scope = new Set();
            this.resourceScopes.push(scope);
        }
        scope.add(file);
    }

    ownFiles(value: RankValue | undefined): void {
        if (isKnownFileFree(value)) return;
        for (const file of containedFiles(value)) this.ownFile(file);
    }

    closeResources(resources: Set<RankFile>, preserved: Set<RankFile>): void {
        let firstError: unknown;
        for (const file of [...resources].reverse()) {
            if (preserved.has(file)) continue;
            try {
                closeFile(file);
            } catch (error) {
                firstError ??= error;
            }
        }
        if (firstError !== undefined) throw firstError;
    }
}

function containedFiles(value: RankValue | undefined): Set<RankFile> {
    const files = new Set<RankFile>();
    if (isKnownFileFree(value)) return files;
    const seen = new Set<object>();
    const pending: Iterator<RankValue | undefined>[] = [[value].values()];
    const captures = function* (scopes: readonly ReadonlyMap<string, RankValue>[]): IterableIterator<RankValue> {
        for (const scope of scopes) yield* scope.values();
    };
    while (pending.length > 0) {
        const next = pending[pending.length - 1].next();
        if (next.done) {
            pending.pop();
            continue;
        }
        const item = next.value;
        if (isKnownFileFree(item) || item === undefined || typeof item !== 'object' || seen.has(item)) continue;
        seen.add(item);
        if (isRankFile(item)) {
            files.add(item);
        } else if (isRankArray(item) && item.containsFiles === false) {
            continue;
        } else if (item instanceof RankDeque || item instanceof RankHeap) {
            pending.push(item.values());
        } else if (isRankSegment(item)) {
            pending.push(item.values());
        } else if (isRankArray(item) || isRankQueue(item)) {
            pending.push(item.items.values());
        } else if (isRankIndex(item) || isRankSet(item)
            || isRankObject(item) || isRankRecord(item)) {
            pending.push(item.entries.values());
        } else if (isRankGroupedTable(item)) {
            pending.push(item.groups.flatMap(group => group.rows).values());
        } else if (isRankCounter(item)) {
            pending.push(Array.from(item.entries.values(), entry => entry.value).values());
        } else if (isRankErrorValue(item)) {
            pending.push([item.value, item.cause].values());
        } else if (isNativeFunction(item)) {
            if (item.captures) pending.push(captures(item.captures));
        } else if (isRankSequence(item)) {
            if (item.plan.captures) pending.push(captures(item.plan.captures));
        }
    }
    return files;
}
