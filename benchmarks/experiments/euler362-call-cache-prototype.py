from pathlib import Path
import sys
# Research only: patch a disposable copy of out/, never the production runtime.
# This prototype still needs declaration and host-object guard audits.
p=Path(sys.argv[1]) / 'jit/call-specializations.js'
s=p.read_text()
s="""import { arrayRevision, hasNativeArrayHeader } from '../array-storage.js';
import { RankDeque } from '../containers.js';
import { hasNativeIndexEntries } from '../runtime/index-storage.js';
const ids = new WeakMap();
function id(v) { let x = ids.get(v); if (!x) ids.set(v, x = {}); return x; }
function guard(v) {
 if (typeof v !== 'object') return {primitive: typeof v};
 if ((v.kind === 'array' || v.kind === 'bytes') && hasNativeArrayHeader(v)) {
  const revision = arrayRevision(v);
  if (revision !== undefined) return {token:id(v), kind:v.kind, revision, rank:v.shape.length};
 }
 if (v instanceof RankDeque || v.kind === 'index' && hasNativeIndexEntries(v.entries))
  return {token:id(v),kind:v.kind};
}
function matches(g,v) {
 if (g.primitive) return g.primitive === typeof v;
 return typeof v === 'object' && ids.get(v) === g.token && v.kind === g.kind
  && (g.revision === undefined || arrayRevision(v) === g.revision && v.shape.length === g.rank);
}
"""+s
s=s.replace('    get(arguments_) {','''    get(arguments_) {
        if (this.last && arguments_.length === this.last.guards.length
          && arguments_.every((v,i)=>matches(this.last.guards[i],v))) return this.last.value;''')
s=s.replace('return this.structural.get(argumentSignature(arguments_));','''{
          const value = this.structural.get(argumentSignature(arguments_));
          const guards = arguments_.map(guard);
          this.last = value !== undefined && guards.every(Boolean) ? {guards,value} : undefined;
          return value;
        }''')
p.write_text(s)
