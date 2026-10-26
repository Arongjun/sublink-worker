// Short-link admin service. Kept in its own module so upstream merges stay easy.
// Short links are stored as `<code>` -> `?<query string>` (see ShortLinkService).
// Config records are stored as `<type>_<8 chars>` -> JSON and are never touched here.

export const CONFIG_KEY_PATTERN = /^[a-z]+_[A-Za-z0-9]{8}$/;
export const SHORT_PREFIXES = { surge: 's', singbox: 'b', clash: 'c', xray: 'x' };

export function isShortLinkValue(value) {
    return typeof value === 'string' && value.startsWith('?');
}

export function isCandidateKey(key) {
    return typeof key === 'string' && key.length > 0 && !CONFIG_KEY_PATTERN.test(key);
}

export function decodeShortLink(code, value, origin = '') {
    const params = {};
    for (const [k, v] of new URLSearchParams(value)) {
        params[k] = k in params ? [].concat(params[k], v) : v;
    }
    const configText = typeof params.config === 'string' ? params.config : '';
    const sources = configText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const hosts = [...new Set(sources.map(hostOf).filter(Boolean))];
    const links = {};
    for (const [target, prefix] of Object.entries(SHORT_PREFIXES)) {
        links[target] = `${origin}/${prefix}/${code}`;
    }
    const { config, ...otherParams } = params;
    return { code, links, sources, hosts, params: otherParams, raw: value };
}

function hostOf(source) {
    try {
        const url = new URL(source);
        return url.hostname || null;
    } catch {
        return null;
    }
}

export class ShortLinkAdmin {
    constructor(kv) {
        this.kv = kv;
    }

    supportsList() {
        return !!this.kv && typeof this.kv.list === 'function';
    }

    async get(code, origin) {
        if (!isCandidateKey(code)) return null;
        const value = await this.kv.get(code);
        return isShortLinkValue(value) ? decodeShortLink(code, value, origin) : null;
    }

    /**
     * Scan KV pages and return short links. When `query` is set, only matches are returned.
     * Stops after `limit` items or `maxScan` keys; returns a cursor to continue.
     */
    async list({ cursor, limit = 20, query = '', origin = '', maxScan = 1000 } = {}) {
        const items = [];
        const q = query.trim().toLowerCase();
        let scanned = 0;
        let next = cursor || undefined;
        let complete = false;
        while (items.length < limit && scanned < maxScan) {
            const page = await this.kv.list({ cursor: next, limit: Math.min(1000, Math.max(limit, 100)) });
            const keys = page.keys.map((k) => (typeof k === 'string' ? k : k.name)).filter(isCandidateKey);
            const values = await Promise.all(keys.map((k) => this.kv.get(k)));
            keys.forEach((key, i) => {
                if (!isShortLinkValue(values[i])) return;
                const item = decodeShortLink(key, values[i], origin);
                if (!q || matches(item, q)) items.push(item);
            });
            scanned += page.keys.length;
            if (page.list_complete || !page.cursor) {
                complete = true;
                next = undefined;
                break;
            }
            next = page.cursor;
        }
        return { items, cursor: complete ? null : next, scanned };
    }

    async delete(code) {
        if (!isCandidateKey(code)) return false;
        const value = await this.kv.get(code);
        if (!isShortLinkValue(value)) return false;
        await this.kv.delete(code);
        return true;
    }
}

function matches(item, q) {
    if (item.code.toLowerCase().includes(q)) return true;
    let decoded = item.raw;
    try { decoded = decodeURIComponent(item.raw); } catch { /* keep raw */ }
    return decoded.toLowerCase().includes(q) || item.hosts.some((h) => h.toLowerCase().includes(q));
}
