/** Synchronous builtins that cannot run Rank callbacks or mutate bindings.
 * Keep this list explicit: a native function alone is not a purity proof.
 * `same` requires the type of the first argument, not array broadcasting. */
export type LoopAtomType = 'integer' | 'boolean' | 'text' | 'bytes';
interface Signature {
    readonly module: string;
    readonly inputs: readonly (LoopAtomType | 'text-or-bytes' | 'text-array' | 'same')[];
    readonly result: LoopAtomType;
}
export const loopBuiltins: Readonly<Record<string, Signature>> = {
    bytes: { module: 'core', inputs: ['text-or-bytes'], result: 'bytes' },
    md5: { module: 'crypto', inputs: ['text-or-bytes'], result: 'bytes' },
    startswith: { module: 'text', inputs: ['text-or-bytes', 'same'], result: 'boolean' },
    lower: { module: 'text', inputs: ['text'], result: 'text' },
    codepoint: { module: 'text', inputs: ['text'], result: 'integer' },
    character: { module: 'text', inputs: ['integer'], result: 'text' },
    join: { module: 'text', inputs: ['text-array', 'text'], result: 'text' },
};
