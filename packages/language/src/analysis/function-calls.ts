import { argumentSignature, returnConflicts, returnInput } from './return-contract.js';
import { AstUtils, type AstNode } from 'langium';
import {
    isApplicationExpression, isAssignmentStatement, isBinaryExpression, isForStatement, isFunctionStatement,
    isNameExpression, isReturnStatement, isUnpackStatement,
    type Expression, type FunctionStatement, type Program, type Statement,
} from '../generated/ast.js';
import { flattenApplication } from '../expressions.js';
import { loopBinding, arrayRank } from './control-flow.js';
import { functionYields, generatorCells, yieldTypes } from './function-yields.js';
import { numericInput, numericRecursionEligible, sameNumericInput, widenedInput } from './numeric-recursion.js';
import { BOTTOM_VALUE, joinValueFacts, UNKNOWN_VALUE, widenValueFacts, type ValueFacts } from './value-domain.js';

interface CallDiagnostic {
    readonly node: AstNode;
    readonly message: string;
    readonly kind: 'TypeError' | 'DimensionMismatch';
}

/** State confined to call-site evaluation and bounded recursive probes. */
export function createCallAnalysis(
    bindings: Map<string, ValueFacts>,
    functions: Map<string, FunctionStatement>,
    diagnostics: CallDiagnostic[],
    expressions: Map<Expression, ValueFacts>,
    returnValues: (items: readonly Statement[], env: Map<string, ValueFacts>) => ValueFacts[],
    analyzeImported: (program: Program, name: string, arguments_: readonly ValueFacts[]) => { result: ValueFacts; diagnostics: readonly CallDiagnostic[] },
) {
    const functionBindings = new Map([...functions.keys()].map(name => [name, bindings.get(name)]));
    const imported = new Map<string, { program: Program; name: string; binding: ValueFacts;
        functions: ReadonlyMap<string, FunctionStatement> }>();
    const importedAliases = new Set<string>();
    const activeCalls = new WeakMap<FunctionStatement, Set<string>>();
    const recursiveProbes = new WeakMap<FunctionStatement, Map<string, { inputs: readonly ValueFacts[]; result: ValueFacts;
        seen: boolean; valid: boolean; pure: boolean }>>();
    const callStack: { definition: FunctionStatement; signature: string; recursive: boolean }[] = [];
    const globalCallEnvs: Map<string, ValueFacts>[] = [];
    const noReturnFunctions = new WeakMap<FunctionStatement, boolean>();
    let remainingCalls = 100;
    let checkingReturns = false;
    type Instance = { rankSignature: string; values: ValueFacts[] };
    const specializations = new WeakMap<FunctionStatement, Map<string, Instance>>();
    const privateBindings: Set<string>[] = [];

    function directNoReturnCall(expression: Expression, env: ReadonlyMap<string, ValueFacts>): boolean {
        const parts = isApplicationExpression(expression) ? flattenApplication(expression) : [expression];
        const target = parts.at(-1);
        if (!target || !isNameExpression(target)) return false;
        if (target.name === 'raise' && !env.has('raise') && (parts.length === 2 || parts.length === 3)) return true;
        const definition = functions.get(target.name);
        if (!definition || env.get(target.name) !== functionBindings.get(target.name)
            || definition.parameters.length !== parts.length - 1) return false;
        let noReturn = noReturnFunctions.get(definition);
        if (noReturn === undefined) {
            noReturn = !functionYields(definition).length && ![...AstUtils.streamAllContents(definition)]
                .some(node => isReturnStatement(node)
                    && AstUtils.getContainerOfType(node, isFunctionStatement) === definition);
            noReturnFunctions.set(definition, noReturn);
        }
        return noReturn;
    }

    function call(name: string, arguments_: readonly ValueFacts[], caller: Map<string, ValueFacts>, site?: Expression): ValueFacts {
        const external = imported.get(name);
        if (external && caller.get(name) === external.binding
            && external.functions.get(external.name)?.parameters.length === arguments_.length) {
            const analysis = analyzeImported(external.program, external.name, arguments_);
            if (site) for (const diagnostic of analysis.diagnostics) {
                if (diagnostic.message.includes('returns incompatible')) diagnostics.push({ ...diagnostic, node: site });
            }
            return analysis.result;
        }
        const definition = functions.get(name);
        if (!definition || caller.get(name) !== functionBindings.get(name)
            || definition.parameters.length !== arguments_.length) return UNKNOWN_VALUE;
        const signature = argumentSignature(arguments_);
        let active = activeCalls.get(definition);
        if (!active) activeCalls.set(definition, active = new Set());
        let probes = recursiveProbes.get(definition);
        if (!probes) recursiveProbes.set(definition, probes = new Map());
        if (active.has(signature)) {
            const cycle = callStack.findIndex(frame => frame.definition === definition && frame.signature === signature);
            for (const frame of callStack.slice(cycle)) frame.recursive = true;
            const probe = probes.get(signature);
            if (!probe) return UNKNOWN_VALUE;
            probe.seen = true;
            if (probe.pure) probe.valid &&= arguments_.every((fact, index) => sameNumericInput(probe.inputs[index], fact));
            return probe.result;
        }
        if (remainingCalls-- <= 0) return UNKNOWN_VALUE;
        const yields = functionYields(definition);
        if (yields.length) {
            // A generator call creates a sequence without executing its body.
            const { cells } = generatorCells(definition, arguments_);
            const known = yieldTypes(cells);
            const declarationKnown = yieldTypes(generatorCells(definition,
                definition.parameters.map(() => UNKNOWN_VALUE)).cells);
            if (site && known.length > 1 && declarationKnown.length <= 1) diagnostics.push({ node: site,
                kind: 'TypeError', message: `${name} yields incompatible types: ${known.join(' and ')}` });
            const elements = cells.length && cells.every(cell => cell.types.length) ? known : undefined;
            const scalars = cells.every(cell => cell.rank === 0);
            return { types: ['sequence'], ...(elements ? { elements } : {}),
                ...(scalars ? { rank: 1, shape: [cells.length ? null : 0] } : {}) };
        }
        const globalEnv = globalCallEnvs.at(-1) ?? caller;
        const local = new Map(definition.$container.$type === 'Program' ? globalEnv : caller);
        // Top-level functions create local bindings on assignment, rather than
        // inheriting the assignment contracts of equally named globals.
        for (const node of AstUtils.streamAllContents(definition)) {
            if (isAssignmentStatement(node) && !definition.parameters.includes(node.name)) local.delete(node.name);
        }
        definition.parameters.forEach((parameter, index) => local.set(parameter, {
            ...arguments_[index], acceptedArrayRank: arrayRank(arguments_[index]), acceptedTypes: arguments_[index].types,
        }));
        if (!definition.parameters.includes('index')) local.set('index', { types: ['index'], elements: [] });
        // Runtime declares local functions before executing the body, including
        // declarations textually after an early return.
        const hoisted = definition.statements.filter(isFunctionStatement).map(nested => ({
            nested, previous: functions.get(nested.name), previousBinding: functionBindings.get(nested.name),
            hadBinding: functionBindings.has(nested.name), previousInstances: specializations.get(nested),
        }));
        for (const { nested } of hoisted) {
            const fact: ValueFacts = { types: ['function'] };
            local.set(nested.name, fact);
            functions.set(nested.name, nested);
            functionBindings.set(nested.name, fact);
            specializations.set(nested, new Map());
        }
        const frame = { definition, signature, recursive: false };
        callStack.push(frame);
        active.add(signature);
        globalCallEnvs.push(globalEnv);
        const nodes = [...AstUtils.streamAllContents(definition)];
        const nestedWrites = new Set(nodes.filter(isFunctionStatement).flatMap(nested =>
            [...AstUtils.streamAllContents(nested)].flatMap(node => isAssignmentStatement(node) ? [node.name]
                : isFunctionStatement(node) ? [node.name] : isUnpackStatement(node) ? node.names : isForStatement(node)
                    ? loopBinding(node.condition)?.names ?? [] : [])));
        privateBindings.push(new Set([...definition.parameters, ...nodes.filter(isAssignmentStatement)
            .map(statement => statement.name).filter(name => !name.includes('.')), ...nodes.filter(isForStatement)
            .flatMap(loop => loopBinding(loop.condition)?.names ?? [])]
            .filter(name => name !== '#' && !nestedWrites.has(name))));
        const entry = new Map(local);
        const diagnosticStart = diagnostics.length;
        const contractEnv = new Map([...local].map(([key, fact]) => [key,
            fact.types.includes('function') ? fact : returnInput(fact)]));
        try {
            const result = returnValues(definition.statements, local);
            // Reaching the end throws: only paths that actually return contribute
            // a result value. With no proven return, the result remains unknown.
            if (!checkingReturns) {
                const before = new Map(expressions);
                const savedGlobal = new Map(globalEnv);
                const savedBudget = remainingCalls;
                const start = diagnostics.length;
                let returns = result;
                checkingReturns = true;
                try {
                    returns = [...result, ...returnValues(definition.statements, contractEnv)];
                } finally {
                    checkingReturns = false;
                    remainingCalls = savedBudget;
                    globalEnv.clear();
                    for (const [key, fact] of savedGlobal) globalEnv.set(key, fact);
                    diagnostics.length = start;
                    expressions.clear();
                    for (const [node, fact] of before) expressions.set(node, fact);
                }
                const instances = specializations.get(definition) ?? new Map<string, Instance>();
                specializations.set(definition, instances);
                const previous = instances.get(signature)?.values ?? [];
                const facts = [...previous, ...returns];
                // Keep only distinct contract facts, not every call's data.
                const rankSignature = argumentSignature(arguments_, false);
                instances.set(signature, { rankSignature, values: [...new Map(facts.map(fact => {
                    const contract = returnInput(fact);
                    return [JSON.stringify(contract), contract] as const;
                })).values()] });
                // With unknown inputs, a type/rank guard may separate valid
                // specializations. The concrete call pass checks each of them.
                const unresolvedDispatch = arguments_.some(fact => !fact.types.length || fact.rank === undefined)
                    && nodes.some(node => isBinaryExpression(node) && node.operator === 'is'
                        || isNameExpression(node) && node.name === 'shape');
                const rankFacts = [...instances.values()].filter(instance => instance.rankSignature === rankSignature)
                    .flatMap(instance => instance.values);
                const conflicts = [...returnConflicts(rankFacts).filter(item => item.kind === 'DimensionMismatch'),
                    ...returnConflicts(facts).filter(item => item.kind === 'TypeError')];
                for (const conflict of unresolvedDispatch ? [] : conflicts) diagnostics.push({
                    node: definition, ...conflict, message: `${name} ${conflict.message}`,
                });
            }
            if (!checkingReturns) for (const { nested } of hoisted) {
                const start = diagnostics.length;
                const savedGlobal = new Map(globalEnv);
                const before = new Map(expressions);
                call(nested.name, nested.parameters.map(() => UNKNOWN_VALUE), new Map(contractEnv));
                const conflicts = diagnostics.slice(start).filter(item => item.message.includes('returns incompatible'));
                diagnostics.length = start;
                diagnostics.push(...conflicts);
                globalEnv.clear();
                for (const [key, fact] of savedGlobal) globalEnv.set(key, fact);
                expressions.clear();
                for (const [node, fact] of before) expressions.set(node, fact);
            }
            const ordinary = joinValueFacts(result);
            if (!frame.recursive || ordinary.bottom) return ordinary;
            // Seed with bottom, not unknown: a recursive edge without a base
            // contributes no completed return. Unknown external calls still do.
            const pure = arguments_.every(numericInput) && numericRecursionEligible(name, definition, bindings);
            const inputs = arguments_.map(fact => pure ? widenedInput(fact) : {
                ...returnInput(fact),
                ...(fact.eagerScalarCells ? { eagerScalarCells: true as const } : {}),
                ...(fact.callbackFreeScalarCells ? { callbackFreeScalarCells: true as const } : {}),
            });
            const widened = new Map(entry);
            definition.parameters.forEach((parameter, index) => widened.set(parameter, {
                ...inputs[index], acceptedTypes: inputs[index].types,
                acceptedArrayRank: arrayRank(inputs[index]),
            }));
            const before = new Map(expressions);
            const savedGlobal = new Map(globalEnv);
            const start = diagnostics.length;
            const probe = { inputs, result: BOTTOM_VALUE, seen: false, valid: true, pure };
            probes.set(signature, probe);
            let conflicts: ReturnType<typeof returnConflicts> = [];
            try {
                const bases = returnValues(definition.statements, new Map(widened));
                const base = widenValueFacts(joinValueFacts(bases));
                if (!probe.seen) return ordinary;
                conflicts = returnConflicts(bases);
                if (!base.types.length || base.rank === undefined || conflicts.length) return UNKNOWN_VALUE;
                probe.result = base;
                globalEnv.clear();
                for (const [key, fact] of savedGlobal) globalEnv.set(key, fact);
                const returns = returnValues(definition.statements, new Map(widened));
                const inferred = widenValueFacts(joinValueFacts(returns));
                conflicts = returnConflicts([...bases, ...returns]);
                if (conflicts.length) return UNKNOWN_VALUE;
                return probe.valid && inferred.rank === base.rank && inferred.types.length
                    && inferred.types.every(type => base.types.includes(type))
                    && (!base.elements?.length || !!inferred.elements?.length
                        && inferred.elements.every(type => base.elements!.includes(type))) ? inferred : UNKNOWN_VALUE;
            } finally {
                probes.delete(signature);
                diagnostics.length = start;
                for (const conflict of conflicts) diagnostics.push({ node: definition, ...conflict,
                    message: `${name} ${conflict.message}` });
                expressions.clear();
                for (const [node, fact] of before) expressions.set(node, fact);
                globalEnv.clear();
                for (const [key, fact] of savedGlobal) globalEnv.set(key, fact);
            }
        } finally {
            callStack.pop();
            active.delete(signature);
            globalCallEnvs.pop();
            privateBindings.pop();
            for (const { nested, previous, previousBinding, hadBinding, previousInstances } of hoisted.reverse()) {
                if (previousInstances) specializations.set(nested, previousInstances);
                else specializations.delete(nested);
                if (previous) functions.set(nested.name, previous);
                else functions.delete(nested.name);
                if (hadBinding) functionBindings.set(nested.name, previousBinding);
                else functionBindings.delete(nested.name);
            }
            if (site) for (let index = diagnosticStart; index < diagnostics.length; index++) {
                if (!diagnostics[index].message.includes('returns incompatible'))
                    diagnostics[index] = { ...diagnostics[index], node: site, message: `${name}: ${diagnostics[index].message}` };
            }
        }
    }

    return {
        functionBindings, imported, importedAliases, globalCallEnvs, privateBindings,
        directNoReturnCall, call,
        hasPureRecursiveProbe: (name: string) => {
            const definition = functions.get(name);
            return !!definition && [...recursiveProbes.get(definition)?.values() ?? []].some(probe => probe.pure);
        },
        validateDeclarations: (env: Map<string, ValueFacts>) => {
            for (const [name, definition] of [...functions]) {
                remainingCalls = 100;
                const start = diagnostics.length;
                const before = new Map(expressions);
                call(name, definition.parameters.map(() => UNKNOWN_VALUE), new Map(env));
                const conflicts = diagnostics.slice(start).filter(item => item.message.includes('returns incompatible'));
                diagnostics.length = start;
                diagnostics.push(...conflicts);
                expressions.clear();
                for (const [node, fact] of before) expressions.set(node, fact);
            }
        },
        resetBudget: () => { remainingCalls = 100; },
    };
}
