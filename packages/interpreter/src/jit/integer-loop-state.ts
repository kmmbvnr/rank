import { integerRangeFacts } from './integer-range-facts.js';
import { AstUtils, type AstNode } from 'langium';
import { INTERRUPT_POLL_INTERVAL } from '../interrupt.js';
import { type LoopHost, type IntegerLoopPlan, type LoopTerm, type LoopPolling } from './integer-loop-plan.js';
import { compilerRejection } from './compiler-rejection.js';
import {
    isFunctionStatement, isReturnStatement, statementResultDiscarded, isArrayAssignmentStatement, isAssignmentStatement, isParenthesizedExpression, isUnpackStatement, isStringLiteral, isApplicationExpression, flattenApplication, isNameExpression, findOperation,
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
    readonly stableStores: ReadonlySet<string>;
    readonly preparedOwners: Set<number>;
    readonly hoistedOffsets: Map<string, string>;  // key: `${slot}_${outerCoord}` -> rowBase var
}

/** Mutable facts belong to one compilation attempt, never an invocation frame. */
export function createLoopState(statement: ForStatement | FunctionStatement, host: LoopHost, textSources: ReadonlySet<string>, textArrays: ReadonlySet<string>,
    failed: (reason: string) => void, numberMode: boolean, wideScalars: ReadonlySet<string> = new Set(), workCounting = false, polling: LoopPolling = 'checked') {
    const zero = numberMode ? '0' : '0n', one = numberMode ? '1' : '1n';
    const safe = (code: string) => numberMode ? `safe(${code})` : code;
    const dirty = (slot: number) => numberMode ? `if (!d${slot}) d${slot} = ++order;` : '';
    const checkpoint = workCounting ? 'work++; checkpoint();' : polling === 'none' ? ''
        : polling === 'batched' ? `if (++pollWork === ${INTERRUPT_POLL_INTERVAL}) { pollWork = 0; checkpoint(undefined, ${INTERRUPT_POLL_INTERVAL}); }` : 'checkpoint();';
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
    // Address guards must see later rebindings too, before any stores emit.
    const reboundNames = new Set<string>();
    let ownershipChecks = false;
    for (const node of AstUtils.streamAllContents(statement)) {
        if (isAssignmentStatement(node)) {
            reboundNames.add(node.name);
            let value = node.value;
            while (isParenthesizedExpression(value)) value = value.value;
            if (node.operator === '=' && isNameExpression(value)) ownershipChecks = true;
        }
        if (isUnpackStatement(node)) node.names.forEach(name => reboundNames.add(name));
    }
    // Only direct selector uses may keep an affine snapshot. Ordinary array
    // arithmetic, aliases, mutation and unused completed bindings retain the
    // existing materialized array path instead of losing its specialization.
    function selectorRange(name: string): boolean {
        const nodes = [statement, ...AstUtils.streamAllContents(statement)];
        const uses = nodes.filter(isNameExpression).filter(node => node.name === name);
        const selectors = new Set<Expression>();
        const add = (value: Expression | undefined) => {
            while (value && isParenthesizedExpression(value)) value = value.value;
            if (value && isNameExpression(value) && value.name === name) selectors.add(value);
        };
        for (const node of nodes) {
            if (isArrayAssignmentStatement(node)) {
                if (node.name === name) return false;
                node.indices.forEach(index => add(index.value));
            }
            if (isApplicationExpression(node)) {
                const parts = flattenApplication(node);
                if (parts.length > 1 && isNameExpression(parts[0]) && parts[0].name !== name) add(parts.at(-1));
            }
        }
        return uses.length > 0 && uses.every(node => selectors.has(node));
    }
    /** The caller's terminal return is outside a numeric function prefix.
     * Earlier prefix statements can still replace a nested store's result. */
    function resultDiscarded(node: Statement): boolean {
        if (!isFunctionStatement(statement)) return statementResultDiscarded(node, statement);
        if (!isReturnStatement(statement.statements.at(-1))) return false;
        let ancestor: AstNode | undefined = node;
        for (let depth = 0; ancestor && ancestor.$container !== statement && depth < 128; depth++) ancestor = ancestor.$container;
        if (!ancestor || ancestor.$container !== statement) return false;
        const index = statement.statements.indexOf(ancestor as Statement);
        const last = statement.statements.length - 2;
        return index >= 0 && (index < last || index === last && statementResultDiscarded(node, ancestor));
    }
    const required = new Set<number>(), assigned = new Set<string>();
    const writers: IntegerLoopPlan['writers'] = [];
    const binders: IntegerLoopPlan['binders'] = [];
    const writerNames: string[] = [], binderNames: string[] = [];
    const written = new Set<string>();
    const containers: IntegerLoopPlan['containers'] = new Map();
    const builtins = new Map<string, string>();
    const syntax = new Set<string>();
    const calls: IntegerLoopPlan['calls'] = [];
    const arrays: IntegerLoopPlan['arrays'] = new Map();
    const calleeArrays = new Set<string>();
    const sliceReadSources = new Set<string>();
    const sliceResultSources = new Set<string>();
    // One read per source at a named cursor; computed/repeated reads use undefined.
    const indexedReads = new Map<string, string | undefined>();
    const arrayInputs = new Set<string>(), arrayDefinitions = new Set<string>();
    const ranges = new Map<string, 'to' | 'till'>();
    const exactInputs = new Set<Expression>();
    const aliases: [string, string][] = [];
    const localAliases: [string, string][] = [];
    const arrayTransfers: [string, string][] = [];
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
    function pushScope(inductionVariable?: string, inductionSlot?: number, range?: LoopRangeInfo, source = statement): LoopScope {
        const stableStores = new Set<string>();
        if (ownershipChecks && range) {
            for (const node of source.statements) if (isArrayAssignmentStatement(node)) stableStores.add(node.name);
            for (const node of AstUtils.streamAllContents(source)) {
                if (isUnpackStatement(node)) { stableStores.clear(); break; }
                if (!isAssignmentStatement(node)) continue;
                stableStores.delete(node.name);
                let value = node.value;
                while (isParenthesizedExpression(value)) value = value.value;
                if (node.operator === '=' && isNameExpression(value)) { stableStores.clear(); break; }
            }
        }
        const scope: LoopScope = {
            depth: loopScopes.length,
            inductionVariable,
            inductionSlot,
            assigned: new Set(),
            range,
            setupLines: [],
            bceGuards: new Map(),
            hoistedOffsets: new Map(),
            stableStores, preparedOwners: new Set(),
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
        statement, ownershipChecks, integerRanges: integerRangeFacts(statement),
        host, numberMode, wideScalars, workCounting, checkpoint, textSources, textArrays, zero, one, safe, dirty, reject,
        localTypes, names, required, assigned, written, reboundNames, writers, binders, writerNames, binderNames,
        vectorReductions: false, primeCopies: false, containers, builtins, syntax, calls, arrays, calleeArrays, sliceReadSources, sliceResultSources, indexedReads, arrayInputs, arrayDefinitions, ranges, aliases, localAliases, arrayTransfers, dequeArrays,
        vectorIterations, iterators, destinations, locations, callouts, canCallout,
        get branchDepth() { return branchDepth; },
        set branchDepth(v: number) { branchDepth = v; },
        arrayRegions: [] as NonNullable<IntegerLoopPlan['arrayRegions']>,
        outlinedLoops: [] as { body: string; inputs: readonly string[] }[],
        exactInputs, rangeNarrowing: false, numberVectors: false, serial: 0, sliceView: false, viewResult: '', hasArrayCall: false, reversedPrimes: false, selectorRange, resultDiscarded, hasControl: false, hasReturn: false, hasYield: false, needsAlgo: false,
        loopScopes, rootSetupLines, pushScope, popScope, currentScope,
    };
}

export type LoopCompilationState = ReturnType<typeof createLoopState>;
