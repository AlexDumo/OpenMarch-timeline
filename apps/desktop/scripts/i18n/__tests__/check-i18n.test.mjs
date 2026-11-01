import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { checkI18n, PATHS } from "../check-i18n.mjs";

const fixtures = [];
after(async () => {
    await Promise.all(
        fixtures.map((dir) => rm(dir, { recursive: true, force: true })),
    );
});

const json = (value) => `${JSON.stringify(value, null, 4)}\n`;

/** A desktop package with one source file, en.json, context and a baseline. */
async function fixture({
    source,
    english = { menu: { save: "Save" } },
    context = { "menu.save": "Menu item that saves the show." },
    baseline = { untranslatedText: {}, keysWithoutContext: [] },
}) {
    const dir = await mkdtemp(path.join(tmpdir(), "check-i18n-"));
    fixtures.push(dir);
    await mkdir(path.join(dir, "src"), { recursive: true });
    await mkdir(path.join(dir, "i18n"), { recursive: true });
    await mkdir(path.join(dir, "i18n-meta"), { recursive: true });
    await writeFile(path.join(dir, "src/View.tsx"), source);
    await writeFile(path.join(dir, PATHS.english), json(english));
    await writeFile(path.join(dir, PATHS.context), json(context));
    await writeFile(path.join(dir, PATHS.baseline), json(baseline));
    return dir;
}

const translated = `
import { useTranslate } from "@tolgee/react";
export function View() {
    const { t } = useTranslate();
    return <button title={t("menu.save")}>{t("menu.save", "Save")}</button>;
}
`;

test("passes translated text", async () => {
    const { errors } = await checkI18n(await fixture({ source: translated }));
    assert.deepEqual(errors, []);
});

test("flags JSX text, text props, literal expressions and toasts", async () => {
    const source = `
export function View({ on }: { on: boolean }) {
    toast.error("Couldn't save");
    return (
        <div aria-label="Toolbar" className="flex gap-4">
            Hello
            <input placeholder={\`Type \${on}\`} />
            {on ? "On" : "Off"}
            <code>pnpm dev</code>
            {" · "}
        </div>
    );
}
`;
    const { errors } = await checkI18n(await fixture({ source }));
    const text = errors.join("\n");
    assert.match(text, /src\/View\.tsx: 6 untranslated UI texts/);
    for (const found of [
        '"Couldn\'t save"',
        '"Toolbar"',
        "Hello",
        "`Type ${on}`",
        '"On"',
        '"Off"',
    ]) {
        assert.ok(text.includes(found), `expected ${found} in:\n${text}`);
    }
    assert.ok(!text.includes("pnpm dev"));
    assert.ok(!text.includes("flex gap-4"));
});

test("an i18n-ignore comment covers its line and the next", async () => {
    const source = `
export function View() {
    return (
        <div>
            {/* i18n-ignore: brand name */}
            <span>OpenMarch</span>
            <span title="Brand" /> {/* i18n-ignore: brand name */}
        </div>
    );
}
`;
    const { errors } = await checkI18n(await fixture({ source }));
    assert.deepEqual(errors, []);
});

test("baselined text passes, but one more in the same file fails", async () => {
    const source = `export const View = () => <p>Old</p>;`;
    const baseline = {
        untranslatedText: { "src/View.tsx": 1 },
        keysWithoutContext: [],
    };
    assert.deepEqual(
        (await checkI18n(await fixture({ source, baseline }))).errors,
        [],
    );

    const more = `export const View = () => <p>Old <b>New</b></p>;`;
    const { errors } = await checkI18n(
        await fixture({ source: more, baseline }),
    );
    assert.match(errors.join("\n"), /2 untranslated UI texts, up from 1/);
});

test("fixed text makes the baseline stale until --update shrinks it", async () => {
    const baseline = {
        untranslatedText: { "src/View.tsx": 2 },
        keysWithoutContext: [],
    };
    const dir = await fixture({ source: translated, baseline });

    const stale = await checkI18n(dir);
    assert.match(stale.errors.join("\n"), /out of date[\s\S]*2 fewer/);

    const updated = await checkI18n(dir, { update: true });
    assert.deepEqual(updated.errors, []);
    assert.equal(updated.updated, true);
    const written = JSON.parse(
        await readFile(path.join(dir, PATHS.baseline), "utf8"),
    );
    assert.deepEqual(written.untranslatedText, {});
});

test("--update never adds new untranslated text to the baseline", async () => {
    const dir = await fixture({
        source: `export const View = () => <p>New</p>;`,
    });
    const { errors } = await checkI18n(dir, { update: true });
    assert.match(errors.join("\n"), /1 untranslated UI text:/);
    const written = JSON.parse(
        await readFile(path.join(dir, PATHS.baseline), "utf8"),
    );
    assert.deepEqual(written.untranslatedText, {});
});

test("a key missing from en.json fails, for t() and <T>", async () => {
    const source = `
export function View() {
    return (
        <>
            {t("menu.open")}
            {tolgee.t("menu.close", "Close")}
            <T keyName="menu.quit" />
        </>
    );
}
`;
    const { errors } = await checkI18n(await fixture({ source }));
    const text = errors.join("\n");
    for (const key of ["menu.open", "menu.close", "menu.quit"]) {
        assert.match(text, new RegExp(`Key "${key}" is not in i18n/en.json`));
    }
});

test("an inline default that differs from en.json fails", async () => {
    const source = `
export const View = () => (
    <>
        {t("menu.save", "Save it")}
        {t("menu.save", { defaultValue: "Save" })}
        <T keyName="menu.save" defaultValue="Save now" />
    </>
);
`;
    const { errors } = await checkI18n(await fixture({ source }));
    assert.equal(errors.filter((e) => e.includes("inline default")).length, 2);
});

test("a new key needs translator context; baselined keys don't", async () => {
    const english = { menu: { save: "Save", open: "Open", quit: "Quit" } };
    const baseline = {
        untranslatedText: {},
        keysWithoutContext: ["menu.open"],
    };
    const { errors } = await checkI18n(
        await fixture({ source: translated, english, baseline }),
    );
    assert.deepEqual(errors, [
        `${PATHS.context}: "menu.quit" needs translator context: what the text is, where it appears and what it does.`,
    ]);
});

test("context for a key that isn't in en.json fails", async () => {
    const context = {
        "menu.save": "Menu item that saves the show.",
        "menu.gone": "Old key.",
    };
    const { errors } = await checkI18n(
        await fixture({ source: translated, context }),
    );
    assert.match(errors.join("\n"), /"menu\.gone" is not in i18n\/en\.json/);
});
