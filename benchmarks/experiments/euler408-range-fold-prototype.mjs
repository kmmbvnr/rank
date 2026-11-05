import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){const result=next(url,context);if(!url.endsWith('/out/reduction.js'))return result;let source=String(result.source);
source="import {prepareIntegerRange} from './integer-view.js';\n"+source;
source=source.replace('isRankSequence(source) ? arithmeticRange(source.plan) : undefined', 'isRankSequence(source) ? arithmeticRange(source.plan) : isRankArray(source) && privateLoopPolling() && !inspectionEnabled() && !demandBudgetEnabled() ? prepareIntegerRange(source) : undefined');
return {...result,source};}});
