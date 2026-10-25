import { Fragment } from "react";
import {
    ArrowsHorizontalIcon,
    ArrowsVerticalIcon,
} from "@phosphor-icons/react";
import type { ParamGlyph } from "../tool/toolKind";

/**
 * The shape UI's direction marks, ↔ (across) and ↕ (deep), drawn as Phosphor icons: as text a
 * platform may draw them as color emoji (owner bug on #417). Readouts keep the marks in their
 * strings; anything showing one goes through here, or `textPresentation` where only text fits.
 */
const ICONS: Record<
    ParamGlyph,
    { Icon: typeof ArrowsHorizontalIcon; name: string }
> = {
    "↔": { Icon: ArrowsHorizontalIcon, name: "across" },
    "↕": { Icon: ArrowsVerticalIcon, name: "deep" },
};

/** `text` with each direction mark drawn as its icon, at `size` px */
export function GlyphText({
    text,
    size = 14,
}: {
    text: string;
    size?: number;
}) {
    return (
        <>
            {text.split(/([↔↕])/).map((part, i) => {
                const glyph = ICONS[part as ParamGlyph];
                if (!glyph) return part && <Fragment key={i}>{part}</Fragment>;
                const { Icon, name } = glyph;
                return (
                    <Icon
                        key={i}
                        size={size}
                        weight="bold"
                        aria-hidden
                        data-glyph={name}
                        className="inline-block shrink-0 align-[-0.125em]"
                    />
                );
            })}
        </>
    );
}

/** For text only (an SVG `<text>`): asks for text, not emoji, presentation after each mark */
export function textPresentation(text: string): string {
    return text.replace(/\p{Extended_Pictographic}(?!︎)/gu, "$&︎");
}
