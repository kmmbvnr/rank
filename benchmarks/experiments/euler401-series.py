import subprocess,json,sys
node=sys.argv[2] if len(sys.argv)>2 else 'node'
variants=[('original','demos/euler/401_sumsquares.ra','compiled'),('array','benchmarks/experiments/euler401-array.ra','compiled'),('array65536','benchmarks/experiments/euler401-array65536.ra','compiled'),('consumer','benchmarks/experiments/euler401-consumer.ra','compiled'),('array-reference','benchmarks/experiments/euler401-array.ra','reference')]
with open(sys.argv[1],'w') as f:
 for trial in range(3):
  for label,src,mode in variants[::1 if trial%2==0 else -1]:
   r=json.loads(subprocess.check_output([node,'benchmarks/euler401-investigation.mjs',src,'1000000000000000',mode],text=True,timeout=120))
   assert r['answer']=='281632621',r
   r.update(variant=label,trial=trial);f.write(json.dumps(r)+'\n');f.flush();print(label,trial,round(r['ms']),round(r['rssMiB']),flush=True)
