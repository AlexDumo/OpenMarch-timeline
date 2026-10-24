import { Tabs, TabContent, TabItem, TabsList } from "@openmarch/ui";
import { FileTab } from "./tabs/FileTab";
import { CollisionsTab } from "./tabs/CollisionsTab";
import AlignmentTab from "./tabs/AlignmentTab";
import ViewTab from "./tabs/ViewTab";
import ShapesTab from "@/shapes/tool/ShapesTab";
import { useEffect, useState } from "react";
import { T } from "@tolgee/react";
import { WarningIcon } from "@phosphor-icons/react/dist/ssr";
import { useSelectedPage } from "@/context/SelectedPageContext";
import { useCollisionStore } from "@/stores/CollisionStore";
import SelectTab from "./tabs/SelectTab";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { useIsVisualsView } from "@/stores/WorkspaceViewStore";
import VisualsToolbar from "@/components/visuals/VisualsToolbar";
import WorkspaceViewSwitch from "@/components/visuals/WorkspaceViewSwitch";

export default function Topbar() {
    const [activeTab, setActiveTab] = useState("alignment");
    const { selectedPage } = useSelectedPage()!;
    const { currentCollisions } = useCollisionStore();
    const visuals = useIsVisualsView();

    // Switch from collisions tab to alignment when page changes and no collisions exist. Not while
    // playing or scrubbing, when the selected page follows the playhead (#226): the tab waits for
    // the page it stops on.
    const isPlaying = useIsPlaying()?.isPlaying ?? false;
    const scrubbing = useTimelineSelectionStore((s) => s.scrubbing);
    useEffect(() => {
        if (isPlaying || scrubbing) return;
        if (activeTab === "collisions" && currentCollisions.length === 0) {
            setActiveTab("alignment");
        }
    }, [
        selectedPage,
        currentCollisions.length,
        activeTab,
        isPlaying,
        scrubbing,
    ]);

    return (
        <div className="group relative">
            <WorkspaceViewSwitch className="absolute top-0 right-0 z-10" />
            {visuals ? (
                <VisualsToolbar />
            ) : (
                <Tabs
                    value={activeTab}
                    onValueChange={setActiveTab}
                    className="flex flex-col gap-0 overflow-hidden"
                >
                    <TabsList className="gap-0 border-none">
                        <TabItem value="file">
                            <T keyName="inspector.shape.fileTab" />
                        </TabItem>
                        <TabItem value="alignment">
                            <T keyName="inspector.shape.alignmentTab" />
                        </TabItem>
                        <TabItem
                            value="shapes"
                            data-testid="toolbar-shapes-tab"
                        >
                            <T keyName="inspector.shape.shapesTab" />
                        </TabItem>

                        <TabItem value="select">
                            <T keyName="inspector.shape.selectTab" />
                        </TabItem>
                        <TabItem value="view">
                            <T keyName="inspector.shape.viewTab" />
                        </TabItem>
                        {selectedPage && currentCollisions.length > 0 && (
                            <TabItem value="collisions">
                                <div className="flex items-center gap-4">
                                    <WarningIcon
                                        width={18}
                                        height={18}
                                        className="text-yellow size-20"
                                    />
                                    {/*<T keyName="inspector.shape.collisionsTab" /> */}
                                    Collisions
                                </div>
                            </TabItem>
                        )}
                    </TabsList>

                    <TabContent value="file">
                        <FileTab />
                    </TabContent>

                    <TabContent value="alignment">
                        <AlignmentTab />
                    </TabContent>

                    <TabContent value="shapes">
                        <ShapesTab />
                    </TabContent>

                    <TabContent value="select">
                        <SelectTab />
                    </TabContent>

                    <TabContent value="view">
                        <ViewTab />
                    </TabContent>

                    <TabContent value="collisions">
                        <CollisionsTab />
                    </TabContent>
                </Tabs>
            )}
        </div>
    );
}
