import type { ValidationError, ValidationResult } from "@openmarch/core";

/**
 * A rejected timeline write (spec section 6). `code` is the spec's error code: `E-S1`, `E-P1`,
 * `E-D2` and `E-N2` come from the core validators and are thrown before the database is touched;
 * `E-A1`, `E-A2`, `E-A3`, `E-T1`, `E-T3`, `E-T4`, `E-T5` and `E-T6` are the invariants the
 * database enforces. `E-ARGS` marks a call the write path refuses before writing (a missing row,
 * a slot count that needs destinations, and so on), and `E-DB` any other database rejection.
 */
export class TimelineWriteError extends Error {
    readonly code: string;
    readonly details: ValidationError[];

    constructor(
        code: string,
        message: string,
        details: ValidationError[] = [],
        options?: { cause?: unknown },
    ) {
        super(
            message.startsWith("E-") ? message : `${code}: ${message}`,
            options,
        );
        this.name = "TimelineWriteError";
        this.code = code;
        this.details = details;
    }
}

/** Throws a `TimelineWriteError` carrying the validator's code when `result` is not ok. */
export function assertValid(result: ValidationResult, what: string): void {
    if (result.ok) return;
    const first = result.errors[0]!;
    const summary = result.errors
        .map((e) => (e.path ? `${e.path}: ${e.message}` : e.message))
        .join("; ");
    throw new TimelineWriteError(
        first.code,
        `${what} is invalid (${summary})`,
        result.errors,
    );
}

/** Throws an `E-ARGS` error for a call the write path refuses before writing. */
export function refuse(message: string): never {
    throw new TimelineWriteError("E-ARGS", message);
}

/** A spec error code in a database error message, e.g. "E-T3/E-T4: ..." or "E-A1: ...". */
const DB_CODE = /\bE-[A-Z]\d\b/;

/**
 * Runs a database write, and turns the invariant triggers' rejections (whose messages start with
 * the spec's error code) into `TimelineWriteError`s. Any other database error becomes `E-DB` with
 * the SQLite message; a `TimelineWriteError` passes through unchanged.
 */
export async function mapDbErrors<T>(write: () => Promise<T>): Promise<T> {
    try {
        return await write();
    } catch (error) {
        if (error instanceof TimelineWriteError) throw error;
        const messages: string[] = [];
        for (let e: unknown = error; e instanceof Error; e = e.cause)
            messages.push(e.message);
        const code = DB_CODE.exec(messages.join("\n"))?.[0];
        const detail =
            messages.find((m) => DB_CODE.test(m)) ??
            messages[messages.length - 1] ??
            "database error";
        throw new TimelineWriteError(code ?? "E-DB", detail, [], {
            cause: error,
        });
    }
}
