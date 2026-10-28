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

    static float[] readTensor(Context context, JSONObject descriptor, int size) throws Exception {
        if (!"F32".equals(descriptor.getString("dtype")) || size < 1 || size > 1048576)
            throw new IllegalArgumentException("File input requires F32 and a valid tensor size");
        long offset = exactLong(descriptor, "offset"), length = exactLong(descriptor, "length");
        long expectedSize = exactLong(descriptor, "fileSize");
        org.json.JSONArray shape = descriptor.getJSONArray("shape");
        long elements = 1;
        if (shape.length() < 1 || shape.length() > 4) throw new IllegalArgumentException("Invalid file tensor shape");
        for (int i = 0; i < shape.length(); i++) {
            long dimension = shape.getLong(i);
            if (dimension < 1 || dimension > 1048576 || !shape.get(i).toString().matches("[0-9]+"))
                throw new IllegalArgumentException("Invalid file tensor shape");
            elements = Math.multiplyExact(elements, dimension);
        }
        if (elements != size || length != size * 4L || expectedSize < length || offset > expectedSize - length)
            throw new IllegalArgumentException("Invalid file tensor range");
        File file = resolve(context, descriptor.getString("path"));
        String revision = descriptor.getString("revision");
        if (file.length() != expectedSize || !revision.equals(file.length() + ":" + file.lastModified()))
            throw new IllegalArgumentException("File tensor changed; reopen the checkpoint");
        // The Kotlin LiteRT API accepts float[], not a file or mapped ByteBuffer.
        // Keep the intermediate read buffer bounded; no tensor data enters the WebView.
        float[] values = new float[size];
        byte[] bytes = new byte[Math.min(65536, size * 4)];
        ByteBuffer view = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        try (RandomAccessFile stream = new RandomAccessFile(file, "r")) {
            stream.seek(offset);
            for (int at = 0; at < size;) {
                int count = Math.min(bytes.length / 4, size - at);
                stream.readFully(bytes, 0, count * 4);
                for (int i = 0; i < count; i++) {
                    float value = view.getFloat(i * 4);
                    if (!Float.isFinite(value)) throw new IllegalArgumentException("RAM file input requires finite f32 values");
                    values[at++] = value;
                }
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
