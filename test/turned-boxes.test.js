// @vitest-environment jsdom
// A node's box turns with the node (`NodeBox.angle`). Its sides are the node's own
// edges: ports, link ends and drops follow the turn, and layout and orthogonal
// routes take the upright box around it.
import { describe, it, expect } from 'vitest';
import { Elicit, plot, edit } from '../src/index.js';
import { anchorOn, perimeterPort, facingSide, boxBounds, fromBox, toBox, sideNormal } from '../src/plot/linkRouter.js';
import { boxAt } from '../src/plot/nodeBox.js';
import { LINK_SHAPES } from '../src/plot/linkGeometry.js';
import { anchorPoint, distanceToView } from '../src/ui/place.js';

const near = (p, x, y) => {
    expect(p.x).toBeCloseTo(x, 6);
    expect(p.y).toBeCloseTo(y, 6);
};

// 40 wide, 20 tall, turned a quarter counter-clockwise: now 20 wide, 40 tall.
const turned = { cx: 100, cy: 100, hw: 20, hh: 10, angle: 90 };

describe('box helpers', () => {
    it('turn counter-clockwise on screen, and back', () => {
        near(fromBox(turned, { x: 120, y: 100 }), 100, 80);
        near(toBox(turned, { x: 100, y: 80 }), 120, 100);
        near(sideNormal(turned, 'right'), 0, -1);
    });

    it('bounds a turned box with the upright box around it', () => {
        const b = boxBounds(turned);
        expect(b.hw).toBeCloseTo(10, 6);
        expect(b.hh).toBeCloseTo(20, 6);
        expect(b.angle).toBeUndefined();
        const upright = { cx: 0, cy: 0, hw: 5, hh: 5 };
        expect(boxBounds(upright)).toBe(upright);
    });
});

describe('ports and link ends on a turned box', () => {
    it('pins a side to the turned edge', () => {
        near(anchorOn(turned, 'right', 0, 0), 100, 80);
        near(anchorOn(turned, 'top', 0, 0), 90, 100);
    });

    it('slides onto the turned edge facing the other end', () => {
        const a = perimeterPort(turned, { x: 100, y: 0 }, 0);
        expect(a.side).toBe('right');
        near(a, 100, 80);
    });

    it('faces the port nearest the other end', () => {
        expect(facingSide(turned, ['top', 'right', 'bottom', 'left'], { x: 100, y: 0 })).toBe('right');
    });

    it('docks a self-loop on the turned edge', () => {
        const shape = LINK_SHAPES.loop.build({ x1: 100, y1: 100, x2: 100, y2: 100 }, 0, {
            loopRadius: 20, source: turned, loopOut: 'right', loopIn: 'right',
        });
        // Both ends sit on the right edge, which now runs along y = 80.
        expect(shape.start.y).toBeCloseTo(80, 6);
        expect(shape.end.y).toBeCloseTo(80, 6);
        expect(shape.mid.y).toBeLessThan(80);
    });

    it('finds a drop inside the turned box only', () => {
        const rows = [{}];
        const rule = () => turned;
        expect(boxAt({ x: 100, y: 82 }, rows, rule)).toBe(0);
        expect(boxAt({ x: 115, y: 100 }, rows, rule)).toBeNull();
    });
});

describe('a turned rect drawing nodes', () => {
    it('puts its ports on the turned sides', async () => {
        const el = Elicit({
            width: 400, height: 300, axes: false,
            schema: {
                structure: 'network',
                tables: {
                    nodes: {
                        id: { type: 'categorical', key: true },
                        x: { type: 'quantitative', domain: [0, 400] },
                        y: { type: 'quantitative', domain: [0, 300] },
                    },
                    links: { source: { type: 'ref' }, target: { type: 'ref' } },
                },
            },
            scales: { x: { range: [0, 400] }, y: { range: [0, 300] } },
            margins: { top: 0, right: 0, bottom: 0, left: 0 },
            data: { nodes: [{ id: 'a', x: 200, y: 150 }], links: [] },
            marks: [
                plot.link(),
                plot.rect({
                    id: 'box', width: 80, height: 40, angle: 90,
                    channels: {
                        x: { field: 'x' },
                        y: { field: 'y' },
                        ports: { value: ['right'], edit: edit.network.connect() },
                    },
                }),
            ],
        });
        document.body.appendChild(el.dom());
        await new Promise((r) => setTimeout(r, 0));
        const [port] = el.scene({ channel: 'port' });
        expect(port.side).toBe('right');
        expect(port.angle).toBe(90);
        // The right edge, turned a quarter, faces up: 40px above the centre.
        near(port.center, 200, 110);
        el.destroy();
    });
});

describe('placing UI on a turned view', () => {
    const view = /** @type {any} */ ({
        mark: 'box', type: 'rect', box: { x: 80, y: 90, width: 40, height: 20 },
        center: { x: 100, y: 100 }, angle: 90,
    });

    it('anchors to the turned side', () => {
        near(anchorPoint(view, 'right'), 100, 80);
        near(anchorPoint(view, 'top'), 90, 100);
    });

    it('measures distance in the view\'s own frame', () => {
        expect(distanceToView(view, { x: 100, y: 82 })).toBeCloseTo(0, 6);
        expect(distanceToView(view, { x: 115, y: 100 })).toBeCloseTo(5, 6);
    });
});
