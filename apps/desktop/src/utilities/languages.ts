// cspell:words Bienvenido Bienvenue vindo

/** A language the app is translated into. */
export interface AppLanguage {
    /** Tolgee language code, also what `setLanguage` saves. */
    code: string;
    /** The language's name in that language. */
    name: string;
    /** "Welcome" in that language, for the welcome flow's first page. */
    greeting: string;
}

/** The app's languages, in the order Settings and the welcome flow list them. */
export const APP_LANGUAGES: readonly AppLanguage[] = [
    { code: "en", name: "English", greeting: "Welcome" },
    { code: "es", name: "Español", greeting: "Bienvenido" },
    { code: "fr", name: "Français", greeting: "Bienvenue" },
    { code: "pt-BR", name: "Português (Brasil)", greeting: "Bem-vindo" },
    { code: "ja", name: "日本語", greeting: "ようこそ" },
];

/**
 * The app language that best matches the browser's or system's preferred
 * languages (`navigator.languages`): an exact match first, then the same
 * base language ("pt-PT" picks "pt-BR"). Null when none match.
 */
export function matchAppLanguage(
    preferred: readonly string[],
    languages: readonly AppLanguage[] = APP_LANGUAGES,
): string | null {
    for (const tag of preferred) {
        const lower = tag.toLowerCase();
        const exact = languages.find((l) => l.code.toLowerCase() === lower);
        if (exact) return exact.code;
        const base = lower.split("-")[0];
        const sameBase = languages.find(
            (l) => l.code.toLowerCase().split("-")[0] === base,
        );
        if (sameBase) return sameBase.code;
    }
    return null;
}
