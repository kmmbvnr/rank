# Independent reference for the explicit planner's X @ W.T operation.
import json,struct,sys,numpy as np
path,name,output=sys.argv[1:4]
tokens=int(sys.argv[4]) if len(sys.argv)>4 else 1
with open(path,'rb') as f:
 n=struct.unpack('<Q',f.read(8))[0];t=json.loads(f.read(n))[name]
assert t['dtype']=='F32' and len(t['shape'])==2
w=np.memmap(path,dtype='<f4',mode='r',offset=8+n+t['data_offsets'][0],shape=t['shape'])
x=np.sin(np.arange(t['shape'][1])[None,:]*0.013+np.arange(tokens)[:,None]*0.4).astype(np.float32)
expected=np.empty((tokens,t['shape'][0]));demo=np.empty_like(expected)
for start in range(0,t['shape'][0],1024):
 block=w[start:start+1024].astype(np.float64)
 expected[:,start:start+len(block)]=x.astype(np.float64)@block.T
 demo[:,start:start+len(block)]=block.sum(axis=1)*0.5
json.dump({'x':x.ravel().tolist(),'expected':expected.ravel().tolist(),'demoExpected':demo.ravel().tolist(),'headerBytes':8+n,'tensorOffset':8+n+t['data_offsets'][0]},open(output,'w'))
