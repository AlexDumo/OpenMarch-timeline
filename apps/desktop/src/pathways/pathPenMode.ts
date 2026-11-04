import type {
    FieldCursor,
    FieldMode,
    FieldModeDrawing,
    FieldPointer,
} from "@/field/editor/fieldEditor";
import { CLICK_SLOP } from "@/field/editor/fieldEditor";
import { rolesOf, type Roles } from "@/input/modifierRoles";
import type { HonoredRoles } from "@/input/gestureChipStore";
import { currentShapeField } from "@/shapes/field/shapeField";
import { openHandleMenu } from "@/shapes/field/handleMenu";
import {
    asCursor,
    drillTerms,
    handleDrawing,
} from "@/shapes/field/fieldModeBase";
import { holdGesture, type HeldGesture } from "@/shapes/field/heldGesture";
import { edgeGuides } from "@/shapes/frame/edgeGuides";
import { lineCoordinate } from "@/shapes/field/lineCoordinate";
import { toolEnvFor } from "@/shapes/tool/toolEnv";
import type { ToolEnv } from "@/shapes/tool/toolKind";
import type { XY } from "@/shapes/types";
import {
    PATH_MENU,
    clickPathHandle,
    cornerOf,
    dragPathHandle,
    landCorner,
    legOf,
    pathHandleAt,
    pathHandles,
    pathHonors,
    pathPoints,
    type PathCorner,
    type PathShape,
} from "./pathEdit";
import {
    addCorner,
    cancelDrag,
    commitCorners,
    deleteCorner,
    dragCorners,
    finishDrawing,
    insertCorner,
    removeLastCorner,
    selectCorner,
    setPointer,
    shapeOf,
    usePathPenStore,
    type PathSession,
} from "./pathPenStore";

/** The env for the roles held, as the shape tool's (half steps, the field's lines, the Snap toggle) */
const envOf = (roles?: Roles): ToolEnv | null => {
    const field = currentShapeField();
    return field ? toolEnvFor(field, roles) : null;
};

/** What a drag on the path reads, for the held-roles chip, as a shape drag names it */
const honored = (shape: PathShape, key: string | null): HonoredRoles => ({
    context: "shape",
    fine: "fine",
    ...(key === null ? {} : pathHonors(shape, key)),
    snaps: true,
});

/** The handle-menu `kind` the path's menus go through, as a shape's do */
const MENU_KIND = { menu: PATH_MENU };

/**
 * The path pen on the field (pathways step 1), working as the shape tool's Line does:
 *
 * - Drawing: every primary press is a click of the next corner, landed on its release (on the
 *   half-step grid or a field line; off the grid with fine, at 45° from the last with constrain).
 *   A double-click, a click on the last corner or on the end spot, or Enter finishes; a
 *   right-click, Backspace or undo takes the last corner back; Escape cancels.
 * - Open: the path takes only presses on its handles, so the marchers stay selectable. A click on
 *   a corner selects it; a drag moves it (fine off the grid, constrain keeping its direction),
 *   saved on release as one undo step; a click on a leg's midpoint adds a corner there, and a drag
 *   adds one and moves it. A right-click opens a corner's or a leg's menu.
 *
 * The held-roles chip names what a drag reads, from the press, as it does for a shape's handles.
 */
class PathPenMode implements FieldMode {
    private held: {
        start: FieldPointer;
        /** The handle pressed on the open path, or null (drawing, or a miss) */
        key: string | null;
        base: PathShape;
        before: readonly PathCorner[];
        moved: boolean;
        /** Where the pointer is, for the chip */
        screen: XY;
        keys: HeldGesture<FieldPointer>;
    } | null = null;
    private listeners = new Set<() => void>();

    constructor() {
        usePathPenStore.subscribe(() => {
            for (const l of this.listeners) l();
        });
    }

    private get session() {
        return usePathPenStore.getState().session;
    }

    get ownsSelectionBox() {
        return this.session?.phase === "drawing";
    }
    get locksSelection() {
        return this.session?.phase === "drawing";
    }
    get blocksFieldMenu() {
        return this.session?.phase === "drawing";
    }
    get gesture() {
        return {
            kind: "path" as const,
            always: this.session?.phase === "drawing",
        };
    }

    private handleAt(s: PathSession, pointer: Pick<FieldPointer, "field">) {
        const env = envOf();
        return env ? pathHandleAt(shapeOf(s), pointer.field, env) : null;
    }

    claims(pointer: FieldPointer): boolean {
        const s = this.session;
        if (!s || pointer.button !== 0) return false;
        if (s.phase === "drawing") return true;
        if (usePathPenStore.getState().saving) return false;
        return this.handleAt(s, pointer) !== null;
    }

