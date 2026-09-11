import { RankError } from './errors.js';
import type { RankArray, RankValue } from './value.js';

interface Storage {
    readonly shape: number[];
    readonly dimensions: readonly number[];
    readonly read: (index: number) => RankValue;
    readonly expose: () => RankValue[];
    exposed: boolean;
}

const owned = new WeakMap<object, Storage>();

/** Internal constructor: items must be a freshly allocated, unaliased JS array. */
export function ownedArray(items: RankValue[], shape: readonly number[]): RankArray {
    if (!items.every(item => typeof item === 'number' || typeof item === 'bigint' || typeof item === 'boolean')) {
        return { kind: 'array', items, shape };
    }
    const dimensions = [...shape];
    const arrayShape = [...dimensions];
    let storage: Storage;
    const result: RankArray = {
        kind: 'array', shape: arrayShape,
        get items() {
            storage.exposed = true;
            const descriptor = Object.getOwnPropertyDescriptor(result, 'items');
            if (descriptor?.get === storage.expose && descriptor.configurable) {
                // After exposure, ordinary reads should be ordinary data-field
                // reads too. Do not replace a host-installed or sealed getter.
                Object.defineProperty(result, 'items', {
                    value: items, writable: true, configurable: true, enumerable: descriptor.enumerable,
                });
            }
            return items;
        },
        set items(replacement) { storage.exposed = true; items = replacement; },
        // Once public storage escapes, it may receive files or accessor cells.
        get containsFiles() { return privateArrayStorage(result) ? false as const : undefined; },
    };
    storage = {
        shape: arrayShape, dimensions, exposed: false, read: index => items[index],
        expose: Object.getOwnPropertyDescriptor(result, 'items')!.get!,
    };
    owned.set(result, storage);
    return result;
}

/** A shallow snapshot for JS callers. Reading .items exposes mutable storage. */
export function createArraySnapshot(items: Iterable<RankValue>, shape?: readonly number[]): RankArray {
    const copied = Array.from(items);
    const dimensions = shape === undefined ? [copied.length] : [...shape];
    if (dimensions.some(size => !Number.isSafeInteger(size) || size < 0)
        || dimensions.reduce((size, dimension) => size * BigInt(dimension), 1n) !== BigInt(copied.length)) {
        throw new RankError('array snapshot shape does not match its items', 'DimensionMismatch');
    }
    return ownedArray(copied, dimensions);
}

/** Unknown objects (including proxies) are rejected without any property probe. */
export function privateArrayStorage(value: RankValue): Storage | undefined {
    if (typeof value !== 'object') return undefined;
    const storage = owned.get(value);
    if (!storage || storage.exposed) return undefined;
    // These identities were allocated here, so descriptor access cannot invoke
    // a Proxy trap. Replaced accessors, storage and shape take the ordinary path.
    if (Object.getOwnPropertyDescriptor(value, 'kind')?.value !== 'array'
        || Object.getOwnPropertyDescriptor(value, 'items')?.get !== storage.expose
        || Object.getOwnPropertyDescriptor(value, 'itemAt') !== undefined
        || Object.getPrototypeOf(value) !== Object.prototype
        || Object.getOwnPropertyDescriptor(Object.prototype, 'itemAt') !== undefined
        || Object.getOwnPropertyDescriptor(value, 'shape')?.value !== storage.shape
        || Object.getPrototypeOf(storage.shape) !== Array.prototype
        || storage.shape.length !== storage.dimensions.length) return undefined;
    for (let axis = 0; axis < storage.dimensions.length; axis++) {
        if (Object.getOwnPropertyDescriptor(storage.shape, axis)?.value !== storage.dimensions[axis]) return undefined;
    }
    return storage;
}
