/** Capabilities are declared once per kind. Consumers name a capability, never a kind inventory. */
export type CollectionCapability = 'elements' | 'extrema' | 'booleans' | 'series' | 'reduce'
    | 'ordered' | 'sortable' | 'unique' | 'size' | 'shape' | 'slice' | 'tensor' | 'indexed' | 'positioned';

const arrayCapabilities = ['elements', 'extrema', 'booleans', 'series', 'reduce', 'ordered',
    'sortable', 'unique', 'size', 'shape', 'slice', 'tensor', 'indexed', 'positioned'] as const;
const queueCapabilities = ['elements', 'extrema', 'booleans', 'reduce', 'ordered', 'unique', 'size', 'shape', 'indexed'] as const;
const declare = <P extends string, C extends readonly CollectionCapability[]>(protocol: P, capabilities: C) => ({ protocol, capabilities });

export const collectionCapabilities = {
    array: declare('array', arrayCapabilities),
    bytes: declare('array', arrayCapabilities),
    sequence: declare('sequence', ['elements', 'extrema', 'booleans', 'series', 'reduce', 'ordered', 'unique', 'size', 'shape', 'slice', 'indexed', 'positioned']),
    queue: declare('queue', queueCapabilities),
    stack: declare('queue', queueCapabilities),
    deque: declare('queue', queueCapabilities),
    set: declare('set', ['elements', 'extrema', 'unique', 'size']),
    heap: declare('heap', ['booleans', 'size']),
    multiset: declare('multiset', ['extrema', 'size', 'shape']),
    text: declare('text', ['reduce', 'ordered', 'sortable', 'unique', 'size', 'shape', 'slice', 'indexed']),
    tuple: declare('tuple', ['size']),
    table: declare('table', ['size']),
    counter: declare('entries', ['size']),
    object: declare('entries', ['size']),
    graph: declare('sized', ['size']),
    dsu: declare('sized', ['size']),
    segment: declare('sized', ['size', 'shape']),
    wavelet: declare('sized', ['size', 'shape']),
} as const;

type Declaration = typeof collectionCapabilities[keyof typeof collectionCapabilities];
export type CollectionProtocol = Declaration['protocol'];

export function collectionProtocol(kind: string, capability: CollectionCapability): CollectionProtocol | undefined {
    const declaration = Object.prototype.hasOwnProperty.call(collectionCapabilities, kind)
        ? collectionCapabilities[kind as keyof typeof collectionCapabilities] : undefined;
    return declaration && (declaration.capabilities as readonly CollectionCapability[]).includes(capability)
        ? declaration.protocol : undefined;
}

export function capabilityKinds(capability: CollectionCapability): string[] {
    return Object.keys(collectionCapabilities).filter(kind => collectionProtocol(kind, capability) !== undefined);
}

type KindsWith<C extends CollectionCapability> = {
    [K in keyof typeof collectionCapabilities]: [C & typeof collectionCapabilities[K]['capabilities'][number]] extends [never] ? never : K
}[keyof typeof collectionCapabilities];
export type CollectionProtocolFor<C extends CollectionCapability> = typeof collectionCapabilities[KindsWith<C>]['protocol'];

/** Rebuilding is an associated result rule of the storage protocol, not of a consumer. */
const uniqueResults: Record<CollectionProtocolFor<'unique'>, string> = {
    array: 'array', sequence: 'sequence', queue: 'queue', text: 'text', set: 'same',
};
export function uniqueResultKind(kind: string): string | undefined {
    const protocol = collectionProtocol(kind, 'unique');
    if (!protocol) return undefined;
    const result = uniqueResults[protocol as keyof typeof uniqueResults];
    return result === 'same' ? kind : result;
}

export type ElementSourceProtocol = CollectionProtocolFor<'elements'>;
export const elementSourceProtocols = Object.fromEntries(capabilityKinds('elements').map(kind =>
    [kind, collectionProtocol(kind, 'elements')!])) as {
        [K in KindsWith<'elements'>]: typeof collectionCapabilities[K]['protocol']
    };
export function elementSourceProtocol(kind: string): ElementSourceProtocol | undefined {
    return collectionProtocol(kind, 'elements') as ElementSourceProtocol | undefined;
}

const requirements: Readonly<Record<string, CollectionCapability>> = {
    iterable: 'elements', 'extrema-source': 'extrema', 'boolean-source': 'booleans',
    'statistical-source': 'series', 'reducible': 'reduce', 'ordered-source': 'ordered',
    sized: 'size', shaped: 'shape', sortable: 'sortable', distinct: 'unique', sliceable: 'slice', tensor: 'tensor',
};

export function isCollectionRequirement(type: string): boolean {
    return Object.prototype.hasOwnProperty.call(requirements, type);
}

/** Abstract contracts match declared capabilities, independently of a concrete runtime kind. */
export function matchesCollectionKind(pattern: string, actual: string): boolean {
    if (pattern === actual) return true;
    const capability = requirements[pattern];
    return capability !== undefined && collectionProtocol(actual, capability) !== undefined;
}
