const encoder = new TextEncoder();

async function digest(text) {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

// Constant-time comparison: hash both sides to fixed length, then XOR every byte.
export async function safeEqual(a, b) {
    const [x, y] = await Promise.all([digest(String(a)), digest(String(b))]);
    let diff = 0;
    for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
    return diff === 0;
}

// Cheap per-isolate brute-force friction: lock a client after too many failures.
export class FailureLimiter {
    constructor({ max = 10, windowMs = 10 * 60 * 1000 } = {}) {
        this.max = max;
        this.windowMs = windowMs;
        this.entries = new Map();
    }

    entry(id) {
        const now = Date.now();
        const e = this.entries.get(id);
        if (!e || now - e.start > this.windowMs) {
            const fresh = { start: now, count: 0 };
            this.entries.set(id, fresh);
            if (this.entries.size > 5000) this.entries.clear();
            return fresh;
        }
        return e;
    }

    isBlocked(id) {
        return this.entry(id).count >= this.max;
    }

    fail(id) {
        this.entry(id).count++;
    }

    reset(id) {
        this.entries.delete(id);
    }
}
