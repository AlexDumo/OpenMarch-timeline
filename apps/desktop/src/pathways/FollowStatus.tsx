/**
 * Following, in the top bar (owner, 2026-11-23): while the Follow tool is open its mode lives in
 * the Paths tab, not in a note over the field. The Follow button reads "Following", a short live
 * line beside it says what's happening ("Click or drag a marcher", then "Holding T9 · …"), the
 * tab's other tools step back, and the other tabs wait until Follow is finished or left.
 */
import { T } from "@tolgee/react";
import tolgee from "@/global/singletons/Tolgee";
import Shortcut from "@/components/ui/Shortcut";
import { goingRound } from "./followAround";
import { ripplesIn } from "./followDrag";
import { usePathPenStore, type PathSession } from "./pathPenStore";

/** Whether `session` is the Follow tool open, or a trail being drawn (step 4's Follow) */
export const isFollowing = (session: PathSession | null | undefined): boolean =>
    session?.phase === "drawing" &&
    (!!session.follow || !!session.target.trail);

/** Whether Follow is open now: the Paths tab shows it, and the rest of the top bar waits */
export const useFollowing = (): boolean =>
    usePathPenStore((s) => isFollowing(s.session));

/** Why the top bar's other tabs and tools wait while Following */
export const followingLockReason = (): string =>
    tolgee.t(
        "pathways.following.locked",
        "Finish or press Esc to leave Follow",
    );

type Status = { key: string; text: string; marcher?: string };

/** What's happening in the Follow tool now, as the top bar says it */
export function followStatusOf(session: PathSession): Status {
    const f = session.follow;
    const drill = (id: number | null | undefined) =>
        session.target.trail?.members.find((m) => m.marcherId === id)?.drill ??
        "";
    const leader = session.target.trail?.members.at(-1)?.drill ?? session.drill;
    if (!f)
        return {
            key: "pathways.following.trail",
            text: "Trail, {marcher} leading · click for a point · <enter></enter> finish · <esc></esc> cancel",
            marcher: leader,
        };
    const slide = f.roundSlide;
    if (slide) {
        const marcher = drill(slide.lead ?? f.around?.leader) || leader;
        if (f.grabbed !== null)
            return slide.loose
                ? {
                      key: "pathways.following.outLoose",
                      text: "{marcher} pulled out · click to place the trail's first point · <enter></enter> finish · <esc></esc> put back",
                      marcher,
                  }
                : {
                      key: "pathways.following.outHeld",
                      text: "{marcher} pulled out · let go to place the trail's first point · <esc></esc> put back",
                      marcher,
                  };
        return slide.loose
            ? {
                  key: "pathways.following.holdingLoose",
                  text: "Holding {marcher} · move along to slide, away to pull out · click to drop · <esc></esc> put back",
                  marcher,
              }
            : {
                  key: "pathways.following.holdingHeld",
                  text: "Holding {marcher} · drag along to slide, away to pull out · let go to drop · <esc></esc> put back",
                  marcher,
              };
    }
    if (goingRound(f))
        return {
            key: "pathways.following.pick",
            text: "Click or drag a marcher, or type how far · <enter></enter> finish · <esc></esc> leave",
        };
    if (f.grabbed === null)
        return {
            key: "pathways.following.pickEnd",
            text: "Drag a trail out of either end of the line · <esc></esc> leave",
        };
    if (ripplesIn(f))
        return {
            key: "pathways.following.ripple",
            text: "Ripple in, {marcher} leading · click an end of the form, or corners first · <esc></esc> cancel",
            marcher: leader,
        };
    return {
        key: "pathways.following.trail",
        text: "Trail, {marcher} leading · click for a point · <enter></enter> finish · <esc></esc> cancel",
        marcher: leader,
    };
}

/** The live line beside the Following button: what's happening, and how it ends */
export function FollowStatus() {
    const session = usePathPenStore((s) => s.session);
    if (!session || !isFollowing(session)) return null;
    const status = followStatusOf(session);
    return (
        <span
            className="text-sub text-text min-w-0 truncate"
            role="status"
            aria-live="polite"
            data-testid="follow-status"
            data-status={status.key}
        >
            <T
                keyName={status.key}
                defaultValue={status.text}
                params={{
                    marcher: status.marcher ?? "",
                    enter: () => <Shortcut action="applyShape" />,
                    esc: () => <Shortcut action="cancelAlignmentUpdates" />,
                }}
            />
        </span>
    );
}
