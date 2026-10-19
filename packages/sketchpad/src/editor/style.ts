import { FONT_FAMILY } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import { countDots } from "../fills/dotCount";
import {
    DEFAULT_EVEN_COUNT,
    formatOmFill,
    parseOmFill,
    type DotSize,
    type OmFill,
} from "../fills/omFills";
import {
    changeSelection,
    isSticky,
    selectedElements,
    STICKY_COLORS,
    type Api,
    type StickyColor,
} from "./scene";
import type { ToolId } from "./tools";

/** The seven fills (UX spec 8.1): none, solid, lines, cross lines and the three dot fills */
export type FillPattern =
    | "none"
    | "solid"
    | "hachure"
    | "cross-hatch"
    | "om-dots"
    | "om-staggered"
    | "om-even";

export const STROKE_SWATCHES = [
    "#1e1e1e",
    "#e03131",
    "#1971c2",
    "#2f9e44",
    "#7950f2",
] as const;
export const FILL_SWATCHES = [
    "transparent",
    "#ffc9c9",
    "#a5d8ff",
    "#b2f2bb",
    "#ffec99",
] as const;

export const FONT_SIZES = { s: 16, m: 20, l: 28, xl: 36 } as const;
export type FontSizeKey = keyof typeof FONT_SIZES;
export const FONTS = {
    hand: FONT_FAMILY.Excalifont,
    sans: FONT_FAMILY.Nunito,
    mono: FONT_FAMILY["Comic Shanns"],
} as const;
export type FontKey = keyof typeof FONTS;

export type Arrowhead = "none" | "arrow" | "triangle" | "bar" | "circle";

const CLOSED = new Set(["rectangle", "diamond", "ellipse"]);
const ROUNDABLE = new Set(["rectangle", "diamond", "line", "arrow"]);
const LINEAR = new Set(["line", "arrow"]);

/** What the Properties panel shows: the selection's style, or the next element's */
export interface StyleView {
    /** Nothing to show (select or hand tool with no selection) */
    empty: boolean;
    selectionCount: number;
    strokeColor: string;
    backgroundColor: string;
    pattern: FillPattern;
    omFill: OmFill | null;
    strokeWidth: number;
    strokeStyle: "solid" | "dashed" | "dotted";
    roughness: number;
    roundness: "round" | "sharp";
    opacity: number;
    fontSize: number;
    fontFamily: number;
    textAlign: "left" | "center" | "right";
    startArrowhead: Arrowhead;
    endArrowhead: Arrowhead;
    sticky: StickyColor | null;
    /** Which sections apply */
    has: {
        fill: boolean;
        text: boolean;
        arrow: boolean;
        roundness: boolean;
        stroke: boolean;
    };
    /** Dots drawn by the selection's dot fills, or null when none has one */
    dots: number | null;
    locked: boolean;
}

export function patternOf(
    fillStyle: string,
    backgroundColor: string,
): FillPattern {
    if (backgroundColor === "transparent") return "none";
    const om = parseOmFill(fillStyle);
    if (om) return `om-${om.kind}` as FillPattern;
    if (fillStyle === "solid" || fillStyle === "cross-hatch") return fillStyle;
    return "hachure";
}

const toArrowhead = (a: string | null | undefined): Arrowhead =>
    a === "arrow" || a === "triangle" || a === "bar" || a === "circle"
        ? a
        : a === "dot"
          ? "circle"
          : "none";

const fromArrowhead = (a: Arrowhead) => (a === "none" ? null : a);

