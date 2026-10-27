"""Native runtime comparison; one subprocess per case/backend/trial, no JSON IPC in timings.
Usage: python coreml-compare.py FIXTURES.json RESULTS.json
Use an isolated environment with coremltools==9.0, ai-edge-litert==2.3.0, numpy==2.5.4.
"""
import base64
import hashlib
import json
import platform
import resource
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def worker(f, engine, mode):
    import numpy as np
    arrays = [np.asarray(x['items'], dtype=np.float32).reshape(x['shape']) for x in f['inputs']]
    def reference(data):
        x = data[0].astype(np.float64)
        if f['recipe'] == 'layernorm':
            centered = x - np.mean(x, axis=-1, keepdims=True)
            expected = centered / np.sqrt(np.mean(centered ** 2, axis=-1, keepdims=True) + 1e-5)
        elif f['recipe'] == 'gelu':
            expected = .5 * x * (1 + np.tanh(np.sqrt(2 / np.pi) * (x + .044715 * x ** 3)))
        elif f['recipe'] == 'matmul':
            expected = x @ data[1].astype(np.float64)
        else:
            p = x @ np.asarray(f['weights'], dtype=np.float64).reshape(f['weightShape'])
            q = p[..., :64].reshape(1, 16, 4, 16).transpose(0, 2, 1, 3)
            k = p[..., 64:128].reshape(1, 16, 4, 16).transpose(0, 2, 3, 1)
            expected = q @ k
        return expected
    expected = reference(arrays)
    result = {'case': f['name'], 'engine': engine, 'mode': mode}
    now = time.perf_counter
    if engine.startswith('litert'):
        from ai_edge_litert.compiled_model import CompiledModel
        from ai_edge_litert.hardware_accelerator import HardwareAccelerator
        from ai_edge_litert.options import Options, GpuOptions
        result['rssAfterImportBytes'] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        started = now()
        model = CompiledModel.from_buffer(base64.b64decode(f['implicitModel'] if engine == 'litert-implicit' else f['model']),
            options=Options(HardwareAccelerator.GPU, gpu_options=GpuOptions(enforce_f32=True)) if mode=='GPU' else Options(HardwareAccelerator.CPU))
        if mode=='GPU': assert model.is_fully_accelerated()
        inputs = model.create_input_buffers(0)
        outputs = model.create_output_buffers(0)
        result['prepareMs'] = (now()-started)*1000
        result['fullyAccelerated'] = model.is_fully_accelerated()
        result['requestedDevice'] = mode
        def predict():
            for buffer, data in zip(inputs, arrays):
                buffer.write(data.ravel())
            model.run_by_index(0, inputs, outputs)
            return outputs[0].read(expected.size, np.float32).reshape(expected.shape)
    else:
        import coremltools as ct
        from coremltools.converters.mil import Builder as mb, Program, Function
        from coremltools.models.compute_plan import MLComputePlan
        result['rssAfterImportBytes'] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        units = getattr(ct.ComputeUnit, mode)
        started = now()
        program = Program()
        placeholders = {f'x{i}': mb.placeholder(shape=a.shape) for i, a in enumerate(arrays)}
        with Function(placeholders, opset_version=ct.target.iOS18) as function:
            args = list(function.inputs.values())
            if engine == 'coreml-natural':
                if f['recipe'] == 'layernorm':
                    y = mb.layer_norm(x=args[0], axes=[-1], epsilon=np.float32(1e-5))
                elif f['recipe'] == 'gelu':
                    y = mb.gelu(x=args[0], mode='TANH_APPROXIMATION')
                elif f['recipe'] == 'matmul':
                    y = mb.matmul(x=args[0], y=args[1])
                else:
                    w = np.asarray(f['weights'], dtype=np.float32).reshape(f['weightShape'])
                    p = mb.matmul(x=args[0], y=w)
                    q = mb.slice_by_size(x=p, begin=[0,0,0], size=[1,16,64])
                    k = mb.slice_by_size(x=p, begin=[0,0,64], size=[1,16,64])
                    q = mb.transpose(x=mb.reshape(x=q, shape=[1,16,4,16]), perm=[0,2,1,3])
                    k = mb.transpose(x=mb.reshape(x=k, shape=[1,16,4,16]), perm=[0,2,3,1])
                    y = mb.matmul(x=q, y=k)
            else:
                values = []; input_index = 0
                for n in f['nodes']:
                    kind = n['kind']
                    if kind == 'input':
                        y = args[input_index]; input_index += 1
                    elif kind == 'constant':
                        y = mb.const(val=np.asarray(n['values'],dtype=np.int32 if n.get('dtype')=='i32' else np.float32).reshape(n['shape']))
                    elif kind == 'reshape': y = mb.reshape(x=values[n['input']],shape=n['shape'])
                    elif kind == 'transpose': y = mb.transpose(x=values[n['input']],perm=values[n['permutation']])
                    elif kind == 'slice': y = mb.slice_by_size(x=values[n['input']],begin=values[n['begin']],size=values[n['size']])
                    elif kind == 'concat': y = mb.concat(values=[values[i] for i in n['operands']],axis=n['axis'])
                    elif kind in ('relu','tanh','rsqrt','softmax'):
                        y = getattr(mb,kind)(x=values[n['input']])
                    elif kind == 'sum': y = mb.reduce_sum(x=values[n['left']],axes=values[n['right']],keep_dims=True)
                    elif kind in ('linear','matmul'): y = mb.matmul(x=values[n['left']],y=values[n['right']])
                    else: y = getattr(mb,{'div':'real_div'}.get(kind,kind))(x=values[n['left']],y=values[n['right']])
                    values.append(y)
                y = values[f['output']]
            function.set_outputs([y])
        program.add_function('main',function)
        converted = ct.convert(program,convert_to='mlprogram',minimum_deployment_target=ct.target.iOS18,
            compute_precision=ct.precision.FLOAT32,compute_units=units,skip_model_load=True)
        result['convertMs'] = (now()-started)*1000
        temp = tempfile.TemporaryDirectory(prefix='rank-coreml-')
        package = str(Path(temp.name)/'model.mlpackage')
        converted.save(package)
        started = now()
        compiled = ct.models.utils.compile_model(package, destination_path=str(Path(temp.name)/'compiled.mlmodelc'))
        result['compileMs'] = (now()-started)*1000
        started = now()
        model = ct.models.CompiledMLModel(compiled,compute_units=units)
        result['loadMs'] = (now()-started)*1000
        result['prepareMs'] = result['compileMs']+result['loadMs']
        output_name = converted.get_spec().description.output[0].name
        data = {f'x{i}':a for i,a in enumerate(arrays)}
        def predict():
            return model.predict(data)[output_name]
    started=now(); output=predict(); result['firstPredictMs']=(now()-started)*1000
    errors=np.abs(output.astype(np.float64)-expected)
    result['maxAbsError']=float(np.max(errors))
    result['correct']=bool(np.all(np.isfinite(output)) and np.all(errors<=1e-5+1e-5*np.abs(expected)))
    # Keep bad results for diagnosis, but do not rank their speed as valid inference.
    for _ in range(5): predict()
    samples=[]
    for _ in range(30):
        started=now(); output=predict(); samples.append((now()-started)*1000)
    errors=np.abs(output.astype(np.float64)-expected)
    result['correct']=result['correct'] and bool(np.all(np.isfinite(output)) and np.all(errors<=1e-5+1e-5*np.abs(expected)))
    result['maxAbsError']=max(result['maxAbsError'],float(np.max(errors)))
    result['warmMs']=samples
    result['warmMedianMs']=statistics.median(samples)
    result['warmP95Ms']=sorted(samples)[28]
    # Check that model reuse observes changed data, outside the timing samples.
    arrays[0] *= np.float32(2)
    changed_expected = reference(arrays)
    changed_output = predict()
    changed_error = np.abs(changed_output.astype(np.float64)-changed_expected)
    result['changedInputCorrect'] = bool(np.all(np.isfinite(changed_output)) and np.all(changed_error<=1e-5+1e-5*np.abs(changed_expected)))
    result['changedInputMaxAbsError'] = float(np.max(changed_error))
    result['peakRssBytes']=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if engine.startswith('coreml'):
        try:
            plan=MLComputePlan.load_from_path(compiled,compute_units=units)
            placement=[]
            for op in plan.model_structure.program.functions['main'].block.operations:
                usage=plan.get_compute_device_usage_for_mlprogram_operation(op)
                placement.append({'op':op.operator_name,'preferred':type(usage.preferred_compute_device).__name__ if usage else None,
                    'supported':[type(device).__name__ for device in usage.supported_compute_devices] if usage else []})
            result['anticipatedPlacement']=placement
        except Exception as error: result['placementError']=str(error)
        temp.cleanup()
    return result


