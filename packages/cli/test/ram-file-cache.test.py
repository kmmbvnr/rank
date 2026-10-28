"""Native buffer lifecycle checks; run with the mlRank Python environment."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import numpy as np

spec = importlib.util.spec_from_file_location('ram_runtime', Path(__file__).parents[1] / 'bin/ram-runtime.py')
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)

class Buffer:
    def __init__(self):
        self.values = np.zeros(2, dtype=np.float32)
        self.fail = False
    def get_tensor_details(self): return {'shape': [2]}
    def write(self, values):
        self.values[:] = values
        if self.fail: raise RuntimeError('write failed')
    def read(self, *_): return self.values.copy()

class Model:
    def __init__(self): self.input, self.output = Buffer(), Buffer()
    def is_fully_accelerated(self): return True
    def create_input_buffers(self, _): return [self.input]
    def create_output_buffers(self, _): return [self.output]
    def run_by_index(self, _, inputs, outputs): outputs[0].write(inputs[0].values * 2)

class FileCacheTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / 'weights.bin'
        self.replace([1, 2])
        self.model = Model()
        self.loader = patch.object(runtime.CompiledModel, 'from_buffer', return_value=self.model)
        self.loader.start()
        self.load()
    def tearDown(self):
        for key in list(runtime.models): runtime.run({'action':'release', 'modelId':key})
        self.loader.stop()
        self.directory.cleanup()
    def replace(self, values):
        temporary = self.path.with_suffix('.new')
        temporary.write_bytes(np.asarray(values, dtype='<f4').tobytes())
        temporary.replace(self.path)
    def descriptor(self):
        st = self.path.stat()
        return dict(path=str(self.path),revision=f'{st.st_dev}:{st.st_ino}:{st.st_size}:{st.st_mtime_ns}:{st.st_ctime_ns}',fileSize=8,offset=0,length=8,dtype='F32',shape=[2])
    def load(self): self.key = runtime.run({'action':'load','model':'AA=='})['modelId']
    def invoke(self, descriptor=None, inline=None):
        return runtime.run(dict(action='invoke',modelId=self.key,input=[] if inline is None else inline,inputFiles=[self.descriptor() if descriptor is None and inline is None else descriptor],profile=True))
    def test_reuse_and_inline_overwrite(self):
        self.assertEqual(self.invoke()['fileBytesRead'], 8)
        self.assertEqual(self.invoke()['fileInputsReused'], 1)
        self.assertEqual(self.invoke(inline=[3,4])['output'], [6,8])
        result = self.invoke()
        self.assertEqual(result['fileBytesRead'], 8)
        self.assertEqual(result['output'], [2,4])
    def test_changed_file_rejected_even_on_cache_hit(self):
        old = self.descriptor(); self.invoke(old); self.replace([4,5])
        with self.assertRaisesRegex(ValueError, 'changed'): self.invoke(old)
        result = self.invoke()
        self.assertEqual(result['output'], [8,10]); self.assertEqual(result['fileBytesRead'], 8)
    def test_failed_write_does_not_leave_a_cached_buffer(self):
        self.invoke(); self.replace([4,5]); self.model.input.fail = True
        with self.assertRaisesRegex(RuntimeError, 'write failed'): self.invoke()
        self.model.input.fail = False
        self.assertEqual(self.invoke()['fileBytesRead'], 8)
    def test_nonfinite_rejected_and_recovery_reads_again(self):
        self.invoke(); self.replace([np.nan,2])
        with self.assertRaisesRegex(ValueError, 'finite'): self.invoke()
        self.replace([1,2]); self.assertEqual(self.invoke()['fileBytesRead'], 8)
    def test_release_and_load_invalidate_inputs(self):
        self.invoke(); runtime.run({'action':'release','modelId':self.key}); self.load()
        self.assertEqual(self.invoke()['fileBytesRead'], 8)

    def test_multiple_models_budget_lru_and_individual_release(self):
        with patch.object(runtime.CompiledModel, 'from_buffer', side_effect=lambda *args, **kwargs: Model()):
            load = lambda: runtime.run({'action':'load','model':'AA==','reservationBytes':64*1024*1024})
            a = load()['modelId']; self.key = a
            self.assertEqual(self.invoke()['fileBytesRead'], 8)
            b = load()['modelId']; self.key = b
            self.assertEqual(self.invoke()['fileBytesRead'], 8)
            self.key = a
            self.assertEqual(self.invoke()['fileInputsReused'], 1)
            c = load()
            self.assertEqual(c['cacheEvictions'], 1)
            self.assertEqual(c['residentModels'], 2)
            self.assertEqual(c['residentBytes'], 128*1024*1024)
            self.assertEqual(runtime.run({'action':'invoke','modelId':b})['code'], 'STALE_MODEL')
            self.assertEqual(self.invoke()['fileBytesRead'], 0)
            released = runtime.run({'action':'release','modelId':c['modelId']})
            self.assertEqual(released['residentModels'], 1)
            self.assertEqual(self.invoke()['fileInputsReused'], 1)

    def test_invalid_admission_preserves_existing_model(self):
        self.invoke()
        for reservation in [0, -1, True, 0.5, 128*1024*1024+1]:
            with self.assertRaisesRegex(ValueError, 'reservation'):
                runtime.run({'action':'load','model':'AA==','reservationBytes':reservation})
        with self.assertRaisesRegex(ValueError, 'smaller'):
            runtime.run({'action':'load','model':'AAAA','reservationBytes':1})
        self.assertEqual(self.invoke()['fileInputsReused'], 1)

    def test_entry_cap_and_failed_allocation(self):
        with patch.object(runtime.CompiledModel, 'from_buffer', side_effect=lambda *args, **kwargs: Model()):
            ids = [runtime.run({'action':'load','model':'AA==','reservationBytes':1024})['modelId'] for _ in range(5)]
            self.assertEqual(len(runtime.models), 4)
            self.assertEqual(runtime.run({'action':'invoke','modelId':ids[0]})['code'], 'STALE_MODEL')
        # Make room so a failed construction need not evict an existing part.
        runtime.run({'action':'release','modelId':ids[1]})
        before = list(runtime.models)
        with patch.object(runtime.CompiledModel, 'from_buffer', side_effect=MemoryError('allocation failed')):
            with self.assertRaisesRegex(MemoryError, 'allocation failed'):
                runtime.run({'action':'load','model':'AA==','reservationBytes':1024})
        self.assertEqual(list(runtime.models), before)

if __name__ == '__main__': unittest.main()
