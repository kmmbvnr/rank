import type { RankValue } from './value.js';

// A call links to its definition's environment, never to the caller's locals.
// Closures and suspended generators keep these frames alive by reference.
export class LocalFrame {
    private mappedValues: Map<string, RankValue> | undefined;
    readonly slots: (RankValue | undefined)[] = [];
    readonly types = new Map<string, ReadonlySet<string>>();

    constructor(
        readonly parent: LocalFrame | undefined,
        readonly layout = new Map<string, number>(),
    ) {}

    // Maps are only needed by escaping captures and scope-owned collections.
    // Once exposed they remain the source of truth for that frame.
    get values(): Map<string, RankValue> {
        if (!this.mappedValues) {
            this.mappedValues = new Map();
            for (const [name, slot] of this.layout) {
                const value = this.slots[slot];
                if (value !== undefined) this.mappedValues.set(name, value);
            }
            this.slots.length = 0;
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
        if (this.mappedValues) {
            this.mappedValues.set(name, value);
            return;
        }
        let slot = this.layout.get(name);
        if (slot === undefined) {
            slot = this.layout.size;
            this.layout.set(name, slot);
        }
        this.slots[slot] = value;
    }

    reset(): boolean {
        if (this.mappedValues) return false;
        this.slots.length = 0;
        this.types.clear();
        return true;
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
}
