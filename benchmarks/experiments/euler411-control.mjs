import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
const sources = JSON.parse(readFileSync(process.env.RANK411_CONTROL ?? '/tmp/rank411-control.json', 'utf8'));
registerHooks({
    load(url, context, next) {
        for (const [path, source] of Object.entries(sources)) {
            if (url.endsWith(path)) return { format: 'module', source, shortCircuit: true };
        }
        return next(url, context);
    },
});
