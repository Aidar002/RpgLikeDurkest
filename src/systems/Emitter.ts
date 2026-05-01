// Tiny typed pub/sub. Replaces the previous "single-callback property"
// pattern (`manager.onXxx = () => {...}`) so multiple listeners can subscribe
// without overwriting each other and so subscribers can `off()` cleanly.
//
// Intentionally minimal: no priorities, no async, no error isolation. If a
// listener throws, the next ones still fire (we swallow + console.error so
// one bad subscriber doesn't break unrelated UI).

export type Listener<T> = (value: T) => void;

export class Emitter<T = void> {
    private listeners: Set<Listener<T>> = new Set();

    /** Subscribe. Returns an unsubscribe handle for convenience. */
    on(listener: Listener<T>): () => void {
        this.listeners.add(listener);
        return () => this.off(listener);
    }

    /** Unsubscribe a listener that was previously passed to `on`. */
    off(listener: Listener<T>): void {
        this.listeners.delete(listener);
    }

    /** Fire all listeners with `value`. */
    emit(value: T): void {
        // Snapshot so subscribers that mutate the listener set during emit
        // don't observe partial updates.
        for (const listener of [...this.listeners]) {
            try {
                listener(value);
            } catch (err) {
                console.error('[Emitter] listener threw', err);
            }
        }
    }

    /** Drop every subscriber. Useful before scene teardown. */
    clear(): void {
        this.listeners.clear();
    }

    /** Number of active subscribers (mostly for tests). */
    get size(): number {
        return this.listeners.size;
    }
}
