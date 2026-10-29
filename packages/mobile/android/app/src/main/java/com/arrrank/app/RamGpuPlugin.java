package com.arrrank.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Request bodies travel through Capacitor; the worker waits using an opaque id. */
@CapacitorPlugin(name = "RamGpu")
public class RamGpuPlugin extends Plugin {
    @PluginMethod public void openSession(PluginCall call) {
        ((MainActivity) getActivity()).ramGpu().openSession().whenComplete((result, error) -> {
            if (error != null) call.reject("Cannot open GPU session");
            else {
                try { call.resolve(JSObject.fromJSONObject(result)); }
                catch (org.json.JSONException invalid) { call.reject("Invalid GPU session response", invalid); }
            }
        });
    }
    @PluginMethod public void closeSession(PluginCall call) {
        ((MainActivity) getActivity()).ramGpu().closeSession(call.getString("sessionId")).whenComplete((result, error) -> {
            if (error != null) call.reject("Cannot close GPU session");
            else {
                try { call.resolve(JSObject.fromJSONObject(result)); }
                catch (org.json.JSONException invalid) { call.reject("Invalid GPU session response", invalid); }
            }
        });
    }
    @PluginMethod public void submit(PluginCall call) {
        try {
            ((MainActivity) getActivity()).ramGpu().submit(call.getString("id"), call.getString("payload"));
            call.resolve();
        } catch (Exception error) { call.reject("Cannot submit RAM computation", error); }
    }
}
