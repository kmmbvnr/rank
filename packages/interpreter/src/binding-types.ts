// Binding contracts retain type names, never values or storage proofs.
const types = new Map<string, ReadonlySet<string>>();

export function bindingTypes(type: string): ReadonlySet<string> {
    let known = types.get(type);
    if (!known) types.set(type, known = new Set([type]));
    return known;
}