export function styleView(api: Api, tool: ToolId): StyleView {
    const st = api.getAppState();
    const sel = selectedElements(api, true);
    const own = sel.filter((e) => !(e.type === "text" && e.containerId));
    const first = own[0];
    const text = sel.find((e) => e.type === "text") as
        | (ExcalidrawElement & {
              fontSize: number;
              fontFamily: number;
              textAlign: string;
          })
        | undefined;
    const types = new Set<string>(own.map((e) => e.type));
    const toolType = tool === "sticky" ? "rectangle" : tool;
    if (own.length === 0) types.add(toolType);
    const empty =
        own.length === 0 &&
        ["selection", "hand", "eraser", "image"].includes(tool);
    let dots: number | null = null;
    for (const e of own) {
        const n = countDots(e as Parameters<typeof countDots>[0]);
        if (n !== null) dots = (dots ?? 0) + n;
    }
    const stickyEl = own.find(isSticky);
    const sticky = stickyEl
        ? (((stickyEl.customData as { color?: StickyColor })
              .color as StickyColor) ?? "yellow")
        : null;
    const fillStyle = (first?.fillStyle ?? st.currentItemFillStyle) as string;
    const backgroundColor =
        first?.backgroundColor ?? st.currentItemBackgroundColor;
    const has = {
        fill:
            [...types].some((t) => CLOSED.has(t)) ||
            own.some((e) => e.type === "line"),
        text: !!text || types.has("text") || tool === "sticky",
        arrow: types.has("arrow"),
        roundness: [...types].some((t) => ROUNDABLE.has(t)),
        stroke: !(own.length > 0 && own.every((e) => e.type === "image")),
    };
    const linear =
        first && LINEAR.has(first.type)
            ? (first as unknown as {
                  startArrowhead: string | null;
                  endArrowhead: string | null;
              })
            : null;
    return {
        empty,
        selectionCount: own.length,
        strokeColor: first?.strokeColor ?? st.currentItemStrokeColor,
        backgroundColor,
        pattern: patternOf(fillStyle, backgroundColor),
        omFill: parseOmFill(fillStyle),
        strokeWidth: first?.strokeWidth ?? st.currentItemStrokeWidth,
        strokeStyle: (first?.strokeStyle ??
            st.currentItemStrokeStyle) as StyleView["strokeStyle"],
        roughness: first?.roughness ?? st.currentItemRoughness,
        roundness: first
            ? first.roundness
                ? "round"
                : "sharp"
            : st.currentItemRoundness,
        opacity: first?.opacity ?? st.currentItemOpacity,
        fontSize: text?.fontSize ?? st.currentItemFontSize,
        fontFamily: text?.fontFamily ?? st.currentItemFontFamily,
        textAlign: (text?.textAlign ??
            st.currentItemTextAlign) as StyleView["textAlign"],
        startArrowhead: toArrowhead(
            linear ? linear.startArrowhead : st.currentItemStartArrowhead,
        ),
        endArrowhead: toArrowhead(
            linear ? linear.endArrowhead : st.currentItemEndArrowhead,
        ),
        sticky,
        has,
        dots,
        locked: own.length > 0 && own.every((e) => e.locked),
    };
}

/** A view's fingerprint, so the panel re-renders only when something it shows changes */
export const styleViewKey = (v: StyleView) => JSON.stringify(v);

type ElementChanges = Partial<ExcalidrawElement> & Record<string, unknown>;

/** Sets a plain element property on the selection and the matching style for new elements */
function setProp(
    api: Api,
    key: string,
    value: unknown,
    appKey: keyof AppState,
    appValue: unknown = value,
    options: Parameters<typeof changeSelection>[3] = {},
    applies: (el: ExcalidrawElement) => boolean = () => true,
) {
    changeSelection(
        api,
        (el) => (applies(el) ? ({ [key]: value } as ElementChanges) : null),
        { [appKey]: appValue } as Partial<AppState>,
        options,
    );
}

/**
 * Sets the stroke color. Dot fills drawn in the stroke's color follow it, so a red circle keeps
 * red dots (as in the mockups).
 */
export function setStrokeColor(api: Api, color: string) {
    const st = api.getAppState();
    const followBg = (stroke: string, bg: string, fillStyle: string) =>
        !!parseOmFill(fillStyle) && bg === stroke;
    changeSelection(
        api,
        (el) =>
            isSticky(el)
                ? null
                : ({
                      strokeColor: color,
                      ...(followBg(
                          el.strokeColor,
                          el.backgroundColor,
                          el.fillStyle as string,
                      )
                          ? { backgroundColor: color }
                          : {}),
                  } as ElementChanges),
        {
            currentItemStrokeColor: color,
            ...(followBg(
                st.currentItemStrokeColor,
                st.currentItemBackgroundColor,
                st.currentItemFillStyle as string,
            )
                ? { currentItemBackgroundColor: color }
                : {}),
        } as Partial<AppState>,
    );
}

export function setBackgroundColor(api: Api, color: string) {
    changeSelection(
        api,
        (el) => ({ backgroundColor: color }) as ElementChanges,
        { currentItemBackgroundColor: color } as Partial<AppState>,
    );
}

/** The fill style string for a pattern, keeping an element's dot settings */
export function fillStyleFor(
    pattern: FillPattern,
    current: string,
    pixelsPerStep: number,
): string {
    if (!pattern.startsWith("om-"))
        return pattern === "none" ? "solid" : pattern;
    const kind = pattern.slice(3) as OmFill["kind"];
    const was = parseOmFill(current);
    return formatOmFill({
        kind,
        spacing:
            kind === "even" ? undefined : (was?.spacing ?? 2 * pixelsPerStep),
        count: kind === "even" ? (was?.count ?? DEFAULT_EVEN_COUNT) : undefined,
        size: was?.size ?? "m",
    });
}

