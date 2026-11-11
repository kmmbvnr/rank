import json,sys,collections
for path in sys.argv[1:]:
 p=json.load(open(path)); nodes={n['id']:n for n in p['nodes']}; parents={child:n['id'] for n in p['nodes'] for child in n.get('children',[])}
 self_time=collections.Counter(); inclusive=collections.Counter(); total=0
 def key(node):
  f=node['callFrame']; return (f.get('functionName') or '(anonymous)',f.get('url',''),f.get('lineNumber',-1)+1)
 for sample,delta in zip(p.get('samples',[]),p.get('timeDeltas',[])):
  total+=delta; self_time[key(nodes[sample])]+=delta; seen=set(); at=sample
  while at in nodes:
   k=key(nodes[at]);seen.add(k);at=parents.get(at)
  for k in seen: inclusive[k]+=delta
 rows=[dict(name=k[0],url=k[1],line=k[2],selfMs=v/1000,selfPercent=100*v/total,inclusivePercent=100*inclusive[k]/total) for k,v in self_time.most_common(40)]
 print(json.dumps(dict(file=path,durationMs=total/1000,top=rows)))
