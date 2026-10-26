import { checkValueMutable, valueProtection } from './value-protection.js';
import { IntegerEntries } from './integer-entries.js';
import { IndexEntries } from './index-storage.js';
import { MissingValueError, RankError } from './errors.js';
import { ResourceMap, ResourceSummary } from './resource-summary.js';
import { StoredValueSummary } from './stored-value.js';
import { RankDeque, RankHeap } from './containers.js';
import { RankMultiset } from './multiset.js';
import { dsuFrom } from './dsu.js';
import { setValueKey } from './set.js';
import { constructingTensorPlan, visitIntegerTensorMap } from './tensor-map.js';
import { currentDiagnostics } from './diagnostics.js';
import { checkpoint, privateLoopPolling, trackKeyedCollection } from './interrupt.js';
import { checkCollectionElementType, isRankArray, isRankCounter, isRankMultiset, isRankSet, type RankCounter, type RankCounterEntry, type RankSet, type RankValue } from './value.js';

// Only sets constructed here have a known storage callback. Host-provided maps
// and replacements must keep ordinary dispatch, where callbacks can re-enter Rank.
const ownedSets = new WeakMap<RankSet, { entries: ResourceMap<RankValue>; resources: ResourceSummary; valueOfEntry: (value: RankValue) => RankValue }>();
const mapMethods = Object.getOwnPropertyDescriptors(ResourceMap.prototype);
const integerMethods = Object.getOwnPropertyDescriptors(IntegerEntries.prototype);
const resourceMethods = Object.getOwnPropertyDescriptors(ResourceSummary.prototype);
const mapSet = Map.prototype.set;
const mapHas = Map.prototype.has;
const mapGet = Map.prototype.get;
const mapValues = Map.prototype.values;
const mapSize = Object.getOwnPropertyDescriptor(Map.prototype, 'size')!.get!;
const numericCounters = new WeakSet<object>();
const counterEntries = new WeakSet<object>();
const ownedCounters = new WeakMap<RankCounter, ResourceMap<RankCounterEntry, string | number | bigint>>();
const counterBuildMethods = [ResourceMap.prototype, ResourceSummary.prototype, StoredValueSummary.prototype]
    .map(prototype => ({ prototype, descriptors: Object.getOwnPropertyDescriptors(prototype) }));

function nativeCounterBuild(): boolean {
    return Map.prototype.get === mapGet && Map.prototype.set === mapSet && counterBuildMethods.every(({ prototype, descriptors }) =>
        Reflect.ownKeys(prototype).length === Reflect.ownKeys(descriptors).length
        && Reflect.ownKeys(descriptors).every(name => {
            const expected = Object.getOwnPropertyDescriptor(prototype, name);
            const original = descriptors[name as string];
            return expected?.value === original.value && expected?.get === original.get && expected?.set === original.set;
        }));
}

function counterKey(value: RankValue): string | number | bigint {
    if (typeof value === 'bigint') {
        const number = Number(value);
        return Number.isSafeInteger(number) ? number : value;
    }
    if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)) {
        return Number.isSafeInteger(value) ? value : BigInt(value);
    }
    return setValueKey(value);
}

function counterStorageKey(entries: RankCounter['entries'], key: string | number | bigint): string | number | bigint {
    return numericCounters.has(entries) || typeof key === 'string' ? key : `number:${key}`;
}

/** Runtime counters use exact numeric keys; foreign maps retain their string codec. */
export function counterValueKey(entries: RankCounter['entries'], value: RankValue): string | number | bigint {
    return counterStorageKey(entries, counterKey(value));
}

export function counterHas(counter: RankCounter, key: RankValue): boolean {
    const entries = counter.entries;
    return entries.has(counterValueKey(entries, key));
}

export function nativeSetMembership(): boolean {
    return Map.prototype.has === mapHas && [IntegerEntries.prototype, ResourceMap.prototype]
        .every(object => !Object.prototype.hasOwnProperty.call(object, 'has'));
}

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
    if (!nativeSetMembership() || Object.prototype.hasOwnProperty.call(entries, 'has')) return undefined;
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
    const entries = counter.entries;
    return entries.get(counterValueKey(entries, key))?.count ?? 0n;
}

