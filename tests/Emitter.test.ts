import { describe, expect, it, vi } from 'vitest';
import { Emitter } from '../src/systems/Emitter';

describe('Emitter', () => {
    it('delivers emitted values to all subscribers in subscribe order', () => {
        const emitter = new Emitter<number>();
        const calls: { who: string; value: number }[] = [];
        emitter.on((v) => calls.push({ who: 'a', value: v }));
        emitter.on((v) => calls.push({ who: 'b', value: v }));

        emitter.emit(7);

        expect(calls).toEqual([
            { who: 'a', value: 7 },
            { who: 'b', value: 7 },
        ]);
    });

    it('returns an unsubscribe handle from on()', () => {
        const emitter = new Emitter<string>();
        const seen: string[] = [];
        const off = emitter.on((v) => seen.push(v));

        emitter.emit('first');
        off();
        emitter.emit('second');

        expect(seen).toEqual(['first']);
        expect(emitter.size).toBe(0);
    });

    it('off(listener) detaches a specific listener but leaves others alone', () => {
        const emitter = new Emitter<void>();
        const a = vi.fn();
        const b = vi.fn();
        emitter.on(a);
        emitter.on(b);

        emitter.off(a);
        emitter.emit();

        expect(a).not.toHaveBeenCalled();
        expect(b).toHaveBeenCalledTimes(1);
        expect(emitter.size).toBe(1);
    });

    it('clear() drops every subscriber', () => {
        const emitter = new Emitter<number>();
        emitter.on(() => {});
        emitter.on(() => {});
        expect(emitter.size).toBe(2);

        emitter.clear();
        expect(emitter.size).toBe(0);

        // Subsequent emits hit no one and don't throw.
        expect(() => emitter.emit(0)).not.toThrow();
    });

    it('isolates listener exceptions: a throwing listener does not stop the rest', () => {
        const emitter = new Emitter<number>();
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const after = vi.fn();

        emitter.on(() => {
            throw new Error('boom');
        });
        emitter.on(after);

        expect(() => emitter.emit(1)).not.toThrow();
        expect(after).toHaveBeenCalledWith(1);
        expect(errSpy).toHaveBeenCalled();

        errSpy.mockRestore();
    });

    it('snapshots listeners during emit so a listener that unsubscribes itself fires this round', () => {
        const emitter = new Emitter<void>();
        const order: string[] = [];

        const off = emitter.on(() => {
            order.push('first');
            // Unsubscribe self DURING emit. Emitter snapshots the set up
            // front, so this fires this round; it just won't fire next.
            off();
        });
        emitter.on(() => {
            order.push('second');
        });

        emitter.emit();
        expect(order).toEqual(['first', 'second']);

        // Next round: the self-unsubscribed listener is gone.
        order.length = 0;
        emitter.emit();
        expect(order).toEqual(['second']);
    });

    it('snapshots listeners during emit so a listener that subscribes a new one does NOT fire it this round', () => {
        const emitter = new Emitter<void>();
        const order: string[] = [];

        emitter.on(() => {
            order.push('outer');
            emitter.on(() => order.push('inner'));
        });

        emitter.emit();
        // 'inner' was registered mid-emit; the snapshot from the start
        // of emit() didn't include it, so it does NOT fire this round.
        expect(order).toEqual(['outer']);

        emitter.emit();
        // Now both fire.
        expect(order).toEqual(['outer', 'outer', 'inner']);
    });

    it('the same listener registered twice still fires only once (Set semantics)', () => {
        const emitter = new Emitter<void>();
        const fn = vi.fn();
        emitter.on(fn);
        emitter.on(fn);

        emitter.emit();
        expect(fn).toHaveBeenCalledTimes(1);
        expect(emitter.size).toBe(1);
    });
});
