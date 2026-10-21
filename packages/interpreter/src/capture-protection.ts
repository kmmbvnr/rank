import { arrayResourceValues, denseScalarItems, noteArrayBinding } from './array-storage.js';
import { RankDeque, RankHeap } from './containers.js';
import { GraphValue } from './graph.js';
import { checkpoint } from './interrupt.js';
import { isRankPlan } from './plan.js';
import { protectValue, valueProtection } from './value-protection.js';
import {
    isNativeFunction, isRankArray, isRankCounter, isRankDsu, isRankGroupedTable, isRankIndex, isRankMultiset, isRankObject,
    isRankQueue, isRankRecord, isRankSegment, isRankSequence, isRankSet, isRankTable, isRankTableAlias, isRankTuple,
    type RankValue,
} from './value.js';

/** Inspect stored state and declared dependencies, never a lazy cell or iterator.
 * Publication is separate: a failed/cancelled binding must not freeze a prefix. */
export function prepareCaptureProtection(value: RankValue, message: string): () => void {
    const seen = new Set<object>();
    const values: RankValue[] = [];
    const arrays: RankValue[] = [];
    const pending: Iterator<RankValue>[] = [[value].values()];
    const captures = function* (scopes: readonly ReadonlyMap<string, RankValue>[]): IterableIterator<RankValue> {
        for (const scope of scopes) yield* scope.values();
    };
    while (pending.length) {
        checkpoint('protecting captured data');
        const next = pending[pending.length - 1].next();
        if (next.done) { pending.pop(); continue; }
        const item = next.value;
        if (typeof item !== 'object' || seen.has(item) || valueProtection(item)) continue;
        seen.add(item);
        values.push(item);
        let children: Iterable<RankValue> | undefined;
        if (isRankArray(item)) {
            arrays.push(item);
            if (denseScalarItems(item) === undefined) {
                children = arrayResourceValues(item) ?? (item.itemAt === undefined ? item.items : undefined);
            }
        } else if (isRankPlan(item)) children = item.dependencies.values();
        else if (isRankTuple(item)) children = item.items;
        else if (isRankRecord(item) || isRankObject(item) || isRankIndex(item) || isRankSet(item)) children = item.entries.values();
        else if (isRankCounter(item)) children = (function* () {
            for (const entry of item.entries.values()) yield entry.value;
        })();
        else if (item instanceof RankHeap) children = item.retainedValues();
        else if (item instanceof RankDeque || isRankMultiset(item) || isRankSegment(item)) children = item.values();
        else if (isRankQueue(item)) children = item.items;
        else if (item instanceof GraphValue) children = item.vertices.values();
        else if (isRankDsu(item)) children = item.values.values();
        else if (isRankTable(item)) children = (function* () {
            for (const column of item.columns) for (const cell of column.cells ?? []) {
                if (cell !== undefined) yield cell;
            }
        })();
        else if (isRankTableAlias(item)) children = [item.source];
        else if (isRankGroupedTable(item)) children = (function* () {
            for (const group of item.groups) yield* group.rows;
            if (item.columnar) yield item.columnar.table;
            if (item.rollingSource) yield item.rollingSource;
        })();
        else if (isRankSequence(item) && !item.plan.singlePass && item.plan.captures) children = captures(item.plan.captures);
        else if (isNativeFunction(item)) children = item.captureValues?.() ?? (item.captures && captures(item.captures));
        else if (item.kind === 'graph' && 'captures' in item) children = captures(item.captures);
        if (children) pending.push(children[Symbol.iterator]());
    }
    return () => {
        for (const array of arrays) noteArrayBinding(array);
        for (const item of values) protectValue(item, message);
    };
}
