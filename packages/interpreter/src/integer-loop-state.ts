import { type IterationBinding, type LoopHost, type LoopTerm } from './integer-loop-plan.js';
import { compilerRejection } from './compiler-rejection.js';
import { type Expression, type Statement } from '@arrrank/language';
import { type RankArray, type RankValue } from './value.js';
import { RankDeque } from './containers.js';

/** Mutable facts belong to one compilation attempt, never an invocation frame. */
export function createLoopState(host: LoopHost, textSources: ReadonlySet<string>, textArrays: ReadonlySet<string>,
    failed: (reason: string) => void, numberMode: boolean) {
    const zero = numberMode ? '0' : '0n', one = numberMode ? '1' : '1n';
    const safe = (code: string) => numberMode ? `safe(${code})` : code;
    const dirty = (slot: number) => numberMode ? `if (!d${slot}) d${slot} = ++order;` : '';
    function reject(node: Expression | Statement, detail?: string): undefined {
        failed(compilerRejection('loop', node, detail));
        return undefined;
    }
    const localTypes = new Map<string, LoopTerm['type']>();
    const names: string[] = [], required = new Set<number>(), assigned = new Set<string>();
    const writers: ((value: RankValue) => void)[] = [];
    const binders: ((value: RankValue) => void)[] = [];
    const writerNames: string[] = [], binderNames: string[] = [];
    const written = new Set<string>();
    const containers = new Map<string, { slot: number; kind: 'index' | 'deque'; integers: boolean; mode?: RankDeque['mode'] }>();
    const builtins = new Map<string, string>();
    const calls: { name: string; locals: readonly string[]; stableArrayReads: boolean;
        bind(): ((arguments_: RankValue[], tail?: boolean) => RankValue) | undefined }[] = [];
    const arrays = new Map<string, { slot: number; rank: number; type: LoopTerm['type'] }>();
    const calleeArrays = new Set<string>();
    const arrayInputs = new Set<string>(), arrayDefinitions = new Set<string>();
    const aliases: [string, string][] = [];
    const graphMutations: string[] = [];
    const vectorIterations: { slot: number; binding: IterationBinding }[] = [];
    const iterators: ((source: RankArray | RankDeque | string) => Iterable<RankValue>)[] = [];
    const destinations = new Map<string, { slot: number; rank: number; compound: boolean; type?: LoopTerm['type']; slice?: boolean }>();
    const locations: Statement[] = [];
    return {
        host, numberMode, textSources, textArrays, zero, one, safe, dirty, reject,
        localTypes, names, required, assigned, written, writers, binders, writerNames, binderNames,
        containers, builtins, calls, arrays, calleeArrays, arrayInputs, arrayDefinitions, aliases,
        graphMutations, vectorIterations, iterators, destinations, locations,
        serial: 0, hasControl: false, hasReturn: false, hasYield: false, needsAlgo: false,
    };
}

export type LoopCompilationState = ReturnType<typeof createLoopState>;
