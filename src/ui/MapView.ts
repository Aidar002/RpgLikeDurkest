/**
 * Map renderer for the dungeon node graph.
 *
 * Owns:
 * - the `mapContainer` children that represent each node (background
 *   rect, icon glyph, optional spritesheet image, optional carved
 *   frame overlay),
 * - per-node "fire" particle effects and the legacy "glow" overlay
 *   map (kept for cleanup compatibility — actual reachable-node
 *   pulse is now rendered as a yoyo on the carved frame inside
 *   {@link MapView.startNodePulse}),
 * - the edge `Graphics` strip that draws connections between nodes.
 *
 * Doesn't own:
 * - run-progress / level-up / unlock plumbing — those stay in
 *   `GameScene.afterMove` / `updateRunProgress` and call back into
 *   {@link MapView.refresh} after mutating dungeon state.
 *
 * The class also exposes pure-geometry helpers (`nodeX`, `nodeY`,
 * `getMapOffset`, `centerOnNode`) so callers don't have to know about
 * the column/row spacing constants.
 */
import * as Phaser from 'phaser';

import type { DungeonManager } from '../systems/DungeonManager';
import type { Localization } from '../systems/Localization';
import type { MapNode } from '../data/MapTypes';
import type { MetaProgressionManager, UiUnlockState } from '../systems/MetaProgressionManager';
import { hasTexture } from './AssetGuard';
import { PixelSprite } from './PixelSprite';
import {
    fitRoomSprite,
    hasFireEffect,
    roomFrameIndex,
    roomIcon,
    roomIconFrame,
    roomSpriteKey,
    roomTypeName,
} from './RoomVisuals';
import { VFX } from './VFX';

/** Square side length for the node background rectangle. */
const NODE_SZ = 80;
/** X position the camera/container centres the current node onto. */
const VIEW_X = 512;
/** Y position the camera/container centres the current node onto. */
const VIEW_Y = 380;

/**
 * Set of Phaser objects that together render one map node. Created in
 * {@link MapView.build} per node, kept in `visuals` for later refresh
 * passes. `sprite` and `frame` are optional because the optional
 * spritesheet textures may not be present (tests, loading phase).
 */
interface NodeVisual {
    rect: Phaser.GameObjects.Rectangle;
    icon: Phaser.GameObjects.Text;
    sprite?: Phaser.GameObjects.Image;
    frame?: Phaser.GameObjects.Image;
}

/**
 * Things {@link MapView} cannot decide on its own and must defer to
 * the host scene for. `canMove` returns whether a click on the given
 * node should advance the player there (depends on global animation
 * state, current room visibility, dead state — none of which live in
 * `MapView`).
 */
interface MapViewDeps {
    scene: Phaser.Scene;
    container: Phaser.GameObjects.Container;
    dungeon: DungeonManager;
    meta: MetaProgressionManager;
    loc: Localization;
    tooltipText: Phaser.GameObjects.Text;
    /** Whether a click on `node` should currently produce movement. */
    canMove(node: MapNode): boolean;
    /** Called when a clickable node was successfully clicked. */
    onNodeClick(node: MapNode): void;
}

export class MapView {
    private scene: Phaser.Scene;
    public readonly container: Phaser.GameObjects.Container;
    private dungeon: DungeonManager;
    private meta: MetaProgressionManager;
    private loc: Localization;
    private tooltipText: Phaser.GameObjects.Text;
    private canMoveDelegate: (node: MapNode) => boolean;
    private onNodeClickDelegate: (node: MapNode) => void;

    public readonly visuals: Map<string, NodeVisual> = new Map();
    public readonly glowMap: Map<string, Phaser.GameObjects.Graphics> = new Map();
    public readonly fireMap: Map<string, { destroy: () => void }> = new Map();
    private edgeGfx!: Phaser.GameObjects.Graphics;

    /**
     * Tracks which node IDs were "fog-of-war visible" on the previous
     * {@link refresh} call. Nodes appearing in the new set but not the
     * old one fade in; nodes disappearing fade out. Avoids the abrupt
     * pop-in / pop-out when the player advances and the visible
     * window shifts forward.
     */
    private lastVisibleIds = new Set<string>();

