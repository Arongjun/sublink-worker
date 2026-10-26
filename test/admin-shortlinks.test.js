import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app/createApp.jsx';
import { MemoryKVAdapter } from '../src/adapters/kv/memoryKv.js';

const TOKEN = 'secret-token-123';
const auth = (t = TOKEN) => ({ Authorization: `Bearer ${t}` });

async function setup(adminToken = TOKEN) {
    const kv = new MemoryKVAdapter();
    await kv.put('abc1234', '?config=' + encodeURIComponent('https://sub.example.com/link?token=xyz\nvless://uuid@node.test:443#n1') + '&selectedRules=balanced');
    await kv.put('myCustom', '?config=' + encodeURIComponent('https://other.host/sub'));
    await kv.put('clash_AbCdEf12', JSON.stringify({ a: 1 }));
    await kv.put('singbox_Zz99Yy88', JSON.stringify({ b: 2 }));
    await kv.put('weirdkey', 'not-a-short-link');
    const app = createApp({ kv, logger: console, config: { adminToken } });
    return { app, kv };
}

describe('short-link admin', () => {
    it('is disabled (404) without ADMIN_TOKEN', async () => {
        const { app } = await setup(null);
        expect((await app.request('http://localhost/admin')).status).toBe(404);
        expect((await app.request('http://localhost/admin/api/links', { headers: auth() })).status).toBe(404);
    });

    it('serves the page with no-store, rejects wrong/missing token with 401', async () => {
        const { app } = await setup();
        const page = await app.request('http://localhost/admin');
        expect(page.status).toBe(200);
        expect(page.headers.get('cache-control')).toContain('no-store');
        expect(await page.text()).toContain('Arong Vpnlink');
        expect((await app.request('http://localhost/admin/api/links')).status).toBe(401);
        const bad = await app.request('http://localhost/admin/api/links', { headers: auth('wrong') });
        expect(bad.status).toBe(401);
        expect(bad.headers.get('cache-control')).toContain('no-store');
        expect((await app.request('http://localhost/admin/api/links?token=' + TOKEN)).status).toBe(401);
    });

    it('rate limits repeated failures', async () => {
        const { app } = await setup();
        const h = { ...auth('nope'), 'CF-Connecting-IP': '1.2.3.4' };
        for (let i = 0; i < 10; i++) await app.request('http://localhost/admin/api/links', { headers: h });
        expect((await app.request('http://localhost/admin/api/links', { headers: h })).status).toBe(429);
    });

    it('lists only short links with decoded params and links', async () => {
        const { app } = await setup();
        const res = await app.request('http://localhost/admin/api/links', { headers: auth() });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.items.map((i) => i.code).sort()).toEqual(['abc1234', 'myCustom']);
        const item = data.items.find((i) => i.code === 'abc1234');
        expect(item.links.clash).toBe('http://localhost/c/abc1234');
        expect(item.links.singbox).toBe('http://localhost/b/abc1234');
        expect(item.sources).toHaveLength(2);
        expect(item.hosts).toContain('sub.example.com');
        expect(item.params.selectedRules).toBe('balanced');
        expect(data.cursor).toBeNull();
    });

    it('paginates with a cursor', async () => {
        const kv = new MemoryKVAdapter();
        for (let i = 0; i < 250; i++) await kv.put(`k${String(i).padStart(4, '0')}`, '?config=x');
        const app = createApp({ kv, config: { adminToken: TOKEN } });
        const seen = new Set();
        let cursor = '';
        let guard = 0;
        do {
            const r = await (await app.request(`http://localhost/admin/api/links?limit=100${cursor ? '&cursor=' + cursor : ''}`, { headers: auth() })).json();
            r.items.forEach((i) => seen.add(i.code));
            cursor = r.cursor;
        } while (cursor && ++guard < 10);
        expect(seen.size).toBe(250);
    });

    it('searches by code, host and content', async () => {
        const { app } = await setup();
        const q = async (s) => (await (await app.request('http://localhost/admin/api/links?q=' + encodeURIComponent(s), { headers: auth() })).json()).items.map((i) => i.code);
        expect(await q('mycus')).toEqual(['myCustom']);
        expect(await q('sub.example.com')).toEqual(['abc1234']);
        expect(await q('node.test')).toEqual(['abc1234']);
        expect(await q('clash_')).toEqual([]);
    });

    it('gets and deletes a short link but never config records', async () => {
        const { app, kv } = await setup();
        expect((await app.request('http://localhost/admin/api/links/abc1234', { headers: auth() })).status).toBe(200);
        expect((await app.request('http://localhost/admin/api/links/clash_AbCdEf12', { headers: auth() })).status).toBe(404);
        expect((await app.request('http://localhost/admin/api/links/clash_AbCdEf12', { method: 'DELETE', headers: auth() })).status).toBe(404);
        expect(await kv.get('clash_AbCdEf12')).not.toBeNull();
        expect((await app.request('http://localhost/admin/api/links/weirdkey', { method: 'DELETE', headers: auth() })).status).toBe(404);
        const del = await app.request('http://localhost/admin/api/links/abc1234', { method: 'DELETE', headers: auth() });
        expect(del.status).toBe(200);
        expect(await kv.get('abc1234')).toBeNull();
        expect((await app.request('http://localhost/c/abc1234')).status).toBe(404);
    });

    it('batch deletes selected codes', async () => {
        const { app, kv } = await setup();
        const res = await app.request('http://localhost/admin/api/links/delete', {
            method: 'POST',
            headers: { ...auth(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ codes: ['abc1234', 'myCustom', 'singbox_Zz99Yy88'] })
        });
        expect((await res.json()).deleted.sort()).toEqual(['abc1234', 'myCustom']);
        expect(await kv.get('singbox_Zz99Yy88')).not.toBeNull();
    });
});
