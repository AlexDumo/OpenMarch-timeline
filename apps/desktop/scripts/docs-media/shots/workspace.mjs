// The workspace chapter (guides/workspace/*).
const shots = [
    {
        id: "window-overview",
        kind: "still",
        // The whole window, a few pages into the show
        async setup({ page, wait }) {
            await wait(4000);
            await page.keyboard.press("KeyE");
            await page.keyboard.press("KeyE");
            await wait(1500);
            return {};
        },
    },
    {
        id: "field-pan-zoom",
        kind: "clip",
        async setup({ page }) {
            const field = await page.locator("canvas").first().boundingBox();
            return {
                box: {
                    x: field.x,
                    y: field.y,
                    width: Math.min(field.width, 900),
                    height: Math.min(field.height, 560),
                },
            };
        },
        async perform({ page, film, overlay, box }) {
            await overlay.enable();
            const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
            await page.mouse.move(c.x - 150, c.y);
            await film.hold(0.4);
            await film.drag(
                page,
                { x: c.x - 150, y: c.y },
                { x: c.x + 100, y: c.y - 60 },
                1,
                { button: "right" },
            );
            await film.hold(0.5);
            await page.keyboard.down("Shift");
            await film.hold(0.3);
            await page.keyboard.press("KeyA");
            await film.hold(0.6);
            await page.keyboard.up("Shift");
            await film.hold(1.2);
        },
    },
];

export default shots;
