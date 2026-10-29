import { type LoopHost, type IntegerLoopPlan } from './integer-loop-plan.js';
import { compilerRejection } from './compiler-rejection.js';
import { type Expression, type Statement } from '@arrrank/language';

export interface LoopRangeInfo {
    readonly startCode: string;
    readonly endCode: string;
    readonly operator: 'to' | 'till';
    readonly strideCode: string;
    readonly unitStride: boolean;
}

export interface LoopScope {
    readonly depth: number;
    readonly inductionVariable?: string;
    readonly inductionSlot?: number;
    readonly assigned: Set<string>;
    range?: LoopRangeInfo;
    readonly setupLines: string[];
    readonly bceGuards: Map<string, string>;       // key: `${slot}_${axis}` -> guard var
    readonly hoistedOffsets: Map<string, string>;  // key: `${slot}_${outerCoord}` -> rowBase var
}

/** Mutable facts belong to one compilation attempt, never an invocation frame. */
export function createLoopState(host: LoopHost, textSources: ReadonlySet<string>, textArrays: ReadonlySet<string>,
    failed: (reason: string) => void, numberMode: boolean, wideScalars: ReadonlySet<string> = new Set()) {
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
    const exactInputs = new Set<Expression>();
    const aliases: [string, string][] = [];
    const localAliases: [string, string][] = [];
    const dequeArrays = new Set<string>();
    const vectorIterations: IntegerLoopPlan['vectorIterations'] = [];
    const iterators: IntegerLoopPlan['iterators'] = [];
    const destinations: IntegerLoopPlan['destinations'] = new Map();
    const locations: Statement[] = [];
    const loopScopes: LoopScope[] = [];
    const rootSetupLines: string[] = [];
    function pushScope(inductionVariable?: string, inductionSlot?: number, range?: LoopRangeInfo): LoopScope {
        const scope: LoopScope = {
            depth: loopScopes.length,
            inductionVariable,
            inductionSlot,
            assigned: new Set(),
            range,
            setupLines: [],
            bceGuards: new Map(),
            hoistedOffsets: new Map(),
        };
        loopScopes.push(scope);
        return scope;
    }
    function popScope(): LoopScope | undefined {
        return loopScopes.pop();
    }
    function currentScope(): LoopScope | undefined {
        return loopScopes.length > 0 ? loopScopes[loopScopes.length - 1] : undefined;
    }
    return {
        host, numberMode, wideScalars, textSources, textArrays, zero, one, safe, dirty, reject,
        localTypes, names, required, assigned, written, writers, binders, writerNames, binderNames,
        containers, builtins, calls, arrays, calleeArrays, indexedReads, arrayInputs, arrayDefinitions, aliases, localAliases, dequeArrays,
        vectorIterations, iterators, destinations, locations,
        exactInputs, serial: 0, hasArrayCall: false, hasControl: false, hasReturn: false, hasYield: false, needsAlgo: false,
        loopScopes, rootSetupLines, pushScope, popScope, currentScope,
    };
}

export type LoopCompilationState = ReturnType<typeof createLoopState>;