if __name__=='__main__':
    if '--worker' in sys.argv:
        payload=json.loads(Path(sys.argv[1]).read_text())
        fixture=payload if isinstance(payload,dict) else payload[int(sys.argv[2])]
        # Keep native stdout diagnostics out of the result file.
        try: result=worker(fixture,sys.argv[3],sys.argv[4])
        except Exception as error: result={'case':fixture['name'],'engine':sys.argv[3],'mode':sys.argv[4],'error':str(error)}
        Path(sys.argv[5]).write_text(json.dumps(result))
    else:
        fixtures=json.loads(Path(sys.argv[1]).read_text()); jobs=[]
        for i,f in enumerate(fixtures):
            jobs.append((i,'litert-current','GPU'))
            jobs.append((i,'litert-current','CPU'))
            if f['recipe']=='matmul':
                jobs.append((i,'litert-implicit','GPU'))
                jobs.append((i,'litert-implicit','CPU'))
            jobs.append((i,'coreml-lowered','CPU_AND_GPU'))
            for mode in ['CPU_ONLY','CPU_AND_GPU','ALL']: jobs.append((i,'coreml-natural',mode))
        import importlib.metadata
        versions={name:importlib.metadata.version(name) for name in ['coremltools','ai-edge-litert','numpy']}
        chip=subprocess.check_output(['sysctl','-n','machdep.cpu.brand_string'],text=True).strip()
        results=[]
        for trial in range(2):
            for i,engine,mode in (jobs if trial==0 else reversed(jobs)):
                print(trial,fixtures[i]['name'],engine,mode,flush=True)
                with tempfile.TemporaryDirectory(prefix='rank-compare-') as directory:
                    path=str(Path(directory)/'result.json')
                    fixture_path=str(Path(directory)/'fixture.json')
                    Path(fixture_path).write_text(json.dumps(fixtures[i]))
                    run=subprocess.run([sys.executable,__file__,fixture_path,str(i),engine,mode,path,'--worker'],capture_output=True,text=True,timeout=180)
                    if Path(path).exists(): result=json.loads(Path(path).read_text())
                    else: result={'case':fixtures[i]['name'],'engine':engine,'mode':mode,'error':run.stderr[-3000:] or f'exit {run.returncode}'}
                    result['trial']=trial; results.append(result)
                    report={'date':'2026-10-27','machine':platform.platform(),'chip':chip,'versions':versions,'python':sys.version,'precision':'FP32','tolerance':{'atol':1e-5,'rtol':1e-5},'method':'Fresh process per case/backend/trial. 1 first call, 5 warmups, 30 measured calls. Trial 2 reverses order. Core ML placement is anticipated, not a hardware trace. Prepare includes native compilation/loading; conversion separate. OS caches are not cleared. Native in-process latency includes input/output handling, excludes Rank/JSON IPC. Peak RSS is process lifetime high water, not model allocation.','fixtures':[{'name':f['name'],'recipe':f['recipe'],'inputShapes':[x['shape'] for x in f['inputs']],'ramCompileMs':f['compileMs'],'modelBytes':len(base64.b64decode(f['model'])),'sourceSha256':hashlib.sha256(f['source'].encode()).hexdigest()} for f in fixtures],'results':results}
                    Path(sys.argv[2]).write_text(json.dumps(report,indent=2))
                    print('  ',result.get('correct'),result.get('warmMedianMs'),result.get('error',''),flush=True)
