/**
 * How a refused renderer SQL call (`sql:proxy`, `unsafeSql:proxy`) crosses
 * IPC while an open suspends the renderer's SQL (P9.3, P9.9).
 *
 * A handler that throws makes Electron log "Error occurred in handler for
 * ..." on every call, and a page still showing the previous file sends a
 * dozen of these during one open. So the handler returns this marker instead,
 * and the preload turns it back into a rejected promise with the same
 * message: the renderer sees the same rejection as before, without the log.
 * No Electron import, so the preload and the main process can share it.
 */

/** The marker's key. Never a column name, so it can't be a real result. */
export const SQL_PROXY_REFUSED = "__openmarchSqlProxyRefused" as const;

export interface SqlProxyRefusal {
    [SQL_PROXY_REFUSED]: true;
    message: string;
}

export function sqlProxyRefusal(message: string): SqlProxyRefusal {
    return { [SQL_PROXY_REFUSED]: true, message };
}

export function isSqlProxyRefusal(value: unknown): value is SqlProxyRefusal {
    return (
        typeof value === "object" &&
        value !== null &&
        (value as Record<string, unknown>)[SQL_PROXY_REFUSED] === true
    );
}

/** For the preload: the handler's result, or a rejection when it was refused. */
export function unwrapSqlProxyResult<T>(result: T | SqlProxyRefusal): T {
    if (isSqlProxyRefusal(result)) throw new Error(result.message);
    return result;
}
