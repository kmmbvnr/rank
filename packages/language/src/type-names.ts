/** Runtime type symbols accepted by `is`, shared with static typing. */
export const RUNTIME_TYPE_NAMES: ReadonlySet<string> = new Set([
    'integer', 'real', 'boolean', 'text', 'date', 'datetime', 'duration',
    'array', 'bytes', 'symbol', 'missing', 'object', 'record', 'file', 'error', 'index',
    'queue', 'deque', 'stack', 'set', 'counter', 'multiset', 'fenwick',
    'segment', 'wavelet', 'heap', 'dsu', 'functional', 'function', 'sequence',
]);
