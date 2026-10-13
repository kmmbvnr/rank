import type { ValueRequirement } from './analysis/requirements.js';
import { sameDim, type Dim } from './analysis/shape-index.js';
import { formatShapePattern, type ShapePattern } from './shape-signature.js';
import { instantiateTypeSignatures, typeVariableDomains } from './signature-matching.js';
export { instantiateTypeSignature, instantiateTypeSignatures, inferSignatureResultTypes } from './signature-matching.js';
import type { ValueFacts } from './analysis/value-domain.js';
import type { Operation } from './operations.js';
import { operationShapeFacts } from './analysis/operation-shape.js';
import { compactSignatures } from './signature-compaction.js';
import { isCollectionRequirement, matchesCollectionKind } from './collection-capabilities.js';

/** Public scalar/value categories. Concrete collection implementations all display as `c`. */
const VALUE_TYPES = new Set(['unknown', 'integer', 'real', 'number', 'boolean', 'text', 'symbol', 'missing',
    'date', 'datetime', 'duration', 'bytes', 'tuple', 'record', 'object', 'column', 'function', 'file', 'database']);

export function displayTypeName(name: string): string {
    const type = name === 'sqlite-expression' ? 'column' : name === 'sqlite-database' ? 'database' : name;
    return VALUE_TYPES.has(type) ? type : 'c';
}

/** Public language types for display. Compiler eligibility is a separate contract. */
export type SignatureAtom =
    | 'unknown' | 'integer' | 'real' | 'number' | 'boolean' | 'text' | 'symbol' | 'missing'
    | 'date' | 'datetime' | 'duration' | 'bytes' | 'array' | 'sequence' | 'tuple' | 'record'
    | 'table' | 'view' | 'column' | 'object' | 'function' | 'file' | 'database' | 'queue' | 'stack' | 'deque' | 'heap'
    | 'set' | 'counter' | 'multiset' | 'index' | 'graph' | 'dsu' | 'segment' | 'fenwick'
    | 'wavelet' | 'functional'
    /** A source of elements, matched by capability rather than nominal kind. */
    | 'iterable' | 'extrema-source' | 'boolean-source' | 'statistical-source' | 'reducible'
    | 'ordered-source' | 'sized' | 'shaped' | 'sortable' | 'distinct' | 'sliceable' | 'tensor';

export type SignatureContainer = 'array' | 'sequence' | 'queue' | 'stack' | 'deque' | 'heap'
    | 'set' | 'counter' | 'multiset';

/** Only an explicit variable can assert that two positions share a type. */
export type SignatureType = SignatureAtom
    | { readonly variable: number; readonly domain?: readonly SignatureAtom[] }
    | { readonly label: string }
    | { readonly union: readonly SignatureType[] }
    /** `rank` counts the axes of an array whose rank is proven, written `c[#, #]<integer>`. */
    | { readonly collection: SignatureAtom; readonly element: SignatureType; readonly rank?: number; readonly shape?: ShapePattern; readonly dims?: readonly (Dim | null)[] }
    /** Finite sugar for concrete collection rows; repeated IDs share their kind. */
    | { readonly container: number; readonly kinds: readonly SignatureContainer[]; readonly element: SignatureType }
    | { readonly tuple: readonly SignatureType[] }
    | { readonly callback: TypeSignature };

export interface TypeSignature {
    readonly inputs: readonly SignatureType[];
    readonly result: SignatureType;
    /** Cell ranks, when these are cell signatures lifted over collection frames. */
    readonly ranks?: readonly (number | 'all')[];
}

/** A proven array rank, for display; a sequence is always one lazy axis and needs none. */
function arrayRank(type: string, rank: number | undefined): { rank: number } | undefined {
    return type === 'array' && rank !== undefined && rank >= 1 ? { rank } : undefined;
}

