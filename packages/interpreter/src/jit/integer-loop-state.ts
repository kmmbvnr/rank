import { type LoopHost, type IntegerLoopPlan, type LoopTerm } from './integer-loop-plan.js';
import { compilerRejection } from './compiler-rejection.js';
import {
    isFunctionStatement, isStringLiteral, isApplicationExpression, flattenApplication, isNameExpression, findOperation,
    type Expression, type Statement, type ForStatement, type FunctionStatement,
} from '@arrrank/language';

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
export function createLoopState(statement: ForStatement | FunctionStatement, host: LoopHost, textSources: ReadonlySet<string>, textArrays: ReadonlySet<string>,
    failed: (reason: string) => void, numberMode: boolean, wideScalars: ReadonlySet<string> = new Set(), workCounting = false) {
    const zero = numberMode ? '0' : '0n', one = numberMode ? '1' : '1n';
    const safe = (code: string) => numberMode ? `safe(${code})` : code;
    const dirty = (slot: number) => numberMode ? `if (!d${slot}) d${slot} = ++order;` : '';
    const checkpoint = workCounting ? 'work++; checkpoint();' : 'checkpoint();';
    function reject(node: Expression | Statement, detail?: string): undefined {
        failed(compilerRejection('loop', node, detail));
        return undefined;
    }
    const localTypes: IntegerLoopPlan['localTypes'] = new Map();
    const names: string[] = [];
    if (isFunctionStatement(statement)) {
        for (const param of statement.parameters) {
            if (!param.includes('.')) names.push(param);
        }
    }
    const required = new Set<number>(), assigned = new Set<string>();
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
    const callouts: { expression: Expression; expectedType?: LoopTerm['type'] }[] = [];
    const loopScopes: LoopScope[] = [];
    const rootSetupLines: string[] = [];
    let branchDepth = 0;
    function canCallout(expression: Expression, hint?: LoopTerm['type']): boolean {
        if (numberMode) return false;
        if (hint === 'text') return false;
        if (isStringLiteral(expression)) return false;
        if (isApplicationExpression(expression)) {
            const names = flattenApplication(expression).filter(isNameExpression);
            if (names.length) {
                const op = findOperation(names.at(-1)!.name);
                if (!op || (op.result !== 'integer' && op.result !== 'boolean' && op.result !== 'real')) return false;
            } else {
                return false;
            }
        }
        return branchDepth > 0 && (host.evaluate !== undefined || host.callout !== undefined) && callouts.length < 16;
    }
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
        statement,
        host, numberMode, wideScalars, workCounting, checkpoint, textSources, textArrays, zero, one, safe, dirty, reject,
        localTypes, names, required, assigned, written, writers, binders, writerNames, binderNames,
        containers, builtins, calls, arrays, calleeArrays, indexedReads, arrayInputs, arrayDefinitions, aliases, localAliases, dequeArrays,
        vectorIterations, iterators, destinations, locations, callouts, canCallout,
        get branchDepth() { return branchDepth; },
        set branchDepth(v: number) { branchDepth = v; },
        exactInputs, serial: 0, sliceView: false, viewResult: '', hasArrayCall: false, hasControl: false, hasReturn: false, hasYield: false, needsAlgo: false,
        loopScopes, rootSetupLines, pushScope, popScope, currentScope,
    };
}

export type LoopCompilationState = ReturnType<typeof createLoopState>;
