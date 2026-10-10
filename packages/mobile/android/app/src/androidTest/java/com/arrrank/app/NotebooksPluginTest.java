package com.arrrank.app;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.pm.ApplicationInfo;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.UUID;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.junit.Test;
import org.junit.After;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class NotebooksPluginTest {
    private final List<NotebooksPlugin> plugins = new ArrayList<>();
    private final List<TestContext> contexts = new ArrayList<>();
    private TestContext context() {
        TestContext context = new TestContext(InstrumentationRegistry.getInstrumentation().getTargetContext());
        contexts.add(context); return context;
    }
    private void closePlugins() { for (NotebooksPlugin plugin : plugins) plugin.handleOnDestroy(); plugins.clear(); }
    private void deleteFixture(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteFixture(child);
        file.delete();
    }
    @After public void cleanup() {
        closePlugins();
        for (TestContext context : contexts) {
            context.getBaseContext().deleteDatabase(context.prefix + "notebooks.db");
            context.getBaseContext().deleteDatabase(context.prefix + "beginner-notebooks.db");
            deleteFixture(new File(context.getBaseContext().getCacheDir(), context.prefix));
        }
    }
    /** Each test has its own catalog and files; never touch the user's notebooks. */
    private static class TestContext extends ContextWrapper {
        final String prefix = "notebooks-test-" + UUID.randomUUID() + "-";
        File files;
        boolean debug = true;
        TestContext(Context base) { super(base); files = new File(base.getCacheDir(), prefix); files.mkdirs(); }
        @Override public ApplicationInfo getApplicationInfo() {
            ApplicationInfo info = new ApplicationInfo(super.getApplicationInfo());
            if (debug) info.flags |= ApplicationInfo.FLAG_DEBUGGABLE;
            else info.flags &= ~ApplicationInfo.FLAG_DEBUGGABLE;
            return info;
        }
        @Override public File getFilesDir() { return files; }
        @Override public File getDatabasePath(String name) { return getBaseContext().getDatabasePath(prefix + name); }
    }
    private static class Call extends PluginCall {
        JSObject result;
        String error;
        Call(JSObject data) { super(null, "Notebooks", "test", "test", data); }
        @Override public void resolve(JSObject data) { result = data; }
        @Override public void resolve() { result = new JSObject(); }
        @Override public void reject(String message, Exception exception) { error = message; }
    }
    private NotebooksPlugin plugin(TestContext context) {
        NotebooksPlugin plugin = new NotebooksPlugin() { @Override public Context getContext() { return context; } };
        plugin.load(); plugins.add(plugin); return plugin;
    }
    private JSObject book(String id, long updated, String draft) throws Exception {
        JSObject snapshot = new JSObject(); snapshot.put("cells", new JSONArray().put("rem Saved notebook").put("Value = 7"));
        snapshot.put("draft", draft);
        JSObject book = new JSObject(); book.put("id", id); book.put("title", "Saved notebook");
        book.put("manual", false); book.put("created", updated); book.put("updated", updated); book.put("snapshot", snapshot);
        return book;
    }
    private Call call(String name, Object value) { JSObject data = new JSObject(); data.put(name, value); return new Call(data); }

    @Test public void savesRaAndDraftAcrossPluginRestartAndRepairsMissingFile() throws Exception {
        TestContext context = context();
        NotebooksPlugin plugin = plugin(context);
        String id = UUID.randomUUID().toString();
        Call save = call("book", book(id, 100, "for i in "));
        plugin.save(save); assertNull(save.error);
        File file = new File(context.files, "notebooks/" + id + ".ra");
        assertEquals("rem Saved notebook\nValue = 7\nfor i in ", new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
        assertTrue(file.delete());
        Call get = call("id", id); plugin(context).get(get);
        assertNull(get.error); assertTrue(file.isFile());
        assertEquals("for i in ", get.result.getJSONObject("book").getJSONObject("snapshot").getString("draft"));
        // Simulate a full/unwritable source directory after a successful catalog commit.
        File realFiles = context.files;
        context.files = new File(realFiles, "blocked"); assertTrue(context.files.createNewFile());
        Call failed = call("book", book(id, 101, "Latest unfinished draft")); plugin.save(failed);
        assertNotNull(failed.error);
        context.files = realFiles;
        Call recovered = call("id", id); plugin(context).get(recovered); assertNull(recovered.error);
        assertEquals("Latest unfinished draft", recovered.result.getJSONObject("book").getJSONObject("snapshot").getString("draft"));
        assertTrue(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8).endsWith("Latest unfinished draft"));
        // Recreate a lost catalog from the .ra files without losing source text.
        closePlugins();
        context.getBaseContext().deleteDatabase(context.prefix + "notebooks.db");
        Call rebuilt = call("id", id); plugin(context).get(rebuilt); assertNull(rebuilt.error);
        assertEquals("rem Saved notebook\nValue = 7\nLatest unfinished draft",
            rebuilt.result.getJSONObject("book").getJSONObject("snapshot").getString("draft"));
    }

    @Test public void pagesTiedDatesAndDeletesWithoutReadingBodies() throws Exception {
        TestContext context = context();
        NotebooksPlugin plugin = plugin(context);
        for (int i = 0; i < 31; i++) {
            Call save = call("book", book(UUID.randomUUID().toString(), 100, "Draft " + i));
            plugin.save(save); assertNull(save.error);
        }
        Call first = call("limit", 25); plugin.list(first); assertNull(first.error);
        assertEquals(25, first.result.getJSONArray("items").length());
        JSObject options = new JSObject(); options.put("limit", 25); options.put("before", first.result.getJSONObject("next"));
        Call second = new Call(options); plugin.list(second); assertNull(second.error);
        assertEquals(6, second.result.getJSONArray("items").length());
        assertFalse(second.result.has("next"));
        String id = first.result.getJSONArray("items").getJSONObject(0).getString("id");
        Call remove = call("id", id); plugin.remove(remove); assertNull(remove.error);
        Call get = call("id", id); plugin.get(get); assertFalse(get.result.has("book"));
        assertFalse(new File(context.files, "notebooks/" + id + ".ra").exists());
        Call invalid = call("id", "../../notebooks.db"); plugin.get(invalid); assertNotNull(invalid.error);
    }
    private Call preview(String name, Object value) {
        JSObject data = new JSObject(); data.put(name, value); data.put("debugPreview", true); return new Call(data);
    }

    @Test public void debugSandboxKeepsSameIdsAndFilesSeparateAcrossRestart() throws Exception {
        TestContext context = context();
        NotebooksPlugin plugin = plugin(context);
        String id = UUID.randomUUID().toString();
        Call normal = call("book", book(id, 100, "Real draft")); plugin.save(normal); assertNull(normal.error);
        Call sandbox = preview("book", book(id, 101, "Sandbox draft")); plugin.save(sandbox); assertNull(sandbox.error);
        assertTrue(new File(context.files, "notebooks/" + id + ".ra").isFile());
        assertTrue(new File(context.files, "beginner-notebooks/" + id + ".ra").isFile());
        closePlugins(); plugin = plugin(context);
        Call get = preview("id", id); plugin.get(get); assertNull(get.error);
        assertEquals("Sandbox draft", get.result.getJSONObject("book").getJSONObject("snapshot").getString("draft"));
        Call remove = preview("id", id); plugin.remove(remove); assertNull(remove.error);
        Call real = call("id", id); plugin.get(real); assertNull(real.error);
        assertEquals("Real draft", real.result.getJSONObject("book").getJSONObject("snapshot").getString("draft"));
        assertTrue(new File(context.files, "notebooks/" + id + ".ra").isFile());
    }

    @Test public void releaseRejectsSandboxAccessAndKeepsNormalHistory() throws Exception {
        TestContext context = context(); context.debug = false;
        NotebooksPlugin plugin = plugin(context);
        Call environment = new Call(new JSObject()); plugin.environment(environment);
        assertFalse(environment.result.getBoolean("debug"));
        String id = UUID.randomUUID().toString();
        Call real = call("book", book(id, 100, "User draft")); plugin.save(real); assertNull(real.error);
        Call save = preview("book", book(id, 101, "Wrong draft")); plugin.save(save); assertNotNull(save.error);
        Call get = preview("id", id); plugin.get(get); assertNotNull(get.error);
        Call list = preview("limit", 25); plugin.list(list); assertNotNull(list.error);
        Call remove = preview("id", id); plugin.remove(remove); assertNotNull(remove.error);
        Call normal = call("id", id); plugin.get(normal); assertNull(normal.error);
        assertEquals("User draft", normal.result.getJSONObject("book").getJSONObject("snapshot").getString("draft"));
        assertFalse(new File(context.files, "beginner-notebooks").exists());
    }

}
