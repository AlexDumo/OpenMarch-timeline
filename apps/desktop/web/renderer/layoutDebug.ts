// cspell:words standalone
/**
 * Preview-only diagnostic (always on, temporarily): shows the
 * sizes the browser reports and where the app frame ends, to track down a
 * gap at the bottom of the screen on a real iPad. Not for upstream.
 */
export function startLayoutDebug() {
    // Always on in the preview for now: a Home Screen app can't take a
    // ?debug address. Remove before the class uses the preview.

    const probe = document.createElement("div");
    probe.style.cssText =
        "position:fixed;left:0;top:0;width:0;height:0;" +
        "padding:env(safe-area-inset-top) env(safe-area-inset-right) " +
        "env(safe-area-inset-bottom) env(safe-area-inset-left);visibility:hidden";
    document.body.appendChild(probe);

    const box = document.createElement("pre");
    box.style.cssText =
        "position:fixed;z-index:2147483647;left:50%;top:40%;transform:translate(-50%,-50%);" +
        "margin:0;padding:10px 12px;border-radius:8px;background:rgba(0,0,0,.85);" +
        "color:#fff;font:12px/1.5 ui-monospace,monospace;pointer-events:none;white-space:pre";
    document.body.appendChild(box);

    // A 2 px red line along the very bottom edge of the screen (the layout
    // viewport): if a gap shows below it, the gap is outside the page.
    const edge = document.createElement("div");
    edge.style.cssText =
        "position:fixed;z-index:2147483647;left:0;right:0;bottom:0;height:2px;background:red;pointer-events:none";
    document.body.appendChild(edge);

    const update = () => {
        const frame = document.querySelector("main.app-frame");
        const rect = frame?.getBoundingClientRect();
        const pad = getComputedStyle(probe);
        const vv = window.visualViewport;
        const standalone =
            (navigator as { standalone?: boolean }).standalone === true ||
            matchMedia("(display-mode: standalone)").matches;
        box.textContent = [
            `mode        ${standalone ? "Home Screen app" : "browser tab"}`,
            `screen      ${window.screen.width} × ${window.screen.height}  dpr ${devicePixelRatio}`,
            `inner       ${window.innerWidth} × ${window.innerHeight}`,
            `visual vp   ${vv ? `${Math.round(vv.width)} × ${Math.round(vv.height)} @ ${Math.round(vv.offsetTop)}` : "n/a"}`,
            `html client ${document.documentElement.clientWidth} × ${document.documentElement.clientHeight}`,
            `safe area   t ${pad.paddingTop} r ${pad.paddingRight} b ${pad.paddingBottom} l ${pad.paddingLeft}`,
            `app frame   ${rect ? `top ${Math.round(rect.top)} bottom ${Math.round(rect.bottom)} height ${Math.round(rect.height)}` : "not found"}`,
            `frame pad   b ${frame ? getComputedStyle(frame).paddingBottom : "?"}`,
            `scroll      ${Math.round(window.scrollY)} / doc ${document.documentElement.scrollHeight}`,
        ].join("\n");
    };
    update();
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    setInterval(update, 1000);
}
