"""GPU-only LiteRT runtime. JSON lines in/out; diagnostics stay on stderr."""
import hashlib
import base64
import json
import os
import sys
import time
import uuid
import resource

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
    action = request.get("action")
    if action not in ("load", "invoke", "release"):
        raise ValueError("Unknown RAM action")
    if action == "release":
        if request.get("modelId") == cached_key:
            inputs = outputs = model = cached_key = None
        return {"released": True}
    cached = action == "invoke"
    if cached and (model is None or request.get("modelId") != cached_key):
        return {"error": "RAM model is no longer loaded", "code": "STALE_MODEL"}
    if not cached:
        inputs = outputs = model = cached_key = None
        try:
            options = Options(HardwareAccelerator.GPU, gpu_options=GpuOptions(enforce_f32=True))
            if ("model" in request) == ("modelFile" in request):
                raise ValueError("Supply exactly one model source")
            if "modelFile" in request:
                descriptor = request["modelFile"]
                path = descriptor["path"]
                if not isinstance(path, str) or not os.path.isabs(path):
                    raise ValueError("Model file requires an absolute path")
                with open(path, "rb") as source:
                    stat = os.fstat(source.fileno())
                    if type(descriptor["size"]) is not int or stat.st_size != descriptor["size"]:
                        raise ValueError("Model file size mismatch")
                    digest = hashlib.sha256()
                    while chunk := source.read(1024 * 1024):
                        digest.update(chunk)
                    if digest.hexdigest() != descriptor["sha256"]:
                        raise ValueError("Model file checksum mismatch")
                    after = os.fstat(source.fileno())
                    if (after.st_size, after.st_mtime_ns) != (stat.st_size, stat.st_mtime_ns):
                        raise ValueError("Model file changed during verification")
                model = CompiledModel.from_file(path, options=options)
            else:
                model = CompiledModel.from_buffer(base64.b64decode(request["model"], validate=True), options=options)
            if not model.is_fully_accelerated():
                raise RuntimeError("RAM graph was not fully delegated to GPU")
            inputs = model.create_input_buffers(0)
            outputs = model.create_output_buffers(0)
            cached_key = str(uuid.uuid4())
        except Exception:
            inputs = outputs = model = cached_key = None
            raise
    if action == "load":
        return {"modelId": cached_key, "fullyAccelerated": True,
                "prepareMs": (time.perf_counter() - started) * 1000}
    prepared = time.perf_counter()
    data = np.asarray(request["input"], dtype=np.float32)
    sizes = [int(np.prod(buffer.get_tensor_details()["shape"])) for buffer in inputs]
    if data.ndim != 1 or data.size != sum(sizes) or not np.isfinite(data).all():
        raise ValueError("Invalid RAM input shape or values")
    offset = 0
    for buffer, size in zip(inputs, sizes):
        buffer.write(data[offset:offset + size])
        offset += size
    written = time.perf_counter()
    model.run_by_index(0, inputs, outputs)
    dispatched = time.perf_counter()
    output_size = int(np.prod(outputs[0].get_tensor_details()["shape"]))
    output = outputs[0].read(output_size, np.float32)
    read = time.perf_counter()
    result = output.tolist()
    finished = time.perf_counter()
    response = {"output": result, "backend": "LiteRT GPU", "fullyAccelerated": True,
            "cached": cached, "prepareMs": (prepared - started) * 1000,
            "executeMs": (finished - prepared) * 1000}
    if request.get("profile"):
        response.update(inputMs=(written - prepared) * 1000,
                        dispatchMs=(dispatched - written) * 1000,
                        readbackMs=(read - dispatched) * 1000,
                        outputMs=(finished - read) * 1000,
                        peakRssBytes=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (1 if sys.platform == "darwin" else 1024))
    return response


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
