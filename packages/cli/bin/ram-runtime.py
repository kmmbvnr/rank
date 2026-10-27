"""One GPU-only LiteRT invocation. JSON in/out; diagnostics stay on stderr."""
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


def run(request):
    started = time.perf_counter()
    model = CompiledModel.from_buffer(
        base64.b64decode(request["model"]), HardwareAccelerator.GPU
    )
    if not model.is_fully_accelerated():
        raise RuntimeError("RAM graph was not fully delegated to GPU")
    inputs = model.create_input_buffers(0)
    outputs = model.create_output_buffers(0)
    prepared = time.perf_counter()
    data = np.asarray(request["input"], dtype=np.float32)
    inputs[0].write(data)
    model.run_by_index(0, inputs, outputs)
    result = outputs[0].read(len(data), np.float32).tolist()
    finished = time.perf_counter()
    return {"output": result, "backend": "LiteRT GPU", "fullyAccelerated": True,
            "prepareMs": (prepared - started) * 1000,
            "executeMs": (finished - prepared) * 1000}


if __name__ == "__main__":
    try:
        os.write(result_fd, (json.dumps(run(json.load(sys.stdin))) + "\n").encode())
    except Exception as error:
        os.write(result_fd, (json.dumps({"error": str(error)}) + "\n").encode())
        sys.exit(1)