    /** Duration (ms) of the per-node reveal/hide fade. */
    private readonly REVEAL_DURATION = 380;

    constructor(deps: MapViewDeps) {
        this.scene = deps.scene;
        this.container = deps.container;
        this.dungeon = deps.dungeon;
        this.meta = deps.meta;
        this.loc = deps.loc;
        this.tooltipText = deps.tooltipText;
        this.canMoveDelegate = deps.canMove;
        this.onNodeClickDelegate = deps.onNodeClick;

        this.edgeGfx = this.scene.add.graphics();
        this.container.add(this.edgeGfx);
    }

    /** Canvas X for the centre of `node`'s background rect. */
    nodeX(node: MapNode): number {
        return node.x;
    }

    /** Canvas Y for the centre of `node`'s background rect. */
    nodeY(node: MapNode): number {
        return node.y;
    }

    /**
     * Container offset that would centre `node` under the viewport
     * focal point. Used by {@link animateShift} to glide the map
     * sideways after the player picks a node.
     */
    getMapOffset(node: MapNode): { x: number; y: number } {
        return {
            x: VIEW_X - this.nodeX(node),
            y: VIEW_Y - this.nodeY(node),
        };
    }

    /** Snap (no animation) the container so `node` is centred. */
    centerOnNode(node: MapNode): void {
        const { x, y } = this.getMapOffset(node);
        this.container.setPosition(x, y);
    }

    /**
     * Whether a click on `node` should currently advance the player
     * to it. Combines the host-supplied {@link canMoveDelegate}
     * (which captures animating / dead / room-visible state) with the
     * intrinsic "is the node a valid forward move" check.
     */
    canUseNode(node: MapNode): boolean {
        return this.canMoveDelegate(node) && !node.cleared && this.dungeon.canMoveTo(node.id);
    }

