type D1MetaLike = {
    rows_read?: number;
    rows_written?: number;
    duration?: number;
    timings?: {
        sql_duration_ms?: number;
    };
    total_attempts?: number;
};

type D1ResultLike = {
    meta?: D1MetaLike;
};

export type D1Summary = {
    measured_queries: number;
    rows_read: number;
    rows_written: number;
    sql_duration_ms: number;
    max_attempts: number;
};

function finiteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function roundMillis(value: number): number {
    return Math.round(value * 1000) / 1000;
}

/**
 * Aggregate only metadata Cloudflare exposes on D1Result-producing calls.
 * `first()` calls do not expose metadata, so `measured_queries` deliberately
 * describes the measured subset rather than claiming to be the route's total
 * D1 query count.
 */
export function summarizeD1Results(results: D1ResultLike[]): D1Summary | null {
    const metas = results
        .map((result) => result.meta)
        .filter((meta): meta is D1MetaLike => Boolean(meta));

    const hasD1Metrics = metas.some((meta) => (
        finiteNumber(meta.rows_read) !== null
        || finiteNumber(meta.rows_written) !== null
        || finiteNumber(meta.timings?.sql_duration_ms) !== null
        || finiteNumber(meta.duration) !== null
        || finiteNumber(meta.total_attempts) !== null
    ));
    if (!hasD1Metrics) return null;

    let rowsRead = 0;
    let rowsWritten = 0;
    let sqlDurationMs = 0;
    let maxAttempts = 0;

    for (const meta of metas) {
        rowsRead += finiteNumber(meta.rows_read) ?? 0;
        rowsWritten += finiteNumber(meta.rows_written) ?? 0;
        sqlDurationMs += finiteNumber(meta.timings?.sql_duration_ms)
            ?? finiteNumber(meta.duration)
            ?? 0;
        maxAttempts = Math.max(maxAttempts, finiteNumber(meta.total_attempts) ?? 0);
    }

    return {
        measured_queries: metas.length,
        rows_read: rowsRead,
        rows_written: rowsWritten,
        sql_duration_ms: roundMillis(sqlDurationMs),
        max_attempts: maxAttempts,
    };
}

export function logD1RouteSummary(
    route: '/api/data' | '/api/search',
    results: D1ResultLike[],
    rowsReturned: number,
    mode?: string,
): void {
    const summary = summarizeD1Results(results);
    // Unit-test mocks intentionally omit D1 runtime metrics. Avoid emitting a
    // misleading all-zero production-style record in that environment.
    if (!summary) return;

    // Log the object itself so Workers Logs extracts/indexes each field instead
    // of storing one opaque JSON string under `message`.
    console.log({
        event: 'd1.route_summary',
        route,
        ...(mode ? { mode } : {}),
        ...summary,
        rows_returned: rowsReturned,
    });
}

export function logRequestError(
    level: 'warn' | 'error',
    event: string,
    request: { method: string; url: string; ray?: string },
    fields: Record<string, unknown>,
): void {
    // Deliberately reduce the request URL to pathname. Query strings can hold
    // search terms and other user data; Cloudflare invocation logs separately
    // apply `redact_query_string = true` at the platform level.
    const payload = {
        event,
        method: request.method,
        path: new URL(request.url).pathname,
        ...(request.ray ? { cf_ray: request.ray } : {}),
        ...fields,
    };
    console[level](payload);
}
