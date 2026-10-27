"""GPU-only LiteRT runtime. JSON lines in/out; diagnostics stay on stderr."""
import base64
import json
import os
import sys
import time

# Some native GPU drivers write diagnostics directly to fd 1. Keep the wire
# separate from both Python logging and C stdio, including process teardown.
result_fd = os.dup(sys.stdout.fileno())
os.dup2(sys.stderr.fileno(), sys.stdout.fileno())

import numpy as np
from ai_edge_litert.compiled_model import CompiledModel
from ai_edge_litert.hardware_accelerator import HardwareAccelerator
from ai_edge_litert.options import Options, GpuOptions


cached_key = None
model = inputs = outputs = None


def run(request):
    global cached_key, model, inputs, outputs
    started = time.perf_counter()
    cached = cached_key == request["model"]
    if not cached:
        # Release the old buffers before the model; retain only one compiled graph.
        inputs = outputs = model = None
        cached_key = None
        model = CompiledModel.from_buffer(
            base64.b64decode(request["model"]),
            options=Options(HardwareAccelerator.GPU, gpu_options=GpuOptions(enforce_f32=True))
        )
        if not model.is_fully_accelerated():
            raise RuntimeError("RAM graph was not fully delegated to GPU")
        inputs = model.create_input_buffers(0)
        outputs = model.create_output_buffers(0)
        cached_key = request["model"]
    prepared = time.perf_counter()
    data = np.asarray(request["input"], dtype=np.float32)
    inputs[0].write(data)
    model.run_by_index(0, inputs, outputs)
    output_size = int(np.prod(outputs[0].get_tensor_details()["shape"]))
    result = outputs[0].read(output_size, np.float32).tolist()
    finished = time.perf_counter()
    return {"output": result, "backend": "LiteRT GPU", "fullyAccelerated": True,
            "cached": cached, "prepareMs": (prepared - started) * 1000,
            "executeMs": (finished - prepared) * 1000}


if __name__ == "__main__":
    wire = os.fdopen(result_fd, "w")
    requests = sys.stdin if "--serve" in sys.argv else [sys.stdin.read()]
    for line in requests:
        try:
            result = run(json.loads(line))
        except Exception as error:
            result = {"error": str(error)}
        wire.write(json.dumps(result) + "\n")
        wire.flush()
