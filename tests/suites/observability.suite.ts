import { describe, expect, it, vi } from 'vitest';
import { logD1RouteSummary, summarizeD1Results } from '../../src/utils/observability';

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

    it('logs route-level metrics without query text or user data', () => {
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
            const payload = JSON.parse(String(log.mock.calls[0][0]));
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
            expect(JSON.stringify(payload)).not.toContain('query');
            expect(JSON.stringify(payload)).not.toContain('bookmark');
        } finally {
            log.mockRestore();
        }
    });
});
