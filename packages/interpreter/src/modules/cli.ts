import { effectiveEnvironment, environmentName } from '../environment.js';
import { RankError } from '../errors.js';
import { MISSING } from '../value.js';
import { native } from './shared.js';
import type { RuntimeModule } from './types.js';

export const cliModule: RuntimeModule = {
    env: context => ({ ...native('env', 1, ([name]) => {
        try { return effectiveEnvironment(context.environment!).get(environmentName(name)) ?? MISSING; }
        catch (error) { throw new RankError(error instanceof Error ? error.message : String(error), 'EnvironmentError'); }
    }), write: {
        arity: 1,
        validate([name]) {
            try { environmentName(name); }
            catch (error) { throw new RankError((error as Error).message, 'EnvironmentError'); }
        },
        call([name], value) {
            const missing = value === MISSING;
            if (!missing && typeof value !== 'string') throw new RankError('env value must be text or missing', 'TypeError');
            if (typeof value === 'string' && value.includes('\0')) throw new RankError('env value must not contain NUL', 'EnvironmentError');
            try { effectiveEnvironment(context.environment!).set(environmentName(name), missing ? undefined : value as string); }
            catch (error) { throw new RankError(error instanceof Error ? error.message : String(error), 'EnvironmentError'); }
            return value;
        },
    } }),
};
