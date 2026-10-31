import json,subprocess
bounds=[0,1,2,3,4,5,6,7,9,10,11,20,29,30,31,50,99,100,101,200]
def brute(n):
    return sum((a*c)%(a+b)==0 for a in range(1,n//3+1)
        for b in range(a,(n-a)//2+1)
        for c in range(b,min(a+b-1,n-a-b)+1))
rows=[]
for n in bounds:
    expected=brute(n)
    for variant in ['original','pruned','combined','vector','sums','shipping']:
        for mode in ['compiled','reference']:
            p=subprocess.run(['node','benchmarks/euler296-investigation.mjs',mode,variant,str(n)],capture_output=True,text=True,check=True,timeout=15)
            row=json.loads(p.stdout)
            assert int(row['answer'])==expected,(n,expected,row)
            rows.append({'n':n,'mode':mode,'variant':variant,'answer':expected})
print(json.dumps({'oracle':'Direct sorted integer triangle enumeration; a*c divisible by a+b','runs':len(rows),'rows':rows},indent=2))
