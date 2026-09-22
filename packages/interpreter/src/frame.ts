import { noteArrayBinding, noteArrayBorrow } from './array-storage.js';
import { checkBindingRank, isRankArray, type RankValue } from './value.js';

// Every write to a name passes here, and most of them carry a number or a
// string. Reaching into another module to learn that costs more than asking
// first, so only a value that could be an array leaves this one.
function noteBinding(value: RankValue, borrowed = false): void {
    if (typeof value === 'object') {
        if (borrowed) noteArrayBorrow(value);
        else noteArrayBinding(value);
    }
}

// A call links to its definition's environment, never to the caller's locals.
// Closures and suspended generators keep these frames alive by reference.
export class LocalFrame {
    private mappedValues: Map<string, RankValue> | undefined;
    private mappedTypes: Map<string, ReadonlySet<string>> | undefined;
    readonly slots: (RankValue | undefined)[] = [];
    // The types a name accepts live in its own slot, so a write that already
    // knows the slot checks them without looking the name up a second time.
    private readonly slotTypes: (ReadonlySet<string> | undefined)[] = [];
    private arrayRanks: Map<string, number> | undefined;

    constructor(
        readonly parent: LocalFrame | undefined,
        readonly layout = new Map<string, number>(),
    ) {}

    // Maps are only needed by escaping captures and scope-owned collections.
    // Once exposed they remain the source of truth for that frame.
    get values(): Map<string, RankValue> {
        if (!this.mappedValues) {
            const values = new Map<string, RankValue>();
            const types = new Map<string, ReadonlySet<string>>();
            for (const [name, slot] of this.layout) {
                const value = this.slots[slot];
                if (value !== undefined) values.set(name, value);
                const accepted = this.slotTypes[slot];
                if (accepted !== undefined) types.set(name, accepted);
            }
            this.mappedValues = values;
            this.mappedTypes = types;
            this.slots.length = 0;
            this.slotTypes.length = 0;
        }
        return this.mappedValues;
    }

    read(slot: number, name: string): RankValue | undefined {
        return this.mappedValues ? this.mappedValues.get(name) : this.slots[slot];
    }

    get(name: string): RankValue | undefined {
        if (this.mappedValues) return this.mappedValues.get(name);
        const slot = this.layout.get(name);
        return slot === undefined ? undefined : this.slots[slot];
    }

    set(name: string, value: RankValue): void {
        this.checkRank(name, value);
        noteBinding(value);
        if (this.mappedValues) {
            this.mappedValues.set(name, value);
            return;
        }
        this.slots[this.slotFor(name)] = value;
    }

    // A name arrives with both its value and the types it settles on.
    define(name: string, value: RankValue, types: ReadonlySet<string>, borrowed = false): void {
        this.checkRank(name, value);
        noteBinding(value, borrowed);
        if (this.mappedValues) {
            this.mappedValues.set(name, value);
            this.mappedTypes!.set(name, types);
            return;
        }
        const slot = this.slotFor(name);
        this.slots[slot] = value;
        this.slotTypes[slot] = types;
    }

    // Writing the same name over and over settles on one slot, so a caller that
    // resolved it once can store straight into it. The write only stands while
    // this frame still holds the name and keeps the types it already accepts;
    // anything else reports back and takes the long way through assign.
    store(slot: number, value: RankValue, received: string): boolean {
        if (this.slots[slot] === undefined) return false;
        const accepted = this.slotTypes[slot];
        if (accepted === undefined || !accepted.has(received)) return false;
        if (isRankArray(value)) {
            const previous = this.slots[slot]!;
            if (!isRankArray(previous) || previous.shape.length !== value.shape.length) return false;
        }
        noteBinding(value);
        this.slots[slot] = value;
        return true;
    }

    /** For a synchronous typed region after its first checked assignment.
     * The returned writer must not outlive that invocation or frame reset. */
    bindStore(name: string): (value: RankValue) => void {
        const slot = this.layout.get(name)!;
        return value => {
            noteBinding(value);
            if (this.mappedValues) this.mappedValues.set(name, value);
            else this.slots[slot] = value;
        };
    }

    typeOf(name: string): ReadonlySet<string> | undefined {
        if (this.mappedTypes) return this.mappedTypes.get(name);
        const slot = this.layout.get(name);
        return slot === undefined ? undefined : this.slotTypes[slot];
    }

    declareType(name: string, types: ReadonlySet<string>): void {
        if (this.mappedTypes) {
            this.mappedTypes.set(name, types);
            return;
        }
        this.slotTypes[this.slotFor(name)] = types;
    }

    reset(): boolean {
        if (this.mappedValues) return false;
        this.slots.length = 0;
        this.slotTypes.length = 0;
        this.arrayRanks?.clear();
        return true;
    }

    private checkRank(name: string, value: RankValue): void {
        if (!isRankArray(value)) return;
        const previous = this.arrayRanks?.get(name);
        const rank = checkBindingRank(name, previous, value)!;
        if (previous === undefined) (this.arrayRanks ??= new Map()).set(name, rank);
    }

    // Reading a variable only wants the value, so the walk keeps it rather than
    // handing back a frame the caller has to look the name up in a second time.
    lookup(name: string): RankValue | undefined {
        for (let frame: LocalFrame | undefined = this; frame; frame = frame.parent) {
            const value = frame.get(name);
            if (value !== undefined) return value;
        }
        return undefined;
    }

    find(name: string): LocalFrame | undefined {
        for (let frame: LocalFrame | undefined = this; frame; frame = frame.parent) {
            if (frame.get(name) !== undefined) return frame;
        }
        return undefined;
    }

    // Resource ownership needs to inspect all values reachable through a closure.
    captures(): Map<string, RankValue>[] {
        const scopes: Map<string, RankValue>[] = [];
        for (let frame: LocalFrame | undefined = this; frame; frame = frame.parent) {
            scopes.push(frame.values);
        }
        return scopes.reverse();
    }

    private slotFor(name: string): number {
        let slot = this.layout.get(name);
        if (slot === undefined) {
            slot = this.layout.size;
            this.layout.set(name, slot);
        }
        return slot;
    }
}
