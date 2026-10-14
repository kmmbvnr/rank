import ts from 'typescript';

/** Facts used by the semantic boundary policy, without comments or string lookalikes. */
export function semanticSource(source, file = 'source.ts') {
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const imports = [];
    let recognizer = false, requirements = false;
    const add = (node, value) => {
        if (node && ts.isStringLiteralLike(node)) imports.push({ specifier: node.text, value });
    };
    const expressionType = node => {
        if (!node) return false;
        if (ts.isIdentifier(node) && node.text.endsWith('Expression')) return true;
        return ts.forEachChild(node, expressionType) === true;
    };
    const functionName = node => {
        if (node.name && ts.isIdentifier(node.name)) return node.name.text;
        if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node))
            && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text;
        return undefined;
    };
    const visit = node => {
        if (ts.isImportDeclaration(node)) {
            const clause = node.importClause;
            const bindings = clause?.namedBindings;
            const value = !clause || !clause.isTypeOnly && (!!clause.name || !bindings
                || ts.isNamespaceImport(bindings) || bindings.elements.some(item => !item.isTypeOnly));
            add(node.moduleSpecifier, value);
        } else if (ts.isExportDeclaration(node)) {
            const clause = node.exportClause;
            const value = !node.isTypeOnly && (!clause || !ts.isNamedExports(clause)
                || clause.elements.some(item => !item.isTypeOnly));
            add(node.moduleSpecifier, value);
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
            add(node.argument.literal, false);
        } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            add(node.arguments[0], true);
        } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
            add(node.moduleReference.expression, !node.isTypeOnly);
        }
        if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
            const name = functionName(node);
            if (name && (/^explicit\w+$/.test(name)
                || name.endsWith('Form') && node.parameters.some(parameter => expressionType(parameter.type)))) recognizer = true;
        }
        if (ts.isIdentifier(node) && ['inferRequirements', 'RequirementAnalysis'].includes(node.text)
            || ts.isPropertyAccessExpression(node) && node.name.text === 'requirements'
            || ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)
                && node.argumentExpression.text === 'requirements') requirements = true;
        ts.forEachChild(node, visit);
    };
    visit(tree);
    requirements ||= imports.some(({ specifier }) => /\/requirement(?:s|-)/.test(specifier));
    return { imports, recognizer, requirements };
}
