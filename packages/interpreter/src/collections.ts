import { RankError } from './errors.js';
import { RankMultiset } from './multiset.js';
import { setValueKey } from './set.js';
import { isRankCounter, isRankMultiset, isRankSet, type RankValue } from './value.js';

export function newStructure(name: string): RankValue {
    switch (name) {
        case 'index': return { kind: 'index', entries: new Map() };
        case 'queue': return { kind: 'queue', items: [] };
        case 'set': return { kind: 'set', entries: new Map() };
        case 'counter': return { kind: 'counter', entries: new Map() };
        case 'multiset': return new RankMultiset();
        default: throw new RankError(`unknown structure: ${name}`);
    }
}

export function expectAddCollection(value: RankValue) {
    if (isRankSet(value) || isRankCounter(value) || isRankMultiset(value)) return value;
    throw new RankError('add expects a set, counter or multiset');
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
