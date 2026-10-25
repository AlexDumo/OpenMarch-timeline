import * as ToggleGroup from "@radix-ui/react-toggle-group";
import { T } from "@tolgee/react";

/** One choice of a few, as pills: the Appearance section's theme picker. */
export default function SettingChoices<V extends string>({
    id,
    value,
    options,
    keyPrefix,
    onChange,
}: {
    id: string;
    value: V;
    options: readonly V[];
    keyPrefix: string;
    onChange: (value: V) => void;
}) {
    return (
        <ToggleGroup.Root
            id={id}
            type="single"
            value={value}
            onValueChange={(next) => {
                if (next) onChange(next as V);
            }}
            className="flex h-fit w-fit flex-wrap gap-8"
        >
            {options.map((option) => (
                <ToggleGroup.Item
                    key={option}
                    value={option}
                    className="text-text bg-fg-2 text-body border-stroke data-[state=on]:border-accent rounded-full border px-12 py-8 outline-hidden duration-150 ease-out focus-visible:-translate-y-4"
                >
                    <T keyName={`${keyPrefix}.${option}`} />
                </ToggleGroup.Item>
            ))}
        </ToggleGroup.Root>
    );
}
