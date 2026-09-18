import type { InterruptSignal } from '@arrrank/interpreter';

/** Android WebView has no SharedArrayBuffer. Poll the app's local signal endpoint
 * from the worker, leaving the interpreter's stack and values in place. */
export function nativeDebugSignal(url: string): InterruptSignal {
    let values = [0, 0, 0];
    let checked = -Infinity;
    function request(query = ''): void {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url + query, false);
        xhr.send();
        if (xhr.status !== 200) throw new Error('Debugger connection closed');
        values = JSON.parse(xhr.responseText);
        checked = performance.now();
    }
    function load(index: number): number {
        if (performance.now() - checked >= 25) request();
        return values[index];
    }
    return {
        length: 3,
        load,
        store(index, value) { request(`&index=${index}&value=${value}`); },
        exchange(index, value) {
            const previous = load(index);
            if (previous !== value) request(`&index=${index}&value=${value}`);
            return previous;
        },
        wait() { request('&wait=1'); },
    };
}
