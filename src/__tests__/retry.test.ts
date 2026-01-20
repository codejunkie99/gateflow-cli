/**
 * Retry-After parsing tests
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { parseRetryAfterFromError } from '../resilience/retry.js';

describe('parseRetryAfterFromError', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('parses numeric retry-after header seconds (including leading zeros)', () => {
        const error = { headers: { 'retry-after': '020' } };
        expect(parseRetryAfterFromError(error)).toBe(20000);
    });

    it('parses http-date retry-after header', () => {
        vi.useFakeTimers();
        const now = new Date('2025-01-01T00:00:00Z');
        vi.setSystemTime(now);
        const headerDate = new Date(now.getTime() + 120000).toUTCString();
        const error = { headers: { 'Retry-After': headerDate } };
        expect(parseRetryAfterFromError(error)).toBe(120000);
    });

    it('parses direct retryAfter numeric as seconds', () => {
        const error = { retryAfter: 5 };
        expect(parseRetryAfterFromError(error)).toBe(5000);
    });
});
