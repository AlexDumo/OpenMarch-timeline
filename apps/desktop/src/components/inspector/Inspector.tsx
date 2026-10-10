import MarcherEditor from "./MarcherEditor";
import PageEditor from "./PageEditor";
import ShapeEditor from "./ShapeEditor";
import ShapeToolPanel from "@/shapes/ui/ShapeToolPanel";
import { PageNotesSection } from "./PageNotesSection";
import { TimelineInspectorSection } from "./TimelineInspectorSection";
import { TimelineMoveCardSlot } from "./TimelineMoveCard";
import { T } from "@tolgee/react";
import { useShapeToolStore } from "@/shapes/shapeToolStore";

function Inspector() {
    // The open shape tool comes first, so its settings are in view while it's in use
    const shapeToolOpen = useShapeToolStore((s) => s.session !== null);
    return (
        <div className="rounded-6 border-stroke bg-fg-1 flex h-full w-xs min-w-0 flex-col border p-12">
            <p className="text-body text-text/60">
                <T keyName="inspector.title" />
            </p>

            {/* Scrollable inspector content */}
            {/* relative so Radix's visually-hidden native selects are contained here instead of escaping to the document */}
            <div className="relative mt-8 flex min-h-0 flex-1 flex-col gap-48 overflow-y-auto">
                {shapeToolOpen && <ShapeToolPanel />}
                {/* UI-14 review: a selected move's card comes first */}
                <TimelineMoveCardSlot />
                <PageEditor />
                <MarcherEditor />
                <ShapeEditor />
                {!shapeToolOpen && <ShapeToolPanel />}
                <TimelineInspectorSection />
            </div>

            {/* Fixed notes footer at the bottom of the inspector */}
            <div className="mt-12">
                <PageNotesSection />
            </div>
        </div>
    );
}

export default Inspector;
