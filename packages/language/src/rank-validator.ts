import { UriUtils, type LangiumDocument, type ValidationAcceptor, type ValidationChecks } from 'langium';
import { isProgram, type FunctionStatement, type Program, type RankAstType, type TextBlockExpression } from './generated/ast.js';
import type { RankServices } from './rank-module.js';
import { expressionDiagnostics } from './expression-grouping.js';
import { analyzeValues } from './analysis/value-diagnostics.js';
import { declaredRanks } from './function-ranks.js';
import { blockScopeDiagnostics } from './analysis/block-scope.js';

export function registerValidationChecks(services: RankServices): void {
    const validator = services.validation.RankValidator;
    const checks: ValidationChecks<RankAstType> = {
        Program: validator.checkExpressions,
        TextBlockExpression: validator.checkTextBlock,
        FunctionStatement: validator.checkFunctionRanks,
    };
    services.validation.ValidationRegistry.register(checks, validator);
}

/** Only `text` and `text lines` exist; any other word after `text` is a mistake. */
export function textBlockModeError(block: TextBlockExpression): string | undefined {
    if (block.mode === undefined || block.mode === 'lines') return undefined;
    return `unknown text block form \`${block.mode}\`; expected \`text\` or \`text lines\``;
}

/**
 * Resolves `use "path"` against the documents the workspace already holds, relative to the
 * importing document. Nothing is read from disk and nothing runs: a module that is missing from
 * the workspace, has syntax errors, or is the document itself resolves to nothing, and the
 * import stays opaque to the analyzer.
 */
export function documentModuleLoader(services: RankServices, document: LangiumDocument): (path: string) => Program | undefined {
    const documents = services.shared.workspace.LangiumDocuments;
    return specifier => {
        try {
            const uri = UriUtils.resolvePath(UriUtils.dirname(document.uri),
                /\.[^/\\]+$/.test(specifier) ? specifier : `${specifier}.ra`);
            if (UriUtils.equals(uri, document.uri) || !documents.hasDocument(uri)) return undefined;
            const parseResult = documents.getDocument(uri)?.parseResult;
            if (!parseResult) return undefined;
            const hasErrors = parseResult.lexerErrors.length > 0 || parseResult.parserErrors.length > 0;
            return !hasErrors && isProgram(parseResult.value) ? parseResult.value : undefined;
        } catch { return undefined; }
    };
}

export class RankValidator {
    constructor(private readonly services?: RankServices) {}

    checkExpressions(program: Program, accept: ValidationAcceptor): void {
        for (const error of expressionDiagnostics(program)) {
            accept('error', error.message, { node: error.node, range: error.cst?.range });
        }
        const parsed = program.$document?.parseResult;
        if (parsed?.lexerErrors.length || parsed?.parserErrors.length || expressionDiagnostics(program).length) return;
        for (const diagnostic of blockScopeDiagnostics(program)) {
            accept('error', diagnostic.message, { node: diagnostic.node });
        }
        const loadModule = this.services && program.$document ? documentModuleLoader(this.services, program.$document) : undefined;
        for (const diagnostic of analyzeValues(program, new Map(), new Map(), [], loadModule).diagnostics) {
            accept(diagnostic.severity ?? 'error', diagnostic.message, { node: diagnostic.node, code: diagnostic.code ?? diagnostic.kind });
        }
    }

    checkFunctionRanks(statement: FunctionStatement, accept: ValidationAcceptor): void {
        const declared = declaredRanks(statement);
        if (typeof declared === 'string') accept('error', declared, { node: statement, property: 'ranks' });
    }

    checkTextBlock(block: TextBlockExpression, accept: ValidationAcceptor): void {
        const message = textBlockModeError(block);
        if (message) accept('error', message, { node: block, property: 'mode' });
    }
}