    /**
     * Build per-node visuals for any node that doesn't already have
     * an entry in `visuals`. Idempotent: re-running after
     * `dungeon.addNodes(...)` only creates the freshly-added nodes
     * and leaves existing ones untouched.
     */
    build(fadeIn: boolean): void {
        const unlocks = this.meta.getUiUnlockState();
        const currentId = this.dungeon.currentNode.id;
        const forwardIds = new Set(this.dungeon.getForwardNodes().map((node) => node.id));

        this.dungeon.getAllNodes().forEach((node) => {
            if (this.visuals.has(node.id)) {
                return;
            }

            const x = this.nodeX(node);
            const y = this.nodeY(node);
            const revealed = node.visited || forwardIds.has(node.id) || node.id === currentId;
            const knowsType =
                node.cleared || node.visited || node.id === currentId || unlocks.showRoomIcons;
            // Every room sits on a black backdrop; the carved frame
            // overlay (room_frames.png) is what carries the state colour
            // (gold safe / red danger / grey unknown). The procedural
            // fallback below adds a thin stroke when the frame texture
            // is missing.
            const alpha = node.cleared ? 0.35 : 1;
            const hasFrame = hasTexture(this.scene, 'hud_room_frames');
            const stroke = node.cleared
                ? 0x333333
                : node.id === currentId
                  ? 0xffffff
                  : forwardIds.has(node.id)
                    ? 0x6d6d6d
                    : 0x343434;

            const rect = this.scene.add.rectangle(x, y, NODE_SZ, NODE_SZ, 0x000000).setAlpha(alpha);
            if (!hasFrame) {
                rect.setStrokeStyle(2, stroke);
            }

            const icon = this.scene.add
                .text(x, y, revealed && knowsType ? roomIcon(node.type) : '?', {
                    fontFamily: 'Courier New',
                    fontSize: '28px',
                    color: node.cleared ? '#888888' : '#ffffff',
                })
                .setOrigin(0.5)
                .setAlpha(alpha);

            // Sprite priority: hand-authored room_icons spritesheet →
            // procedural PixelSprite (per-type 24×24 sprite) → text glyph.
            let sprite: Phaser.GameObjects.Image | undefined;
            if (revealed && knowsType && hasTexture(this.scene, 'hud_room_icons')) {
                icon.setVisible(false);
                sprite = this.scene.add
                    .image(x, y, 'hud_room_icons', roomIconFrame(node.type))
                    .setOrigin(0.5)
                    .setAlpha(alpha);
                fitRoomSprite(sprite);
                if (node.cleared) sprite.setTint(0x555555);
            } else {
                const spriteKey = PixelSprite.roomKey(roomSpriteKey(node.type));
                if (revealed && knowsType && hasTexture(this.scene, spriteKey)) {
                    icon.setVisible(false);
                    sprite = this.scene.add.image(x, y, spriteKey).setOrigin(0.5).setAlpha(alpha);
                    fitRoomSprite(sprite);
                    if (node.cleared) sprite.setTint(0x555555);
                }
            }

            // Decorative frame overlay (bronze for safe, iron-red for danger,
            // grey for unknown). Only renders when the optional spritesheet is
            // present — falls back silently to the base rect+icon otherwise.
            let frame: Phaser.GameObjects.Image | undefined;
            if (hasFrame) {
                const frameIdx = revealed && knowsType ? roomFrameIndex(node.type) : 2;
                frame = this.scene.add
                    .image(x, y, 'hud_room_frames', frameIdx)
                    .setOrigin(0.5)
                    .setAlpha(alpha);
                frame.setDisplaySize(NODE_SZ + 8, NODE_SZ + 8);
                if (node.cleared) frame.setTint(0x555555);
            }

            if (fadeIn && !node.cleared) {
                rect.setAlpha(0);
                icon.setAlpha(0);
                const targets: Phaser.GameObjects.GameObject[] = [rect, icon];
                if (sprite) {
                    sprite.setAlpha(0);
                    targets.push(sprite);
                }
                if (frame) {
                    frame.setAlpha(0);
                    targets.push(frame);
                }
                this.scene.tweens.add({
                    targets,
                    alpha: 1,
                    duration: 420,
                    ease: 'Quad.out',
                });
            }

            this.makeClickable(rect, node);

            const children: Phaser.GameObjects.GameObject[] = [rect, icon];
            if (sprite) children.push(sprite);
            if (frame) children.push(frame);
            this.container.add(children);
            this.visuals.set(node.id, { rect, icon, sprite, frame });
        });
    }

    private makeClickable(rect: Phaser.GameObjects.Rectangle, node: MapNode): void {
        rect.setInteractive({ useHandCursor: true });
        rect.on('pointerdown', () => {
            if (this.canUseNode(node)) {
                this.onNodeClickDelegate(node);
            }
        });
        rect.on('pointerover', () => {
            if (this.canUseNode(node)) {
                this.applyHover(node, true);
            }
            const unlocks = this.meta.getUiUnlockState();
            const revealed =
                node.visited ||
                node.id === this.dungeon.currentNode.id ||
                this.dungeon.getForwardNodes().some((n) => n.id === node.id);
            const knowsType =
                node.visited || node.id === this.dungeon.currentNode.id || unlocks.showRoomIcons;
            if (revealed && knowsType && !node.cleared) {
                this.tooltipText.setText(roomTypeName(node.type, this.loc));
                const screenX = this.nodeX(node) + this.container.x;
                const screenY = this.nodeY(node) + this.container.y - NODE_SZ / 2 - 18;
                this.tooltipText.setPosition(screenX, screenY).setOrigin(0.5, 1).setVisible(true);
            }
        });
        rect.on('pointerout', () => {
            this.applyHover(node, false);
            this.tooltipText.setVisible(false);
        });
    }

