import type { ReactNode } from "react";

export function Field({
    label,
    children,
    help,
}: {
    label: string;
    children: ReactNode;
    help?: ReactNode;
}) {
    return (
        <div className="flex flex-col gap-6">
            <p className="text-sub text-text/60">{label}</p>
            {children}
            {help}
        </div>
    );
}

export const Help = ({
    children,
    testId,
}: {
    children: ReactNode;
    testId?: string;
}) => (
    <p className="text-sub text-text/60" data-testid={testId}>
        {children}
    </p>
);
