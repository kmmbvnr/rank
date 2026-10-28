"""GPU-only LiteRT runtime. JSON lines in/out; diagnostics stay on stderr."""
import hashlib
import base64
import json
import os
import sys
import time
import uuid
import resource
from collections import OrderedDict

# Some native GPU drivers write diagnostics directly to fd 1. Keep the wire
# separate from both Python logging and C stdio, including process teardown.
result_fd = os.dup(sys.stdout.fileno())
os.dup2(sys.stderr.fileno(), sys.stdout.fileno())

import numpy as np
import ai_edge_litert
from ai_edge_litert.environment import Environment, EnvironmentOptions
from ai_edge_litert.compiled_model import CompiledModel
from ai_edge_litert.hardware_accelerator import HardwareAccelerator
from ai_edge_litert.options import Options, GpuOptions


MEMORY_BUDGET = 128 * 1024 * 1024
MAX_MODELS = 4
models = OrderedDict()
states = {}
MAX_STATES = 64
environment = None


def state_bytes():
    return sum(entry["bytes"] for entry in states.values())


def cache_status():
    return {"residentModels": len(models),
            "residentBytes": sum(entry["reservation"] for entry in models.values()) + state_bytes(),
            "residentStates": len(states), "stateBytes": state_bytes(),
            "memoryBudgetBytes": MEMORY_BUDGET}


