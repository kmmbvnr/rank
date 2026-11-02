import subprocess,json,sys,os
root,node,out=sys.argv[1:];rows=[]
for size,mode,count in [('full','compiled',3),('10000000000','compiled',3),('100000000','reference',1)]:
 for _ in range(count):
  r=subprocess.run([node,'benchmarks/euler505-investigation.mjs','501',size,mode],cwd=root,capture_output=True,text=True,timeout=90,env=dict(os.environ,CONTROL='',DIAGNOSTICS='',PROFILE='',LC=''))
  if r.returncode:raise RuntimeError(r.stderr)
  x=json.loads(r.stdout);rows.append(x);open(out,'w').write(json.dumps(rows,indent=2));print(r.stdout,flush=True)