export function counterFromTensor(value: RankValue): RankCounter | undefined {
    if (!isRankArray(value) || value.shape.length !== 1 || !constructingTensorPlan(value) || !nativeCounterBuild()) return undefined;
    const result = newStructure('counter') as RankCounter;
    if (!visitIntegerTensorMap(value, cell => { addToCollection(result, cell); })) return undefined;
    const diagnostics = currentDiagnostics();
    if (diagnostics) { diagnostics.compiledCounterBuilds++; diagnostics.compiledCounterKeys += value.shape[0]; }
    return result;
}

/** Native key graphs contain no callbacks, so gathering exact integer counts
 * can fold directly. Foreign readers retain ordinary eager gather ordering. */
export function sumCounterTensor(counter: RankCounter, keys: RankValue): bigint | undefined {
    if (!isRankArray(keys) || !privateLoopPolling() || !constructingTensorPlan(keys)) return undefined;
    // A host Map override can re-enter Rank and mutate key inputs. Never borrow
    // tensor storage across such a call, or replace the public lookup dispatch.
    const entries = ownedCounters.get(counter);
    if (!entries || Object.getOwnPropertyDescriptor(counter, 'entries')?.value !== entries
        || Object.getPrototypeOf(counter) !== Object.prototype || Object.getPrototypeOf(entries) !== ResourceMap.prototype
        || Map.prototype.get !== mapGet || Object.prototype.hasOwnProperty.call(entries, 'get')
        || Object.prototype.hasOwnProperty.call(ResourceMap.prototype, 'get')) return undefined;
    const keyCount = keys.shape.reduce((n, dimension) => n * dimension, 1);
    if (mapSize.call(entries) > keyCount) return undefined;
    // Public entries/counts may have been replaced by the host since creation.
    // Borrow key storage only while every lookup is an ordinary data read.
    for (const entry of mapValues.call(entries)) {
        checkpoint('preparing counter frequencies');
        if (!counterEntries.has(entry)
            || typeof Object.getOwnPropertyDescriptor(entry, 'count')?.value !== 'bigint') return undefined;
    }
    let answer = 0n;
    if (!visitIntegerTensorMap(keys, key => { answer += counterFrequency(counter, key); })) return undefined;
    const diagnostics = currentDiagnostics();
    if (diagnostics) { diagnostics.compiledCounterSums++; diagnostics.compiledCounterKeys += keyCount; }
    return answer;
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
            const entries = new ResourceMap<RankCounterEntry, string | number | bigint>(entry => entry.value);
            numericCounters.add(entries);
            const result = entries.resources.track({ kind: 'counter', entries });
            ownedCounters.set(result, entries);
            return result;
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
    const key = isRankCounter(receiver) ? counterKey(value) : setValueKey(value);
    const elementType = checkCollectionElementType(receiver.kind, () => receiver.elementType, value);
    receiver.elementType = elementType;
    trackKeyedCollection(receiver);
    if (isRankSet(receiver)) receiver.entries.set(key as string, value);
    else {
        const entries = receiver.entries;
        const existing = entries.get(counterStorageKey(entries, key));
        if (existing) existing.count += 1n;
        else {
            const entry = { value, count: 1n };
            counterEntries.add(entry);
            const destination = receiver.entries;
            destination.set(counterStorageKey(destination, key), entry);
        }
    }
    return receiver;
}

export function removeFromCollection(target: RankValue, value: RankValue): RankValue {
    checkValueMutable(target);
    if (isRankMultiset(target)) return target.remove(value);
    if (isRankCounter(target)) {
        const key = counterKey(value), entries = target.entries;
        const existing = entries.get(counterStorageKey(entries, key));
        if (!existing) throw new MissingValueError('counter does not contain the value');
        if (existing.count <= 1n) {
            const destination = target.entries;
            destination.delete(counterStorageKey(destination, key));
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
