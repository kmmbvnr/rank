import { joinValueFacts, stableRecordField, TRACKED_COLLECTIONS, type ValueFacts } from './value-domain.js';

export const isTrackedCollection = (fact: ValueFacts | undefined): boolean =>
    fact?.collectionId !== undefined && fact.types.length === 1 && TRACKED_COLLECTIONS.includes(fact.types[0]);

/** Cell types a summary may insert into or remove from a tracked collection without running user code. */
const SUMMARIZED_ELEMENTS = ['integer', 'real', 'boolean', 'text', 'symbol', 'record'];

export const summarizedElement = (value: ValueFacts): boolean =>
    value.types.length > 0 && value.types.every(type => SUMMARIZED_ELEMENTS.includes(type))
    && (value.types.join() === 'record' || value.rank === 0 || value.types.join() === 'text');

/** What a collection's facts claim about its contents after it receives one value of the given facts. */
export function withInsertedElement(collection: ValueFacts, value: ValueFacts): ValueFacts {
    const accepted = collection.elements;
    if (!value.types.length) {
        // The inserted value's type is unknown, so no claim about the contents survives. A populated
        // collection stays homogeneous in type, but an empty one has no type to keep.
        return accepted?.length ? { ...collection, elementRecord: undefined }
            : { ...collection, collectionId: undefined, elements: undefined, elementRecord: undefined };
    }
    // Records in one collection may differ, so keep only what every insertion shares.
    const schema = value.types.join() === 'record' ? stableRecordField(value) : undefined;
    const elementRecord = !schema ? undefined
        : accepted?.length ? collection.elementRecord && joinValueFacts([collection.elementRecord, schema])
            : schema;
    return { ...collection, elements: accepted?.length ? accepted : value.types, elementRecord };
}