/** Convert proven facts to display types; callers choose how unknown variables are named. */
export function signatureType(value: ValueFacts, unknown: () => SignatureType = () => 'unknown'): SignatureType {
    if (!value.types.length) return unknown();
    const members = value.types.map((name): SignatureType => {
        if (name === 'tuple' && value.tupleItems) return { tuple: value.tupleItems.map(item => signatureType(item, unknown)) };
        if (['array', 'sequence', 'queue', 'stack', 'deque', 'set', 'multiset', 'heap'].includes(name)
            && (value.elements?.length || name === 'array' && (value.shape || value.rank !== undefined))) return { collection: name as SignatureAtom,
            element: signatureType({ types: value.elements ?? [] }, unknown), ...arrayRank(name, value.rank),
            ...(name === 'array' && value.shape ? { shape: value.shape, ...(value.dims?.length === value.shape.length ? { dims: value.dims } : {}) } : {}) };
        return name === 'sqlite-expression' ? 'column' : name === 'sqlite-table' ? 'view'
            : name === 'sqlite-database' ? 'database' : name as SignatureAtom;
    });
    return members.length === 1 ? members[0] : { union: members };
}

export interface SignatureFormatOptions {
    readonly shortNumericNames?: boolean;
    /** Scalar cell ranks are implicit in the compact editor footer. */
    readonly compact?: boolean;
    readonly variableRequirements?: ReadonlyMap<number, ValueRequirement>;
}

/** Format facts supplied by the catalogue or analyzer; never infer them from operand names. */
export function formatTypeSignature(signature: TypeSignature, options: SignatureFormatOptions = {}): string {
    return formatSignature(signature, options);
}

interface SignatureNames {
    variable(domain: SignatureType | undefined, occurrence: number): string;
}

function variableNames(shortNumericNames: boolean | undefined): () => string {
    let next = 0;
    const fresh = (): string => {
        let index = next++;
        if (index === 2) return fresh(); // c is the container family, never a type variable.
        if (shortNumericNames && (index === 8 || index === 17)) return fresh();
        return index < 26 ? String.fromCharCode(97 + index) : `t${index + 1}`;
    };
    return fresh;
}

const domainKey = (domain: SignatureType | undefined): string => domain && typeof domain === 'object' && 'union' in domain
    ? JSON.stringify(domain.union.map(domainKey).sort()) : JSON.stringify(domain) ?? 'unbounded';

