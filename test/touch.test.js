// @vitest-environment jsdom
// A finger is bigger and less steady than a mouse: small marks get a touch target.
import { describe, it, expect } from 'vitest';
import { hitTest, hitTestTouch, TOUCH_REACH } from '../src/edit/pick.js';
import { bindPointerEvents } from '../src/renderers/pointer.js';
import { tapDistance, CLICK_DISTANCE, TOUCH_TAP_DISTANCE } from '../src/renderers/shared.js';
import { guides } from '../src/index.js';

const dot = (cx, cy, index, r = 5) => ({ type: 'circle', cx, cy, r, featureId: 'f', index, editable: true });

describe('hitTestTouch', () => {
    it('takes a small dot the finger lands beside, which a mouse misses', () => {
        const marks = [dot(50, 50, 0)];
        expect(hitTest(marks, 65, 50)).toBe(null);
        expect(hitTestTouch(marks, 65, 50, TOUCH_REACH)).toBe(marks[0]);
        expect(hitTestTouch(marks, 50 + TOUCH_REACH + 1, 50, TOUCH_REACH)).toBe(null);
    });

    it('prefers the mark under the finger, then the nearest', () => {
        const a = dot(50, 50, 0);
        const b = dot(80, 50, 1);
        // Inside both targets, nearer a; b is drawn on top.
        expect(hitTestTouch([a, b], 62, 50, TOUCH_REACH)).toBe(a);
        // On b itself.
        expect(hitTestTouch([a, b], 78, 50, TOUCH_REACH)).toBe(b);
    });

    it('grows a thin rect to the touch target, not a large one', () => {
        const thin = { type: 'rect', x: 40, y: 100, width: 20, height: 0, featureId: 'f', index: 0, editable: true };
        const big = { type: 'rect', x: 100, y: 0, width: 60, height: 80, featureId: 'f', index: 1, editable: true };
        expect(hitTestTouch([thin], 50, 115, TOUCH_REACH)).toBe(thin);
        expect(hitTestTouch([big], 130, 95, TOUCH_REACH)).toBe(null);
    });

    it('reaches a thin line within the target band', () => {
        const line = { type: 'line', x1: 0, y1: 50, x2: 100, y2: 50, strokeWidth: 2, featureId: 'f', index: 0, editable: true };
        expect(hitTestTouch([line], 50, 65, TOUCH_REACH)).toBe(line);
        expect(hitTestTouch([line], 50, 80, TOUCH_REACH)).toBe(null);
    });

    it('never takes a locked or inert mark', () => {
        expect(hitTestTouch([{ ...dot(50, 50, 0), locked: true }], 60, 50, TOUCH_REACH)).toBe(null);
        expect(hitTestTouch([{ ...dot(50, 50, 0), pointerEvents: 'none' }], 60, 50, TOUCH_REACH)).toBe(null);
    });

    it('is hitTest without a reach', () => {
        expect(hitTestTouch([dot(50, 50, 0)], 65, 50, 0)).toBe(null);
    });
});

describe('tapDistance', () => {
    it('lets a finger wobble further than a mouse', () => {
        expect(tapDistance('mouse', CLICK_DISTANCE)).toBe(CLICK_DISTANCE);
        expect(tapDistance('touch', CLICK_DISTANCE)).toBe(TOUCH_TAP_DISTANCE);
    });
});

describe('canvas renderer, touch', () => {
    /** A pointer event jsdom can build, with a pointerType. */
    const press = (type, x, y, pointerType) => {
        const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
        Object.defineProperty(e, 'pointerType', { value: pointerType });
        Object.defineProperty(e, 'pointerId', { value: 1 });
        return e;
    };
    const setup = () => {
        const canvas = document.createElement('canvas');
        const node = dot(50, 50, 0);
        const events = [];
        const ctx = { scene: { children: [node] }, width: 200, height: 200, margins: { left: 0, top: 0 }, planeOnTop: false, onEvent: (e) => events.push(e) };
        bindPointerEvents(canvas, () => ctx);
        return { canvas, node, events };
    };

    it('a finger beside a small dot grabs it; a mouse there does not', () => {
        const touch = setup();
        touch.canvas.dispatchEvent(press('pointerdown', 65, 50, 'touch'));
        expect(touch.events[0]).toMatchObject({ type: 'dragstart', node: touch.node });

        const mouse = setup();
        mouse.canvas.dispatchEvent(press('pointerdown', 65, 50, 'mouse'));
        expect(mouse.events.some((e) => e.type === 'dragstart')).toBe(false);
    });

    it('a wobbly tap on a dot is still a click', () => {
        const { canvas, node, events } = setup();
        canvas.dispatchEvent(press('pointerdown', 50, 50, 'touch'));
        canvas.dispatchEvent(press('pointermove', 56, 50, 'touch'));
        canvas.dispatchEvent(press('pointerup', 56, 50, 'touch'));
        expect(events.some((e) => e.type === 'click' && e.node === node)).toBe(true);
    });
});

describe('pointer guides under a finger', () => {
    const at = (touch) => ({ ui: { pointer: { x: 50, y: 50, touch } }, theme: {} });
    it('a crosshair follows a finger unless touch: false', () => {
        expect(guides.crosshair().build([], {}, 100, 100, at(true)).length).toBeGreaterThan(0);
        expect(guides.crosshair({ touch: false }).build([], {}, 100, 100, at(true))).toEqual([]);
        expect(guides.crosshair({ touch: false }).build([], {}, 100, 100, at(false)).length).toBeGreaterThan(0);
    });
});
