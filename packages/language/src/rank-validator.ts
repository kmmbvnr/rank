import type { ValidationChecks } from 'langium';
import type { RankAstType } from './generated/ast.js';
import type { RankServices } from './rank-module.js';

/**
 * Register custom validation checks.
 */
export function registerValidationChecks(services: RankServices) {
    const registry = services.validation.ValidationRegistry;
    const validator = services.validation.RankValidator;
    const checks: ValidationChecks<RankAstType> = {
        // TODO: Declare validators for your properties
        // See doc : https://langium.org/docs/learn/workflow/create_validations/
        /*
        Element: validator.checkElement
        */
    };
    registry.register(checks, validator);
}

/**
 * Implementation of custom validations.
 */
export class RankValidator {

    // TODO: Add logic here for validation checks of properties
    // See doc : https://langium.org/docs/learn/workflow/create_validations/
    /*
    checkElement(element: Element, accept: ValidationAcceptor): void {
        // Always accepts
    }
    */
}
