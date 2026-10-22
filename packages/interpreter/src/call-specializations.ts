import { argumentSignature } from './return-contract.js';
import type { RankValue } from './value.js';
import { typeName } from './value.js';
import { isRankPlan } from './plan.js';

function primitiveType(value: RankValue): string | undefined {
    if (typeof value !== 'object') return typeof value;
    if (!isRankPlan(value)) return undefined;
    switch (typeName(value)) {
        case 'integer': return 'bigint';
        case 'real': return 'number';
        case 'boolean': return 'boolean';
        case 'text': return 'string';
        default: return undefined;
    }
}

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
        if (arguments_.some(value => primitiveType(value) === undefined)) return this.structural.get(argumentSignature(arguments_));
        let node = this.primitives;
        for (const value of arguments_) {
            const next = node.children.get(primitiveType(value)!);
            if (!next) return undefined;
            node = next;
        }
        return node.value;
    }

    set(arguments_: readonly RankValue[], value: T): void {
        if (arguments_.some(value => primitiveType(value) === undefined)) {
            this.structural.set(argumentSignature(arguments_), value);
            return;
        }
        let node = this.primitives;
        for (const argument of arguments_) {
            const type = primitiveType(argument)!;
            let next = node.children.get(type);
            if (!next) node.children.set(type, next = { children: new Map() });
            node = next;
        }
        node.value = value;
    }
}
