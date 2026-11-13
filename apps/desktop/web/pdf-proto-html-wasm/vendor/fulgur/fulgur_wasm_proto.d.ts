/* tslint:disable */
/* eslint-disable */

/**
 * Builder-style engine that mirrors `fulgur::Engine`'s configuration
 * surface for the WASM target.
 */
export class Engine {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Register a CSS stylesheet (B-3a).
     *
     * All registered CSS is concatenated and injected as a single
     * `<style>` block at render time. Use this for any CSS that the
     * HTML references via `<link rel="stylesheet">` — those tags are
     * not resolved in the WASM target (no async NetProvider yet, see
     * scope 3b in `project_wasm_resource_bridging.md`).
     */
    add_css(css: string): void;
    /**
     * Register a font from raw bytes (TTF / OTF / WOFF2).
     *
     * `wasm-bindgen` accepts a `Uint8Array` from JS for the `bytes`
     * parameter. WOFF2 is decoded to TTF in-process; WOFF1 is rejected.
     * Family name is extracted from the font's `name` table — no
     * `family` argument is needed.
     */
    add_font(bytes: Uint8Array | number[]): void;
    /**
     * Register an image asset (B-3a).
     *
     * `name` is the URL/path key referenced in the HTML — e.g.
     * `<img src="hero.png">` should be registered with `name = "hero.png"`.
     * A leading `./` is normalised away so `./hero.png` and `hero.png`
     * resolve to the same asset.
     * The supported formats are whatever fulgur's image pipeline accepts
     * (PNG / JPEG / GIF / etc.); decoding happens at render time.
     */
    add_image(name: string, bytes: Uint8Array | number[]): void;
    /**
     * Apply configuration options from a JS object (B-3c).
     *
     * 受け付けるキーは `pageSize` / `margin` / `landscape` / `title` /
     * `authors` / `description` / `keywords` / `creator` / `producer` /
     * `creationDate` / `lang` / `bookmarks`。`pageSize` は CSS Paged Media
     * keyword 文字列 (`"A3"` / `"A4"` / `"A5"` / `"B4"` / `"B5"` /
     * `"JIS-B4"` / `"JIS-B5"` / `"Letter"` / `"Legal"` / `"Ledger"`、
     * 大文字小文字無視) か `{ widthMm, heightMm }` object。
     * `margin` は `{ mm }` / `{ pt }` / `{ topMm, rightMm, bottomMm,
     * leftMm }` のいずれか。未知のキーや不明な page size 名はエラー。
     * 複数回呼び出すと後勝ちで partial merge される。
     *
     * 内部実装は `JSON.stringify` で options を一度文字列化してから
     * `serde_json::from_str` で deserialize する。`serde-wasm-bindgen`
     * の `Reflect::get` ベースの deserializer は `deny_unknown_fields`
     * を honor せず typo を silently 通してしまうため、検証ゲートを
     * 効かせる経路として JSON 経由を採用している。副次効果として、JS の
     * `NaN` / `Infinity` は `JSON.stringify` で `null` に化けるため
     * `f32` フィールドの deserialize が型エラーで失敗し、非有限な
     * `widthMm` 等はここで弾かれる。負値や margin が content area を
     * 潰す組み合わせは構文的に正当な数値なので通るが、`render()` が
     * 呼び出す `fulgur::Config::validate` が最終的に弾く。
     */
    configure(options: any): void;
    /**
     * Create a new engine with no registered assets.
     */
    constructor();
    /**
     * Render the given HTML string to a PDF byte array.
     */
    render(html: string): Uint8Array;
}

/**
 * Render the given HTML string to a PDF byte array (B-1 compatible).
 *
 * Equivalent to `Engine::new().render(html)`. Kept for back-compat with
 * callers built against the B-1 API; new code should use [`Engine`].
 */
export function render_html(html: string): Uint8Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_engine_free: (a: number, b: number) => void;
    readonly engine_add_css: (a: number, b: number, c: number) => void;
    readonly engine_add_font: (a: number, b: number, c: number, d: number) => void;
    readonly engine_add_image: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly engine_configure: (a: number, b: number, c: any) => void;
    readonly engine_new: () => number;
    readonly engine_render: (a: number, b: number, c: number, d: number) => void;
    readonly render_html: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export4: (a: number) => void;
    readonly __wbindgen_export5: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export6: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
