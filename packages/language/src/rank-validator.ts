import type { ValidationAcceptor, ValidationChecks } from 'langium';
import type { Program, RankAstType, TextBlockExpression } from './generated/ast.js';
import type { RankServices } from './rank-module.js';
import { expressionDiagnostics } from './expression-grouping.js';

export function registerValidationChecks(services: RankServices): void {
    const validator = services.validation.RankValidator;
    const checks: ValidationChecks<RankAstType> = {
        Program: validator.checkExpressions,
        TextBlockExpression: validator.checkTextBlock,
    };
    services.validation.ValidationRegistry.register(checks, validator);
}

/** Only `text` and `text lines` exist; any other word after `text` is a mistake. */
export function textBlockModeError(block: TextBlockExpression): string | undefined {
    if (block.mode === undefined || block.mode === 'lines') return undefined;
    return `unknown text block form \`${block.mode}\`; expected \`text\` or \`text lines\``;
}

export class RankValidator {
    checkExpressions(program: Program, accept: ValidationAcceptor): void {
        for (const error of expressionDiagnostics(program)) {
            accept('error', error.message, { node: error.node, range: error.cst?.range });
        }
    }

    checkTextBlock(block: TextBlockExpression, accept: ValidationAcceptor): void {
        const message = textBlockModeError(block);
        if (message) accept('error', message, { node: block, property: 'mode' });
    }
}
