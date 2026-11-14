// @ts-check
// tiles.js — slippy-map tile cover for a raster basemap (the OSM / Leaflet model).
// Tiles are Web Mercator images, so they only register under a Web Mercator
// projection (isWebMercator). Placement, from the chart's fitted d3.geoMercator:
//   worldPx = 2π · scale                          the world's width in px
//   z       = round(log2(worldPx / tileSize))     nearest integer zoom
//   size    = worldPx / 2^z                       a tile's on-screen size
//   origin  = projection([0,0]) − worldPx/2       the world's top-left corner
// Tile (x, y) sits at origin + (x, y)·size. The origin comes from the live
// projection, so tiles and vector marks share one coordinate system.

/** Latitude where the Mercator world becomes square: atan(sinh(π)). */
export const MAX_MERCATOR_LAT = 85.0511287798066;

/**
 * Does this projection place lon/lat the way the tile pyramid does? Checked by
 * behaviour: probe points must land where the Web Mercator formula puts them:
 *
 *   x = ox + worldPx · (lon + 180) / 360
 *   y = oy + worldPx · (0.5 − ln(tan(π/4 + φ/2)) / 2π)
 *
 * The latitude probes reject equirectangular, which agrees on the equator. A pure
 * longitude rotation passes: tiles and data pan together.
 *
 * @param {import('./projection.js').ProjectionContext | null | undefined} projection
 * @returns {boolean}
 */
export function isWebMercator(projection) {
    if (!projection || !projection.raw || typeof projection.raw.scale !== 'function') return false;
    const worldPx = 2 * Math.PI * projection.raw.scale();
    if (!Number.isFinite(worldPx) || worldPx <= 0) return false;

    const centre = projection.apply([0, 0]);
    if (!centre) return false;
    const ox = centre[0] - worldPx / 2;
    const oy = centre[1] - worldPx / 2;

    // Mercator's y for a latitude, in world pixels from the top edge.
    const mercY = (/** @type {number} */ lat) => {
        const phi = (lat * Math.PI) / 180;
        return oy + worldPx * (0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI));
    };
    const mercX = (/** @type {number} */ lon) => ox + (worldPx * (lon + 180)) / 360;

    const tol = Math.max(0.5, worldPx * 1e-6);
    for (const [lon, lat] of [[90, 0], [-60, 45], [30, -30], [0, 60]]) {
        const p = projection.apply([lon, lat]);
        if (!p) return false;
        if (Math.abs(p[0] - mercX(lon)) > tol) return false;
        if (Math.abs(p[1] - mercY(lat)) > tol) return false;
    }
    return true;
}

/**
 * @typedef {{ z: number, x: number, y: number, px: number, py: number, size: number, key: string }} Tile
 */

/**
 * The tiles covering the plot frame, with their pixel placement.
 * Returns null when the projection can't carry tiles.
 *
 * @param {import('./projection.js').ProjectionContext | null | undefined} projection
 * @param {number} width @param {number} height  inner plot size
 * @param {{ tileSize?: number, minZoom?: number, maxZoom?: number, zoomOffset?: number }} [opts]
 * @returns {{ z: number, size: number, tiles: Tile[] } | null}
 */
export function tileCover(projection, width, height, opts = {}) {
    const { tileSize = 256, minZoom = 0, maxZoom = 19, zoomOffset = 0 } = opts;
    if (!isWebMercator(projection) || !(width > 0) || !(height > 0)) return null;

    const proj = /** @type {any} */ (projection);
    const worldPx = 2 * Math.PI * proj.raw.scale();
    if (!Number.isFinite(worldPx) || worldPx <= 0) return null;

    // Nearest integer zoom, then let the tiles scale to the fitted size.
    const zRaw = Math.round(Math.log2(worldPx / tileSize)) + zoomOffset;
    const z = Math.max(minZoom, Math.min(maxZoom, zRaw));
    const n = 2 ** z;                 // tiles per axis at this zoom
    const size = worldPx / n;         // a tile's on-screen size

    const centre = proj.apply([0, 0]);
    if (!centre) return null;
    const ox = centre[0] - worldPx / 2;   // world top-left, in plot pixels
    const oy = centre[1] - worldPx / 2;

    const x0 = Math.floor((0 - ox) / size);
    const x1 = Math.ceil((width - ox) / size);
    const y0 = Math.floor((0 - oy) / size);
    const y1 = Math.ceil((height - oy) / size);

    /** @type {Tile[]} */
    const tiles = [];
    for (let y = Math.max(0, y0); y < Math.min(n, y1); y++) {
        for (let x = x0; x < x1; x++) {
            // Longitude wraps; latitude does not (poles are the edge of the world).
            const wrapped = ((x % n) + n) % n;
            tiles.push({
                z,
                x: wrapped,
                y,
                px: ox + x * size,
                py: oy + y * size,
                size,
                key: `${z}/${wrapped}/${y}`,
            });
        }
    }
    return { z, size, tiles };
}

/**
 * Resolve a tile URL from a template (`{z}/{x}/{y}`, with an optional `{s}`
 * subdomain) or a function. Subdomains are rotated by tile coords so a row of
 * tiles spreads across the server's hosts, as Leaflet does.
 *
 * @param {string | ((t: Tile) => string)} url
 * @param {Tile} tile
 * @param {string[]} subdomains
 * @returns {string}
 */
export function tileUrl(url, tile, subdomains = ['a', 'b', 'c']) {
    if (typeof url === 'function') return url(tile);
    const s = subdomains.length
        ? subdomains[Math.abs(tile.x + tile.y) % subdomains.length]
        : '';
    return url
        .replace('{s}', s)
        .replace('{z}', String(tile.z))
        .replace('{x}', String(tile.x))
        .replace('{y}', String(tile.y));
}
