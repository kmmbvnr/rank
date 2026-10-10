package com.arrrank.app;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.util.AtomicFile;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;

/** Private .ra files with a transactional catalog and recovery snapshots for interrupted writes. */
@CapacitorPlugin(name = "Notebooks")
public class NotebooksPlugin extends Plugin {
    private Catalog catalog;
    private Catalog beginnerCatalog;

    private boolean debugBuild() {
        return (getContext().getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    @PluginMethod public void environment(PluginCall call) {
        JSObject result = new JSObject(); result.put("debug", debugBuild()); call.resolve(result);
    }

    private boolean debugPreview(PluginCall call) {
        boolean preview = Boolean.TRUE.equals(call.getBoolean("debugPreview", false));
        if (preview && !debugBuild()) throw new IllegalStateException("Beginner preview requires a debug build");
        return preview;
    }

    private Catalog catalog(PluginCall call) {
        if (!debugPreview(call)) return catalog;
        if (beginnerCatalog == null) beginnerCatalog = new Catalog(getContext(), "beginner-notebooks");
        return beginnerCatalog;
    }

    @Override public void load() { catalog = new Catalog(getContext(), "notebooks"); }
    @Override protected void handleOnDestroy() { if (catalog != null) catalog.close(); if (beginnerCatalog != null) beginnerCatalog.close(); }

    private static class Catalog extends SQLiteOpenHelper {
        private final Context context;
        private final String directory;
        Catalog(Context context, String directory) {
            super(context, directory + ".db", null, 1); this.context = context; this.directory = directory;
        }
        @Override public void onCreate(SQLiteDatabase db) {
            db.execSQL("CREATE TABLE notebooks (id TEXT PRIMARY KEY, title TEXT NOT NULL, manual INTEGER NOT NULL, "
                + "created INTEGER NOT NULL, updated INTEGER NOT NULL, snapshot TEXT NOT NULL)");
            db.execSQL("CREATE INDEX notebooks_recent ON notebooks(updated DESC, id DESC)");
            // A missing/recreated catalog can recover the source from the plain .ra files.
            // Cell boundaries and manual titles require the catalog; recovered source becomes a draft.
            File[] files = new File(context.getFilesDir(), directory).listFiles((directory, name) -> name.endsWith(".ra"));
            if (files == null) return;
            for (File file : files) {
                String key = file.getName().substring(0, file.getName().length() - 3);
                if (!("legacy".equals(key) || key.matches("[a-fA-F0-9-]{36}"))) continue;
                try (InputStream stream = new FileInputStream(file)) {
                    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                    byte[] buffer = new byte[8192]; int count;
                    while ((count = stream.read(buffer)) != -1) bytes.write(buffer, 0, count);
                    String text = new String(bytes.toByteArray(), StandardCharsets.UTF_8);
                    String first = "";
                    for (String line : text.split("\\r?\\n")) {
                        String trimmed = line.trim();
                        if (first.isEmpty() && !trimmed.isEmpty()) first = trimmed;
                        if (trimmed.matches("rem\\s+.+")) { first = trimmed.substring(3).trim(); break; }
                    }
                    String title = first.replaceAll("\\s+", " ");
                    if (title.isEmpty()) title = "New notebook";
                    if (title.codePointCount(0, title.length()) > 40) title = title.substring(0, title.offsetByCodePoints(0, 39)) + "…";
                    JSONObject snapshot = new JSONObject(); snapshot.put("cells", new JSONArray()); snapshot.put("draft", text);
                    ContentValues values = new ContentValues(); values.put("id", key); values.put("title", title);
                    values.put("manual", 0); values.put("created", file.lastModified()); values.put("updated", file.lastModified());
                    values.put("snapshot", snapshot.toString()); db.insertOrThrow("notebooks", null, values);
                } catch (Exception error) { throw new IllegalStateException("Cannot recover notebook catalog", error); }
            }
        }
        @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
            throw new IllegalStateException("Unsupported notebook catalog version");
        }
    }

    private String id(String id) {
        if (id == null || !("legacy".equals(id) || id.matches("[a-fA-F0-9-]{36}")))
            throw new IllegalArgumentException("Invalid notebook ID");
        return id;
    }

    private JSObject metadata(Cursor cursor) {
        JSObject meta = new JSObject();
        meta.put("id", cursor.getString(0)); meta.put("title", cursor.getString(1));
        meta.put("manual", cursor.getInt(2) != 0); meta.put("created", cursor.getLong(3)); meta.put("updated", cursor.getLong(4));
        return meta;
    }

    private synchronized JSObject read(String key, PluginCall call) throws Exception {
        try (Cursor cursor = catalog(call).getReadableDatabase().query("notebooks",
            new String[]{"id", "title", "manual", "created", "updated", "snapshot"},
            "id = ?", new String[]{id(key)}, null, null, null)) {
            if (!cursor.moveToFirst()) return null;
            JSObject book = metadata(cursor);
            book.put("snapshot", new JSONObject(cursor.getString(5)));
            return book;
        }
    }

    static String source(JSONObject snapshot) throws Exception {
        JSONArray cells = snapshot.getJSONArray("cells");
        StringBuilder text = new StringBuilder();
        for (int i = 0; i < cells.length(); i++) {
            Object cell = cells.get(i);
            if (!(cell instanceof String)) throw new IllegalArgumentException("Invalid notebook cell");
            text.append((String) cell).append('\n');
        }
        Object draft = snapshot.get("draft");
        if (!(draft instanceof String)) throw new IllegalArgumentException("Invalid notebook draft");
        return text.append((String) draft).toString();
    }

    private File file(String key, PluginCall call) throws Exception {
        File directory = new File(getContext().getFilesDir(), debugPreview(call) ? "beginner-notebooks" : "notebooks");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("Cannot create notebook folder");
        return new File(directory, id(key) + ".ra");
    }

    private void writeSource(String key, String source, PluginCall call) throws Exception {
        AtomicFile file = new AtomicFile(file(key, call));
        FileOutputStream stream = null;
        try {
            stream = file.startWrite();
            stream.write(source.getBytes(StandardCharsets.UTF_8));
            file.finishWrite(stream);
        } catch (Exception error) {
            if (stream != null) file.failWrite(stream);
            throw error;
        }
    }

    @PluginMethod public synchronized void get(PluginCall call) {
        try {
            JSObject book = read(call.getString("id"), call);
            if (book != null) writeSource(book.getString("id"), source(book.getJSONObject("snapshot")), call);
            JSObject result = new JSObject();
            if (book != null) result.put("book", book);
            call.resolve(result);
        } catch (Exception error) { call.reject("Cannot open notebook", error); }
    }

    @PluginMethod public synchronized void save(PluginCall call) {
        try {
            JSObject book = call.getObject("book");
            if (book == null) throw new IllegalArgumentException("Missing notebook");
            String key = id(book.getString("id"));
            JSONObject snapshot = book.getJSONObject("snapshot");
            String text = source(snapshot);
            ContentValues values = new ContentValues();
            values.put("id", key); values.put("title", book.getString("title"));
            values.put("manual", book.getBoolean("manual") ? 1 : 0);
            values.put("created", book.getLong("created")); values.put("updated", book.getLong("updated"));
            values.put("snapshot", snapshot.toString());
            // Commit the recovery snapshot first. If .ra writing fails, the draft is still durable,
            // and get/save repairs the file. A failed save is reported and blocks document switching.
            if (catalog(call).getWritableDatabase().insertWithOnConflict("notebooks", null, values, SQLiteDatabase.CONFLICT_REPLACE) < 0)
                throw new IllegalStateException("Cannot commit notebook snapshot");
            writeSource(key, text, call);
            call.resolve();
        } catch (Exception error) { call.reject("Cannot save notebook", error); }
    }

    @PluginMethod public synchronized void list(PluginCall call) {
        try {
            int limit = Math.max(1, Math.min(100, call.getInt("limit", 25)));
            JSObject before = call.getObject("before");
            String where = before == null ? null : "updated < ? OR (updated = ? AND id < ?)";
            String[] args = before == null ? null : new String[]{String.valueOf(before.getLong("updated")),
                String.valueOf(before.getLong("updated")), id(before.getString("id"))};
            JSArray items = new JSArray();
            JSObject last = null;
            JSObject next = null;
            try (Cursor cursor = catalog(call).getReadableDatabase().query("notebooks",
                new String[]{"id", "title", "manual", "created", "updated"}, where, args, null, null,
                "updated DESC, id DESC", String.valueOf(limit + 1))) {
                while (cursor.moveToNext()) {
                    if (items.length() == limit) {
                        next = new JSObject(); next.put("id", last.getString("id")); next.put("updated", last.getLong("updated"));
                        break;
                    }
                    last = metadata(cursor); items.put(last);
                }
            }
            JSObject result = new JSObject(); result.put("items", items);
            if (next != null) result.put("next", next);
            call.resolve(result);
        } catch (Exception error) { call.reject("Cannot load notebook history", error); }
    }

    @PluginMethod public synchronized void remove(PluginCall call) {
        try {
            String key = id(call.getString("id"));
            // Remove the file first. If deletion fails, retain the catalog and recovery snapshot.
            File source = file(key, call);
            if (source.exists() && !source.delete()) throw new IllegalStateException("Cannot delete notebook file");
            catalog(call).getWritableDatabase().delete("notebooks", "id = ?", new String[]{key});
            call.resolve();
        } catch (Exception error) { call.reject("Cannot delete notebook", error); }
    }

    @PluginMethod public void exportFile(PluginCall call) {
        try {
            JSObject book = read(call.getString("id"), call);
            if (book == null) throw new IllegalArgumentException("Notebook is no longer available");
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE); intent.setType("text/plain");
            intent.putExtra(Intent.EXTRA_TITLE, book.getString("title").replaceAll("[\\\\/:*?\"<>|]", "_") + ".ra");
            startActivityForResult(call, intent, "exportResult");
        } catch (Exception error) { call.reject("Cannot export notebook", error); }
    }

