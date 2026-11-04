import subprocess,json,os,sys
node=sys.argv[1] if len(sys.argv)>1 else 'node'
out=sys.argv[2] if len(sys.argv)>2 else '/tmp/rank407-series-mac.jsonl'
base=['demos/euler/407_idempotents.ra',[]]
prototype=['benchmarks/experiments/euler407-private.ra',['--import','./benchmarks/experiments/euler407-prototype.mjs']]
with open(out,'w') as f:
 for round in range(3):
  for label,(source,extra) in ([('original',base),('prototype',prototype)] if round%2==0 else [('prototype',prototype),('original',base)]):
   r=subprocess.run([node,*extra,'benchmarks/euler404-investigation.mjs',source,'10000000','compiled'],env={**os.environ,'RANK407_LARGE_PROBE':'1'},capture_output=True,text=True,check=True,timeout=100)
   p=json.loads(r.stdout);assert p['answer']=='39782849136421';p.update(label=label,round=round);f.write(json.dumps(p)+'\n');f.flush();print(label,p['ms'],p['rssMiB'],flush=True)
 for label,source in [('original-reference','demos/euler/407_idempotents.ra'),('powmod-reference','benchmarks/experiments/euler407-powmod.ra')]:
  r=subprocess.run([node,'benchmarks/euler404-investigation.mjs',source,'10000000','reference'],capture_output=True,text=True,check=True,timeout=100);p=json.loads(r.stdout);assert p['answer']=='39782849136421';p['label']=label;f.write(json.dumps(p)+'\n');f.flush();print(label,p['ms'],p['rssMiB'],flush=True)
