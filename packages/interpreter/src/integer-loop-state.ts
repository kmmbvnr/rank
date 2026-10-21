import { type LoopHost, type IntegerLoopPlan } from './integer-loop-plan.js';
import { compilerRejection } from './compiler-rejection.js';
import { type Expression, type Statement } from '@arrrank/language';

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
    const localTypes: IntegerLoopPlan['localTypes'] = new Map();
    const names: string[] = [], required = new Set<number>(), assigned = new Set<string>();
    const writers: IntegerLoopPlan['writers'] = [];
    const binders: IntegerLoopPlan['binders'] = [];
    const writerNames: string[] = [], binderNames: string[] = [];
    const written = new Set<string>();
    const containers: IntegerLoopPlan['containers'] = new Map();
    const builtins = new Map<string, string>();
    const calls: IntegerLoopPlan['calls'] = [];
    const arrays: IntegerLoopPlan['arrays'] = new Map();
    const calleeArrays = new Set<string>();
    // One read per source at a named cursor; computed/repeated reads use undefined.
    const indexedReads = new Map<string, string | undefined>();
    const arrayInputs = new Set<string>(), arrayDefinitions = new Set<string>();
    const aliases: [string, string][] = [];
    const graphMutations: string[] = [];
    const vectorIterations: IntegerLoopPlan['vectorIterations'] = [];
    const iterators: IntegerLoopPlan['iterators'] = [];
    const destinations: IntegerLoopPlan['destinations'] = new Map();
    const locations: Statement[] = [];
    return {
        host, numberMode, textSources, textArrays, zero, one, safe, dirty, reject,
        localTypes, names, required, assigned, written, writers, binders, writerNames, binderNames,
        containers, builtins, calls, arrays, calleeArrays, indexedReads, arrayInputs, arrayDefinitions, aliases,
        graphMutations, vectorIterations, iterators, destinations, locations,
        serial: 0, hasArrayCall: false, hasControl: false, hasReturn: false, hasYield: false, needsAlgo: false,
    };
}

export type LoopCompilationState = ReturnType<typeof createLoopState>;
