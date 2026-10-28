import json,struct,sys,numpy as np
path,output=sys.argv[1:]
with open(path,'rb') as f:
 n=struct.unpack('<Q',f.read(8))[0];t=json.loads(f.read(n))['weight']
w=np.memmap(path,dtype='<f4',mode='r',offset=8+n+t['data_offsets'][0],shape=t['shape'])
cases=[]
for ids,positions in [([7,2047,7,0],[0,3,1,127]),([0,7,2047,7],[127,1,3,0])]:
 expected=(w[ids].astype(np.float64)+w[2048+np.asarray(positions)].astype(np.float64)).ravel().tolist()
 cases.append({'ids':ids,'positions':positions,'expected':expected})
json.dump({'cases':cases,'headerBytes':8+n},open(output,'w'))
