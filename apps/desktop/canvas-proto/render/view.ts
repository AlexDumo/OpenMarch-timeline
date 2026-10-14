/**
 * PROTOTYPE. The 2D view: an orthographic camera looking straight down at the
 * field. Field pixels map to three world units with Y flipped (three's +Y is
 * up, the field's +Y is toward the front), so `world = (x, -y)`.
 *
 * The SVG overlay uses the same `fieldToScreen`, so handles and the WebGL
 * layer can't drift apart.
 */
import { OrthographicCamera } from "three";

export class View {
    /** Field-pixel point at the center of the screen. */
    cx = 0;
    cy = 0;
    /** Screen (CSS) pixels per field pixel. */
    zoom = 1;
    width = 1;
    height = 1;
    readonly camera = new OrthographicCamera(-1, 1, 1, -1, -100, 100);

    resize(width: number, height: number) {
        this.width = Math.max(1, width);
        this.height = Math.max(1, height);
        this.update();
    }

    update() {
        const hw = this.width / 2 / this.zoom;
        const hh = this.height / 2 / this.zoom;
        const c = this.camera;
        c.left = -hw;
        c.right = hw;
        c.top = hh;
        c.bottom = -hh;
        c.position.set(this.cx, -this.cy, 10);
        c.updateProjectionMatrix();
        c.updateMatrixWorld();
    }

    screenToField(sx: number, sy: number): [number, number] {
        return [
            this.cx + (sx - this.width / 2) / this.zoom,
            this.cy + (sy - this.height / 2) / this.zoom,
        ];
    }

    fieldToScreen(x: number, y: number): [number, number] {
        return [
            (x - this.cx) * this.zoom + this.width / 2,
            (y - this.cy) * this.zoom + this.height / 2,
        ];
    }

    /** Zooms by `factor`, keeping the field point under (sx, sy) still. */
    zoomAt(sx: number, sy: number, factor: number) {
        const [fx, fy] = this.screenToField(sx, sy);
        this.zoom = Math.min(40, Math.max(0.05, this.zoom * factor));
        this.cx = fx - (sx - this.width / 2) / this.zoom;
        this.cy = fy - (sy - this.height / 2) / this.zoom;
        this.update();
    }

    panBy(dxScreen: number, dyScreen: number) {
        this.cx -= dxScreen / this.zoom;
        this.cy -= dyScreen / this.zoom;
        this.update();
    }

    /** Fits a field-pixel rectangle with a margin. */
    fit(minX: number, minY: number, maxX: number, maxY: number, margin = 40) {
        const w = maxX - minX;
        const h = maxY - minY;
        this.zoom = Math.min(
            (this.width - margin * 2) / w,
            (this.height - margin * 2) / h,
        );
        this.cx = (minX + maxX) / 2;
        this.cy = (minY + maxY) / 2;
        this.update();
    }
}
