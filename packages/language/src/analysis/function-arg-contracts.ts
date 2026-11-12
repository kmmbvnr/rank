import { AstUtils } from 'langium';
import {
    isArgStatement, isFunctionStatement, type ArgStatement, type FunctionStatement, type Program,
} from '../generated/ast.js';
import type { ScopeDiagnostic } from './function-scope-diagnostics.js';

/** The `arg` lines that open a function body: contracts on its header parameters. */
export function functionArgContracts(definition: FunctionStatement): readonly ArgStatement[] {
    const contracts: ArgStatement[] = [];
    for (const statement of definition.statements) {
        if (!isArgStatement(statement)) break;
        contracts.push(statement);
    }
    return contracts;
}

/** Placement and naming rules for `arg` inside `fun`, shared by the editor and execution. */
export function functionArgDiagnostics(program: Program): ScopeDiagnostic[] {
    const diagnostics: ScopeDiagnostic[] = [];
    for (const node of AstUtils.streamAllContents(program)) {
        if (!isFunctionStatement(node)) continue;
        const leading = new Set(functionArgContracts(node));
        const seen = new Set<string>();
        for (const contract of leading) {
            if (!node.parameters.includes(contract.name)) {
                diagnostics.push({ node: contract, message:
                    `arg ${contract.name}: function ${node.name} has no parameter ${contract.name}` });
            } else if (seen.has(contract.name)) {
                diagnostics.push({ node: contract, message: `arg ${contract.name} is declared twice` });
            }
            seen.add(contract.name);
            if (contract.defaultValue) {
                diagnostics.push({ node: contract, message:
                    `arg ${contract.name}: a function parameter takes its default from a call group, such as .by ${contract.name} = value` });
            }
        }
        for (const inner of AstUtils.streamAllContents(node)) {
            if (!isArgStatement(inner) || leading.has(inner)) continue;
            if (AstUtils.getContainerOfType(inner, isFunctionStatement) !== node) continue;
            diagnostics.push({ node: inner, message: `arg ${inner.name} must come first in the body of function ${node.name}` });
        }
    }
    return diagnostics;
}