    @ActivityCallback private void exportResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) { call.resolve(); return; }
        try {
            JSObject book = read(call.getString("id"), call);
            if (book == null) throw new IllegalArgumentException("Notebook is no longer available");
            try (OutputStream stream = getContext().getContentResolver().openOutputStream(result.getData().getData(), "wt")) {
                if (stream == null) throw new IllegalStateException("Cannot open export destination");
                stream.write(source(book.getJSONObject("snapshot")).getBytes(StandardCharsets.UTF_8));
            }
            call.resolve();
        } catch (Exception error) { call.reject("Cannot export notebook", error); }
    }

    @PluginMethod public void importFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE); intent.setType("*/*");
        startActivityForResult(call, intent, "importResult");
    }

    @ActivityCallback private void importResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) { call.resolve(new JSObject()); return; }
        try (InputStream stream = getContext().getContentResolver().openInputStream(result.getData().getData())) {
            if (stream == null) throw new IllegalStateException("Cannot read imported file");
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192]; int count;
            while ((count = stream.read(buffer)) != -1) bytes.write(buffer, 0, count);
            JSObject response = new JSObject(); response.put("source", new String(bytes.toByteArray(), StandardCharsets.UTF_8));
            call.resolve(response);
        } catch (Exception error) { call.reject("Cannot import notebook", error); }
    }
}
