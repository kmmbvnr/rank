import { type Module, type AstNode, type CstNode, type GrammarAST, type ValueType, type ParserOptions, DefaultTokenBuilder, GrammarUtils, DefaultValueConverter, inject, createLangiumParser, createCompletionParser } from 'langium';
import { LLStarLookaheadStrategy } from 'chevrotain-allstar';
import { ErrorLookaheadStrategy } from './error-lookahead.js';
import { groupExpressions, type GroupingOptions } from './expression-grouping.js';
import { SignatureLexer } from './signature-lexer.js';
import { prepareFunctionDeclarations } from './function-declaration.js';
import { normalizePrimaryApplications } from './primary-applications.js';
import { functionCallSignature } from './function-call-signature.js';
import { functionBindingPlan } from './function-binding.js';
import { isFunctionStatement, isFunctionBindingStatement, isProgram } from './generated/ast.js';
import { createDefaultModule, createDefaultSharedModule, type DefaultSharedModuleContext, type LangiumServices, type LangiumSharedServices, type PartialLangiumServices } from 'langium/lsp';
import { RankGeneratedModule, RankGeneratedSharedModule } from './generated/module.js';
import { RankValidator, registerValidationChecks } from './rank-validator.js';

/** Match the comment's left boundary against the full input, including a preceding label dot. */
class RankTokenBuilder extends DefaultTokenBuilder {
    protected override buildTerminalToken(terminal: GrammarAST.TerminalRule) {
        const token = super.buildTerminalToken(terminal);
        if (terminal.name === 'REM_COMMENT') {
            token.PATTERN = this.regexPatternFunction(GrammarUtils.terminalRegex(terminal));
            token.LINE_BREAKS = false;
            token.START_CHARS_HINT = ['r'];
        }
        return token;
    }
}

/** An integer written with an exponent (`4e6`, `2E+3`) is the digits followed by that many zeros. */
class RankValueConverter extends DefaultValueConverter {
    protected override runConverter(rule: GrammarAST.AbstractRule, input: string, cstNode: CstNode): ValueType {
        if (rule.name === 'SIGNATURE_WORD') return input.slice(1);
        const exponent = rule.name === 'INTEGER' ? /^([0-9]+)[eE]\+?([0-9]+)$/.exec(input) : undefined;
        if (exponent) {
            if (Number(exponent[2]) > 10_000) throw new Error('Integer exponent is too large');
            return BigInt(exponent[1] + '0'.repeat(Number(exponent[2])));
        }
        return super.runConverter(rule, input, cstNode);
    }
}

/**
 * Declaration of custom services - add your own service classes here.
 */
export type RankAddedServices = {
    validation: {
        RankValidator: RankValidator
    }
}

/**
 * Union of Langium default services and your custom services - use this as constructor parameter
 * of custom service classes.
 */
export type RankServices = LangiumServices & RankAddedServices

/** Keep adaptive LL(*) prediction, but bound the token paths enumerated for syntax errors. */
function withBoundedErrorLookahead(services: RankServices, incomplete = false, strategy?: LLStarLookaheadStrategy): RankServices {
    const parser: RankServices['parser'] = Object.create(services.parser);
    Object.defineProperty(parser, 'ParserConfig', { value: {
        ...services.parser.ParserConfig,
        maxLookahead: 1,
        lookaheadStrategy: strategy ?? new LLStarLookaheadStrategy({ incomplete,
            logging: services.LanguageMetaData.mode === 'production' ? () => {} : undefined }),
    } });
    return { ...services, parser };
}

/**
 * Dependency injection module that overrides Langium default services and contributes the
 * declared custom services. The Langium defaults can be partially specified to override only
 * selected services, while the custom services must be fully specified.
 */
