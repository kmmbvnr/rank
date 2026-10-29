package com.arrrank.app;

import android.content.Context;
import android.util.Base64;
import com.google.ai.edge.litert.Accelerator;
import com.google.ai.edge.litert.CompiledModel;
import com.google.ai.edge.litert.Environment;
import com.google.ai.edge.litert.TensorBuffer;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.security.MessageDigest;
import java.util.List;
import java.util.ArrayList;
import com.google.ai.edge.litert.TensorType;
import java.util.LinkedHashMap;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

/** GPU resources and their bounded LRU are owned by one executor thread. */
final class RamGpu {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Context context;
    private Environment environment;
    private static final long MEMORY_BUDGET = 128L * 1024 * 1024;
    private static final int MAX_MODELS = 4;
    private final LinkedHashMap<String, Resident> models = new LinkedHashMap<>(8, 0.75f, true);
    private final LinkedHashMap<String, State> states = new LinkedHashMap<>();
    private static final int MAX_STATES = 64;
    private final java.util.Set<String> sessions = ConcurrentHashMap.newKeySet();
    private final ConcurrentHashMap<String, String> replyOwners = new ConcurrentHashMap<>();
    private static final class State {
        String owner;
        TensorBuffer buffer;
        List<Integer> shape;
        long bytes;
    }
    private static final class Resident {
        String owner;
        CompiledModel model;
        List<TensorBuffer> inputs, outputs;
        int[] inputSizes;
        boolean[] integerInputs;
        String[] fileInputs;
        long reservation;
        List<TensorType> inputTypes;
        TensorType outputType;
    }

    RamGpu(Context context) { this.context = context.getApplicationContext(); }

    CompletableFuture<JSONObject> openSession() {
        return CompletableFuture.supplyAsync(() -> {
            try {
                String id = java.util.UUID.randomUUID().toString();
                sessions.add(id);
                return new JSONObject().put("sessionId", id);
            } catch (Exception error) { throw new RuntimeException(error); }
        }, executor);
    }

