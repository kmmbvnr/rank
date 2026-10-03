import { argumentSignature } from './return-contract.js';
import type { RankValue } from './value.js';

interface PrimitiveNode<T> {
    readonly children: Map<string, PrimitiveNode<T>>;
    value?: T;
}

/** Per-owner preparation, keyed by types rather than argument values. Primitive
 * domains have fixed ranks (text is rank 1), so their path needs no serialization.
 * Structural inputs retain the semantic signature and its mutation checks. */
export class CallSpecializations<T> {
    private readonly primitives: PrimitiveNode<T> = { children: new Map() };
    private readonly structural = new Map<string, T>();

    get(arguments_: readonly RankValue[]): T | undefined {
        if (arguments_.some(value => typeof value === 'object')) return this.structural.get(argumentSignature(arguments_));
        let node = this.primitives;
        for (const value of arguments_) {
            const next = node.children.get(typeof value);
            if (!next) return undefined;
            node = next;
        }
        return node.value;
    }

    set(arguments_: readonly RankValue[], value: T): void {
        if (arguments_.some(value => typeof value === 'object')) {
            this.structural.set(argumentSignature(arguments_), value);
            return;
        }
        let node = this.primitives;
        for (const argument of arguments_) {
            const type = typeof argument;
            let next = node.children.get(type);
            if (!next) node.children.set(type, next = { children: new Map() });
            node = next;
        }
        node.value = value;
    }
}