    press(pointer: FieldPointer, { isMac }: { isMac: boolean }): void {
        const s = this.session;
        if (!s) return;
        this.endHeld();
        const base = shapeOf(s);
        const key =
            s.phase === "open"
                ? (this.handleAt(s, pointer)?.key ?? null)
                : null;
        const keys = holdGesture<FieldPointer>(
            pointer,
            (at, roles) => this.follow(at, roles),
            [],
            isMac,
            {
                honored: honored(base, key),
                screen: () => this.held?.screen ?? pointer.screen,
            },
        );
        this.held = {
            start: pointer,
            screen: pointer.screen,
            key,
            base,
            before: s.corners,
            moved: false,
            keys,
        };
        if (s.phase === "drawing") this.preview(pointer, keys.roles());
    }

    private endHeld() {
        this.held?.keys.end();
        this.held = null;
    }

    /** While drawing, the next corner where a click now would put it */
    private preview(pointer: Pick<FieldPointer, "field">, roles: Roles) {
        const s = this.session;
        const env = envOf(roles);
        if (!s || s.phase !== "drawing" || !env) return;
        setPointer(landCorner(shapeOf(s), pointer.field, env));
    }

    /** The pointer at `pointer` with `roles`: the drag, or the preview, as they are now */
    private follow(pointer: FieldPointer, roles: Roles) {
        const p = this.held;
        const s = this.session;
        if (!p || !s) return;
        if (s.phase === "drawing") {
            this.preview(pointer, roles);
            return;
        }
        if (p.key === null) return;
        const env = envOf(roles);
        if (!env) return;
        const corner = cornerOf(p.base, p.key);
        dragCorners(
            dragPathHandle(p.base, p.key, pointer.field, env),
            corner >= 0 ? corner : legOf(p.base, p.key),
        );
    }

    move(pointer: FieldPointer): void {
        const p = this.held;
        if (!p) {
            if (this.session?.phase === "drawing")
                this.preview(pointer, rolesOf(pointer, "shape"));
            return;
        }
        p.screen = pointer.screen;
        p.moved ||=
            Math.hypot(
                pointer.screen.x - p.start.screen.x,
                pointer.screen.y - p.start.screen.y,
            ) >= CLICK_SLOP;
        const roles = p.keys.move(pointer, p.moved ? pointer : null);
        if (this.session?.phase === "drawing" || p.moved)
            this.follow(pointer, roles);
    }

    release(
        pointer: FieldPointer,
        click: { double: boolean; ownFirst: boolean } | null,
    ): void {
        const p = this.held;
        const roles = p?.keys.roles();
        this.endHeld();
        const s = this.session;
        if (!p || !s) return;
        if (s.phase === "drawing") {
            this.releaseDrawing(s, pointer, click, roles);
            return;
        }
        if (p.key === null) return;
        if (p.moved) {
            // Moved past the slop with nothing dragged (no field yet): nothing to save
            if (s.dragging === null) return;
            // A midpoint dragged adds its corner, which stays unselected; a corner dragged keeps
            // the selection only if it was that corner
            const corner = cornerOf(p.base, p.key);
            const keep = corner >= 0 && p.key === s.selected;
            void commitCorners(
                usePathPenStore.getState().session?.corners ?? p.before,
                p.before,
                keep ? s.selected : null,
            );
            return;
        }
        // A click: a midpoint adds a corner there; a corner is selected (its double-click turns it
        // smooth on a Line, which waits for curves)
        const added = clickPathHandle(p.base, p.key);
        if (added) {
            void commitCorners(added, p.before, null);
            return;
        }
        if (cornerOf(p.base, p.key) >= 0) selectCorner(p.key);
    }

    private releaseDrawing(
        s: PathSession,
        pointer: FieldPointer,
        click: { double: boolean } | null,
        roles: Roles | undefined,
    ) {
        const env = envOf(roles);
        if (!env) return;
        // The double-click's second click finishes, as a Line's does
        if (click?.double) {
            void finishDrawing();
            return;
        }
        const points = pathPoints(shapeOf(s));
        const last = points[points.length - 2]!;
        const end = points[points.length - 1]!;
        const near = (q: XY) =>
            Math.hypot(q.x - pointer.field.x, q.y - pointer.field.y) <=
            env.hitRadius;
        // On the last corner (a Line's last point), or on the end spot the path goes to
        if ((s.corners.length > 0 && near(last)) || near(end)) {
            void finishDrawing();
            return;
        }
        const at = landCorner(shapeOf(s), pointer.field, env);
        // Landed on the last corner: the same as clicking it
        const prev = s.corners.at(-1)?.at;
        if (prev && prev.x === at.x && prev.y === at.y) {
            void finishDrawing();
            return;
        }
        addCorner(at);
        setPointer(at);
    }

    cancel(): void {
        const p = this.held;
        this.endHeld();
        if (p?.moved && this.session?.phase === "open") cancelDrag(p.before);
    }

