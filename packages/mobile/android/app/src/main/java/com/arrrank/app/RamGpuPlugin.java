package com.arrrank.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Request bodies travel through Capacitor; the worker waits using an opaque id. */
@CapacitorPlugin(name = "RamGpu")
public class RamGpuPlugin extends Plugin {
    @PluginMethod public void submit(PluginCall call) {
        try {
            ((MainActivity) getActivity()).ramGpu().submit(call.getString("id"), call.getString("payload"));
            call.resolve();
        } catch (Exception error) { call.reject("Cannot submit RAM computation", error); }
    }
}
