import { AstUtils, type AstNode } from 'langium';
import {
    isApplicationExpression, isAssignmentStatement, isForStatement, isFunctionStatement,
    isNameExpression, isReturnStatement, isUnpackStatement,
    type Expression, type FunctionStatement, type Program, type Statement,
} from '../generated/ast.js';
import { flattenApplication } from '../expressions.js';
import { loopBinding, arrayRank } from './control-flow.js';
import { functionYields, generatorCells, yieldTypes } from './function-yields.js';
import { numericInput, numericRecursionEligible, sameNumericInput, widenedInput } from './numeric-recursion.js';
import { joinValueFacts, UNKNOWN_VALUE, type ValueFacts } from './value-domain.js';

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
    analyzeImported: (program: Program, name: string, arguments_: readonly ValueFacts[]) => ValueFacts,
) {
    const functionBindings = new Map([...functions.keys()].map(name => [name, bindings.get(name)]));
    const imported = new Map<string, { program: Program; name: string; binding: ValueFacts;
        functions: ReadonlyMap<string, FunctionStatement> }>();
    const importedAliases = new Set<string>();
    const activeCalls = new Set<string>();
    const recursiveProbes = new Map<string, { inputs: readonly ValueFacts[]; result: ValueFacts;
        seen: boolean; valid: boolean }>();
    const globalCallEnvs: Map<string, ValueFacts>[] = [];
    const noReturnFunctions = new WeakMap<FunctionStatement, boolean>();
    let remainingCalls = 100;
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
            return analyzeImported(external.program, external.name, arguments_);
        }
        const definition = functions.get(name);
        if (!definition || caller.get(name) !== functionBindings.get(name)
            || definition.parameters.length !== arguments_.length) return UNKNOWN_VALUE;
        if (activeCalls.has(name)) {
            const probe = recursiveProbes.get(name);
            if (!probe) return UNKNOWN_VALUE;
            probe.seen = true;
            probe.valid &&= arguments_.every((fact, index) => sameNumericInput(probe.inputs[index], fact));
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
            hadBinding: functionBindings.has(nested.name),
        }));
        for (const { nested } of hoisted) {
            const fact: ValueFacts = { types: ['function'] };
            local.set(nested.name, fact);
            functions.set(nested.name, nested);
            functionBindings.set(nested.name, fact);
        }
        activeCalls.add(name);
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
        const diagnosticStart = diagnostics.length;
        try {
            const result = returnValues(definition.statements, local);
            // Reaching the end throws: only paths that actually return contribute
            // a result value. With no proven return, the result remains unknown.
            const ordinary = joinValueFacts(result);
            if (ordinary.types.length || !arguments_.every(numericInput)
                || !numericRecursionEligible(name, definition, bindings)) return ordinary;
            const inputs = arguments_.map(widenedInput);
            const widened = new Map(local);
            definition.parameters.forEach((parameter, index) => widened.set(parameter, {
                ...inputs[index], acceptedTypes: inputs[index].types,
                acceptedArrayRank: arrayRank(inputs[index]),
            }));
            const before = new Map(expressions);
            const start = diagnostics.length;
            let base = joinValueFacts(result.filter(fact => fact.types.length));
            if (!base.types.length) {
                try {
                    base = joinValueFacts(returnValues(definition.statements, new Map(widened))
                        .filter(fact => fact.types.length));
                } finally {
                    diagnostics.length = start;
                    expressions.clear();
                    for (const [node, fact] of before) expressions.set(node, fact);
                }
            }
            if (base.rank !== 0 || !base.types.length
                || !base.types.every(type => type === 'integer' || type === 'real')) return ordinary;
            const probe = { inputs, result: base, seen: false, valid: true };
            recursiveProbes.set(name, probe);
            let inferred: ValueFacts;
            try {
                inferred = joinValueFacts(returnValues(definition.statements, widened));
            } finally {
                recursiveProbes.delete(name);
                diagnostics.length = start;
                expressions.clear();
                for (const [node, fact] of before) expressions.set(node, fact);
            }
            return probe.valid && probe.seen && inferred.rank === 0 && inferred.types.length
                && inferred.types.every(type => base.types.includes(type)) ? inferred : ordinary;
        } finally {
            activeCalls.delete(name);
            globalCallEnvs.pop();
            privateBindings.pop();
            for (const { nested, previous, previousBinding, hadBinding } of hoisted.reverse()) {
                if (previous) functions.set(nested.name, previous);
                else functions.delete(nested.name);
                if (hadBinding) functionBindings.set(nested.name, previousBinding);
                else functionBindings.delete(nested.name);
            }
            if (site) for (let index = diagnosticStart; index < diagnostics.length; index++) {
                diagnostics[index] = { ...diagnostics[index], node: site, message: `${name}: ${diagnostics[index].message}` };
            }
        }
    }

    return {
        functionBindings, imported, importedAliases, globalCallEnvs, privateBindings,
        directNoReturnCall, call,
        hasRecursiveProbe: (name: string) => activeCalls.has(name) && recursiveProbes.has(name),
        resetBudget: () => { remainingCalls = 100; },
    };
}
