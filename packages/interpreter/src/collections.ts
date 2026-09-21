import { MissingValueError, RankError } from './errors.js';
import { ResourceMap } from './resource-summary.js';
import { RankDeque, RankHeap } from './containers.js';
import { RankMultiset } from './multiset.js';
import { dsuFrom } from './dsu.js';
import { setValueKey } from './set.js';
import { isRankCounter, isRankMultiset, isRankSet, type RankCounterEntry, type RankValue } from './value.js';

export function newStructure(name: string): RankValue {
    switch (name) {
        case 'index': {
            const entries = new ResourceMap<RankValue>(value => value);
            return entries.resources.track({ kind: 'index', entries });
        }
        case 'queue': return new RankDeque();
        case 'deque': return new RankDeque('deque');
        case 'stack': return new RankDeque('stack');
        case 'heap': return new RankHeap();
        case 'set': {
            const entries = new ResourceMap<RankValue>(value => value);
            return entries.resources.track({ kind: 'set', entries });
        }
        case 'counter': {
            const entries = new ResourceMap<RankCounterEntry>(entry => entry.value);
            return entries.resources.track({ kind: 'counter', entries });
        }
        case 'multiset': return new RankMultiset();
        case 'orderedset': return new RankMultiset(true);
        case 'dsu': return dsuFrom();
        default: throw new RankError(`unknown structure: ${name}`);
    }
}

export function expectAddCollection(value: RankValue) {
    if (isRankSet(value) || isRankCounter(value) || isRankMultiset(value)) return value;
    // A graph takes `add` too, through its own dispatch, so name it here: the
    // usual mistake is a receiver that never became the collection it looks like.
    throw new RankError('add expects a graph, set, counter or multiset');
}

export function addToCollection(target: RankValue, value: RankValue): RankValue {
    const receiver = expectAddCollection(target);
    if (isRankMultiset(receiver)) return receiver.add(value);
    const key = setValueKey(value);
    if (isRankSet(receiver)) receiver.entries.set(key, value);
    else {
        const existing = receiver.entries.get(key);
        if (existing) existing.count += 1n;
        else receiver.entries.set(key, { value, count: 1n });
    }
    return receiver;
}

export function removeFromCollection(target: RankValue, value: RankValue): RankValue {
    if (isRankMultiset(target)) return target.remove(value);
    if (isRankCounter(target)) {
        const key = setValueKey(value);
        const existing = target.entries.get(key);
        if (!existing) throw new MissingValueError('counter does not contain the value');
        if (existing.count <= 1n) {
            target.entries.delete(key);
        } else {
            existing.count -= 1n;
        }
        return target;
    }
    if (!isRankSet(target)) throw new RankError('remove expects a set, counter or multiset');
    if (!target.entries.delete(setValueKey(value))) {
        throw new MissingValueError('set does not contain the value');
    }
    return target;
}