    /**
     * Map-node hover affordance. With the carved `room_frames.png`
     * overlay present we scale the frame ~10% and tint it lighter;
     * without the overlay we fall back to a thicker neutral-gold
     * rect stroke. No white outline anywhere — that was the "current
     * room" highlight the player asked us to retire. After hover-out
     * the frame restarts its idle pulsate if the node is still a
     * reachable forward option, so the "breathing" affordance never
     * gets eaten by a hover.
     */
    private applyHover(node: MapNode, hovered: boolean): void {
        const visual = this.visuals.get(node.id);
        if (!visual) {
            return;
        }
        const targetSize = hovered ? NODE_SZ + 18 : NODE_SZ + 8;
        const tint = hovered ? 0xfff5cc : 0xffffff;
        const isReachable = !node.cleared && this.dungeon.canMoveTo(node.id);
        if (visual.frame) {
            this.scene.tweens.killTweensOf(visual.frame);
            this.scene.tweens.add({
                targets: visual.frame,
                displayWidth: targetSize,
                displayHeight: targetSize,
                duration: 120,
                ease: 'Sine.out',
                onComplete: () => {
                    if (!hovered && isReachable) {
                        this.startNodePulse(visual);
                    }
                },
            });
            if (node.cleared) {
                visual.frame.setTint(0x555555);
            } else if (hovered) {
                visual.frame.setTint(tint);
            } else {
                visual.frame.clearTint();
            }
            return;
        }
        // Fallback path (PNG missing) — a thin stroke change with the
        // same semantic palette as refresh(), no white.
        const colour = node.cleared ? 0x333333 : isReachable ? 0x6d6d6d : 0x343434;
        visual.rect.setStrokeStyle(hovered ? 3 : 2, hovered ? 0x9a8a4a : colour);
    }

    /**
     * Idle "breathing" pulse on a reachable map node — the carved
     * frame yoyos between its base size (NODE_SZ + 8) and a slightly
     * larger peak (NODE_SZ + 14). This replaced the grey
     * VFX.nodeGlow rectangle that players asked us to retire.
     *
     * Hover takes priority via {@link applyHover} (which kills tweens
     * on the frame and animates to NODE_SZ + 18); on hover-out the
     * pulse is restarted from there so the affordance is continuous
     * across the player's pointer movement.
     */
    private startNodePulse(visual: NodeVisual): void {
        if (visual.frame) {
            const baseSize = NODE_SZ + 8;
            const peakSize = NODE_SZ + 14;
            this.scene.tweens.killTweensOf(visual.frame);
            visual.frame.setDisplaySize(baseSize, baseSize);
            this.scene.tweens.add({
                targets: visual.frame,
                displayWidth: peakSize,
                displayHeight: peakSize,
                duration: 760,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.inOut',
            });
            return;
        }
        // PNG missing — pulse the rect's stroke alpha instead so the
        // affordance is still visible on the fallback render path.
        this.scene.tweens.killTweensOf(visual.rect);
        this.scene.tweens.add({
            targets: visual.rect,
            alpha: { from: 0.7, to: 1 },
            duration: 760,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.inOut',
        });
    }

