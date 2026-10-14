/**
 * PROTOTYPE. The field, drawn from FieldProperties the way the 2D canvas's
 * `createFieldGrid` does: grid, half lines, yard lines, hashes, checkpoint
 * labels and yard numbers. Lines are `LineSegments2` (a width in screen
 * pixels); their width follows the zoom like Fabric's 1-px world lines, but
 * never drops under one screen pixel, so a zoomed-out grid doesn't shimmer.
 */
import {
    Color,
    Group,
    Mesh,
    MeshBasicMaterial,
    PlaneGeometry,
    Vector2,
} from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import type { FieldProperties, RgbaColor } from "@openmarch/core";
import { GlyphAtlas, TextBatch, type TextBatchLabel } from "./sdfText";

const css = (c: RgbaColor) => `rgb(${c.r}, ${c.g}, ${c.b})`;

interface LineSet {
    material: LineMaterial;
    baseOpacity: number;
    /** Width in field pixels; the screen width is this times the zoom. */
    worldWidth: number;
    minPx: number;
}

export class FieldLayer {
    readonly group = new Group();
    private readonly lineSets: LineSet[] = [];
    private readonly texts: TextBatch[] = [];

    constructor(
        field: FieldProperties,
        atlas: GlyphAtlas,
        opts: { gridLines: boolean; halfLines: boolean },
    ) {
        const W = field.width;
        const H = field.height;
        const step = field.pixelsPerStep;
        const cf = field.centerFrontPoint;
        const theme = field.theme;

        const bg = new Mesh(
            new PlaneGeometry(W, H),
            new MeshBasicMaterial({
                color: new Color(css(theme.background)),
                depthTest: false,
            }),
        );
        bg.position.set(W / 2, -H / 2, 0);
        bg.renderOrder = 0;
        this.group.add(bg);

        const segs = (worldWidth: number, color: RgbaColor, pts: number[], minPx = 1, order = 1) => {
            if (pts.length === 0) return;
            const geometry = new LineSegmentsGeometry();
            // Field (x, y) → world (x, -y, 0)
            const p3: number[] = [];
            for (let i = 0; i < pts.length; i += 2) p3.push(pts[i], -pts[i + 1], 0);
            geometry.setPositions(p3);
            const material = new LineMaterial({
                color: new Color(css(color)).getHex(),
                linewidth: 1,
                transparent: true,
                opacity: color.a,
                depthTest: false,
            });
            const line = new LineSegments2(geometry, material);
            line.renderOrder = order;
            line.frustumCulled = false;
            this.group.add(line);
            this.lineSets.push({ material, worldWidth, minPx, baseOpacity: color.a });
        };

        const ys = [...field.yCheckpoints].sort(
            (a, b) => b.stepsFromCenterFront - a.stepsFromCenterFront,
        );
        const firstVisibleY = field.yCheckpoints.reduce(
            (prev, curr) =>
                curr.visible && curr.stepsFromCenterFront > prev.stepsFromCenterFront
                    ? curr
                    : prev,
            ys[ys.length - 1],
        );
        let yStart = ys[0];
        if (
            firstVisibleY.stepsFromCenterFront !== 0 &&
            firstVisibleY.stepsFromCenterFront % 1 !== 0
        )
            yStart = firstVisibleY;

        if (opts.gridLines) {
            const pts: number[] = [];
            for (let x = cf.xPixels; x < W; x += step) pts.push(x, 0, x, H);
            for (let x = cf.xPixels - step; x > 0; x -= step) pts.push(x, 0, x, H);
            for (let y = cf.yPixels + yStart.stepsFromCenterFront * step; y > 0; y -= step)
                pts.push(0, y, W, y);
            segs(1, theme.tertiaryStroke, pts, 1, 1);
        }
        if (opts.halfLines) {
            const pts: number[] = [];
            if (field.halfLineXInterval) {
                const d = step * field.halfLineXInterval;
                pts.push(cf.xPixels, 0, cf.xPixels, H);
                for (let x = cf.xPixels + d; x < W; x += d) pts.push(x, 0, x, H);
                for (let x = cf.xPixels - d; x > 0; x -= d) pts.push(x, 0, x, H);
            }
            if (field.halfLineYInterval) {
                const d = step * field.halfLineYInterval;
                for (let y = cf.yPixels + yStart.stepsFromCenterFront * step - d; y > 0; y -= d)
                    pts.push(0, y, W, y);
            }
            segs(1, theme.secondaryStroke, pts, 1, 2);
        }

        const yard: number[] = [];
        const hashRef: number[] = [];
        const hashSecondary: number[] = [];
        for (const xc of field.xCheckpoints) {
            if (!xc.visible) continue;
            const x = cf.xPixels + xc.stepsFromCenterFront * step;
            yard.push(x, 0, x, H);
            if (field.useHashes) {
                const hw = 10;
                for (const yc of field.yCheckpoints) {
                    if (!yc.visible) continue;
                    const y = cf.yPixels + yc.stepsFromCenterFront * step - 1;
                    const target = yc.useAsReference ? hashRef : hashSecondary;
                    target.push(Math.max(0, x - hw), y, Math.min(W, x + hw) + 1, y);
                }
            }
        }
        if (!field.useHashes) {
            for (const yc of field.yCheckpoints) {
                if (!yc.visible) continue;
                const y = cf.yPixels + yc.stepsFromCenterFront * step;
                yard.push(0, y, W, y);
            }
        }
        segs(1, theme.primaryStroke, yard, 1, 3);
        segs(3, theme.primaryStroke, hashRef, 1.5, 3);
        segs(2, theme.secondaryStroke, hashSecondary, 1, 3);

        // Checkpoint labels (outside the field) and yard numbers.
        const external = new TextBatch(atlas, css(theme.externalLabel), null);
        const labels: TextBatchLabel[] = [];
        const anchors: number[] = [];
        for (const xc of field.xCheckpoints) {
            if (!xc.visible) continue;
            const x = cf.xPixels + xc.stepsFromCenterFront * step;
            if (field.bottomLabelsVisible) {
                labels.push({ text: xc.terseName, scale: 20, baselineEm: -0.9 });
                anchors.push(x, -(cf.yPixels + 5));
            }
            if (field.topLabelsVisible) {
                labels.push({ text: xc.terseName, scale: 20, baselineEm: 0.3 });
                anchors.push(x, 5);
            }
        }
        for (const yc of field.yCheckpoints) {
            if (!yc.visible) continue;
            const y = cf.yPixels + yc.stepsFromCenterFront * step;
            if (field.leftLabelsVisible) {
                labels.push({ text: yc.terseName, scale: 20, align: "right", baselineEm: -0.3 });
                anchors.push(-10, -y);
            }
            if (field.rightLabelsVisible) {
                labels.push({ text: yc.terseName, scale: 20, align: "left", baselineEm: -0.3 });
                anchors.push(W + 10, -y);
            }
        }
        external.setLabels(labels);
        external.setAnchors(anchors);
        external.mesh.renderOrder = 4;
        this.group.add(external.mesh);
        this.texts.push(external);

        const yn = field.yardNumberCoordinates;
        if (
            yn.homeStepsFromFrontToInside !== undefined &&
            yn.homeStepsFromFrontToOutside !== undefined
        ) {
            const numberHeight =
                (yn.homeStepsFromFrontToInside - yn.homeStepsFromFrontToOutside) * step;
            const numbers = new TextBatch(atlas, css(theme.fieldLabel), null);
            const nl: TextBatchLabel[] = [];
            const na: number[] = [];
            for (const xc of field.xCheckpoints) {
                if (!xc.fieldLabel) continue;
                const x = cf.xPixels + xc.stepsFromCenterFront * step;
                // Home numbers read from the front; away numbers are upside down.
                nl.push({ text: xc.fieldLabel, scale: numberHeight * 1.25 });
                na.push(x, -(cf.yPixels - yn.homeStepsFromFrontToOutside * step));
                if (yn.awayStepsFromFrontToOutside !== undefined) {
                    nl.push({ text: xc.fieldLabel, scale: numberHeight * 1.25, rotation: Math.PI });
                    na.push(x, -(cf.yPixels - yn.awayStepsFromFrontToOutside * step));
                }
            }
            numbers.setLabels(nl);
            numbers.setAnchors(na);
            numbers.mesh.renderOrder = 4;
            this.group.add(numbers.mesh);
            this.texts.push(numbers);
        }
    }

    /** Line widths follow the zoom; LineMaterial needs the drawing-buffer size. */
    update(zoom: number, resolution: Vector2) {
        for (const set of this.lineSets) {
            const px = set.worldWidth * zoom;
            set.material.linewidth = Math.max(set.minPx, Math.min(px, 6));
            // Thinner than the minimum: keep the width, fade by coverage (as
            // Fabric's antialiased sub-pixel lines look).
            set.material.opacity = set.baseOpacity * Math.min(1, px / set.minPx);
            set.material.resolution.copy(resolution);
        }
    }

    dispose() {
        this.group.traverse((o) => {
            const m = o as Mesh;
            m.geometry?.dispose();
            (m.material as { dispose?: () => void } | undefined)?.dispose?.();
        });
    }
}
