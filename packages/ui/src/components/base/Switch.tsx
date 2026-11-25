import * as RadixSwitch from "@radix-ui/react-switch";
import type { SwitchProps as RadixSwitchProps } from "@radix-ui/react-switch";
import clsx from "clsx";
import { forwardRef } from "react";

export interface SwitchProps extends RadixSwitchProps {
    /**
     * `track` says on or off with the track: grey with a light knob when off, the accent with a
     * light knob when on, the way phones and most desktop apps draw a switch. `default` keeps
     * the knob's color (dark when off, the accent when on) on a plain track.
     */
    look?: "default" | "track";
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
    ({ className, look = "default", ...props }, ref) => {
        const rootClassname = clsx(
            "relative touch:before:absolute touch:before:-inset-x-4 touch:before:-inset-y-10 touch:before:content-[''] h-[25px] w-[42px] cursor-pointer border focus-visible:outline-none rounded-full focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-50 duration-150 ease-out",
            look === "track"
                ? "shrink-0 border-transparent bg-text/20 data-[state=checked]:bg-accent transition-colors focus-visible:ring-2 focus-visible:ring-accent"
                : "border-stroke bg-fg-2",
            className,
        );
        const thumbClassname = clsx(
            "translate-x-[1px] block size-[20px] rounded-full transition-transform duration-100 will-change-transform data-[state=checked]:translate-x-[17.5px]",
            look === "track"
                ? "bg-text-invert shadow-sm"
                : "bg-text/80 data-[state=checked]:bg-accent",
        );
        return (
            <RadixSwitch.Root ref={ref} className={rootClassname} {...props}>
                <RadixSwitch.Thumb className={thumbClassname} />
            </RadixSwitch.Root>
        );
    },
);

Switch.displayName = "Switch";