    /**
     * Clear and re-stroke the edge `Graphics`. Lines from the current
     * node to forward options render bright; backward / non-current
     * sources fade. Per-source-node grouping spreads outgoing lanes
     * so lines from the same source don't overlap.
     */
    redrawEdges(): void {
        this.edgeGfx.clear();

        // Fade the freshly-redrawn edge graphics in. Edges always
        // re-render as a whole layer (only the current room's
        // outgoing fan is drawn — see the fog-of-war filter below),
        // so a single alpha tween on `edgeGfx` is enough to make the
        // new lines glide in instead of popping.
        this.scene.tweens.killTweensOf(this.edgeGfx);
        this.edgeGfx.setAlpha(0);
        this.scene.tweens.add({
            targets: this.edgeGfx,
            alpha: 1,
            duration: this.REVEAL_DURATION,
            ease: 'Quad.out',
        });

        const currentDepth = this.dungeon.currentDepth;
        const forwardIds = new Set(this.dungeon.getForwardNodes().map((node) => node.id));
        const currentId = this.dungeon.currentNode.id;
        const allNodes = this.dungeon.getAllNodes();

        // Fog-of-war: only the edges fanning out from the current
        // room are drawn. Edges between not-yet-reachable future
        // rooms would point at hidden nodes — drawing them would
        // leak the upcoming layout the player isn't supposed to see
        // yet.
        allNodes.forEach((node) => {
            if (node.id !== currentId) return;
            if (node.cleared) return;
            if (node.depth < currentDepth) return;
            if (node.edges.length === 0) return;

            const targets = node.edges
                .map((id) => allNodes.find((candidate) => candidate.id === id))
                .filter((target): target is MapNode => !!target);

            const x1 = this.nodeX(node);
            const y1 = this.nodeY(node);

            targets.forEach((target) => {
                const active = !node.cleared && forwardIds.has(target.id) && node.id === currentId;
                const lineColor = node.cleared ? 0x2a2a2a : active ? 0x9b9b9b : 0x3b3b3b;
                const lineAlpha = node.cleared ? 0.18 : active ? 1 : 0.35;
                const lineWidth = active ? 3 : 2;

                const x2 = this.nodeX(target);
                const y2 = this.nodeY(target);

                // Straight line — child rooms can sit in any direction
                // around the parent (see MapGenerator.placeNode), so a
                // direct segment is the only layout-agnostic option.
                this.edgeGfx.lineStyle(lineWidth, lineColor, lineAlpha);
                this.edgeGfx.beginPath();
                this.edgeGfx.moveTo(x1, y1);
                this.edgeGfx.lineTo(x2, y2);
                this.edgeGfx.strokePath();
            });
        });
    }

