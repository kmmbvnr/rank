#include <node_api.h>
#include <sqlite3ext.h>
#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>

struct Connection;
struct Registry {
    std::recursive_mutex mutex;
    std::condition_variable_any changed;
    std::vector<Connection*> connections;
    int32_t* signal = nullptr;
    bool stopping = false;
};
struct Connection {
    std::shared_ptr<Registry> registry;
    sqlite3* database;
    const sqlite3_api_routines* api;
};
struct State {
    explicit State(napi_env environment) : env(environment) {}
    napi_env env;
    napi_ref buffer = nullptr;
    std::shared_ptr<Registry> registry = std::make_shared<Registry>();
    std::thread monitor;
};
static thread_local State* current = nullptr;

static void Monitor(std::shared_ptr<Registry> registry) {
    std::unique_lock<std::recursive_mutex> lock(registry->mutex);
    while (!registry->stopping) {
        // No wakeups while there are no open interactive SQLite connections.
        registry->changed.wait(lock, [&] { return registry->stopping || !registry->connections.empty(); });
        if (registry->stopping) break;
        if (std::atomic_ref<int32_t>(*registry->signal).load(std::memory_order_relaxed)) {
            for (auto* connection : registry->connections) connection->api->interruptx(connection->database);
        }
        // Repeat until JS acknowledges cancellation. This also closes the race
        // where Ctrl-C arrived just before SQLite started executing a statement.
        registry->changed.wait_for(lock, std::chrono::milliseconds(2), [&] {
            return registry->stopping || registry->connections.empty();
        });
    }
}

static napi_value Configure(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1];
    void* data = nullptr;
    size_t length = 0;
    bool buffer = false;
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok
        || argc != 1 || napi_is_buffer(env, argv[0], &buffer) != napi_ok || !buffer
        || napi_get_buffer_info(env, argv[0], &data, &length) != napi_ok
        || length != sizeof(int32_t)
        || reinterpret_cast<uintptr_t>(data) % std::atomic_ref<int32_t>::required_alignment != 0) {
        napi_throw_type_error(env, nullptr, "SQLite cancellation expects an aligned four-byte buffer");
        return nullptr;
    }
    if (current->buffer) {
        napi_throw_error(env, nullptr, "SQLite cancellation is already configured in this worker");
        return nullptr;
    }
    if (napi_create_reference(env, argv[0], 1, &current->buffer) != napi_ok) return nullptr;
    current->registry->signal = static_cast<int32_t*>(data);
    current->monitor = std::thread(Monitor, current->registry);
    napi_value result;
    napi_get_undefined(env, &result);
    return result;
}

static napi_value Synchronized(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1], receiver, result;
    napi_valuetype type;
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 1
        || napi_typeof(env, argv[0], &type) != napi_ok || type != napi_function) {
        napi_throw_type_error(env, nullptr, "SQLite synchronization expects a callback");
        return nullptr;
    }
    napi_get_undefined(env, &receiver);
    // Hold this across the whole close, not just the destructor notification:
    // sqlite3_interrupt must never race sqlite3_close. The guard destructor
    // re-enters the same mutex on this thread.
    std::lock_guard<std::recursive_mutex> lock(current->registry->mutex);
    if (napi_call_function(env, receiver, argv[0], 0, nullptr, &result) != napi_ok) return nullptr;
    return result;
}

static void Destroy(void* data) {
    auto* connection = static_cast<Connection*>(data);
    auto registry = connection->registry;
    {
        std::lock_guard<std::recursive_mutex> lock(registry->mutex);
        auto& connections = registry->connections;
        connections.erase(std::remove(connections.begin(), connections.end(), connection), connections.end());
        registry->changed.notify_all();
    }
    delete connection;
}
static void Guard(sqlite3_context*, int, sqlite3_value**) { /* SQL NULL, no side effects. */ }

#ifdef _WIN32
#define RANK_EXPORT __declspec(dllexport)
#else
#define RANK_EXPORT __attribute__((visibility("default")))
#endif

// Node retains the shared buffer; SQLite's supported extension API supplies the
// connection and its own interrupt function. No second SQLite library is linked.
extern "C" RANK_EXPORT int sqlite3_rankinterrupt_init(
    sqlite3* database, char**, const sqlite3_api_routines* api
) {
    if (!current || !current->buffer || !api->interruptx) return SQLITE_MISUSE;
    auto* connection = new Connection{current->registry, database, api};
    // SQLite owns this guard and calls Destroy on close (also on registration
    // failure). Registering a harmless function gives the extension a lifetime.
    int status = api->create_function_v2(database, "__rank_interrupt_lifetime", 0, SQLITE_UTF8,
        connection, Guard, nullptr, nullptr, Destroy);
    if (status != SQLITE_OK) return status;
    {
        std::lock_guard<std::recursive_mutex> lock(current->registry->mutex);
        current->registry->connections.push_back(connection);
        current->registry->changed.notify_all();
    }
    return SQLITE_OK;
}

static void Cleanup(void* data) {
    auto* state = static_cast<State*>(data);
    {
        std::lock_guard<std::recursive_mutex> lock(state->registry->mutex);
        state->registry->stopping = true;
        state->registry->changed.notify_all();
    }
    if (state->monitor.joinable()) state->monitor.join();
    // Cleanup hooks run before environment finalizers. Stop accessing SQLite
    // before the driver finalizes any remaining database objects.
    if (state->buffer) napi_delete_reference(state->env, state->buffer);
    if (current == state) current = nullptr;
    delete state;
}

NAPI_MODULE_INIT() {
    auto* state = new State(env);
    current = state;
    if (napi_add_env_cleanup_hook(env, Cleanup, state) != napi_ok) {
        delete state;
        current = nullptr;
        return nullptr;
    }
    napi_value configure, close;
    if (napi_create_function(env, "configure", NAPI_AUTO_LENGTH, Configure, nullptr, &configure) != napi_ok
        || napi_create_function(env, "synchronized", NAPI_AUTO_LENGTH, Synchronized, nullptr, &close) != napi_ok
        || napi_set_named_property(env, exports, "configure", configure) != napi_ok
        || napi_set_named_property(env, exports, "synchronized", close) != napi_ok) return nullptr;
    return exports;
}