    cursorAt(pointer: FieldPointer): FieldCursor | null {
        const s = this.session;
        if (!s) return null;
        // Between clicks the next leg follows the pointer with the roles its keys hold, so it
        // lands where a click would, as a Line's does
        if (s.phase === "drawing") {
            this.preview(pointer, rolesOf(pointer, "shape"));
            return "crosshair";
        }
        const handle = this.handleAt(s, pointer);
        return handle ? asCursor(handle.cursor) : null;
    }

    leave(): void {
        if (this.session?.phase === "drawing") setPointer(null);
    }

    /**
     * While drawing, a right-click (a Mac's Ctrl-click, a long press) takes the last corner back,
     * as it does a Line's last point. On the open path, a corner's or a leg's menu.
     */
    openMenu(pointer: FieldPointer): boolean {
        const s = this.session;
        if (!s) return false;
        if (s.phase === "drawing") return removeLastCorner();
        const handle = this.handleAt(s, pointer);
        return openHandleMenu(
            MENU_KIND,
            shapeOf(s),
            1,
            handle ? { type: "handle", key: handle.key } : null,
            pointer.screen,
            (key, value) => {
                const now = usePathPenStore.getState().session;
                if (!now || now.phase !== "open") return null;
                const shape = shapeOf(now);
                const corner = cornerOf(shape, key);
                const leg = legOf(shape, key);
                if (value === "delete" && corner >= 0)
                    void deleteCorner(corner);
                else if (value === "add" && leg >= 0) void insertCorner(leg);
                // The menu closes: its entries do one thing each
                return null;
            },
        );
    }

    drawing(): FieldModeDrawing | null {
        return drawingOf(this.session);
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
}

let last: { session: PathSession | null; drawing: FieldModeDrawing | null } = {
    session: null,
    drawing: null,
};

/**
 * What the pen draws: the path from where the marcher starts (its ghost) through the corners to
 * its end spot, its handles as a Line's are drawn (squares on the corners, the selected one
 * filled, small round ones mid-leg), and while drawing a leg to where the next corner would land,
 * with where that is in drill terms. While the pointer lands a corner on one of the field's lines,
 * a guide along it, named as the coordinate sheet writes it, as for a Line's points. Worked out
 * once per session state: the overlay reads it as a snapshot.
 */
export function drawingOf(
    session: PathSession | null,
): FieldModeDrawing | null {
    if (session === last.session) return last.drawing;
    let drawing: FieldModeDrawing | null = null;
    if (session) {
        const { target, pointer, selected } = session;
        const drawingNow = session.phase === "drawing";
        const shape = shapeOf(session);
        const middle = session.corners.map((c) => c.at);
        const outline = [
            target.from,
            ...middle,
            ...(drawingNow && pointer ? [pointer] : []),
            target.to,
        ];
        const handles = drawingNow
            ? { handles: middle, addHandles: [], selectedHandles: [] }
            : handleDrawing(
                  { handles: () => pathHandles(shape) },
                  shape,
                  1,
                  selected,
              );
        // The point being placed or dragged: guides where it's on a field line, and where it is
        const moving = drawingNow
            ? pointer
            : session.dragging === null
              ? null
              : (middle[session.dragging] ?? null);
        const tipText = moving ? drillTerms(moving) : null;
        drawing = {
            outline,
            openOutline: true,
            stage: drawingNow ? "drawing" : "open",
            spots: [target.to],
            walks: [],
            ...handles,
            rings: [target.from],
            ringIds: [target.marcherId],
            ...guidesFor(moving ? [moving] : [], outline),
            ...(tipText && moving
                ? { tip: { at: moving, text: tipText } }
                : {}),
        };
    }
    last = { session, drawing };
    return drawing;
}

/** Guides along the field's lines that `points` lie on, as a shape's are drawn while it's edited */
function guidesFor(
    points: readonly XY[],
    outline: readonly XY[],
): Pick<FieldModeDrawing, "guides" | "guideEdges" | "guideMarks" | "onGuides"> {
    const field = currentShapeField();
    if (!field || points.length === 0) return {};
    const env = toolEnvFor(field);
    if (env.pull === false) return {};
    const { width, height } = field.fieldProperties;
    const { guides, edges, marks, on } = edgeGuides(
        outline,
        points,
        [],
        env.fieldLines,
        { width, height },
    );
    if (guides.length === 0) return {};
    return {
        guides: guides.map((g) => {
            const label = lineCoordinate(g.axis, g.at);
            return { from: g.from, to: g.to, ...(label ? { label } : {}) };
        }),
        guideEdges: edges,
        ...(marks.length > 0 ? { guideMarks: marks } : {}),
        onGuides: on,
    };
}

/** The one pen mode the field editor is given while a path is drawn or open. */
export const pathPenMode = new PathPenMode();
