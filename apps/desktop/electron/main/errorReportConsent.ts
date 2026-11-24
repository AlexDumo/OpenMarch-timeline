import type { ElectronMainOptions } from "@sentry/electron/main";

/**
 * Error reports (Sentry) follow the same yes/no as analytics: they leave the app only after the
 * person said yes (`optOutAnalytics` false). Unanswered counts as no, as it does for PostHog.
 * Development runs never send.
 */
export function errorReportsAllowedFor(
    nodeEnv: string | undefined,
    optOutAnalytics: unknown,
): boolean {
    return nodeEnv !== "development" && optOutAnalytics === false;
}

type TransportFactory = NonNullable<ElectronMainOptions["transport"]>;

/**
 * `makeTransport` with every send held back while `allowed()` is false. Sentry stays enabled so it
 * still catches crashes, but nothing (events, sessions or crash dumps) leaves without consent.
 * `allowed` is read at each send, so an answer given after launch applies at once.
 */
export function consentGatedTransport(
    makeTransport: TransportFactory,
    allowed: () => boolean,
): TransportFactory {
    return (options) => {
        const transport = makeTransport(options);
        return {
            send: (envelope) =>
                allowed() ? transport.send(envelope) : Promise.resolve({}),
            flush: (timeout) => transport.flush(timeout),
        };
    };
}
