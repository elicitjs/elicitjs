// @ts-check
// format.js: display formatters. A `format` option takes a function or a
// d3-format specifier string (dates need a function, e.g. `format.time()`).
// Formatting is display-only; the field keeps its raw value.

import * as d3 from 'd3';

/**
 * Resolve a format option into a `(value) => string` function.
 *   - function  → used as-is
 *   - string    → d3.format(specifier)
 *   - falsy     → String(v) (null/undefined → '')
 * @param {string | ((v: any) => string) | null | undefined} format
 * @returns {(v: any) => string}
 */
export function resolveFormat(format) {
    if (typeof format === 'function') return format;
    if (typeof format === 'string') {
        const fmt = d3.format(format);
        return (/** @type {any} */ v) => (v == null || v === '' ? '' : fmt(v));
    }
    return (/** @type {any} */ v) => (v == null ? '' : String(v));
}

/**
 * A d3-format number formatter.
 * @param {string} [specifier=''] d3-format specifier (e.g. '.1f', ',.0f', '.2s')
 * @returns {(v: any) => string}
 */
export function number(specifier = '') {
    return resolveFormat(specifier);
}

/**
 * A percent formatter. Pass a d3-format specifier (default `.0%`); values are
 * expected in [0, 1] the way d3.format('%') expects them.
 * @param {string} [specifier='.0%']
 * @returns {(v: any) => string}
 */
export function percent(specifier = '.0%') {
    return resolveFormat(specifier);
}

/**
 * SI-prefix compact numbers (e.g. 1.2k, 3.4M). Default `.2s`.
 * @param {string} [specifier='.2s']
 * @returns {(v: any) => string}
 */
export function si(specifier = '.2s') {
    return resolveFormat(specifier);
}

/**
 * A d3-time-format date formatter. Values may be Date or parseable timestamps.
 * @param {string} [specifier='%Y-%m-%d']
 * @returns {(v: any) => string}
 */
export function time(specifier = '%Y-%m-%d') {
    const fmt = d3.timeFormat(specifier);
    return (/** @type {any} */ v) => {
        if (v == null || v === '') return '';
        const d = v instanceof Date ? v : new Date(v);
        return Number.isNaN(+d) ? String(v) : fmt(d);
    };
}

/**
 * Prefix every formatted value with a fixed string (e.g. currency).
 * @param {string} prefix
 * @param {string | ((v: any) => string)} [inner=''] inner number format
 * @returns {(v: any) => string}
 */
export function prefix(prefix, inner = '') {
    const fmt = resolveFormat(inner);
    return (/** @type {any} */ v) => (v == null || v === '' ? '' : `${prefix}${fmt(v)}`);
}

/**
 * Suffix every formatted value with a fixed string (e.g. units).
 * @param {string} suffix
 * @param {string | ((v: any) => string)} [inner=''] inner number format
 * @returns {(v: any) => string}
 */
export function suffix(suffix, inner = '') {
    const fmt = resolveFormat(inner);
    return (/** @type {any} */ v) => (v == null || v === '' ? '' : `${fmt(v)}${suffix}`);
}
