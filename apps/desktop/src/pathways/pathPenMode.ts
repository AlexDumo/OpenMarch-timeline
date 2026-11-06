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
import tolgee from "@/global/singletons/Tolgee";
import {
    PATH_MENU,
    laneOutline,
    memberWalkOf,
    scheduleOf,
    clickPathHandle,
    dragNewPoint,
    dragPathHandle,
    landCorner,
    legOf,
    onLine,
    onPath,
    pathHandleAt,
    pathHandles,
    pathHonors,
    pathOutline,
    pathPoints,
    pointOf,
    samePoints,
    tangentHandle,
    tangentOf,
    type PathPoint,
    type PathShape,
} from "./pathEdit";
import {
    addPoint,
    cancelDrag,
    commitPoints,
    deletePoint,
    dragPoints,
    endNewPoint,
    finishDrawing,
    openPath,
    removeLastPoint,
    selectPoint,
    setPointSmooth,
    setPointer,
    shapeNewPoint,
    shapeOf,
    pathShown,
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

/** What the field's menu offers on a path: open it, or take it away (one undo step) */
export const PATH_FIELD_MENU = ["editPath", "removePath"] as const;

/**
 * The path pen on the field (pathways steps 1 and 2), working as the shape tool's Line does:
 *
 * - Drawing: a click places the next point, a corner, landed on its release (on the half-step
 *   grid or a field line; off the grid with fine, at 45° from the last with constrain). A
 *   press-and-drag places a smooth point where it was pressed instead, its roundness how far the
 *   drag went (in tenths, fine for any), its tangent bar shown while dragging. A
 *   double-click, a click on the last point or on the end spot, or Enter finishes; a right-click,
 *   Backspace or undo takes the last point back; Escape cancels.
 * - Closed (the selected marcher's path, shown): the path takes no press, so clicks, drags and
 *   marquees around it are the field's. A double-click on its line opens it (a click there keeps
 *   the selection, so the double-click has a first click); a right-click or long press there opens
 *   the field's menu with Edit path and Remove path.
 * - Open: the path takes only presses on its handles, so the marchers stay selectable. A click on
 *   a point selects it, and a selected smooth point shows its tangent bar, whose ends drag its
 *   roundness; a double-click on a point swaps corner and smooth; a drag moves a point (fine off
 *   the grid, constrain keeping its direction), saved on release as one undo step; a click on a
 *   leg's midpoint adds a point there, and a drag adds one and moves it. A right-click or long
 *   press opens a point's menu (Corner | Smooth, Roundness, Delete point) or a leg's (Add point
 *   here, Straight | Curved), and elsewhere on the line the field's menu with Remove path. A click
 *   on empty field changes the selection, which closes it.
 *
 * The held-roles chip names what a drag reads, from the press, as it does for a shape's handles.
 */
class PathPenMode implements FieldMode {
    private held: {
        start: FieldPointer;
        /** The handle pressed on the open path, or null (drawing, or a miss) */
        key: string | null;
        base: PathShape;
        before: readonly PathPoint[];
        moved: boolean;
        /**
         * Drawing: where the press landed a point, made smooth once the drag leaves the slop; null
         * when the press was on the last point or the end spot, which finishes on release however
         * far it moved (review of #680)
         */
        landed: XY | null;
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

    /** The session when its path is drawn now (a closed one can be hidden), else null */
    private get shownSession() {
        const { session, hidden } = usePathPenStore.getState();
        return pathShown(session, hidden) ? session : null;
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
        return env
            ? pathHandleAt(shapeOf(s), pointer.field, env, s.selected)
            : null;
    }

    /** Whether `pointer` is on the path's line, open or closed */
    private onLine(s: PathSession, pointer: Pick<FieldPointer, "field">) {
        const env = envOf();
        if (s.phase === "drawing" || !env) return false;
        if (onPath(shapeOf(s), pointer.field, env)) return true;
        // A group path's lanes open it too (step 15)
        const lanes = drawingOf(s)?.lanes ?? [];
        return lanes.some((lane) => onLine(lane, pointer.field, env.hitRadius));
    }

    claims(pointer: FieldPointer): boolean {
        const s = this.session;
        if (!s || pointer.button !== 0 || s.phase === "closed") return false;
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
        const env = envOf(keys.roles());
        this.held = {
            start: pointer,
            screen: pointer.screen,
            key,
            base,
            before: s.points,
            moved: false,
            landed:
                s.phase === "drawing" &&
                env &&
                !onFinishSpot(s, pointer.field, env)
                    ? landCorner(base, pointer.field, env)
                    : null,
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
            if (p.moved && p.landed) this.shapeNew(p, pointer, roles);
            else this.preview(pointer, roles);
            return;
        }
        if (p.key === null) return;
        const env = envOf(roles);
        if (!env) return;
        const point = pointOf(p.base, p.key);
        const tangent = tangentOf(p.base, p.key);
        dragPoints(
            dragPathHandle(p.base, p.key, pointer.field, env),
            point >= 0 ? point : tangent ? tangent.index : legOf(p.base, p.key),
        );
    }

    /**
     * While drawing, a press-and-drag: the point lands where it was pressed, smooth, its roundness
     * following the drag. A press on the last point or the end spot finishes instead (on release).
     */
    private shapeNew(
        p: NonNullable<PathPenMode["held"]>,
        pointer: FieldPointer,
        roles: Roles,
    ) {
        const env = envOf(roles);
        const s = this.session;
        if (!env || !s || !p.landed) return;
        const placed: PathShape = {
            ...p.base,
            points: [...p.base.points, { at: p.landed }],
        };
        shapeNewPoint(dragNewPoint(placed, pointer.field, env));
        setPointer(null);
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
            // A press-and-drag placed its smooth point as it went
            if (p.moved && s.dragging !== null) {
                endNewPoint();
                return;
            }
            // Pressed on the last point or the end spot and moved a little: still a finish
            if (p.moved && p.landed === null) {
                void finishDrawing();
                return;
            }
            this.releaseDrawing(s, pointer, click, roles);
            return;
        }
        if (p.key === null) return;
        if (p.moved) {
            // Moved past the slop with nothing dragged (no field yet): nothing to save
            if (s.dragging === null) return;
            const now = usePathPenStore.getState().session?.points ?? p.before;
            if (samePoints(now, p.before)) {
                cancelDrag(p.before);
                return;
            }
            // A midpoint dragged adds its point, which stays unselected; a point dragged keeps
            // the selection only if it was that point; a tangent bar's end keeps its point
            const point = pointOf(p.base, p.key);
            const keep =
                (point >= 0 && p.key === s.selected) ||
                tangentOf(p.base, p.key) !== null;
            void commitPoints(now, p.before, keep ? s.selected : null);
            return;
        }
        const point = pointOf(p.base, p.key);
        // A double-click on a point swaps corner and smooth, as a Line's does (#557)
        if (point >= 0 && click?.double && click.ownFirst) {
            void setPointSmooth(
                point,
                !((p.base.points[point]?.tension ?? 0) > 0),
            );
            return;
        }
        // A click: a midpoint adds a point there; a point is selected
        const added = clickPathHandle(p.base, p.key);
        if (added) {
            void commitPoints(added, p.before, null);
            return;
        }
        if (point >= 0) selectPoint(p.key);
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
        // On the last point (a Line's last point), or on the end spot the path goes to
        if (onFinishSpot(s, pointer.field, env)) {
            void finishDrawing();
            return;
        }
        const at = landCorner(shapeOf(s), pointer.field, env);
        // Landed on the last point: the same as clicking it
        const prev = s.points.at(-1)?.at;
        if (prev && prev.x === at.x && prev.y === at.y) {
            void finishDrawing();
            return;
        }
        addPoint(at);
        setPointer(at);
    }

    cancel(): void {
        const p = this.held;
        this.endHeld();
        if (!p?.moved) return;
        if (this.session?.phase === "open") cancelDrag(p.before);
        // A lost press-and-drag while drawing takes back the point it was placing
        else if (this.session?.dragging !== null) {
            cancelDrag(p.before);
        }
    }

    cursorAt(pointer: FieldPointer): FieldCursor | null {
        const s = this.session;
        if (!s || s.phase === "closed") return null;
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
     * While drawing, a right-click (a Mac's Ctrl-click, a long press) takes the last point back,
     * as it does a Line's last point. On the open path, a point's or a leg's menu, as a Line's: a
     * Corner | Smooth pick keeps the menu open, showing the change.
     */
    openMenu(pointer: FieldPointer): boolean {
        const s = this.session;
        if (!s || s.phase === "closed") return false;
        if (s.phase === "drawing") return removeLastPoint();
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
                const point = pointOf(shape, key);
                // Deleting the last point removes the path (AP-R2)
                if (value === "delete" && point >= 0) {
                    void deletePoint(point);
                    return null;
                }
                const env = envOf();
                const picked = env
                    ? PATH_MENU.pick(shape, 1, key, value, env)
                    : null;
                if (!picked) return null;
                if (!samePoints(picked.params.points, now.points))
                    void commitPoints(
                        picked.params.points,
                        now.points,
                        picked.selected,
                    );
                else if (picked.selected !== undefined)
                    selectPoint(picked.selected);
                // Corner | Smooth and Straight | Curved stay open, showing the change; the
                // others do one thing and close
                return ["corner", "smooth", "straight", "curved"].includes(
                    value,
                )
                    ? { params: picked.params, n: 1 }
                    : null;
            },
        );
    }

    /** On the path's line (no handle took it): Edit path and Remove path, in the field's menu */
    fieldMenuAt(pointer: FieldPointer): readonly string[] | null {
        const s = this.shownSession;
        if (!s || s.target.routeId === null || !this.onLine(s, pointer))
            return null;
        return PATH_FIELD_MENU;
    }

    /**
     * A click on the path's line keeps the selection (the field's rule would let the marcher go,
     * and the path with it); the second click of a double-click opens it. Elsewhere, the field's.
     */
    takeClick(pointer: FieldPointer, double: boolean): boolean {
        const s = this.shownSession;
        if (!s || !this.onLine(s, pointer)) return false;
        if (double) openPath();
        return true;
    }

    drawing(): FieldModeDrawing | null {
        return drawingOf(this.shownSession);
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
 * its end spot, the same open or closed; once open, its handles as a Line's are drawn (squares on
 * the corners, the selected one filled, small round ones mid-leg), and while drawing a leg to where the next corner would land,
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
        const middle = session.points.map((c) => c.at);
        // While drawing, the next leg runs to where the next point would land, straight
        const outline =
            drawingNow && pointer
                ? [
                      ...pathOutline({
                          ...shape,
                          to: pointer,
                          ends: { from: shape.from, to: pointer },
                      }),
                      target.to,
                  ]
                : pathOutline(shape);
        // While a press-and-drag shapes the point just placed, its tangent bar
        const shaping =
            drawingNow && session.dragging !== null
                ? ([1, -1] as const).flatMap((side) => {
                      const at = tangentHandle(shape, session.dragging!, side);
                      return at
                          ? [{ at, from: middle[session.dragging!]! }]
                          : [];
                  })
                : [];
        const handles = drawingNow
            ? {
                  handles: middle,
                  addHandles: [],
                  selectedHandles: [],
                  barHandles: shaping,
              }
            : session.phase === "closed"
              ? { handles: [], addHandles: [], selectedHandles: [] }
              : handleDrawing(
                    {
                        handles: (_p, _n, sel) =>
                            pathHandles(shape, sel ?? null),
                    },
                    shape,
                    1,
                    selected,
                );
        // The point being placed or dragged: guides where it's on a field line, and where it is
        const moving = drawingNow
            ? (pointer ??
              (session.dragging === null ? null : middle[session.dragging]!))
            : session.dragging === null
              ? null
              : (middle[session.dragging] ?? null);
        const tipText = moving ? drillTerms(moving) : null;
        const group = target.group;
        const { lanes, memberRings } = groupParts(session, shape);
        drawing = {
            outline,
            openOutline: true,
            pathLine: session.phase === "closed" ? "shown" : "edited",
            stage: drawingNow ? "drawing" : "open",
            spots: group ? group.members.map((m) => m.to) : [target.to],
            walks: [],
            ...handles,
            rings: group ? group.members.map((m) => m.from) : [target.from],
            ringIds: group
                ? group.members.map((m) => m.marcherId)
                : [target.marcherId],
            ...(lanes ? { lanes } : {}),
            ...(memberRings ? { memberRings } : {}),
            ...guidesFor(moving ? [moving] : [], outline),
            ...(tipText && moving
                ? { tip: { at: moving, text: tipText } }
                : {}),
        };
    }
    last = { session, drawing };
    return drawing;
}

