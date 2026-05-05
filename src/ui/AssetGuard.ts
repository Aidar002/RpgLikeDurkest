/**
 * Tiny helpers around `scene.textures.exists(key)` so callers don't
 * scatter the same `if (textures.exists(...)) { … } else { fallback }`
 * branch across HUD/map/room rendering code.
 *
 * Two flavours:
 *
 * - `withTexture(scene, key, withImage, withFallback)` runs one of two
 *   builders and returns its value. Used when both branches *return* a
 *   game object (or null) and the caller wants to swap.
 * - `hasTexture(scene, key)` is a thin alias for readability when the
 *   caller still wants to make a per-branch decision inline (e.g.
 *   `const stroke = hasTexture(...) ? colorA : colorB;`).
 *
 * The check is intentionally just `textures.exists` — Phaser has no
 * cheaper "this key was successfully loaded" primitive. BootScene
 * registers textures once, so this is a constant-time map lookup.
 */
import * as Phaser from 'phaser';

/** Returns true if the given texture key is registered in `scene.textures`. */
export function hasTexture(scene: Phaser.Scene, key: string): boolean {
    return scene.textures.exists(key);
}

/**
 * Builder dispatch by texture availability. `withImage` is invoked when
 * the texture is loaded; `withFallback` runs when it isn't (e.g. during
 * tests where assets are not staged, or transiently while BootScene is
 * still loading).
 *
 * Both branches must return the same type so the call site can use the
 * result without unwrapping a union.
 */
export function withTexture<T, U = T>(
    scene: Phaser.Scene,
    key: string,
    withImage: () => T,
    withFallback: () => U,
): T | U {
    return scene.textures.exists(key) ? withImage() : withFallback();
}
