import type { ValidationAcceptor, ValidationChecks } from 'langium';
import type { Program, RankAstType, TextBlockExpression } from './generated/ast.js';
import type { RankServices } from './rank-module.js';
import { expressionDiagnostics } from './expression-grouping.js';
import { analyzeValues } from './analysis/value-diagnostics.js';

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
        const parsed = program.$document?.parseResult;
        if (parsed?.lexerErrors.length || parsed?.parserErrors.length || expressionDiagnostics(program).length) return;
        for (const diagnostic of analyzeValues(program).diagnostics) {
            accept('error', diagnostic.message, { node: diagnostic.node, code: diagnostic.kind });
        }
    }

    checkTextBlock(block: TextBlockExpression, accept: ValidationAcceptor): void {
        const message = textBlockModeError(block);
        if (message) accept('error', message, { node: block, property: 'mode' });
    }
}
