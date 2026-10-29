package com.arrrank.app;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceResponse;
import java.io.File;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** Read-only bounded access to imported checkpoint/model files in app storage. */
final class ModelFiles {
    static File resolve(Context context, String name) throws Exception {
        if (name == null || !name.matches("[A-Za-z0-9_-][A-Za-z0-9_./-]*") || name.contains(".."))
            throw new IllegalArgumentException("Invalid model file name");
        File root = new File(context.getFilesDir(), "models").getCanonicalFile();
        File file = new File(root, name).getCanonicalFile();
        if (!file.getPath().startsWith(root.getPath() + File.separator) || !file.isFile())
            throw new IllegalArgumentException("Model file not found");
        return file;
    }

    static File tensorFile(Context context, JSONObject descriptor, int size) throws Exception {
        if (!"F32".equals(descriptor.getString("dtype")) || size < 1 || size > 4194304)
            throw new IllegalArgumentException("File input requires F32 and a valid tensor size");
        long offset = exactLong(descriptor, "offset"), length = exactLong(descriptor, "length");
        long expectedSize = exactLong(descriptor, "fileSize");
        org.json.JSONArray shape = descriptor.getJSONArray("shape");
        long elements = 1;
        if (shape.length() < 1 || shape.length() > 4) throw new IllegalArgumentException("Invalid file tensor shape");
        for (int i = 0; i < shape.length(); i++) {
            long dimension = shape.getLong(i);
            if (dimension < 1 || dimension > 4194304 || !shape.get(i).toString().matches("[0-9]+"))
                throw new IllegalArgumentException("Invalid file tensor shape");
            elements = Math.multiplyExact(elements, dimension);
        }
        if (elements != size || length != size * 4L || expectedSize < length || offset > expectedSize - length)
            throw new IllegalArgumentException("Invalid file tensor range");
        File file = resolve(context, descriptor.getString("path"));
        String revision = descriptor.getString("revision");
        if (file.length() != expectedSize || !revision.equals(file.length() + ":" + file.lastModified()))
            throw new IllegalArgumentException("File tensor changed; reopen the checkpoint");
        return file;
    }

    static final class TensorReadProfile {
        long allocationNanos, readNanos, decodeNanos;
    }

    static float[] readTensor(Context context, JSONObject descriptor, int size, TensorReadProfile profile) throws Exception {
        File file = tensorFile(context, descriptor, size);
        long offset = descriptor.getLong("offset");
        String revision = descriptor.getString("revision");
        // The Kotlin LiteRT API accepts float[], not a file or mapped ByteBuffer.
        // Keep the intermediate read buffer bounded; no tensor data enters the WebView.
        long allocated = profile == null ? 0 : System.nanoTime();
        float[] values = new float[size];
        byte[] bytes = new byte[Math.min(65536, size * 4)];
        ByteBuffer view = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        if (profile != null) profile.allocationNanos += System.nanoTime() - allocated;
        try (RandomAccessFile stream = new RandomAccessFile(file, "r")) {
            stream.seek(offset);
            for (int at = 0; at < size;) {
                int count = Math.min(bytes.length / 4, size - at);
                long started = profile == null ? 0 : System.nanoTime();
                stream.readFully(bytes, 0, count * 4);
                long read = profile == null ? 0 : System.nanoTime();
                if (profile != null) profile.readNanos += read - started;
                for (int i = 0; i < count; i++) {
                    float value = view.getFloat(i * 4);
                    if (!Float.isFinite(value)) throw new IllegalArgumentException("RAM file input requires finite f32 values");
                    values[at++] = value;
                }
                if (profile != null) profile.decodeNanos += System.nanoTime() - read;
            }
        }
        if (!revision.equals(file.length() + ":" + file.lastModified()))
            throw new IllegalArgumentException("File tensor changed during transfer");
        return values;
    }

    private static long exactLong(JSONObject value, String key) throws Exception {
        Object raw = value.get(key);
        if (!raw.toString().matches("[0-9]+")) throw new IllegalArgumentException("Invalid " + key);
        long result = value.getLong(key);
        if (result < 0 || result > 9007199254740991L) throw new IllegalArgumentException("Invalid " + key);
        return result;
    }

    static WebResourceResponse serve(Context context, Uri uri) {
        try {
            File file = resolve(context, uri.getQueryParameter("name"));
            byte[] data;
            String mime;
            if ("stat".equals(uri.getQueryParameter("action"))) {
                data = new JSONObject().put("size", file.length()).put("revision", file.length() + ":" + file.lastModified())
                    .toString().getBytes(StandardCharsets.UTF_8);
                mime = "application/json";
            } else if ("sha256".equals(uri.getQueryParameter("action"))) {
                long size = file.length(), modified = file.lastModified();
                java.security.MessageDigest digest = java.security.MessageDigest.getInstance("SHA-256");
                byte[] chunk = new byte[65536];
                try (java.io.FileInputStream stream = new java.io.FileInputStream(file)) {
                    int count; while ((count = stream.read(chunk)) != -1) digest.update(chunk, 0, count);
                }
                if (size != file.length() || modified != file.lastModified())
                    throw new IllegalArgumentException("File changed during checksum verification");
                StringBuilder hex = new StringBuilder();
                for (byte b : digest.digest()) hex.append(String.format("%02x", b & 255));
                data = new JSONObject().put("sha256", hex.toString()).toString().getBytes(StandardCharsets.UTF_8);
                mime = "application/json";
            } else {
                long offset = Long.parseLong(uri.getQueryParameter("offset"));
                int count = Integer.parseInt(uri.getQueryParameter("count"));
                if (offset < 0 || offset > file.length() || count < 0 || count > 65536)
                    throw new IllegalArgumentException("Invalid model file range");
                data = new byte[(int)Math.min(count, file.length() - offset)];
                try (RandomAccessFile stream = new RandomAccessFile(file, "r")) {
                    stream.seek(offset); stream.readFully(data);
                }
                mime = "application/octet-stream";
            }
            return new WebResourceResponse(mime, null, 200, "OK",
                DebugSignalClient.addIsolationHeaders(java.util.Collections.singletonMap("Cache-Control", "no-store")), new ByteArrayInputStream(data));
        } catch (Exception error) {
            return new WebResourceResponse("text/plain", "UTF-8", 400, "Bad Request",
                DebugSignalClient.addIsolationHeaders(java.util.Collections.singletonMap("Cache-Control", "no-store")),
                new ByteArrayInputStream(error.toString().getBytes(StandardCharsets.UTF_8)));
        }
    }
}
