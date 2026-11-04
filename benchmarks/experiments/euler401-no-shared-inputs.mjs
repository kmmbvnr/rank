import { registerHooks } from 'node:module';
registerHooks({ load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.endsWith('/out/function-plan.js')) return loaded;
    const source = String(loaded.source);
    const marker = 'if (node.input.name && node.type.rank) {';
    if (source.split(marker).length !== 2) throw Error('expected one shared-input guard');
    return { ...loaded, source: source.replace(marker, 'if (false && node.input.name && node.type.rank) {') };
} });