export function setPattern(
    api: Api,
    pattern: FillPattern,
    pixelsPerStep: number,
) {
    const st = api.getAppState();
    const colorFor = (bg: string, stroke: string) =>
        pattern === "none"
            ? "transparent"
            : bg !== "transparent"
              ? bg
              : pattern === "solid"
                ? "#a5d8ff"
                : stroke;
    const closed = (el: ExcalidrawElement) =>
        CLOSED.has(el.type) || el.type === "line" || el.type === "freedraw";
    changeSelection(
        api,
        (el) =>
            closed(el) && !isSticky(el)
                ? ({
                      backgroundColor: colorFor(
                          el.backgroundColor,
                          el.strokeColor,
                      ),
                      fillStyle:
                          pattern === "none"
                              ? el.fillStyle
                              : fillStyleFor(
                                    pattern,
                                    el.fillStyle,
                                    pixelsPerStep,
                                ),
                  } as ElementChanges)
                : null,
        {
            currentItemBackgroundColor: colorFor(
                st.currentItemBackgroundColor,
                st.currentItemStrokeColor,
            ),
            ...(pattern === "none"
                ? {}
                : {
                      currentItemFillStyle: fillStyleFor(
                          pattern,
                          st.currentItemFillStyle as string,
                          pixelsPerStep,
                      ),
                  }),
        } as Partial<AppState>,
    );
}

/** Changes the dot settings of the selection's dot fills and of new elements */
export function setDotFill(api: Api, change: (fill: OmFill) => OmFill) {
    const st = api.getAppState();
    const next = (fillStyle: string) => {
        const om = parseOmFill(fillStyle);
        return om ? formatOmFill(change(om)) : null;
    };
    changeSelection(
        api,
        (el) => {
            const fillStyle = next(el.fillStyle as string);
            return fillStyle ? ({ fillStyle } as ElementChanges) : null;
        },
        (next(st.currentItemFillStyle as string)
            ? { currentItemFillStyle: next(st.currentItemFillStyle as string) }
            : {}) as Partial<AppState>,
    );
}

export const setDotSize = (api: Api, size: DotSize) =>
    setDotFill(api, (f) => ({ ...f, size }));

export const setStrokeWidth = (api: Api, width: number) =>
    setProp(api, "strokeWidth", width, "currentItemStrokeWidth");

export const setStrokeStyle = (api: Api, style: StyleView["strokeStyle"]) =>
    setProp(api, "strokeStyle", style, "currentItemStrokeStyle");

export const setRoughness = (api: Api, roughness: number) =>
    setProp(
        api,
        "roughness",
        roughness,
        "currentItemRoughness",
        roughness,
        {},
        (el) => !isSticky(el),
    );

export function setRoundness(api: Api, round: "round" | "sharp") {
    changeSelection(
        api,
        (el) =>
            ROUNDABLE.has(el.type)
                ? ({
                      roundness:
                          round === "round"
                              ? { type: LINEAR.has(el.type) ? 2 : 3 }
                              : null,
                  } as ElementChanges)
                : null,
        { currentItemRoundness: round } as Partial<AppState>,
    );
}

export const setOpacity = (api: Api, opacity: number) =>
    setProp(api, "opacity", opacity, "currentItemOpacity", opacity, {
        withBoundText: true,
    });

export const setFontSize = (api: Api, size: number) =>
    setProp(
        api,
        "fontSize",
        size,
        "currentItemFontSize",
        size,
        { withBoundText: true, refreshText: true },
        (el) => el.type === "text",
    );

export const setFontFamily = (api: Api, family: number) =>
    setProp(
        api,
        "fontFamily",
        family,
        "currentItemFontFamily",
        family,
        { withBoundText: true, refreshText: true },
        (el) => el.type === "text",
    );

export const setTextAlign = (api: Api, align: StyleView["textAlign"]) =>
    setProp(
        api,
        "textAlign",
        align,
        "currentItemTextAlign",
        align,
        { withBoundText: true, refreshText: true },
        (el) => el.type === "text",
    );

export const setArrowhead = (api: Api, end: "start" | "end", head: Arrowhead) =>
    setProp(
        api,
        end === "start" ? "startArrowhead" : "endArrowhead",
        fromArrowhead(head),
        end === "start"
            ? "currentItemStartArrowhead"
            : "currentItemEndArrowhead",
        fromArrowhead(head),
        {},
        (el) => LINEAR.has(el.type),
    );

export function setStickyColor(api: Api, color: StickyColor) {
    const c = STICKY_COLORS[color];
    changeSelection(api, (el) =>
        isSticky(el)
            ? ({
                  backgroundColor: c.fill,
                  strokeColor: c.stroke,
                  customData: { ...(el.customData ?? {}), color },
              } as ElementChanges)
            : null,
    );
}

export function toggleLock(api: Api) {
    const sel = selectedElements(api, true);
    const lock = !sel.every((e) => e.locked);
    changeSelection(
        api,
        () => ({ locked: lock }) as ElementChanges,
        lock ? ({ selectedElementIds: {} } as Partial<AppState>) : {},
        { withBoundText: true },
    );
}
