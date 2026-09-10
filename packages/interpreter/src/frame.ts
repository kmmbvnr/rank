import type { RankValue } from './value.js';

// A call links to its definition's environment, never to the caller's locals.
// Closures and suspended generators keep these frames alive by reference.
export class LocalFrame {
    readonly values = new Map<string, RankValue>();
    readonly types = new Map<string, ReadonlySet<string>>();

    constructor(readonly parent: LocalFrame | undefined) {}

    find(name: string): LocalFrame | undefined {
        for (let frame: LocalFrame | undefined = this; frame; frame = frame.parent) {
            if (frame.values.has(name)) return frame;
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
