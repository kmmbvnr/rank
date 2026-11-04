// A matching built module from the unmodified revision, for compiler controls.
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
const source=readFileSync(process.env.BEFORE_VECTOR_WORK,'utf8');
registerHooks({load(url,context,next){const result=next(url,context);
 return url.endsWith('/jit/vector-entry-work.js')?{...result,source}:result;
}});
