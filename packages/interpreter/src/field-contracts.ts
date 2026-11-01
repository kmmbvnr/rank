import type { CollectionElementType } from './value.js';

function live(value: CollectionElementType): boolean {
    return value.type === 'record' || value.fields !== undefined || value.elements?.some(live) === true || value.positions?.some(live) === true;
}

function sameList(left: readonly CollectionElementType[] | undefined, right: readonly CollectionElementType[] | undefined): boolean {
    if (left === right) return true;
    if (!left || !right || left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) if (!sameImmutable(left[i], right[i])) return false;
    return true;
}

function sameImmutable(a: CollectionElementType, b: CollectionElementType): boolean {
    if (a === b) return true;
    if (a.type !== b.type || a.rank !== b.rank || a.type === 'record' || a.fields || b.fields) return false;
    return sameList(a.elements, b.elements) && sameList(a.positions, b.positions);
}

/** Runtime-owned field metadata. Array/tuple contracts are immutable; nested
 * record maps remain live and must use recursive signature/retention checks. */
export class FieldContracts extends Map<string, CollectionElementType> {
    private revision = {};
    private nested = 0;
    private tuples = 0;

    constructor() { super(); }

    override set(name: string, value: CollectionElementType): this {
        const previous = super.get(name);
        if (previous && sameImmutable(previous, value)) return this;
        if (previous !== value) {
            if (previous && live(previous)) this.nested--;
            if (previous?.type === 'tuple') this.tuples--;
            if (live(value)) this.nested++;
            if (value.type === 'tuple') this.tuples++;
            this.revision = {};
        }
        return super.set(name, value);
    }

    override delete(name: string): boolean {
        const previous = super.get(name);
        if (!super.delete(name)) return false;
        if (previous && live(previous)) this.nested--;
        if (previous?.type === 'tuple') this.tuples--;
        this.revision = {};
        return true;
    }

    override clear(): void {
        if (this.size) this.revision = {};
        this.nested = 0;
        this.tuples = 0;
        super.clear();
    }

    retentionIsNoop(): boolean { return this.nested === 0 && this.tuples === 0; }

    flatRevision(): object | undefined { return this.nested === 0 ? this.revision : undefined; }
}

export function flatFieldRevision(fields: ReadonlyMap<string, CollectionElementType>): object | undefined {
    return fields instanceof FieldContracts ? fields.flatRevision() : undefined;
}

export function fieldRetentionIsNoop(fields: ReadonlyMap<string, CollectionElementType>): boolean {
    return fields instanceof FieldContracts && fields.retentionIsNoop();
}
