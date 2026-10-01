export type TypeChoices = ReadonlySet<string> | readonly string[];

const has = (types: TypeChoices, type: string): boolean =>
    'has' in types ? types.has(type) : types.includes(type);

/**
 * A settled binding accepts each concrete replacement type in its contract.
 * `.NA` (type `missing`) fits every binding, which then keeps its own type, and
 * a binding that has only held `.NA` so far accepts any first value.
 */
export function acceptsBindingType(expected: TypeChoices, received: string): boolean {
    return received === 'missing' || has(expected, 'missing') || has(expected, received);
}

/** The type a binding settles on: one that has only held `.NA` takes the type of its first value. */
export function settledBindingTypes(expected: ReadonlySet<string>, received: TypeChoices): ReadonlySet<string>;
export function settledBindingTypes(expected: readonly string[], received: TypeChoices): readonly string[];
export function settledBindingTypes(expected: TypeChoices, received: TypeChoices): TypeChoices {
    const size = 'has' in expected ? expected.size : expected.length;
    if (size !== 1 || !has(expected, 'missing')) return expected;
    const concrete = [...received].filter(type => type !== 'missing');
    return concrete.length ? ('has' in expected ? new Set(concrete) : concrete) : expected;
}

/** Reject a runtime write if any of its possible values would break the binding. */
export function possibleBindingTypeConflict(expected: TypeChoices, received: TypeChoices): boolean {
    for (const type of received) if (!acceptsBindingType(expected, type)) return true;
    return false;
}

/** A static diagnostic needs proof that every possible value breaks the binding. */
export function provenBindingTypeConflict(expected: TypeChoices, received: TypeChoices): boolean {
    let known = false;
    for (const type of received) {
        known = true;
        if (acceptsBindingType(expected, type)) return false;
    }
    return known;
}

export function bindingRankConflict(expected: number | undefined, received: number | undefined): boolean {
    return expected !== undefined && received !== undefined && expected !== received;
}

export function bindingTypeMessage(
    name: string, expected: TypeChoices, received: TypeChoices, sort = false,
): string {
    const format = (types: TypeChoices) => (sort ? [...types].sort() : [...types]).join(' or ');
    return `${name} has type ${format(expected)} and cannot receive ${format(received)}`;
}

export function bindingRankMessage(name: string, expected: number, received: number): string {
    return `${name} has rank ${expected} and cannot receive rank ${received}`;
}
