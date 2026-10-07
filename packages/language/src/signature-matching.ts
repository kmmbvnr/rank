import type { SignatureContainer, SignatureType, TypeSignature } from './type-signature.js';

type Bindings = Map<number, SignatureType>;
const union = (members: readonly SignatureType[]): SignatureType => {
    const unique = [...new Map(members.map(member => [JSON.stringify(member), member])).values()];
    return unique.length === 1 ? unique[0] : { union: unique };
};
const members = (value: SignatureType): readonly SignatureType[] =>
    value === 'number' ? ['integer', 'real']
        : typeof value === 'object' && 'union' in value ? value.union : [value];

/** Intersection of finite nominal domains, without numeric promotion or shape solving. */
function intersect(left: SignatureType, right: SignatureType): SignatureType | undefined {
    if (left === 'unknown') return right;
    if (right === 'unknown') return left;
    if (left === 'number' || right === 'number'
        || typeof left === 'object' && 'union' in left || typeof right === 'object' && 'union' in right) {
        const results = members(left).flatMap(a => members(right).flatMap(b => {
            const result = intersect(a, b);
            return result === undefined ? [] : [result];
        }));
        return results.length ? union(results) : undefined;
    }
    if (typeof left === 'string' || typeof right === 'string') {
        if (left === right) return left;
        const atom = typeof left === 'string' ? left : right;
        const structured = typeof left === 'object' ? left : typeof right === 'object' ? right : undefined;
        if (structured && ('collection' in structured && structured.collection === atom
            || 'tuple' in structured && atom === 'tuple' || 'label' in structured && atom === 'symbol'
            || 'callback' in structured && atom === 'function')) return structured;
        return undefined;
    }
    if ('collection' in left && 'collection' in right && left.collection === right.collection) {
        if (left.rank !== undefined && right.rank !== undefined && left.rank !== right.rank) return undefined;
        const element = intersect(left.element, right.element);
        return element === undefined ? undefined : { collection: left.collection, element,
            ...((left.rank ?? right.rank) === undefined ? {} : { rank: left.rank ?? right.rank }) };
    }
    if ('tuple' in left && 'tuple' in right && left.tuple.length === right.tuple.length) {
        const items = left.tuple.map((item, index) => intersect(item, right.tuple[index]));
        return items.every(item => item !== undefined) ? { tuple: items } : undefined;
    }
    return JSON.stringify(left) === JSON.stringify(right) ? left : undefined;
}

function match(pattern: SignatureType, actual: SignatureType, bindings: Bindings): boolean {
    if (actual === 'unknown') return true;
    if (typeof pattern === 'string') return pattern === 'unknown' || intersect(pattern, actual) !== undefined;
    if ('variable' in pattern) {
        const domain = pattern.domain ? union(pattern.domain) : 'unknown';
        const accepted = intersect(domain, actual);
        const narrowed = accepted === undefined ? undefined : intersect(bindings.get(pattern.variable) ?? 'unknown', accepted);
        if (narrowed === undefined) return false;
        bindings.set(pattern.variable, narrowed);
        return true;
    }
    if ('union' in pattern || actual === 'number' || typeof actual === 'object' && 'union' in actual) {
        const patterns = 'union' in pattern ? pattern.union : [pattern];
        const alternatives: Bindings[] = [];
        for (const branch of patterns) for (const value of members(actual)) {
            const candidate = new Map(bindings);
            if (match(branch, value, candidate)) alternatives.push(candidate);
        }
        if (!alternatives.length) return false;
        // A branch that leaves a variable unbound cannot establish its result type.
        for (const id of alternatives[0].keys()) {
            if (alternatives.every(candidate => candidate.has(id)))
                bindings.set(id, union(alternatives.map(candidate => candidate.get(id)!)));
        }
        return true;
    }
    if ('collection' in pattern) {
        if (typeof actual === 'string') return actual === pattern.collection;
        return 'collection' in actual && actual.collection === pattern.collection
            && (pattern.rank === undefined || actual.rank === undefined || pattern.rank === actual.rank)
            && match(pattern.element, actual.element, bindings);
    }
    if ('tuple' in pattern) {
        if (actual === 'tuple') return true;
        return typeof actual === 'object' && 'tuple' in actual && pattern.tuple.length === actual.tuple.length
            && pattern.tuple.every((part, index) => match(part, actual.tuple[index], bindings));
    }
    if ('label' in pattern) return actual === 'symbol'
        || typeof actual === 'object' && 'label' in actual && pattern.label === actual.label;
    if ('container' in pattern) return false; // Expanded before nominal matching.
    if (actual === 'function') return true;
    return typeof actual === 'object' && 'callback' in actual
        && pattern.callback.inputs.length === actual.callback.inputs.length
        && pattern.callback.inputs.every((input, index) => match(input, actual.callback.inputs[index], bindings))
        && match(pattern.callback.result, actual.callback.result, bindings);
}