    /**
     * Re-derive every existing node visual's appearance from the
     * current dungeon state (cleared / current / forward / revealed).
     * Cheap idempotent pass; safe to call after every move or unlock.
     *
     * Also re-attaches the per-frame fire effect to camp/altar nodes
     * (REST/START/SHRINE) and clears the legacy `glowMap` overlay.
     */
    refresh(_unlocks?: UiUnlockState): void {
        const unlocks = _unlocks ?? this.meta.getUiUnlockState();

        // The reachable-node affordance used to be a separate grey
        // VFX.nodeGlow rectangle; we now pulsate the carved frame
        // itself instead, so this map only holds left-over glows from
        // older runs and is always cleared here. The active "pulse"
        // tween on each frame is killed below as part of the per-node
        // refresh so it doesn't compound.
        this.glowMap.forEach((glow) => glow.destroy());
        this.glowMap.clear();
        this.fireMap.forEach((fire) => fire.destroy());
        this.fireMap.clear();

        const currentId = this.dungeon.currentNode.id;
        const forwardIds = new Set(this.dungeon.getForwardNodes().map((node) => node.id));
        const allNodes = this.dungeon.getAllNodes();

        // Fog-of-war reveal/hide animation needs to know which nodes
        // were visible last frame so it can fade newcomers in and
        // ex-visible cleared/out-of-window nodes out smoothly.
        const newVisibleIds = new Set<string>();

        this.visuals.forEach((visual, id) => {
            const node = allNodes.find((candidate) => candidate.id === id);
            if (!node) {
                return;
            }

            const hasFrame = hasTexture(this.scene, 'hud_room_frames');
            const isCurrent = id === currentId;
            const isForward = forwardIds.has(id);

            // Kill any in-flight tween on every visual element before
            // re-deriving state. A residual fade or yoyo-pulse would
            // otherwise overwrite the alpha/visibility we set below
            // and the tweens we're about to schedule.
            this.scene.tweens.killTweensOf(visual.rect);
            this.scene.tweens.killTweensOf(visual.icon);
            if (visual.sprite) this.scene.tweens.killTweensOf(visual.sprite);
            if (visual.frame) this.scene.tweens.killTweensOf(visual.frame);

            // Fog-of-war: only the current room and its directly
            // reachable forward options are rendered. Cleared
            // (already-walked) rooms and not-yet-reachable future
            // rooms stay hidden until the player advances toward them.
            const visible = !node.cleared && (isCurrent || isForward);
            const wasVisible = this.lastVisibleIds.has(id);

            if (!visible) {
                if (wasVisible) {
                    // Smoothly fade out a node that just left the
                    // visible window (current room got cleared, or a
                    // forward option was abandoned), then hide it.
                    const fadeTargets: Phaser.GameObjects.GameObject[] = [visual.rect, visual.icon];
                    if (visual.sprite && visual.sprite.visible) {
                        fadeTargets.push(visual.sprite);
                    }
                    if (visual.frame && visual.frame.visible) {
                        fadeTargets.push(visual.frame);
                    }
                    this.scene.tweens.add({
                        targets: fadeTargets,
                        alpha: 0,
                        duration: this.REVEAL_DURATION,
                        ease: 'Quad.in',
                        onComplete: () => {
                            visual.rect.setVisible(false);
                            visual.icon.setVisible(false);
                            if (visual.sprite) visual.sprite.setVisible(false);
                            if (visual.frame) visual.frame.setVisible(false);
                        },
                    });
                } else {
                    visual.rect.setVisible(false);
                    visual.icon.setVisible(false);
                    if (visual.sprite) visual.sprite.setVisible(false);
                    if (visual.frame) visual.frame.setVisible(false);
                }
                return;
            }
            newVisibleIds.add(id);
            visual.rect.setVisible(true);

            const revealed = isCurrent || isForward || node.visited;
            const knowsType = node.visited || isCurrent || unlocks.showRoomIcons;
            const iconText = revealed && knowsType ? roomIcon(node.type) : '?';

            // Black backdrop for every room — the carved frame overlay
            // (when present) carries the state colour, so the rect's
            // own stroke is only used as a fallback indicator when the
            // frame texture is missing. The "current room" no longer gets
            // a separate white outline; the player figures out where they
            // stand from the play-area state and the upcoming hover scale
            // affordance on reachable nodes.
            visual.rect.setFillStyle(0x000000).setAlpha(1);
            if (hasFrame) {
                visual.rect.setStrokeStyle(0);
            } else {
                visual.rect.setStrokeStyle(2, isForward ? 0x6d6d6d : 0x343434);
            }

            if (visual.frame) {
                const frameIdx = revealed && knowsType ? roomFrameIndex(node.type) : 2;
                this.scene.tweens.killTweensOf(visual.frame);
                visual.frame
                    .setFrame(frameIdx)
                    .setAlpha(1)
                    .clearTint()
                    .setDisplaySize(NODE_SZ + 8, NODE_SZ + 8)
                    .setVisible(true);
            }

            // Sprite priority: hand-authored room_icons spritesheet →
            // procedural PixelSprite → text glyph (matches build()).
            const useSheet = revealed && knowsType && hasTexture(this.scene, 'hud_room_icons');
            const proceduralKey = PixelSprite.roomKey(roomSpriteKey(node.type));
            const useProcedural =
                !useSheet && revealed && knowsType && hasTexture(this.scene, proceduralKey);
            if (useSheet) {
                if (!visual.sprite) {
                    visual.sprite = this.scene.add
                        .image(
                            this.nodeX(node),
                            this.nodeY(node),
                            'hud_room_icons',
                            roomIconFrame(node.type)
                        )
                        .setOrigin(0.5);
                    this.container.add(visual.sprite);
                } else {
                    visual.sprite.setTexture('hud_room_icons', roomIconFrame(node.type));
                }
                fitRoomSprite(visual.sprite);
                visual.sprite.setAlpha(1).clearTint().setVisible(true);
                visual.icon.setVisible(false);
            } else if (useProcedural) {
                if (!visual.sprite) {
                    visual.sprite = this.scene.add
                        .image(this.nodeX(node), this.nodeY(node), proceduralKey)
                        .setOrigin(0.5);
                    this.container.add(visual.sprite);
                } else {
                    visual.sprite.setTexture(proceduralKey);
                }
                fitRoomSprite(visual.sprite);
                visual.sprite.setAlpha(1).clearTint().setVisible(true);
                visual.icon.setVisible(false);
            } else {
                visual.icon.setText(iconText).setColor('#ffffff').setAlpha(1).setVisible(true);
                if (visual.sprite) visual.sprite.setVisible(false);
            }

            // Reachable-node affordance: pulsate the carved frame
            // (or, when the PNG is missing, the rect stroke) so the
            // forward options breathe in and out. The grey
            // VFX.nodeGlow rectangle was retired — players asked us
            // to remove the dull grey halo; the pulse sits inside
            // the existing frame palette so it never clashes with
            // the room-type tint.
            const startPulse = isForward && !node.cleared;

            if (!wasVisible) {
                // Newly visible (just came into the fog-of-war
                // window). Fade every visual element in from alpha
                // 0 over REVEAL_DURATION and only kick the pulse
                // off once the reveal settles, otherwise the pulse
                // yoyo would fight the fade-in tween.
                const fadeTargets: Phaser.GameObjects.GameObject[] = [visual.rect, visual.icon];
                visual.rect.setAlpha(0);
                visual.icon.setAlpha(0);
                if (visual.sprite && visual.sprite.visible) {
                    visual.sprite.setAlpha(0);
                    fadeTargets.push(visual.sprite);
                }
                if (visual.frame && visual.frame.visible) {
                    visual.frame.setAlpha(0);
                    fadeTargets.push(visual.frame);
                }
                this.scene.tweens.add({
                    targets: fadeTargets,
                    alpha: 1,
                    duration: this.REVEAL_DURATION,
                    ease: 'Quad.out',
                    onComplete: () => {
                        if (startPulse) this.startNodePulse(visual);
                    },
                });
            } else if (startPulse) {
                this.startNodePulse(visual);
            }

            // Tiny fire embers above campfire/altar nodes
            // (REST/START/SHRINE). Skipped on cleared rooms because
            // their fire is "out".
            if (!node.cleared && hasFireEffect(node.type)) {
                const fire = VFX.nodeFire(
                    this.scene,
                    this.container,
                    this.nodeX(node),
                    this.nodeY(node)
                );
                this.fireMap.set(id, fire);
            }
        });

        this.lastVisibleIds = newVisibleIds;
    }

