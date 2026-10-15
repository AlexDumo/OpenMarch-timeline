import FieldBenchmark from "./FieldBenchmark";
import {
    fabricCanvas,
    fabricFrames,
    fabricMarcherCount,
    fabricView,
} from "./fabricBenchmark";

const frames = fabricFrames(fabricCanvas);
const view = fabricView(fabricCanvas);
const element = () =>
    (fabricCanvas() as { lowerCanvasEl?: Element } | null)?.lowerCanvasEl ??
    null;

/**
 * The field benchmark over the Fabric field, mounted beside it, so the parity
 * gate (#208) can measure both fields on the same machine. Deleted with
 * Fabric in #209.
 */
export default function FabricFieldBenchmark() {
    return (
        <FieldBenchmark
            field="fabric"
            frames={frames}
            view={view}
            element={element}
            marcherCount={fabricMarcherCount}
        />
    );
}