function substitute(pattern: SignatureType, bindings: Bindings): SignatureType {
    if (typeof pattern === 'string') return pattern;
    if ('variable' in pattern) return bindings.get(pattern.variable) ?? pattern;
    if ('union' in pattern) return union(pattern.union.map(part => substitute(part, bindings)));
    if ('collection' in pattern) return { ...pattern, element: substitute(pattern.element, bindings) };
    if ('tuple' in pattern) return { tuple: pattern.tuple.map(part => substitute(part, bindings)) };
    if ('callback' in pattern) return { callback: { ...pattern.callback,
        inputs: pattern.callback.inputs.map(part => substitute(part, bindings)),
        result: substitute(pattern.callback.result, bindings) } };
    return pattern;
}

export function typeVariableDomains(signature: TypeSignature): Map<number, SignatureType> | undefined {
    const domains = new Map<number, SignatureType>();
    let valid = true;
    const collect = (pattern: SignatureType): void => {
        if (typeof pattern === 'string') return;
        if ('variable' in pattern && pattern.domain) {
            const domain = pattern.domain.length ? intersect(domains.get(pattern.variable) ?? 'unknown', union(pattern.domain)) : undefined;
            if (domain === undefined) valid = false;
            else domains.set(pattern.variable, domain);
        } else if ('union' in pattern) pattern.union.forEach(collect);
        else if ('collection' in pattern || 'container' in pattern) collect(pattern.element);
        else if ('tuple' in pattern) pattern.tuple.forEach(collect);
        else if ('callback' in pattern) {
            pattern.callback.inputs.forEach(collect);
            collect(pattern.callback.result);
        }
    };
    signature.inputs.forEach(collect);
    collect(signature.result);
    return valid ? domains : undefined;
}

/** Kind variables are finite notation over concrete rows, not higher-kinded types. */
export function containerVariableDomains(signature: TypeSignature): Map<number, readonly SignatureContainer[]> {
    const domains = new Map<number, readonly SignatureContainer[]>();
    const collect = (type: SignatureType): void => {
        if (typeof type === 'string') return;
        if ('container' in type) {
            const prior = domains.get(type.container);
            domains.set(type.container, [...new Set(type.kinds)].filter(kind => !prior || prior.includes(kind)));
            collect(type.element);
        } else if ('collection' in type) collect(type.element);
        else if ('union' in type) type.union.forEach(collect);
        else if ('tuple' in type) type.tuple.forEach(collect);
        else if ('callback' in type) { type.callback.inputs.forEach(collect); collect(type.callback.result); }
    };
    signature.inputs.forEach(collect);
    collect(signature.result);
    return domains;
}

function mapSignatureTypes(signature: TypeSignature, transform: (type: SignatureType) => SignatureType): TypeSignature {
    const map = (type: SignatureType): SignatureType => {
        if (typeof type === 'string') return type;
        if ('collection' in type || 'container' in type) return transform({ ...type, element: map(type.element) });
        if ('union' in type) return { union: type.union.map(map) };
        if ('tuple' in type) return { tuple: type.tuple.map(map) };
        if ('callback' in type) return { callback: mapSignatureTypes(type.callback, transform) };
        return type;
    };
    return { ...signature, inputs: signature.inputs.map(map), result: map(signature.result) };
}

export function expandContainerSignatures(signature: TypeSignature): readonly TypeSignature[] {
    const domains = containerVariableDomains(signature);
    if (!domains.size) return [signature];
    let assignments: Map<number, SignatureContainer>[] = [new Map()];
    for (const [id, kinds] of domains) {
        assignments = assignments.flatMap(prior => kinds.map(kind => new Map(prior).set(id, kind)));
    }
    return assignments.map(assignment => mapSignatureTypes(signature, type =>
        typeof type === 'object' && 'container' in type
            ? { collection: assignment.get(type.container)!, element: type.element } : type));
}