    /**
     * Fade-out the cleared-room visuals to alpha 0.35 in parallel.
     * Fires `done()` once every tween settles. If there are no
     * cleared visuals to animate, calls `done()` synchronously.
     */
    animateClearedOut(done: () => void): void {
        const ids = this.dungeon
            .getAllNodes()
            .filter((node) => node.cleared)
            .map((node) => node.id)
            .filter((id) => this.visuals.has(id));

        if (!ids.length) {
            done();
            return;
        }

        let remaining = ids.length;
        ids.forEach((id) => {
            const visual = this.visuals.get(id);
            if (!visual) {
                remaining--;
                if (remaining === 0) {
                    done();
                }
                return;
            }

            // Kill any in-flight pulse (fallback render path) so it
            // doesn't fight the alpha→0.35 fade that follows.
            this.scene.tweens.killTweensOf(visual.rect);
            if (visual.frame) this.scene.tweens.killTweensOf(visual.frame);

            const tweenTargets: Phaser.GameObjects.GameObject[] = [visual.rect, visual.icon];
            if (visual.sprite) tweenTargets.push(visual.sprite);
            if (visual.frame) {
                this.scene.tweens.killTweensOf(visual.frame);
                tweenTargets.push(visual.frame);
            }
            this.scene.tweens.add({
                targets: tweenTargets,
                alpha: 0,
                duration: 350,
                ease: 'Quad.in',
                onComplete: () => {
                    visual.rect.setVisible(false);
                    visual.icon.setVisible(false);
                    if (visual.sprite) visual.sprite.setVisible(false);
                    if (visual.frame) visual.frame.setVisible(false);
                    remaining--;
                    if (remaining === 0) {
                        done();
                    }
                },
            });
        });
    }

    /** Glide the container so `node` is centred on the viewport. */
    animateShift(node: MapNode, done: () => void): void {
        const { x, y } = this.getMapOffset(node);
        this.scene.tweens.add({
            targets: this.container,
            x,
            y,
            duration: 360,
            ease: 'Quad.inOut',
            onComplete: done,
        });
    }

    // ─── walk animation ──────────────────────────────────────────