function formatSignature(signature: TypeSignature, options: SignatureFormatOptions, names?: SignatureNames): string {
    const variables = new Map<number, string>();
    const constraints = new Map<number, readonly SignatureAtom[]>();
    const domains = typeVariableDomains(signature);
    const occurrences = new Map<string, number>();
    const occurrence = (key: string): number => {
        const index = occurrences.get(key) ?? 0;
        occurrences.set(key, index + 1);
        return index;
    };
    const dimensions: Dim[] = [];
    const dimensionName = (dim: Dim): string => {
        let index = dimensions.findIndex(prior => sameDim(prior, dim));
        if (index < 0) { index = dimensions.length; dimensions.push(dim); }
        return ['n', 'm', 'k'][index] ?? `n${index + 1}`;
    };
    const fresh = variableNames(options.shortNumericNames);
    const type = (value: SignatureType, operand = false): string => {
        if (typeof value === 'string') return value === 'unknown' ? '?'
            : options.shortNumericNames && value === 'integer' ? 'i'
            : options.shortNumericNames && value === 'real' ? 'r' : displayTypeName(value);
        if ('label' in value) return `.${value.label}`;
        if ('variable' in value) {
            const required = options.variableRequirements?.get(value.variable);
            if (required?.domains?.length) {
                const cells = type({ union: required.domains as readonly SignatureAtom[] });
                const rank = required.rank;
                return `(${cells}) [rank ${rank.max === Infinity ? `≥ ${rank.min}` : rank.min === rank.max
                    ? rank.min : `${rank.min}..${rank.max}`}]`;
            }
            let name = variables.get(value.variable);
            if (!name) {
                const domain = domains?.get(value.variable);
                variables.set(value.variable, name = names
                    ? names.variable(domain, occurrence(`type:${domainKey(domain)}`)) : fresh());
            }
            if (value.domain) constraints.set(value.variable, value.domain);
            return name;
        }
        if ('union' in value) {
            const members = value.union.map(item => type(item));
            const integer = options.shortNumericNames ? 'i' : 'integer';
            const real = options.shortNumericNames ? 'r' : 'real';
            if (members.includes(integer) && members.includes(real)) {
                members.splice(Math.min(members.indexOf(integer), members.indexOf(real)), 0, 'number');
            }
            const compact = [...new Set(members.filter(item =>
                !members.includes('number') || ![integer, real].includes(item)))];
            const text = compact.join(' | ');
            return operand && compact.length > 1 ? `(${text})` : text;
        }
        if ('collection' in value) {
            if (value.collection === 'array' && value.shape) return `c[${formatShapePattern(value.shape.map((size, axis) => size ?? (value.dims?.[axis] ? dimensionName(value.dims[axis]!) : null)))}]<${type(value.element)}>`;
            // Exact rank: each `#` represents one axis of unknown size.
            if (value.collection === 'array' && value.rank) return `c[${Array(value.rank).fill('#').join(', ')}]<${type(value.element)}>`;
            return `c<${type(value.element)}>`;
        }
        if ('container' in value) {
            return `c<${type(value.element)}>`;
        }
        if ('tuple' in value) return `tuple(${value.tuple.map(item => type(item)).join(', ')})`;
        return `(${body(value.callback)})`;
    };
    const body = (value: TypeSignature): string => {
        const inputs = value.inputs.map(input => type(input, true)).join(' ');
        const result = type(value.result);
        const ranks = value.ranks && !(options.compact && value.ranks.every(rank => rank === 0))
            ? ` [rank ${value.ranks.join(' ')}]` : '';
        return `${inputs ? inputs + ' ' : ''}→ ${result}${ranks}`;
    };
    const formatted = body(signature);
    const bounds = [...constraints].map(([id, domain]) =>
        `${variables.get(id)}: ${type(domains?.get(id) ?? { union: domain })}`);
    return formatted + (bounds.length ? ` ; ${bounds.join(' ; ')}` : '');
}

/** Alternatives share a naming table, but never merge independent variables within one row. */
export function formatTypeSignatures(signatures: readonly TypeSignature[], options: SignatureFormatOptions = {}): string {
    const fresh = variableNames(options.shortNumericNames);
    const variables = new Map<string, string>();
    const names: SignatureNames = {
        variable(domain, occurrence) {
            const key = `${domainKey(domain)}:${occurrence}`;
            let name = variables.get(key);
            if (!name) variables.set(key, name = fresh());
            return name;
        },
    };
    const bodies = new Set<string>(), bounds = new Map<string, string>();
    for (const signature of signatures) {
        for (const part of formatSignature(signature, options, names).split(' ; ')) {
            if (part.includes('→')) bodies.add(part);
            else {
                const name = part.slice(0, part.indexOf(':'));
                if (!bounds.has(name)) bounds.set(name, part);
            }
        }
    }
    const formatted = [...bodies, ...bounds.values()];
    return options.compact ? abbreviateUnions(formatted) : formatted.join(' ; ');
}

