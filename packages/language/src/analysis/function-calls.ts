import { functionRelationship, instantiateRelationship, type FunctionRelationship } from './function-relationships.js';
import { establishedArrayContract } from './array-binding-contract.js';
import { argumentSignature, returnConflicts, returnInput } from './return-contract.js';
import { AstUtils, type AstNode } from 'langium';
import {
    isApplicationExpression, isAssignmentStatement, isBinaryExpression, isForStatement, isFunctionStatement,
    isNameExpression, isReturnStatement, isUnpackStatement,
    type Expression, type FunctionStatement, type Program, type Statement,
} from '../generated/ast.js';
import { flattenApplication } from '../expressions.js';
import { loopBinding, arrayRank, parameterFacts } from './control-flow.js';
import { functionYields, generatorCells, yieldTypes } from './function-yields.js';
import { numericInput, numericRecursionEligible, sameNumericInput, widenedInput } from './numeric-recursion.js';
import { BOTTOM_VALUE, joinValueFacts, UNKNOWN_VALUE, widenValueFacts, withPathDims, type ValueFacts } from './value-domain.js';

interface CallDiagnostic {
    readonly node: AstNode;
    readonly message: string;
    readonly kind: 'TypeError' | 'DimensionMismatch';
}

/**
 * A function of an imported module, tied to the binding that introduced it: a call uses the
 * summary only while the environment still holds this exact `binding`.
 */
export interface ImportedFunction {
    readonly program: Program;
    readonly name: string;
    readonly binding: ValueFacts;
    readonly functions: ReadonlyMap<string, FunctionStatement>;
}