/** Restore notation only when all concrete alternatives still describe the same element relationships. */
function collapseContainerRows(template: TypeSignature, rows: readonly TypeSignature[]): readonly TypeSignature[] {
    const kinds = containerVariableDomains(template);
    const restore = (pattern: SignatureType, actual: SignatureType): SignatureType => {
        if (typeof pattern === 'string' || typeof actual === 'string') return actual;
        if ('container' in pattern && 'collection' in actual)
            return { ...pattern, kinds: kinds.get(pattern.container)!, element: restore(pattern.element, actual.element) };
        if ('collection' in pattern && 'collection' in actual)
            return { ...actual, element: restore(pattern.element, actual.element) };
        if ('tuple' in pattern && 'tuple' in actual)
            return { tuple: actual.tuple.map((part, index) => restore(pattern.tuple[index], part)) };
        if ('union' in pattern && 'union' in actual && pattern.union.length === actual.union.length)
            return { union: actual.union.map((part, index) => restore(pattern.union[index], part)) };
        if ('callback' in pattern && 'callback' in actual)
            return { callback: restoreRow(pattern.callback, actual.callback) };
        return actual;
    };
    const restoreRow = (pattern: TypeSignature, row: TypeSignature): TypeSignature => ({ ...row,
        inputs: row.inputs.map((part, index) => restore(pattern.inputs[index], part)),
        result: restore(pattern.result, row.result) });
    const restored = rows.map(row => restoreRow(template, row));
    return restored.every(row => JSON.stringify(row) === JSON.stringify(restored[0])) ? restored.slice(0, 1) : rows;
}

/** Keep alternative rows correlated. A singular caller cannot choose an arbitrary kind. */
export function instantiateTypeSignatures(signature: TypeSignature, inputs: readonly SignatureType[]): readonly TypeSignature[] {
    const expanded = expandContainerSignatures(signature);
    const rows = expanded.flatMap(row => {
        const matched = instantiateConcreteSignature(row, inputs);
        return matched ? [matched] : [];
    });
    return rows.length > 1 && rows.length === expanded.length ? collapseContainerRows(signature, rows) : rows;
}

export function instantiateTypeSignature(signature: TypeSignature, inputs: readonly SignatureType[]): TypeSignature | undefined {
    const rows = instantiateTypeSignatures(signature, inputs);
    return rows.length === 1 ? rows[0] : undefined;
}

/** Match one complete correlated row. Unknown inputs remain unknown; failed rows never supply result facts. */
function instantiateConcreteSignature(signature: TypeSignature,
    inputs: readonly SignatureType[]): TypeSignature | undefined {
    if (signature.inputs.length !== inputs.length) return undefined;
    const domains = typeVariableDomains(signature);
    if (!domains) return undefined;
    const constrained = (pattern: SignatureType): SignatureType => {
        if (typeof pattern === 'string') return pattern;
        if ('variable' in pattern && domains.has(pattern.variable)) {
            const domain = domains.get(pattern.variable)!;
            return { ...pattern, domain: members(domain).filter((member): member is Extract<SignatureType, string> => typeof member === 'string') };
        }
        if ('union' in pattern) return { union: pattern.union.map(constrained) };
        if ('collection' in pattern) return { ...pattern, element: constrained(pattern.element) };
        if ('tuple' in pattern) return { tuple: pattern.tuple.map(constrained) };
        if ('callback' in pattern) return { callback: { ...pattern.callback,
            inputs: pattern.callback.inputs.map(constrained), result: constrained(pattern.callback.result) } };
        return pattern;
    };
    const patterns = signature.inputs.map(constrained);
    const bindings: Bindings = new Map();
    if (!patterns.every((pattern, index) => match(pattern, inputs[index], bindings))) return undefined;
    // Recheck after every shared variable has been narrowed, including constraints on later references.
    if (!patterns.every((pattern, index) => match(substitute(pattern, bindings), inputs[index], new Map()))) return undefined;
    return { ...signature, inputs: patterns.map(pattern => substitute(pattern, bindings)),
        result: substitute(constrained(signature.result), bindings) };
}

/** Successful nominal result domains only; unresolved variables stay unknown. */
export function inferSignatureResultTypes(signatures: readonly TypeSignature[],
    inputs: readonly SignatureType[]): readonly string[] | undefined {
    const nominal = (type: SignatureType): readonly string[] | undefined => {
        if (typeof type === 'string') return type === 'unknown' ? undefined
            : type === 'number' ? ['integer', 'real']
                : [type === 'column' ? 'sqlite-expression' : type === 'view' ? 'sqlite-table'
                    : type === 'database' ? 'sqlite-database' : type];
        if ('union' in type) {
            const values = type.union.map(nominal);
            return values.every(value => value !== undefined) ? [...new Set(values.flat())] : undefined;
        }
        if ('collection' in type) return [type.collection];
        if ('container' in type) return [...type.kinds];
        if ('tuple' in type) return ['tuple'];
        if ('label' in type) return ['symbol'];
        if ('callback' in type) return ['function'];
        return undefined;
    };
    const results = signatures.flatMap(signature => {
        return instantiateTypeSignatures(signature, inputs).map(row => nominal(row.result));
    });
    return results.length && results.every(result => result !== undefined) ? [...new Set(results.flat())] : undefined;
}