    /** Graphics layer for footprint trace dots drawn during the walk. */
    private traceGfx: Phaser.GameObjects.Graphics | null = null;

    /**
     * Compute the polyline (in container-local coords) that connects
     * `from` to `to` for the walk animation. Edges are now straight
     * 2-point segments because rooms can be placed in any direction
     * around their parent (see MapGenerator.placeNode).
     */
    getEdgePath(from: MapNode, to: MapNode): { x: number; y: number }[] {
        return [
            { x: this.nodeX(from), y: this.nodeY(from) },
            { x: this.nodeX(to), y: this.nodeY(to) },
        ];
    }

    /**
     * Total euclidean length of a polyline.
     */
    private static pathLength(pts: { x: number; y: number }[]): number {
        let len = 0;
        for (let i = 1; i < pts.length; i++) {
            const dx = pts[i].x - pts[i - 1].x;
            const dy = pts[i].y - pts[i - 1].y;
            len += Math.sqrt(dx * dx + dy * dy);
        }
        return len;
    }

    /**
     * Interpolate a position along a polyline at fractional distance `t`
     * (0 = start, 1 = end).
     */
    private static samplePath(
        pts: { x: number; y: number }[],
        t: number
    ): { x: number; y: number } {
        const total = MapView.pathLength(pts);
        let target = t * total;
        for (let i = 1; i < pts.length; i++) {
            const dx = pts[i].x - pts[i - 1].x;
            const dy = pts[i].y - pts[i - 1].y;
            const seg = Math.sqrt(dx * dx + dy * dy);
            if (target <= seg || i === pts.length - 1) {
                const frac = seg > 0 ? target / seg : 0;
                return {
                    x: pts[i - 1].x + dx * frac,
                    y: pts[i - 1].y + dy * frac,
                };
            }
            target -= seg;
        }
        return pts[pts.length - 1];
    }

    /**
     * Animate a walk from `from` to `to` over `durationMs`.
     *
     * During the walk the map container is repositioned each frame so the
     * current walk position stays centred at the viewport focal point, and
     * small dot traces are drawn along the path.
     *
     * @param onStep  Called every frame with the current walk position in
     *                **screen** coordinates so the caller can update the
     *                torchlight overlay.
     * @param done    Fires once the walk completes.
     */
    animateWalk(
        from: MapNode,
        to: MapNode,
        durationMs: number,
        onStep: (screenX: number, screenY: number) => void,
        done: () => void
    ): void {
        const path = this.getEdgePath(from, to);

        if (!this.traceGfx) {
            this.traceGfx = this.scene.add.graphics();
            this.container.add(this.traceGfx);
        }

        const proxy = { t: 0 };
        const traceInterval = 18;
        let lastTraceDist = -traceInterval;
        const totalLen = MapView.pathLength(path);

        this.scene.tweens.add({
            targets: proxy,
            t: 1,
            duration: durationMs,
            ease: 'Sine.inOut',
            onUpdate: () => {
                const pos = MapView.samplePath(path, proxy.t);

                this.container.setPosition(VIEW_X - pos.x, VIEW_Y - pos.y);

                const currentDist = proxy.t * totalLen;
                if (currentDist - lastTraceDist >= traceInterval) {
                    this.traceGfx!.fillStyle(0xcccccc, 0.45);
                    this.traceGfx!.fillCircle(pos.x, pos.y, 2.5);
                    lastTraceDist = currentDist;
                }

                onStep(VIEW_X, VIEW_Y);
            },
            onComplete: () => {
                this.centerOnNode(to);
                // Fog-of-war: the breadcrumb dots only exist while
                // the player is in motion. Once they've arrived at
                // the next room the trail is wiped so the map only
                // shows the current room and the upcoming options.
                if (this.traceGfx) {
                    this.traceGfx.clear();
                }
                done();
            },
        });
    }

    /** Remove walk trace dots (called when starting a new run / map
     *  reset so the old traces don't pile up). */
    clearTraces(): void {
        if (this.traceGfx) {
            this.traceGfx.clear();
        }
    }
}