export const RankModule: Module<RankServices, PartialLangiumServices & RankAddedServices> = {
    parser: {
        TokenBuilder: () => new RankTokenBuilder(),
        Lexer: services => new SignatureLexer(services),
        ValueConverter: () => new RankValueConverter(),
        LangiumParser: services => {
            // Enumerating three-token error paths for an unfinished `array` blocks typing for hundreds of ms.
            const strategy = new ErrorLookaheadStrategy({
                logging: services.LanguageMetaData.mode === 'production' ? () => {} : undefined,
            });
            const parser = createLangiumParser(withBoundedErrorLookahead(services, false, strategy));
            const parse = parser.parse.bind(parser);
            parser.parse = <T extends AstNode>(input: string, options?: ParserOptions) => {
                strategy.beginParse();
                const lexer = services.parser.Lexer as SignatureLexer;
                let grouping = options as GroupingOptions | undefined;
                if (grouping?.loadModule) {
                    const signatures = new Map(grouping.signatures);
                    const bindings = new Map(grouping.bindings);
                    const declarations = new Map(grouping.declarations);
                    for (const entry of lexer.imports(input)) {
                        const module = grouping.loadModule(entry.path);
                        if (!module) continue;
                        const exported = new Map<string, ReturnType<typeof functionCallSignature>>();
                        const definitions = new Map<string, import('./generated/ast.js').FunctionStatement>();
                        for (const statement of module.statements) {
                            if (isFunctionStatement(statement)) {
                                exported.set(statement.name, functionCallSignature(statement));
                                definitions.set(statement.name, statement);
                            }
                        }
                        for (const statement of module.statements) {
                            if (!isFunctionBindingStatement(statement)) continue;
                            const target = functionBindingPlan(statement).alias;
                            const signature = target && exported.get(target);
                            if (signature) exported.set(statement.name, signature);
                        }
                        for (const [name, signature] of exported) {
                            const qualified = entry.alias ? `${entry.alias}.${name}` : name;
                            signatures.set(qualified, signature);
                            const definition = definitions.get(name);
                            if (definition) declarations.set(qualified, definition);
                            bindings.set(qualified, [signature.leftCount + signature.rightParameters.length]);
                        }
                    }
                    grouping = { ...grouping, signatures, bindings, declarations };
                }
                lexer.signatures = grouping?.signatures ?? new Map();
                const result = parse<T>(input, options);
                if (!result.lexerErrors.length && result.parserErrors.length) {
                    strategy.failures.clear();
                    strategy.diagnosing = true;
                    try {
                        parse<T>(input, options);
                        strategy.locate(result.parserErrors[0], input);
                    } finally {
                        strategy.diagnosing = false;
                        strategy.failures.clear();
                    }
                }
                if (!result.lexerErrors.length && !result.parserErrors.length && isProgram(result.value)) {
                    prepareFunctionDeclarations(result.value);
                    normalizePrimaryApplications(result.value);
                    groupExpressions(result.value, grouping);
                }
                return result;
            };
            return parser;
        },
        CompletionParser: services => createCompletionParser(withBoundedErrorLookahead(services, true)),
    },
    validation: {
        RankValidator: services => new RankValidator(services)
    }
};

/**
 * Create the full set of services required by Langium.
 *
 * First inject the shared services by merging two modules:
 *  - Langium default shared services
 *  - Services generated by langium-cli
 *
 * Then inject the language-specific services by merging three modules:
 *  - Langium default language-specific services
 *  - Services generated by langium-cli
 *  - Services specified in this file
 *
 * @param context Optional module context with the LSP connection
 * @returns An object wrapping the shared services and the language-specific services
 */
export function createRankServices(context: DefaultSharedModuleContext): {
    shared: LangiumSharedServices,
    Rank: RankServices
} {
    const shared = inject(
        createDefaultSharedModule(context),
        RankGeneratedSharedModule
    );
    const Rank = inject(
        createDefaultModule({ shared }),
        RankGeneratedModule,
        RankModule
    );
    shared.ServiceRegistry.register(Rank);
    registerValidationChecks(Rank);
    if (!context.connection) {
        // We don't run inside a language server
        // Therefore, initialize the configuration provider instantly
        shared.workspace.ConfigurationProvider.initialized({});
    }
    return { shared, Rank };
}
