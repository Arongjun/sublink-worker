/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */
import { ShortLinkAdmin } from './shortLinkAdmin.js';
import { safeEqual, FailureLimiter } from './auth.js';
import { AdminPage } from './AdminPage.jsx';

const NO_STORE = {
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer'
};

function clientId(c) {
    return c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
}

/**
 * Register /admin and /admin/api/* routes. Disabled (404) unless an admin token is configured.
 * @param {import('hono').Hono} app
 * @param {{ kv: any, config: { adminToken?: string } }} runtime
 */
export function registerAdminRoutes(app, runtime) {
    const token = runtime.config?.adminToken;
    const limiter = new FailureLimiter();
    const admin = runtime.kv ? new ShortLinkAdmin(runtime.kv) : null;

    app.use('/admin', async (c, next) => {
        if (!token) return c.notFound();
        await next();
        for (const [k, v] of Object.entries(NO_STORE)) c.header(k, v);
    });
    app.use('/admin/*', async (c, next) => {
        if (!token) return c.notFound();
        for (const [k, v] of Object.entries(NO_STORE)) c.header(k, v);
        if (c.req.path.startsWith('/admin/api/')) {
            const id = clientId(c);
            if (limiter.isBlocked(id)) {
                return c.json({ error: 'Too many failed attempts, try again later' }, 429);
            }
            const auth = c.req.header('Authorization') || '';
            const provided = auth.startsWith('Bearer ') ? auth.slice(7) : '';
            if (!provided || !(await safeEqual(provided, token))) {
                limiter.fail(id);
                return c.json({ error: 'Unauthorized' }, 401);
            }
            limiter.reset(id);
            if (!admin) return c.json({ error: 'KV store is not configured' }, 503);
            if (!admin.supportsList() && c.req.path === '/admin/api/links' && c.req.method === 'GET') {
                return c.json({ error: 'This storage backend does not support listing' }, 501);
            }
        }
        await next();
        for (const [k, v] of Object.entries(NO_STORE)) c.header(k, v);
    });

    app.get('/admin', (c) => c.html(<AdminPage />));

    app.get('/admin/api/links', async (c) => {
        const origin = new URL(c.req.url).origin;
        const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20', 10) || 20, 1), 100);
        const result = await admin.list({
            cursor: c.req.query('cursor') || undefined,
            query: c.req.query('q') || '',
            limit,
            origin
        });
        return c.json(result);
    });

    app.get('/admin/api/links/:code', async (c) => {
        const item = await admin.get(c.req.param('code'), new URL(c.req.url).origin);
        return item ? c.json(item) : c.json({ error: 'Not found' }, 404);
    });

    app.delete('/admin/api/links/:code', async (c) => {
        const ok = await admin.delete(c.req.param('code'));
        return ok ? c.json({ deleted: [c.req.param('code')] }) : c.json({ error: 'Not found' }, 404);
    });

    app.post('/admin/api/links/delete', async (c) => {
        let body;
        try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
        const codes = Array.isArray(body?.codes) ? body.codes.filter((x) => typeof x === 'string').slice(0, 200) : [];
        if (!codes.length) return c.json({ error: 'No codes' }, 400);
        const deleted = [];
        for (const code of codes) if (await admin.delete(code)) deleted.push(code);
        return c.json({ deleted });
    });
}
