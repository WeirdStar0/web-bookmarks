import { describe, expect, it, vi } from 'vitest';
import { logD1RouteSummary, logRequestError, summarizeD1Results } from '../../src/utils/observability';

describe('observability helpers', () => {
    it('aggregates only D1 metadata that is actually measurable', () => {
        expect(summarizeD1Results([
            {
                meta: {
                    rows_read: 12,
                    rows_written: 0,
                    timings: { sql_duration_ms: 0.1254 },
                    total_attempts: 1,
                },
            },
            {
                meta: {
                    rows_read: 30,
                    rows_written: 2,
                    duration: 0.3336,
                    total_attempts: 2,
                },
            },
        ])).toEqual({
            measured_queries: 2,
            rows_read: 42,
            rows_written: 2,
            sql_duration_ms: 0.459,
            max_attempts: 2,
        });
    });

    it('returns null when the runtime provides no D1 metrics', () => {
        expect(summarizeD1Results([{ meta: {} }, {}])).toBeNull();
    });

    it('logs indexable route-level fields without query text or user data', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        try {
            logD1RouteSummary('/api/search', [{
                meta: {
                    rows_read: 9,
                    rows_written: 0,
                    duration: 0.25,
                    total_attempts: 1,
                },
            }], 3);

            expect(log).toHaveBeenCalledTimes(1);
            const payload = log.mock.calls[0][0];
            expect(payload).toEqual({
                event: 'd1.route_summary',
                route: '/api/search',
                measured_queries: 1,
                rows_read: 9,
                rows_written: 0,
                sql_duration_ms: 0.25,
                max_attempts: 1,
                rows_returned: 3,
            });
            expect(typeof payload).toBe('object');
            expect(JSON.stringify(payload)).not.toContain('search term');
            expect(JSON.stringify(payload)).not.toContain('bookmark title');
        } finally {
            log.mockRestore();
        }
    });

    it('strips query strings from structured error logs', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            logRequestError('warn', 'request.rejected', {
                method: 'GET',
                url: 'https://example.com/api/search?q=private-search-term&folderId=42',
                ray: 'ray-123',
            }, {
                status: 400,
                message: 'Rejected',
            });

            expect(warn).toHaveBeenCalledTimes(1);
            const payload = warn.mock.calls[0][0];
            expect(payload).toEqual({
                event: 'request.rejected',
                method: 'GET',
                path: '/api/search',
                cf_ray: 'ray-123',
                status: 400,
                message: 'Rejected',
            });
            expect(JSON.stringify(payload)).not.toContain('private-search-term');
            expect(JSON.stringify(payload)).not.toContain('folderId');
        } finally {
            warn.mockRestore();
        }
    });
});
