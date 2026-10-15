/**
 * Which marchers the new field draws dimmed (fork #201; UI-9: while a move is
 * isolated, the marchers outside it), outside React. The marchers and labels
 * layers read it in their frame hooks and redraw when `version` changes.
 * Selection rules (that a dimmed marcher can't be selected or hit) are the
 * editor's: it asks the same `isMarcherDimmed`.
 */
export class FieldDimming {
    /** Goes up whenever who's dimmed may have changed. */
    version = 0;
    private dimmed: (id: number) => boolean = () => false;
    /** Whether anyone can be dimmed: false skips asking per marcher. */
    any = false;
    private readonly listeners = new Set<() => void>();

    /** Calls `listener` after each change (a layer asks for a frame). Returns the unsubscribe. */
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /** Dims the marchers `dimmed` names; null dims nobody. */
    set(dimmed: ((id: number) => boolean) | null) {
        if (!dimmed && !this.any) return;
        this.dimmed = dimmed ?? (() => false);
        this.any = dimmed !== null;
        this.version++;
        for (const listener of this.listeners) listener();
    }

    isDimmed(id: number): boolean {
        return this.any && this.dimmed(id);
    }
}

/** How opaque a dimmed marcher and its label are (Fabric's `CanvasMarcher.DIMMED_OPACITY`). */
export const DIMMED_OPACITY = 0.25;