/**
 * A group path's parts of the drawing (step 15): every member's lane, thin and faint (while
 * drawing, to where the next point would land), and the rings saying who follows it
 */
function groupParts(
    session: PathSession,
    shape: PathShape,
): Pick<FieldModeDrawing, "lanes" | "memberRings"> {
    const group = session.target.group;
    if (!group) return {};
    const { pointer } = session;
    const laneShape =
        session.phase === "drawing" && pointer
            ? {
                  ...shape,
                  points: [...shape.points, { at: pointer }],
                  ends: shape.ends ?? { from: shape.from, to: shape.to },
              }
            : shape;
    const schedule = scheduleOf(laneShape);
    return {
        lanes: group.members.map((m) => laneOutline(memberWalkOf(schedule, m))),
        memberRings: [
            ...group.members.map((m) => ({
                at: m.from,
                marcherId: m.marcherId,
                kind: "group" as const,
                label: tolgee.t(
                    "pathways.rings.group",
                    "Follows the group path",
                ),
            })),
            ...group.outside.map((m) => ({
                at: m.from,
                marcherId: m.marcherId,
                kind: "own" as const,
                label: m.ownPath
                    ? tolgee.t("pathways.rings.own", "Own path")
                    : tolgee.t(
                          "pathways.rings.offGroup",
                          "Not on the group path",
                      ),
            })),
        ],
    };
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

/** Whether `at` is on the drawing's last point or on the end spot the path goes to */
function onFinishSpot(s: PathSession, at: XY, env: ToolEnv): boolean {
    const points = pathPoints(shapeOf(s));
    const last = points[points.length - 2]!;
    const end = points[points.length - 1]!;
    const near = (q: XY) => Math.hypot(q.x - at.x, q.y - at.y) <= env.hitRadius;
    return (s.points.length > 0 && near(last)) || near(end);
}
