import { findOperation, matchCompiledEffectSignature } from '@arrrank/language';
import { prepareGraphAdd } from './graph-mutation.js';
import { prepareSetAdd } from './collections.js';
import { currentDiagnostics } from './diagnostics.js';
import type { RankValue } from './value.js';

type Effect = (arguments_: RankValue[]) => void;
type Adapter = (receiver: RankValue | undefined) => Effect | undefined;
// Receiver adapters validate concrete runtime storage and method identities.
// Syntax lowering and loop execution never dispatch on operation/receiver names.
const adapters: Readonly<Record<string, Adapter>> = {
    'graph:add': prepareGraphAdd,
    'set:add': prepareSetAdd,
};

interface EffectHost {
    read(name: string): RankValue | undefined;
    module(name: string): boolean;
}

/** Rebind on every region entry, before any effects. A failed guard falls back
 * to ordinary dispatch, preserving module/type errors and operand evaluation. */
export function prepareEffectCall(host: EffectHost, name: string, receiver: string, inputs: readonly string[]): () =>
    ((arguments_: RankValue[]) => RankValue) | undefined {
    const profiles = findOperation(name)?.compiledEffects?.filter(signature => matchCompiledEffectSignature(signature, inputs)) ?? [];
    return () => {
        const value = host.read(receiver);
        for (const signature of profiles) {
            if (!host.module(signature.module)) continue;
            const adapter = adapters[`${signature.receiver}:${name}`];
            const call = adapter?.(value);
            if (call) return arguments_ => {
                const diagnostics = currentDiagnostics();
                if (diagnostics) diagnostics.compiledEffectCalls++;
                call(arguments_);
                return value!;
            };
        }
        return undefined;
    };
}