/** A union abbreviation is an equality, not a shared type variable: its uses remain independent. */
function abbreviateUnions(formatted: readonly string[]): string {
    const rows = formatted.join(' ; ');
    const unions = new Map<string, number>();
    // Only flat atom unions in signature bodies. Bounds retain their full definitions.
    const atom = `(?:${[...VALUE_TYPES, 'i', 'r', 'c'].join('|')})`;
    const pattern = new RegExp(`\\b${atom}(?: \\| ${atom}){3,}\\b`, 'g');
    for (const row of rows.split(' ; ').filter(row => row.includes('→'))) {
        for (const match of row.matchAll(pattern)) unions.set(match[0], (unions.get(match[0]) ?? 0) + 1);
    }
    const aliases: [string, string][] = [];
    let index = 0;
    for (const [union, count] of unions) {
        if (count < 2) continue;
        let name: string;
        do { name = ['u', 'v', 'w'][index] ?? `u${index + 1}`; index++; }
        while (new RegExp(`\\b${name}\\b`).test(rows));
        aliases.push([union, name]);
    }
    const bodies = rows.split(' ; ').map(row => {
        if (!row.includes('→')) return row;
        for (const [union, name] of aliases) row = row.replace(new RegExp(`\\b${union.split('|').join('\\|')}\\b`, 'g'), name)
            .split(`(${name})`).join(name);
        return row;
    });
    return [...bodies, ...aliases.map(([union, name]) => `${name} = ${union}`)].join(' ; ');
}

/** Filter only proven domain mismatches. An incomplete or invalid call still shows the declared alternatives. */
export function matchingSignatures(signatures: readonly TypeSignature[], inputs: readonly ValueFacts[]): readonly TypeSignature[] {
    const arity = signatures.filter(signature => signature.inputs.length === inputs.length);
    const matches = (pattern: SignatureType, value: ValueFacts): boolean => {
        if (!value.types.length) return true;
        if (typeof pattern === 'string') return pattern === 'unknown' || value.types.some(type =>
            pattern === 'number' ? type === 'integer' || type === 'real'
                : pattern === 'column' ? type === 'sqlite-expression'
                : pattern === 'view' ? type === 'sqlite-table'
                : pattern === 'database' ? type === 'sqlite-database' : matchesCollectionKind(pattern, type));
        if ('label' in pattern) return value.types.includes('symbol');
        if ('variable' in pattern) return !pattern.domain || matches({ union: pattern.domain }, value);
        if ('union' in pattern) return pattern.union.some(part => matches(part, value));
        if ('collection' in pattern) return matches(pattern.collection, value)
            && (!value.elements?.length || matches(pattern.element, { types: value.elements }));
        if ('container' in pattern) return pattern.kinds.some(kind => matches(kind, value))
            && (!value.elements?.length || matches(pattern.element, { types: value.elements }));
        if ('tuple' in pattern) return value.types.includes('tuple') && (!value.tupleItems
            || pattern.tuple.length === value.tupleItems.length
                && pattern.tuple.every((part, index) => matches(part, value.tupleItems![index])));
        return value.types.includes('function');
    };
    const cell = (signature: TypeSignature, index: number): ValueFacts => {
        const value = inputs[index];
        return signature.ranks?.[index] === 0 && value.types.length === 1
            && ['array', 'bytes', 'sequence', 'queue', 'stack', 'deque'].includes(value.types[0])
            ? { types: value.types[0] === 'bytes' ? ['integer'] : value.elements ?? [] } : value;
    };
    const narrow = (pattern: SignatureType, value: ValueFacts): SignatureType => {
        if (!value.types.length) return pattern;
        if (typeof pattern === 'string') return isCollectionRequirement(pattern) && value.types.length === 1
            ? signatureType(value) : pattern;
        if ('union' in pattern) {
            const members = pattern.union.filter(part => matches(part, value)).map(part => narrow(part, value));
            return members.length === 1 ? members[0] : members.length ? { union: members } : pattern;
        }
        if ('collection' in pattern && value.elements?.length) {
            const collection = isCollectionRequirement(pattern.collection) && value.types.length === 1
                ? value.types[0] as SignatureAtom : pattern.collection;
            return { ...pattern, collection,
                element: narrow(pattern.element, { types: value.elements }), ...arrayRank(collection, value.rank),
                ...(collection === 'array' && !pattern.shape && value.shape ? { shape: value.shape } : {}) };
        }
        return pattern;
    };
    const candidates = arity.flatMap(signature => {
        const instantiated = instantiateTypeSignatures(signature,
            signature.inputs.map((_, index) => signatureType(cell(signature, index))));
        return instantiated.map(row => ({ ...row, inputs: row.inputs.map((pattern, index) =>
            narrow(pattern, cell(signature, index))) }));
    });
    return candidates.length ? candidates : arity;
}