def run(request):
    global environment
    started = time.perf_counter()
    action = request.get("action")
    if action not in ("load", "invoke", "release", "readState", "releaseState"):
        raise ValueError("Unknown RAM action")
    if action == "releaseState":
        states.pop(request.get("stateId"), None)
        return {"released": True, **cache_status()}
    if action == "readState":
        state = states.get(request.get("stateId"))
        if state is None: return {"error": "RAM state is no longer available", "code": "STALE_STATE"}
        values = state["buffer"].read(state["bytes"] // 4, np.float32)
        if not np.isfinite(values).all(): raise ValueError("Non-finite GPU state")
        return {"output": values.tolist(), **cache_status()}
    if action == "release":
        models.pop(request.get("modelId"), None)
        return {"released": True, **cache_status()}
    if action == "load":
        # Legacy/prepared model callers without an estimate reserve the whole budget.
        reservation = request.get("reservationBytes", MEMORY_BUDGET)
        if type(reservation) is not int or reservation < 1 or reservation > MEMORY_BUDGET:
            raise ValueError("RAM model reservation exceeds the 128 MiB budget or is invalid")
        if ("model" in request) == ("modelFile" in request):
            raise ValueError("Supply exactly one model source")
        path = data = None
        if "modelFile" in request:
            descriptor = request["modelFile"]
            path = descriptor["path"]
            if not isinstance(path, str) or not os.path.isabs(path):
                raise ValueError("Model file requires an absolute path")
            with open(path, "rb") as source:
                stat = os.fstat(source.fileno())
                if type(descriptor["size"]) is not int or stat.st_size != descriptor["size"]:
                    raise ValueError("Model file size mismatch")
                if stat.st_size > reservation:
                    raise ValueError("RAM reservation is smaller than the model file")
                digest = hashlib.sha256()
                while chunk := source.read(1024 * 1024):
                    digest.update(chunk)
                if digest.hexdigest() != descriptor["sha256"]:
                    raise ValueError("Model file checksum mismatch")
                after = os.fstat(source.fileno())
                if (after.st_size, after.st_mtime_ns) != (stat.st_size, stat.st_mtime_ns):
                    raise ValueError("Model file changed during verification")
        else:
            data = base64.b64decode(request["model"], validate=True)
            if len(data) > reservation:
                raise ValueError("RAM reservation is smaller than the serialized model")
        if state_bytes() + reservation > MEMORY_BUDGET:
            raise ValueError("RAM states leave insufficient model memory; release states explicitly")
        evicted = 0
        while models and (len(models) >= MAX_MODELS or cache_status()["residentBytes"] + reservation > MEMORY_BUDGET):
            models.popitem(last=False)
            evicted += 1
        options = Options(HardwareAccelerator.GPU, gpu_options=GpuOptions(enforce_f32=True))
        if environment is None:
            environment = Environment.create(options=EnvironmentOptions(runtime_path=os.path.dirname(ai_edge_litert.__file__)))
        model = CompiledModel.from_file(path, options=options, environment=environment) if path else CompiledModel.from_buffer(data, options=options, environment=environment)
        if not model.is_fully_accelerated():
            raise RuntimeError("RAM graph was not fully delegated to GPU")
        inputs, outputs = model.create_input_buffers(0), model.create_output_buffers(0)
        key = str(uuid.uuid4())
        models[key] = {"model": model, "inputs": inputs, "outputs": outputs,
                       "file_inputs": [None] * len(inputs), "reservation": reservation}
        return {"modelId": key, "fullyAccelerated": True, "cacheEvictions": evicted,
                "prepareMs": (time.perf_counter() - started) * 1000, **cache_status()}
    key = request.get("modelId")
    entry = models.get(key)
    if entry is None:
        return {"error": "RAM model is no longer loaded", "code": "STALE_MODEL"}
    models.move_to_end(key)
    model, inputs, outputs, file_inputs = (entry[name] for name in ("model", "inputs", "outputs", "file_inputs"))
    prepared = time.perf_counter()
    data = np.asarray(request["input"], dtype=np.float64)
    sizes = [int(np.prod(buffer.get_tensor_details()["shape"])) for buffer in inputs]
    files = request.get("inputFiles", [None] * len(inputs))
    if not isinstance(files, list) or len(files) != len(inputs):
        raise ValueError("Wrong file input count")
    state_inputs = request.get("inputStates", [None] * len(inputs))
    if not isinstance(state_inputs, list) or len(state_inputs) != len(inputs):
        raise ValueError("Wrong state input count")
    call_inputs = list(inputs)
    for index, state_id in enumerate(state_inputs):
        if state_id is None: continue
        if files[index] is not None: raise ValueError("Input cannot be both a state and a file")
        if not isinstance(state_id, str) or state_id not in states:
            return {"error": "RAM state is no longer available", "code": "STALE_STATE"}
        saved = states[state_id]
        details = inputs[index].get_tensor_details()
        if saved["shape"] != list(details["shape"]) or details.get("dtype", "float32") != "float32":
            raise ValueError("GPU state input shape or dtype mismatch")
        call_inputs[index] = saved["buffer"]
    retain = request.get("retainOutput", False)
    output_shape = list(outputs[0].get_tensor_details()["shape"])
    output_bytes = int(np.prod(output_shape)) * 4
    if retain and outputs[0].get_tensor_details().get("dtype", "float32") != "float32":
        raise ValueError("Retained output requires F32 tensor metadata")
    if retain and (len(states) >= MAX_STATES or cache_status()["residentBytes"] + output_bytes > MEMORY_BUDGET):
        raise ValueError("RAM state memory/count limit reached; release states explicitly")
    if data.ndim != 1 or data.size != sum(size for size, file, state in zip(sizes, files, state_inputs) if file is None and state is None) or not np.isfinite(data).all():
        raise ValueError("Invalid RAM input shape or values")
    offset = 0
    file_bytes = file_reused = 0
    for index, (buffer, size, descriptor) in enumerate(zip(inputs, sizes, files)):
        if state_inputs[index] is not None: continue
        if descriptor is None:
            file_inputs[index] = None
            values = data[offset:offset + size]
            dtype = buffer.get_tensor_details().get("dtype", "float32")
            if dtype == "int32":
                if np.any(values != np.floor(values)) or np.any(values < -2147483648) or np.any(values > 2147483647):
                    raise ValueError("RAM i32 input requires signed 32-bit integers")
                buffer.write(values.astype(np.int32))
            else:
                values = values.astype(np.float32)
                if not np.isfinite(values).all():
                    raise ValueError("RAM input requires finite f32 values")
                buffer.write(values)
            offset += size
            continue
        if buffer.get_tensor_details().get("dtype", "float32") != "float32":
            raise ValueError("File inputs require F32 tensors")
        shape = list(buffer.get_tensor_details()["shape"])
        if (descriptor.get("dtype") != "F32" or descriptor.get("shape") != shape
                or type(descriptor.get("offset")) is not int or type(descriptor.get("length")) is not int
                or type(descriptor.get("fileSize")) is not int or descriptor["offset"] < 0
                or descriptor["length"] != size * 4
                or descriptor["offset"] > descriptor["fileSize"] - descriptor["length"]
                or not isinstance(descriptor.get("path"), str) or not os.path.isabs(descriptor["path"])):
            raise ValueError("Invalid file tensor descriptor")
        with open(descriptor["path"], "rb") as source:
            stat = os.fstat(source.fileno())
            revision = lambda st: f"{st.st_dev}:{st.st_ino}:{st.st_size}:{st.st_mtime_ns}:{st.st_ctime_ns}"
            if stat.st_size != descriptor["fileSize"] or revision(stat) != descriptor.get("revision"):
                raise ValueError("File tensor changed; reopen the checkpoint")
            if file_inputs[index] == descriptor:
                file_reused += 1
                continue
            file_inputs[index] = None
            mapped = np.memmap(source, dtype="<f4", mode="r", offset=descriptor["offset"], shape=(size,))
            try:
                for start in range(0, size, 16384):
                    if not np.isfinite(mapped[start:start + 16384]).all():
                        raise ValueError("RAM file input requires finite f32 values")
                buffer.write(mapped)
                if revision(os.fstat(source.fileno())) != descriptor["revision"]:
                    raise ValueError("File tensor changed during transfer")
                file_inputs[index] = dict(descriptor)
                file_bytes += descriptor["length"]
            finally:
                mapped._mmap.close()
    written = time.perf_counter()
    model.run_by_index(0, call_inputs, outputs)
    dispatched = time.perf_counter()
    if retain:
        replacement = model.create_output_buffers(0)
        state_id = str(uuid.uuid4())
        states[state_id] = {"buffer": outputs[0], "shape": output_shape, "bytes": output_bytes}
        entry["outputs"] = replacement
        result = {"state": {"id": state_id, "shape": output_shape, "dtype": "f32"}}
        read = time.perf_counter()
    else:
        output = outputs[0].read(output_bytes // 4, np.float32)
        read = time.perf_counter()
        result = {"output": output.tolist()}
    finished = time.perf_counter()
    response = {**result, "backend": "LiteRT GPU", "fullyAccelerated": True,
            "cached": True, **cache_status(), "prepareMs": (prepared - started) * 1000,
            "executeMs": (finished - prepared) * 1000}
    if request.get("profile"):
        response.update(stateInputsReused=sum(x is not None for x in state_inputs), outputBytesRead=0 if retain else output_bytes, fileBytesRead=file_bytes, fileInputsReused=file_reused, inputMs=(written - prepared) * 1000,
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
