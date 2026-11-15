// Types for gltf-validator (copied from archive/pre-convergence).
declare module "gltf-validator" {
    export interface ValidatorMessage {
        code: string;
        message: string;
        /** 0 error, 1 warning, 2 info, 3 hint. */
        severity: number;
        pointer?: string;
        offset?: number;
    }

    export interface ValidatorReport {
        issues: {
            numErrors: number;
            numWarnings: number;
            numInfos: number;
            numHints: number;
            messages: ValidatorMessage[];
            truncated: boolean;
        };
        info?: {
            version?: string;
            generator?: string;
            extensionsUsed?: string[];
            extensionsRequired?: string[];
            hasSkins?: boolean;
            totalTriangleCount?: number;
            maxInfluences?: number;
        };
    }

    export interface ValidationOptions {
        uri?: string;
        format?: "glb" | "gltf";
        externalResourceFunction?: (uri: string) => Promise<Uint8Array>;
        writeTimestamp?: boolean;
        maxIssues?: number;
        ignoredIssues?: string[];
        severityOverrides?: Record<string, number>;
    }

    export function validateBytes(
        data: Uint8Array,
        options?: ValidationOptions,
    ): Promise<ValidatorReport>;

    export function version(): string;
}
