import { checkValueMutable, valueProtection } from './value-protection.js';
import { IntegerEntries } from './integer-entries.js';
import { IndexEntries } from './index-storage.js';
import { MissingValueError, RankError } from './errors.js';
import { ResourceMap, ResourceSummary } from './resource-summary.js';
import { RankDeque, RankHeap } from './containers.js';
import { RankMultiset } from './multiset.js';
import { dsuFrom } from './dsu.js';
import { setValueKey } from './set.js';
import { checkpoint, trackKeyedCollection } from './interrupt.js';
import { checkCollectionElementType, isRankCounter, isRankMultiset, isRankSet, type RankCounter, type RankCounterEntry, type RankSet, type RankValue } from './value.js';

// Only sets constructed here have a known storage callback. Host-provided maps
// and replacements must keep ordinary dispatch, where callbacks can re-enter Rank.
const ownedSets = new WeakMap<RankSet, { entries: ResourceMap<RankValue>; resources: ResourceSummary; valueOfEntry: (value: RankValue) => RankValue }>();
const mapMethods = Object.getOwnPropertyDescriptors(ResourceMap.prototype);
const integerMethods = Object.getOwnPropertyDescriptors(IntegerEntries.prototype);
const resourceMethods = Object.getOwnPropertyDescriptors(ResourceSummary.prototype);
const mapSet = Map.prototype.set;

export function prepareSetAdd(value: RankValue | undefined): ((values: RankValue[]) => void) | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const storage = ownedSets.get(value as RankSet);
    if (!storage || Object.getPrototypeOf(value) !== Object.prototype) return undefined;
    const properties = Object.getOwnPropertyDescriptors(value);
    if (properties.kind?.value !== 'set' || properties.entries?.value !== storage.entries
        || properties.elementType && !('value' in properties.elementType)) return undefined;
    // Ordinary set dispatch checks protection before evaluating its operand.
    if (valueProtection(value)) return undefined;
    const contract = properties.elementType?.value;
    if (contract !== undefined) {
        // Only an ordinary scalar contract can be read without host callbacks.
        const fields = Object.getOwnPropertyDescriptors(contract);
        if (Object.getPrototypeOf(contract) !== Object.prototype || Reflect.ownKeys(fields).length !== 1
            || typeof fields.type?.value !== 'string') return undefined;
    }
    const entries = storage.entries;
    if (Map.prototype.set !== mapSet
        || Object.getOwnPropertyDescriptor(entries, 'resources')?.value !== storage.resources
        || Object.getOwnPropertyDescriptor(entries, 'valueOfEntry')?.value !== storage.valueOfEntry) return undefined;
    for (const [name, descriptor] of Object.entries(mapMethods)) {
        const current = Object.getOwnPropertyDescriptor(ResourceMap.prototype, name);
        if (current?.value !== descriptor.value || current?.get !== descriptor.get || current?.set !== descriptor.set
            || Object.prototype.hasOwnProperty.call(entries, name)
            || !Object.prototype.hasOwnProperty.call(integerMethods, name) && Object.prototype.hasOwnProperty.call(IntegerEntries.prototype, name)) return undefined;
    }
    const objects: [object, object, PropertyDescriptorMap][] = [
        [entries, IntegerEntries.prototype, integerMethods], [storage.resources, ResourceSummary.prototype, resourceMethods],
    ];
    for (const [object, prototype, methods] of objects) {
        if (Object.getPrototypeOf(object) !== prototype) return undefined;
        for (const [name, descriptor] of Object.entries(methods)) {
            const current = Object.getOwnPropertyDescriptor(prototype, name);
            if (Object.prototype.hasOwnProperty.call(object, name) || current?.value !== descriptor.value
                || current?.get !== descriptor.get || current?.set !== descriptor.set) return undefined;
        }
    }
    return values => {
        checkpoint('adding set element');
        addToCollection(value, values[0]);
    };
}

export function counterFrequency(counter: RankCounter, key: RankValue): bigint {
    return counter.entries.get(setValueKey(key))?.count ?? 0n;
}

export function newStructure(name: string): RankValue {
    switch (name) {
        case 'index': {
            const entries = new IndexEntries();
            return entries.resources.track({ kind: 'index', entries });
        }
        case 'queue': return new RankDeque();
        case 'deque': return new RankDeque('deque');
        case 'stack': return new RankDeque('stack');
        case 'heap': return new RankHeap();
        case 'set': {
            const valueOfEntry = (value: RankValue) => value;
            const entries = new IntegerEntries(valueOfEntry);
            const result = entries.resources.track({ kind: 'set', entries });
            ownedSets.set(result, { entries, resources: entries.resources, valueOfEntry });
            return result;
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
    if (isRankSet(value) || isRankCounter(value) || isRankMultiset(value)) { checkValueMutable(value); return value; }
    // A graph takes `add` too, through its own dispatch, so name it here: the
    // usual mistake is a receiver that never became the collection it looks like.
    throw new RankError('add expects a graph, set, counter or multiset');
}

export function addToCollection(target: RankValue, value: RankValue): RankValue {
    const receiver = expectAddCollection(target);
    if (isRankMultiset(receiver)) return receiver.add(value);
    const key = setValueKey(value);
    const elementType = checkCollectionElementType(receiver.kind, () => receiver.elementType, value);
    receiver.elementType = elementType;
    trackKeyedCollection(receiver);
    if (isRankSet(receiver)) receiver.entries.set(key, value);
    else {
        const existing = receiver.entries.get(key);
        if (existing) existing.count += 1n;
        else receiver.entries.set(key, { value, count: 1n });
    }
    return receiver;
}

export function removeFromCollection(target: RankValue, value: RankValue): RankValue {
    checkValueMutable(target);
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
