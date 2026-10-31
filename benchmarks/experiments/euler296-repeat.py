import subprocess,json
rows=[]
cases=[('compiled','original','100000'),('compiled','pruned','100000'),('compiled','combined','100000'),('reference','original','10000'),('reference','pruned','10000'),('reference','combined','10000')]
for i in range(3):
 for args in cases:
  p=subprocess.run(['node','benchmarks/euler296-investigation.mjs',*args],capture_output=True,text=True,check=True,timeout=60)
  row=json.loads(p.stdout);row['sample']=i+1;rows.append(row);print(json.dumps(row),flush=True)
  open('benchmarks/baselines/2026-10-31-euler296-repeated.json','w').write(json.dumps(rows,indent=2))
