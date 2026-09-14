import {
    isAssignmentStatement, isNameExpression, isFunctionStatement,
    type Statement,
} from '@arrrank/language';

interface Uses { reads: Map<string, number>; writes: Map<string, number>; safe: boolean }
const cache = new WeakMap<object, Uses>();

/** Lexical def/use summary. Captures, handlers and indirect module writes are
 * barriers until a richer control-flow analysis can reconstruct locals. */
export function privateTensorNames(first: Statement, names: string[]): boolean {
    if (names.length === 0) return true;
    let owner = first.$container;
    while (owner && !isFunctionStatement(owner)) owner = owner.$container as typeof owner;
    if (!owner || !isFunctionStatement(owner)) return false;
    let uses = cache.get(owner);
    if (!uses) {
        uses = { reads: new Map(), writes: new Map(), safe: true };
        const summary = uses;
        const write = (name: string) => summary.writes.set(name, (summary.writes.get(name) ?? 0) + 1);
        function visit(value: unknown): void {
            if (Array.isArray(value)) { value.forEach(visit); return; }
            if (!value || typeof value !== 'object') return;
            const node = value as Record<string, unknown>;
            if (isNameExpression(node)) summary.reads.set(node.name, (summary.reads.get(node.name) ?? 0) + 1);
            if (isAssignmentStatement(node)) write(node.name);
            else if (typeof node.name === 'string' && String(node.$type).endsWith('Statement')) write(node.name);
            if (Array.isArray(node.names)) for (const name of node.names) if (typeof name === 'string') write(name);
            if (['FunctionStatement', 'TryStatement', 'UseStatement', 'RunStatement', 'YieldStatement'].includes(String(node.$type))) summary.safe = false;
            for (const [key, child] of Object.entries(node)) if (!key.startsWith('$')) visit(child);
        }
        owner.parameters.forEach(write);
        visit(owner.statements);
        cache.set(owner, uses);
    }
    // Multiple uses inside the candidate are allowed; the caller verifies that
    // every read is inside its expression graph rather than elsewhere in code.
    return uses.safe && new Set(names).size === names.length
        && names.every(name => !name.includes('.') && uses!.writes.get(name) === 1);
}

export function tensorReadCount(first: Statement, name: string): number {
    let owner = first.$container;
    while (owner && !isFunctionStatement(owner)) owner = owner.$container as typeof owner;
    return owner ? cache.get(owner)?.reads.get(name) ?? 0 : 0;
}
