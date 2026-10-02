import { ArrayBindingContract } from './array-binding-contract.js';
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
    private arrayElements: Map<string, ArrayBindingContract> | undefined;
    private arrayRanks: Map<string, number> | undefined;
    // Set for the globals; see publish().
    private shared = false;

    constructor(
        readonly parent: LocalFrame | undefined,
        readonly layout = new Map<string, number>(),
    ) {}

    /** A frame whose values live in a map someone else also holds: the
     * globals, which a host reads and injects through `Interpreter.variables`. */
    static over(values: Map<string, RankValue>): LocalFrame {
        const frame = new LocalFrame(undefined);
        frame.mappedValues = values;
        frame.mappedTypes = new Map();
        frame.shared = true;
        return frame;
    }

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
        if (this.shared) {
            this.publish(name, value);
            return;
        }
        value = this.checkArray(name, value);
        noteBinding(value);
        if (this.mappedValues) {
            this.mappedValues.set(name, value);
            return;
        }
        this.slots[this.slotFor(name)] = value;
    }

    // A name arrives with both its value and the types it settles on.
    define(name: string, value: RankValue, types: ReadonlySet<string>, borrowed = false): void {
        if (this.shared) {
            this.publish(name, value);
            this.mappedTypes!.set(name, types);
            return;
        }
        value = this.checkArray(name, value);
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
    store(slot: number, name: string, value: RankValue, received: string): boolean {
        if (this.slots[slot] === undefined) return false;
        const accepted = this.slotTypes[slot];
        if (accepted === undefined || !accepted.has(received)) return false;
        if (isRankArray(value)) {
            const previous = this.slots[slot]!;
            if (!isRankArray(previous) || previous.shape.length !== value.shape.length) return false;
        }
        value = this.checkArray(name, value);
        noteBinding(value);
        this.slots[slot] = value;
        return true;
    }

    /** For a synchronous typed region after its first checked assignment.
     * The returned writer must not outlive that invocation or frame reset. */
    bindStore(name: string): (value: RankValue) => void {
        const slot = this.layout.get(name)!;
        return value => {
            value = this.checkArray(name, value);
            noteBinding(value);
            if (this.mappedValues) this.mappedValues.set(name, value);
            else this.slots[slot] = value;
        };
    }

    /** Forgets a name that ended with its block: its value and the types it accepted. */
    unset(name: string): void {
        this.arrayRanks?.delete(name);
        this.arrayElements?.delete(name);
        if (this.mappedValues) {
            this.mappedValues.delete(name);
            this.mappedTypes!.delete(name);
            return;
        }
        const slot = this.layout.get(name);
        if (slot === undefined) return;
        this.slots[slot] = undefined;
        this.slotTypes[slot] = undefined;
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

    /** Names holding a value or a type contract; a type can outlive its value. */
    names(): Set<string> {
        if (this.mappedValues) return new Set([...this.mappedValues.keys(), ...this.mappedTypes!.keys()]);
        const names = new Set<string>();
        for (const [name, slot] of this.layout) {
            if (this.slots[slot] !== undefined || this.slotTypes[slot] !== undefined) names.add(name);
        }
        return names;
    }

    rankOf(name: string): number | undefined {
        return this.arrayRanks?.get(name);
    }

    /** Copies another frame's contracts, so a fork rejects what the original would. */
    adoptContracts(source: LocalFrame): void {
        for (const name of source.names()) {
            const types = source.typeOf(name);
            if (types !== undefined) this.declareType(name, types);
            const elements = source.arrayElements?.get(name);
            if (elements) (this.arrayElements ??= new Map()).set(name, elements.copy());
            const rank = source.rankOf(name);
            if (rank !== undefined) (this.arrayRanks ??= new Map()).set(name, rank);
        }
    }

    reset(): boolean {
        if (this.mappedValues) return false;
        this.slots.length = 0;
        this.slotTypes.length = 0;
        this.arrayRanks?.clear();
        this.arrayElements?.clear();
        return true;
    }

    // A global is visible from the moment it is written. Reading a ranked
    // array's shape for the rank check can run a Rank function, and a debugger
    // paused there shows the new binding. A rejected rank restores the old value.
    private publish(name: string, value: RankValue): void {
        const values = this.mappedValues!;
        const previous = values.get(name);
        values.set(name, value);
        try {
            value = this.checkArray(name, value);
            values.set(name, value);
        } catch (error) {
            if (previous === undefined) values.delete(name);
            else values.set(name, previous);
            throw error;
        }
        noteBinding(value);
    }

    private checkArray(name: string, value: RankValue): RankValue {
        if (!isRankArray(value)) return value;
        const previous = this.arrayRanks?.get(name);
        const rank = checkBindingRank(name, previous, value)!;
        const contract = this.arrayElements?.get(name) ?? new ArrayBindingContract(name);
        const checked = contract.check(value);
        if (previous === undefined) (this.arrayRanks ??= new Map()).set(name, rank);
        (this.arrayElements ??= new Map()).set(name, contract);
        return checked;
    }

    checkArrayWrite(name: string, target: RankValue, replacements: readonly RankValue[]): readonly RankValue[] {
        if (!isRankArray(target)) return replacements;
        // Host-injected arrays acquire a contract on their first source write.
        if (!this.arrayElements?.has(name)) this.checkArray(name, target);
        return this.arrayElements!.get(name)!.write(replacements);
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