/** Unknown metadata stays unknown; result roles and operand spelling are not type contracts. */
export function operationSignature(operation: Operation, inputs?: number | readonly ValueFacts[], options: SignatureFormatOptions = {}): string | undefined {
    if (options.compact && operation.signatures?.length && operation.argumentMapping) {
        const summary = argumentMappingSummary(operation.argumentMapping, inputs, options);
        if (summary) return summary;
    }
    const signatures = typeof inputs === 'number'
        ? operation.signatures?.filter(signature => signature.inputs.length === inputs)
        : inputs ? matchingSignatures(operation.signatures ?? [], inputs) : operation.signatures;
    // Shape facts describe the whole result, including frames around scalar cells.
    const shaped = typeof inputs === 'object' ? operationShapeFacts(operation, inputs) : undefined;
    const ranked = (signature: TypeSignature): TypeSignature => {
        const result = signature.result;
        if (!shaped) return signature;
        const shapeResult = (type: SignatureType): SignatureType => {
            if (typeof type === 'object' && 'collection' in type && type.collection === 'array')
                return { ...type, rank: shaped.rank, shape: shaped.shape?.map((size, index) =>
                    size ?? (type.shape?.length === shaped.shape?.length ? type.shape?.[index] ?? null : null)) };
            if (shaped.types.join() === 'array' && shaped.rank !== undefined && shaped.rank > 0
                && signature.inputs.some(input => typeof input === 'object'
                    && 'collection' in input && input.collection === 'array'))
                return { collection: 'array', element: type, rank: shaped.rank, shape: shaped.shape };
            return type;
        };
        // Matmul's empty output shape is a scalar; nonempty output shapes select its array row.
        if (operation.name === 'matmul' && typeof result === 'object' && 'union' in result) {
            const alternatives = result.union.filter(type => shaped.rank === 0
                ? typeof type === 'string' : typeof type === 'object' && 'collection' in type);
            if (alternatives.length === 1) return { ...signature, result: shapeResult(alternatives[0]) };
        }
        return { ...signature, result: shapeResult(result) };
    };
    if (!signatures?.length) return undefined;
    const rows = signatures.map(ranked);
    return options.compact ? formatTypeSignatures(compactSignatures(rows), options)
        : [...new Set(rows.map(signature => formatTypeSignature(signature, options)))].join(' ; ');
}

/** Explain argument-wise mapping once; proven calls continue through the full overload matcher. */
function argumentMappingSummary(mapping: NonNullable<Operation['argumentMapping']>, inputs: number | readonly ValueFacts[] | undefined,
    options: SignatureFormatOptions): string | undefined {
    if (typeof inputs === 'object' && inputs.every(input => input.types.length === 1
        && (input.types[0] !== 'array' || !!input.elements?.length))) return undefined;
    const arity = typeof inputs === 'number' ? inputs : inputs?.length;
    const bases = mapping.bases.filter(base => arity === undefined || base.inputs.length === arity);
    if (!bases.length) return undefined;
    const cells = typeof inputs === 'object' ? inputs.map((input): ValueFacts => {
        const types = input.types.includes('array') ? input.elements?.length
            ? [...new Set([...input.types.filter(type => type !== 'array'), ...input.elements])] : [] : input.types;
        return { types: types.includes('sqlite-expression') ? [] : types };
    }) : undefined;
    const selected = cells ? matchingSignatures(bases, cells) : bases;
    return [formatTypeSignatures(selected, options), 'containers: elementwise', 'SQL: column result',
        mapping.columns === 'recursive' ? 'containers + SQL: c<column> result' : 'containers + SQL: unsupported'].join(' ; ');
}
