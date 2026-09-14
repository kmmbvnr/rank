import type { ValidationAcceptor, ValidationChecks } from 'langium';
import type { Program, RankAstType } from './generated/ast.js';
import type { RankServices } from './rank-module.js';
import { expressionDiagnostics } from './expression-grouping.js';

export function registerValidationChecks(services: RankServices): void {
    const checks: ValidationChecks<RankAstType> = { Program: services.validation.RankValidator.checkExpressions };
    services.validation.ValidationRegistry.register(checks, services.validation.RankValidator);
}

export class RankValidator {
    checkExpressions(program: Program, accept: ValidationAcceptor): void {
        for (const error of expressionDiagnostics(program)) {
            accept('error', error.message, { node: error.node, range: error.cst?.range });
        }
    }
}