/** State confined to call-site evaluation and bounded recursive probes. */
export function createCallAnalysis(
    bindings: Map<string, ValueFacts>,
    functions: Map<string, FunctionStatement>,
    diagnostics: CallDiagnostic[],
    expressions: Map<Expression, ValueFacts>,
    returnValues: (items: readonly Statement[], env: Map<string, ValueFacts>) => ValueFacts[],
    analyzeImported: (program: Program, name: string, arguments_: readonly ValueFacts[]) => { result: ValueFacts; diagnostics: readonly CallDiagnostic[]; relationship?: FunctionRelationship },
    initialImports: ReadonlyMap<string, ImportedFunction> = new Map(),
) {
    const functionBindings = new Map([...functions.keys()].map(name => [name, bindings.get(name)]));
    const imported = new Map<string, ImportedFunction>(initialImports);
    const importedAliases = new Set([...initialImports.keys()].map(qualified => qualified.slice(0, qualified.indexOf('.'))));
    const activeCalls = new WeakMap<FunctionStatement, Set<string>>();
    const recursiveProbes = new WeakMap<FunctionStatement, Map<string, { inputs: readonly ValueFacts[]; result: ValueFacts;
        seen: boolean; valid: boolean; pure: boolean }>>();
    const callStack: { definition: FunctionStatement; signature: string; recursive: boolean }[] = [];
    const globalCallEnvs: Map<string, ValueFacts>[] = [];
    const noReturnFunctions = new WeakMap<FunctionStatement, boolean>();
    const relationships = new Map<FunctionStatement, FunctionRelationship>();
    const checkedRelationships = new WeakSet<FunctionStatement>();
    const importedRelationships = new WeakMap<ImportedFunction, { definition: FunctionStatement; summary?: FunctionRelationship }>();
    let remainingCalls = 100;
    let checkingReturns = false;
    type Instance = { rankSignature: string; values: ValueFacts[] };
    const specializations = new WeakMap<FunctionStatement, Map<string, Instance>>();
    const privateBindings: Set<string>[] = [];
    /** Every name a frame binds, including those a nested function may also write through the closure. */
    const frameBindings: Set<string>[] = [];

    let relationshipDepth = 0;
    const validRelationship = (summary: FunctionRelationship, env: ReadonlyMap<string, ValueFacts>) =>
        summary.dependencies.every(dependency => {
            const external = imported.get(dependency.name);
            return env.get(dependency.name) === dependency.binding && (external
                ? external.binding === dependency.binding && external.functions.get(external.name) === dependency.definition
                : functions.get(dependency.name) === dependency.definition && functionBindings.get(dependency.name) === dependency.binding);
        });
    function importedRelationship(name: string, env: ReadonlyMap<string, ValueFacts>): FunctionRelationship | undefined {
        const external = imported.get(name);
        const definition = external?.functions.get(external.name);
        if (!external || !definition || env.get(name) !== external.binding) return undefined;
        let cached = importedRelationships.get(external);
        if (!cached || cached.definition !== definition) {
            if (definition.ranks.length || definition.statements.length !== 1 || !isReturnStatement(definition.statements[0])) {
                importedRelationships.set(external, { definition });
                return undefined;
            }
            const analysis = analyzeImported(external.program, external.name, definition.parameters.map(() => UNKNOWN_VALUE));
            const prefix = name.slice(0, name.length - external.name.length);
            const dependencies = analysis.relationship?.dependencies.map(dependency => {
                const qualified = prefix + dependency.name, target = imported.get(qualified);
                return target?.program === external.program && target.functions.get(target.name) === dependency.definition
                    ? { name: qualified, definition: dependency.definition, binding: target.binding } : undefined;
            });
            const summary = !analysis.diagnostics.length && analysis.relationship && dependencies?.every(dependency => dependency !== undefined)
                ? { ...analysis.relationship, dependencies } : undefined;
            cached = { definition, summary };
            importedRelationships.set(external, cached);
        }
        return cached.summary && validRelationship(cached.summary, env) ? cached.summary : undefined;
    }
    function relationshipFor(definition: FunctionStatement, env: ReadonlyMap<string, ValueFacts>): FunctionRelationship | undefined {
        const cached = relationships.get(definition);
        if (cached) {
            if (validRelationship(cached, env)) return cached;
            relationships.delete(definition);
            checkedRelationships.delete(definition);
        }
        // Mark before following callees: recursive groups retain the existing bounded analysis.
        if (checkedRelationships.has(definition) || relationshipDepth >= 100) return undefined;
        checkedRelationships.add(definition);
        relationshipDepth++;
        try {
            const relationship = functionRelationship(definition, name => {
                const external = imported.get(name);
                if (external) {
                    const summary = importedRelationship(name, env);
                    const callee = external.functions.get(external.name);
                    return summary && callee ? { name, definition: callee, binding: external.binding, relationship: summary } : undefined;
                }
                const callee = functions.get(name), binding = functionBindings.get(name);
                // Captured function scopes need their own dependency environment.
                if (!callee || callee.$container.$type !== 'Program' || !binding || env.get(name) !== binding) return undefined;
                const summary = relationshipFor(callee, env);
                return summary && { name, definition: callee, binding, relationship: summary };
            });
            if (relationship) relationships.set(definition, relationship);
            return relationship;
        } finally { relationshipDepth--; }
    }

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
            const relationship = importedRelationship(name, caller);
            const result = relationship && instantiateRelationship(relationship, arguments_.map(parameterFacts));
            if (result) return withPathDims(joinValueFacts([result]));
            const analysis = analyzeImported(external.program, external.name, arguments_);
            if (site) for (const diagnostic of analysis.diagnostics) {
                if (diagnostic.message.includes('returns incompatible')) diagnostics.push({ ...diagnostic, node: site });
            }
            return analysis.result;
        }
        const definition = functions.get(name);
        if (!definition || caller.get(name) !== functionBindings.get(name)
            || definition.parameters.length !== arguments_.length) return UNKNOWN_VALUE;
        // A declared `rank` maps the body over cells, so the whole-operand facts do not describe the call.
        if (definition.ranks.length) return UNKNOWN_VALUE;
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
        const globalEnv = globalCallEnvs.at(-1) ?? caller;
        const entryEnv = definition.$container.$type === 'Program' ? globalEnv : caller;
        const relationship = relationshipFor(definition, entryEnv);
        const summarized = relationship && instantiateRelationship(relationship, arguments_) !== undefined;
        // Instantiating a proved relationship does not consume the recursive body-walk budget.
        if (!summarized && remainingCalls-- <= 0) return UNKNOWN_VALUE;
        const yields = summarized ? [] : functionYields(definition);
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
        const local = new Map(entryEnv);
        const nodes = summarized ? [] : [...AstUtils.streamAllContents(definition)];
        // Top-level functions create local bindings on assignment, rather than
        // inheriting the assignment contracts of equally named globals.
        for (const node of nodes) {
            if (isAssignmentStatement(node) && !definition.parameters.includes(node.name)) local.delete(node.name);
        }
        definition.parameters.forEach((parameter, index) => local.set(parameter, parameterFacts(arguments_[index])));
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
        const nestedWrites = new Set(nodes.filter(isFunctionStatement).flatMap(nested =>
            [...AstUtils.streamAllContents(nested)].flatMap(node => isAssignmentStatement(node) ? [node.name]
                : isFunctionStatement(node) ? [node.name] : isUnpackStatement(node) ? node.names : isForStatement(node)
                    ? loopBinding(node.condition)?.names ?? [] : [])));
        const bound = [...definition.parameters, ...nodes.filter(isAssignmentStatement)
            .map(statement => statement.name).filter(name => !name.includes('.')), ...nodes.filter(isForStatement)
            .flatMap(loop => loopBinding(loop.condition)?.names ?? [])].filter(name => name !== '#');
        privateBindings.push(new Set(bound.filter(name => !nestedWrites.has(name))));
        frameBindings.push(new Set(bound));
        const entry = new Map(local);
        const diagnosticStart = diagnostics.length;
        const contractEnv = new Map([...local].map(([key, fact]) => [key,
            fact.types.includes('function') ? fact : returnInput(fact)]));
        try {
            const result = summarized
                ? [instantiateRelationship(relationship, definition.parameters.map(name => local.get(name)!), expressions)!]
                : returnValues(definition.statements, local);
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
                    const contract = summarized && instantiateRelationship(relationship,
                        definition.parameters.map(name => contractEnv.get(name)!));
                    // Widening forgets reader safety, so a valid call summary may
                    // need ordinary analysis for its broader return contract.
                    returns = [...result, ...(contract ? [contract] : returnValues(definition.statements, contractEnv))];
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
            const ordinary = withPathDims(joinValueFacts(result));
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
                acceptedArrayRank: arrayRank(inputs[index]), acceptedArrayContract: establishedArrayContract(inputs[index]),
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
            frameBindings.pop();
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
        functionBindings, imported, importedAliases, globalCallEnvs, privateBindings, frameBindings,
        directNoReturnCall, call, relationships,
        validRelationships: (env: ReadonlyMap<string, ValueFacts>) => {
            const result = new Map([...relationships].filter(([, summary]) => validRelationship(summary, env)));
            for (const [name, external] of imported) {
                const cached = importedRelationships.get(external);
                if (cached?.summary && env.get(name) === external.binding
                    && external.functions.get(external.name) === cached.definition && validRelationship(cached.summary, env)) {
                    result.set(cached.definition, cached.summary);
                }
            }
            return result;
        },
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