    CompletableFuture<JSONObject> closeSession(String owner) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                if (owner == null || owner.isEmpty()) throw new IllegalArgumentException("Missing GPU session");
                synchronized (replies) {
                    sessions.remove(owner);
                    states.entrySet().removeIf(item -> {
                        if (!owner.equals(item.getValue().owner)) return false;
                        item.getValue().buffer.close(); return true;
                    });
                    models.entrySet().removeIf(item -> {
                        if (!owner.equals(item.getValue().owner)) return false;
                        closeModel(item.getValue()); return true;
                    });
                    replyOwners.entrySet().removeIf(item -> {
                        if (!owner.equals(item.getValue())) return false;
                        CompletableFuture<String> reply = replies.remove(item.getKey());
                        if (reply != null) reply.complete("{\"error\":\"GPU session closed\"}");
                        return true;
                    });
                    if (models.isEmpty() && states.isEmpty()) closeEnvironment();
                    return cacheStatus(new JSONObject());
                }
            } catch (Exception error) { throw new RuntimeException(error); }
        }, executor);
    }

    void resetSessions() {
        executor.submit(() -> {
            synchronized (replies) {
                sessions.clear();
                for (Resident entry : models.values()) closeModel(entry);
                models.clear();
                for (State state : states.values()) state.buffer.close();
                states.clear();
                for (CompletableFuture<String> reply : replies.values()) reply.complete("{\"error\":\"GPU page closed\"}");
                replies.clear(); replyOwners.clear();
                closeEnvironment();
            }
        });
    }

    private final ConcurrentHashMap<String, CompletableFuture<String>> replies = new ConcurrentHashMap<>();

    private CompletableFuture<String> reply(String id) {
        if (id == null || !id.matches("[a-f0-9-]{36}")) throw new IllegalArgumentException("Invalid RAM request id");
        return replies.computeIfAbsent(id, ignored -> new CompletableFuture<>());
    }

    void submit(String id, String payload) {
        CompletableFuture<String> result = reply(id);
        executor.submit(() -> {
            try {
                if (payload == null || payload.length() > 32 * 1024 * 1024) throw new IllegalArgumentException("Invalid RAM request");
                JSONObject request = new JSONObject(payload);
                String owner = request.optString("sessionId", "");
                if (!owner.isEmpty() && sessions.contains(owner)) replyOwners.put(id, owner);
                result.complete(execute(request).toString());
            } catch (Exception error) { result.complete(failure(error)); }
            catch (OutOfMemoryError error) { result.complete(failure(new IllegalStateException("RAM GPU allocation failed", error))); }
        });
    }

    String await(String id, String sessionId) {
        CompletableFuture<String> response;
        synchronized (replies) {
            if (sessionId != null && !sessions.contains(sessionId)) {
                replies.remove(id); replyOwners.remove(id);
                return "{\"error\":\"GPU session is closed\",\"code\":\"STALE_SESSION\"}";
            }
            response = reply(id);
        }
        try { return response.get(60, TimeUnit.SECONDS); }
        catch (Exception error) {
            String owner = sessionId != null ? sessionId : id == null ? null : replyOwners.get(id);
            if (owner != null) {
                closeSession(owner);
                return "{\"error\":\"GPU request failed; session closed\",\"code\":\"STALE_SESSION\"}";
            }
            return failure(error);
        }
        finally { if (id != null) { replies.remove(id); replyOwners.remove(id); } }
    }

    private static String failure(Exception error) {
        JSONObject result = new JSONObject();
        try { result.put("error", "RAM GPU: " + error.toString()); }
        catch (Exception ignored) { }
        return result.toString();
    }

    private JSONObject execute(JSONObject request) throws Exception {
        long started = System.nanoTime();
        String action = request.getString("action");
        String owner = request.optString("sessionId", "");
        if (!owner.isEmpty() && !sessions.contains(owner))
            return new JSONObject().put("error", "GPU session is closed").put("code", "STALE_SESSION");
        if (!action.equals("load") && !action.equals("invoke") && !action.equals("release") && !action.equals("readState") && !action.equals("releaseState"))
            throw new IllegalArgumentException("Unknown RAM action");
        if (action.equals("releaseState")) {
            State state = states.get(request.optString("stateId"));
            if (state != null && !owner.equals(state.owner)) throw new IllegalArgumentException("GPU state belongs to another session");
            states.remove(request.optString("stateId"));
            if (state != null) state.buffer.close();
            if (models.isEmpty() && states.isEmpty()) closeEnvironment();
            return cacheStatus(new JSONObject().put("released", true));
        }
        if (action.equals("readState")) {
            State state = states.get(request.optString("stateId"));
            if (state == null || !owner.equals(state.owner)) return new JSONObject().put("error", "RAM state is no longer available").put("code", "STALE_STATE");
            JSONArray values = new JSONArray();
            for (float value : state.buffer.readFloat()) {
                if (!Float.isFinite(value)) throw new IllegalArgumentException("Non-finite GPU state");
                values.put((double) value);
            }
            return cacheStatus(new JSONObject().put("output", values));
        }
        if (action.equals("release")) {
            Resident released = models.get(request.optString("modelId"));
            if (released != null && !owner.equals(released.owner)) throw new IllegalArgumentException("GPU model belongs to another session");
            closeModel(models.remove(request.optString("modelId")));
            if (models.isEmpty() && states.isEmpty()) closeEnvironment();
            return cacheStatus(new JSONObject().put("released", true));
        }
        boolean cached = action.equals("invoke");
        Resident entry = cached ? models.get(request.optString("modelId")) : new Resident();
        if (entry == null || cached && !owner.equals(entry.owner))
            return new JSONObject().put("error", "RAM model is no longer loaded").put("code", "STALE_MODEL");
        String key = request.optString("modelId");
        int evicted = 0;
        if (!cached) {
            entry.owner = owner;
            Object raw = request.opt("reservationBytes");
            if (raw != null && (!raw.toString().matches("[0-9]+") || request.getLong("reservationBytes") < 1
                    || request.getLong("reservationBytes") > MEMORY_BUDGET))
                throw new IllegalArgumentException("RAM model reservation exceeds the 128 MiB budget or is invalid");
            entry.reservation = raw == null ? MEMORY_BUDGET : request.getLong("reservationBytes");
            if (request.has("model") == request.has("modelFile")) throw new IllegalArgumentException("Supply exactly one model source");
            boolean temporary = !request.has("modelFile");
            File file = temporary ? File.createTempFile("rank-ram-", ".tflite", context.getCacheDir())
                : ModelFiles.resolve(context, request.getJSONObject("modelFile").getString("path"));
            try {
                if (temporary) {
                    try (FileOutputStream stream = new FileOutputStream(file)) { stream.write(Base64.decode(request.getString("model"), Base64.DEFAULT)); }
                } else {
                    JSONObject descriptor = request.getJSONObject("modelFile");
                    long size = file.length(), modified = file.lastModified();
                    if (size > entry.reservation) throw new IllegalArgumentException("RAM reservation is smaller than the model file");
                    if (size != descriptor.getLong("size")) throw new IllegalArgumentException("Model file size mismatch");
                    MessageDigest digest = MessageDigest.getInstance("SHA-256");
                    byte[] chunk = new byte[1024 * 1024];
                    try (FileInputStream stream = new FileInputStream(file)) {
                        int count; while ((count = stream.read(chunk)) != -1) digest.update(chunk, 0, count);
                    }
                    StringBuilder hex = new StringBuilder();
                    for (byte b : digest.digest()) hex.append(String.format("%02x", b & 255));
                    if (!hex.toString().equals(descriptor.getString("sha256"))) throw new IllegalArgumentException("Model file checksum mismatch");
                    if (size != file.length() || modified != file.lastModified()) throw new IllegalArgumentException("Model file changed during verification");
                }
                if (file.length() > entry.reservation)
                    throw new IllegalArgumentException("RAM reservation is smaller than the serialized model");
                if (stateBytes() + entry.reservation > MEMORY_BUDGET) throw new IllegalArgumentException("RAM states leave insufficient model memory; release states explicitly");
                while (!models.isEmpty() && (models.size() >= MAX_MODELS || residentBytes() + entry.reservation > MEMORY_BUDGET)) {
                    String oldest = models.keySet().iterator().next();
                    closeModel(models.remove(oldest)); evicted++;
                }
                // GPU only: do not request CPU as a secondary accelerator.
                CompiledModel.Options options = new CompiledModel.Options(Accelerator.GPU);
                options.setGpuOptions(new CompiledModel.GpuOptions(null, null, null,
                    CompiledModel.GpuOptions.Precision.FP32, null, null, null, null,
                    null, null, null, null, null, null, null));
                // A single environment owns the shared GPU context. Closing an older
                // per-model environment while another is alive crashes Adreno's driver.
                if (environment == null) environment = Environment.create();
                entry.model = CompiledModel.create(file.getAbsolutePath(), options, environment);
                entry.inputs = entry.model.createInputBuffers(); entry.outputs = entry.model.createOutputBuffers();
                JSONArray names = request.optJSONArray("inputNames");
                if (names != null) {
                    if (names.length() != entry.inputs.size()) throw new IllegalArgumentException("Wrong input name count");
                    entry.inputTypes = new ArrayList<>();
                    for (int i = 0; i < names.length(); i++) entry.inputTypes.add(entry.model.getInputTensorType(names.getString(i), ""));
                    entry.outputType = entry.model.getOutputTensorType(request.getString("outputName"), "");
                }
                entry.fileInputs = new String[entry.inputs.size()];
                entry.integerInputs = new boolean[entry.inputs.size()];
                JSONArray dtypes = request.optJSONArray("inputDtypes");
                if (dtypes != null) {
                    if (dtypes.length() != entry.inputs.size()) throw new IllegalArgumentException("Wrong RAM input dtype count");
                    for (int i = 0; i < dtypes.length(); i++) {
                        String dtype = dtypes.getString(i);
                        if (!dtype.equals("f32") && !dtype.equals("i32")) throw new IllegalArgumentException("Invalid RAM input dtype");
                        entry.integerInputs[i] = dtype.equals("i32");
                    }
                }
                JSONArray sizes = request.optJSONArray("inputSizes");
                if (sizes != null) {
                    if (sizes.length() != entry.inputs.size()) throw new IllegalArgumentException("Wrong RAM input count");
                    entry.inputSizes = new int[sizes.length()];
                    for (int i = 0; i < entry.inputSizes.length; i++) {
                        entry.inputSizes[i] = sizes.getInt(i);
                        if (entry.inputSizes[i] < 1 || entry.inputSizes[i] > 4194304)
                            throw new IllegalArgumentException("Invalid RAM input size");
                    }
                } else if (entry.inputs.size() != 1) throw new IllegalArgumentException("Multiple RAM inputs require sizes");
                key = java.util.UUID.randomUUID().toString();
                models.put(key, entry);
            } catch (Exception | OutOfMemoryError error) { closeModel(entry); if (models.isEmpty() && states.isEmpty()) closeEnvironment(); throw error; } finally { if (temporary) file.delete(); }
        }
        if (action.equals("load")) return cacheStatus(new JSONObject().put("modelId", key)
            .put("cacheEvictions", evicted).put("gpuOnlyRequested", true).put("prepareMs", (System.nanoTime() - started) / 1e6));
        CompiledModel model = entry.model;
        List<TensorBuffer> inputs = entry.inputs, outputs = entry.outputs;
        int[] inputSizes = entry.inputSizes;
        String[] fileInputs = entry.fileInputs;
        long prepared = System.nanoTime();
        JSONArray data = request.getJSONArray("input");
        int[] sizes = inputSizes == null ? new int[] {data.length()} : inputSizes;
        JSONArray files = request.optJSONArray("inputFiles");
        if (files != null && (inputSizes == null || files.length() != sizes.length))
            throw new IllegalArgumentException("File inputs require declared input sizes");
        JSONArray stateInputs = request.optJSONArray("inputStates");
        if (stateInputs != null && (entry.inputTypes == null || stateInputs.length() != sizes.length))
            throw new IllegalArgumentException("State inputs require tensor metadata and matching input count");
        List<TensorBuffer> callInputs = new ArrayList<>(inputs);
        int stateInputsReused = 0;
        long total = 0;
        for (int i = 0; i < sizes.length; i++) {
            if (stateInputs != null && !stateInputs.isNull(i)) {
                if (files != null && !files.isNull(i)) throw new IllegalArgumentException("Input cannot be both a state and a file");
                State state = states.get(stateInputs.getString(i));
                if (state == null || !owner.equals(state.owner)) return new JSONObject().put("error", "RAM state is no longer available").put("code", "STALE_STATE");
                TensorType type = entry.inputTypes.get(i);
                if (type.getElementType() != TensorType.ElementType.FLOAT || !state.shape.equals(type.getLayout().getDimensions()))
                    throw new IllegalArgumentException("GPU state input shape or dtype mismatch");
                callInputs.set(i, state.buffer); stateInputsReused++;
            } else if (files == null || files.isNull(i)) total += sizes[i];
        }
        boolean retain = request.optBoolean("retainOutput", false);
        long outputBytes = 0;
        if (retain) {
            if (entry.outputType == null || entry.outputType.getElementType() != TensorType.ElementType.FLOAT)
                throw new IllegalArgumentException("Retained output requires F32 tensor metadata");
            outputBytes = 4;
            for (int n : entry.outputType.getLayout().getDimensions()) outputBytes = Math.multiplyExact(outputBytes, n);
            if (states.size() >= MAX_STATES || residentBytes() + outputBytes > MEMORY_BUDGET)
                throw new IllegalArgumentException("RAM state memory/count limit reached; release states explicitly");
        }
        if (total != data.length()) throw new IllegalArgumentException("Wrong RAM input length");
        int offset = 0, fileInputsReused = 0;
        long fileBytesRead = 0;
        for (int index = 0; index < sizes.length; index++) {
            if (stateInputs != null && !stateInputs.isNull(index)) continue;
            if (files != null && !files.isNull(index)) {
                if (entry.integerInputs[index]) throw new IllegalArgumentException("File inputs require F32 tensors");
                JSONObject descriptor = files.getJSONObject(index);
                ModelFiles.tensorFile(context, descriptor, sizes[index]);
                String identity = descriptor.toString();
                if (identity.equals(fileInputs[index])) { fileInputsReused++; continue; }
                fileInputs[index] = null;
                inputs.get(index).writeFloat(ModelFiles.readTensor(context, descriptor, sizes[index]));
                fileInputs[index] = identity;
                fileBytesRead += descriptor.getLong("length");
                continue;
            }
            fileInputs[index] = null;
            if (entry.integerInputs[index]) {
                int[] input = new int[sizes[index]];
                for (int i = 0; i < input.length; i++) {
                    double value = data.getDouble(offset++);
                    if (!Double.isFinite(value) || value != Math.rint(value) || value < Integer.MIN_VALUE || value > Integer.MAX_VALUE)
                        throw new IllegalArgumentException("RAM i32 input requires signed 32-bit integers");
                    input[i] = (int) value;
                }
                inputs.get(index).writeInt(input);
                continue;
            }
            float[] input = new float[sizes[index]];
            for (int i = 0; i < input.length; i++) {
                input[i] = (float) data.getDouble(offset++);
                if (!Float.isFinite(input[i])) throw new IllegalArgumentException("RAM input requires finite f32 values");
            }
            inputs.get(index).writeFloat(input);
        }
        long written = System.nanoTime();
        model.run(callInputs, outputs);
        long dispatched = System.nanoTime();
        JSONObject result = new JSONObject();
        long read;
        if (retain) {
            List<TensorBuffer> replacement = model.createOutputBuffers();
            State state = new State(); state.owner = owner; state.buffer = outputs.get(0);
            state.shape = new ArrayList<>(entry.outputType.getLayout().getDimensions()); state.bytes = outputBytes;
            String id = java.util.UUID.randomUUID().toString();
            states.put(id, state); entry.outputs = replacement;
            result.put("state", new JSONObject().put("id", id).put("shape", new JSONArray(state.shape)).put("dtype", "f32"));
            read = System.nanoTime();
        } else {
            float[] output = outputs.get(0).readFloat();
            read = System.nanoTime(); outputBytes = output.length * 4L;
            JSONArray values = new JSONArray();
            for (float value : output) values.put((double) value);
            result.put("output", values);
        }
        long packed = System.nanoTime();
        // Kotlin 2.3.0 exposes no isFullyAccelerated query. Do not invent one:
        // full graph placement is verified with delegate logs in the device check.
        result.put("backend", "LiteRT GPU"); result.put("gpuOnlyRequested", true);
        result.put("cached", cached); result.put("prepareMs", (prepared - started) / 1e6);
        result.put("executeMs", (System.nanoTime() - prepared) / 1e6);
        if (request.optBoolean("profile", false)) {
            result.put("stateInputsReused", stateInputsReused);
            result.put("outputBytesRead", retain ? 0 : outputBytes);
            result.put("pssBytes", android.os.Debug.getPss() * 1024L);
            result.put("fileBytesRead", fileBytesRead);
            result.put("fileInputsReused", fileInputsReused);
            result.put("inputMs", (written - prepared) / 1e6);
            result.put("dispatchMs", (dispatched - written) / 1e6);
            result.put("readbackMs", (read - dispatched) / 1e6);
            result.put("outputMs", (packed - read) / 1e6);
        }
        return cacheStatus(result);
    }

    private long stateBytes() { long bytes = 0; for (State state : states.values()) bytes += state.bytes; return bytes; }
    private long residentBytes() {
        long bytes = stateBytes(); for (Resident entry : models.values()) bytes += entry.reservation;
        return bytes;
    }
    private JSONObject cacheStatus(JSONObject result) throws Exception {
        return result.put("residentSessions", sessions.size()).put("residentBytes", residentBytes()).put("residentModels", models.size())
            .put("memoryBudgetBytes", MEMORY_BUDGET).put("residentStates", states.size()).put("stateBytes", stateBytes());
    }
    private static void closeModel(Resident entry) {
        if (entry == null) return;
        if (entry.inputs != null) for (TensorBuffer buffer : entry.inputs) buffer.close();
        if (entry.outputs != null) for (TensorBuffer buffer : entry.outputs) buffer.close();
        if (entry.model != null) entry.model.close();
        entry.inputs = null; entry.outputs = null; entry.model = null; entry.fileInputs = null;
    }
    private void closeEnvironment() { if (environment != null) { environment.close(); environment = null; } }
    void close() {
        resetSessions();
        executor.shutdown();
    }
}
