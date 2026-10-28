# Independent reference for the explicit planner's X @ W.T operation.
import json,struct,sys,numpy as np
path,name,output=sys.argv[1:]
with open(path,'rb') as f:
 n=struct.unpack('<Q',f.read(8))[0];t=json.loads(f.read(n))[name]
assert t['dtype']=='F32' and len(t['shape'])==2
w=np.memmap(path,dtype='<f4',mode='r',offset=8+n+t['data_offsets'][0],shape=t['shape'])
x=np.sin(np.arange(t['shape'][1])*0.013).astype(np.float32)
expected=[];demo=[]
for start in range(0,t['shape'][0],1024):
 block=w[start:start+1024].astype(np.float64)
 expected.extend((block@x.astype(np.float64)).tolist());demo.extend((block.sum(axis=1)*0.5).tolist())
json.dump({'x':x.tolist(),'expected':expected,'demoExpected':demo,'headerBytes':8+n,'tensorOffset':8+n+t['data_offsets'][0]},open(output,'w'))
