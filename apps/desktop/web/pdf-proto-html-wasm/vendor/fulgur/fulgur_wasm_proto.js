/* @ts-self-types="./fulgur_wasm_proto.d.ts" */

/**
 * Builder-style engine that mirrors `fulgur::Engine`'s configuration
 * surface for the WASM target.
 */
export class Engine {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        EngineFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_engine_free(ptr, 0);
    }
    /**
     * Register a CSS stylesheet (B-3a).
     *
     * All registered CSS is concatenated and injected as a single
     * `<style>` block at render time. Use this for any CSS that the
     * HTML references via `<link rel="stylesheet">` — those tags are
     * not resolved in the WASM target (no async NetProvider yet, see
     * scope 3b in `project_wasm_resource_bridging.md`).
     * @param {string} css
     */
    add_css(css) {
        const ptr0 = passStringToWasm0(
            css,
            wasm.__wbindgen_export,
            wasm.__wbindgen_export2,
        );
        const len0 = WASM_VECTOR_LEN;
        wasm.engine_add_css(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Register a font from raw bytes (TTF / OTF / WOFF2).
     *
     * `wasm-bindgen` accepts a `Uint8Array` from JS for the `bytes`
     * parameter. WOFF2 is decoded to TTF in-process; WOFF1 is rejected.
     * Family name is extracted from the font's `name` table — no
     * `family` argument is needed.
     * @param {Uint8Array | number[]} bytes
     */
    add_font(bytes) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            wasm.engine_add_font(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeFromExternrefTable0(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Register an image asset (B-3a).
     *
     * `name` is the URL/path key referenced in the HTML — e.g.
     * `<img src="hero.png">` should be registered with `name = "hero.png"`.
     * A leading `./` is normalised away so `./hero.png` and `hero.png`
     * resolve to the same asset.
     * The supported formats are whatever fulgur's image pipeline accepts
     * (PNG / JPEG / GIF / etc.); decoding happens at render time.
     * @param {string} name
     * @param {Uint8Array | number[]} bytes
     */
    add_image(name, bytes) {
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passStringToWasm0(
                name,
                wasm.__wbindgen_export,
                wasm.__wbindgen_export2,
            );
            len0 = WASM_VECTOR_LEN;
            ptr1 = passArray8ToWasm0(bytes, wasm.__wbindgen_export);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) {
                wasm.__wbindgen_export3(ptr1, len1 * 1, 1);
            }
            if (ptr0) {
                wasm.__wbindgen_export3(ptr0, len0 * 1, 1);
            }
            throw e;
        }
        wasm.engine_add_image(this.__wbg_ptr, ptr0, len0, ptr1, len1);
    }
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
     * @param {any} options
     */
    configure(options) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            wasm.engine_configure(retptr, this.__wbg_ptr, options);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeFromExternrefTable0(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Create a new engine with no registered assets.
     */
    constructor() {
        const ret = wasm.engine_new();
        this.__wbg_ptr = ret;
        EngineFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Render the given HTML string to a PDF byte array.
     * @param {string} html
     * @returns {Uint8Array}
     */
    render(html) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const ptr0 = passStringToWasm0(
                html,
                wasm.__wbindgen_export,
                wasm.__wbindgen_export2,
            );
            const len0 = WASM_VECTOR_LEN;
            wasm.engine_render(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            if (r3) {
                throw takeFromExternrefTable0(r2);
            }
            var v2 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export3(r0, r1 * 1, 1);
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) Engine.prototype[Symbol.dispose] = Engine.prototype.free;

/**
 * Render the given HTML string to a PDF byte array (B-1 compatible).
 *
 * Equivalent to `Engine::new().render(html)`. Kept for back-compat with
 * callers built against the B-1 API; new code should use [`Engine`].
 * @param {string} html
 * @returns {Uint8Array}
 */
export function render_html(html) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        const ptr0 = passStringToWasm0(
            html,
            wasm.__wbindgen_export,
            wasm.__wbindgen_export2,
        );
        const len0 = WASM_VECTOR_LEN;
        wasm.render_html(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeFromExternrefTable0(r2);
        }
        var v2 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export3(r0, r1 * 1, 1);
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_208446807d0d1e30: function (arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg___wbindgen_string_get_7ce8eee7fd327545: function (arg0, arg1) {
            const obj = arg1;
            const ret = typeof obj === "string" ? obj : undefined;
            var ptr1 = isLikeNone(ret)
                ? 0
                : passStringToWasm0(
                      ret,
                      wasm.__wbindgen_export,
                      wasm.__wbindgen_export2,
                  );
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 1, len1, true);
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_4c88d8bf264fd984: function (arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_stringify_0a0fbf2ef722380a: function () {
            return handleError(function (arg0) {
                const ret = JSON.stringify(arg0);
                return ret;
            }, arguments);
        },
        __wbindgen_init_externref_table: function () {
            const table = wasm.__wbindgen_externrefs;
            table.set(0, undefined);
            table.set(1024, undefined);
            table.set(1025, null);
            table.set(1026, true);
            table.set(1027, false);
        },
    };
    return {
        __proto__: null,
        "./fulgur_wasm_proto_bg.js": import0,
    };
}

const EngineFinalization =
    typeof FinalizationRegistry === "undefined"
        ? { register: () => {}, unregister: () => {} }
        : new FinalizationRegistry((ptr) => wasm.__wbg_engine_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__wbindgen_export5();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (
        cachedDataViewMemory0 === null ||
        cachedDataViewMemory0.buffer.detached === true ||
        (cachedDataViewMemory0.buffer.detached === undefined &&
            cachedDataViewMemory0.buffer !== wasm.memory.buffer)
    ) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (
        cachedUint8ArrayMemory0 === null ||
        cachedUint8ArrayMemory0.byteLength === 0
    ) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_export4(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0()
            .subarray(ptr, ptr + buf.length)
            .set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7f) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, (len = offset + arg.length * 3), 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__wbindgen_export6(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(bytes) {
    numBytesDecoded += bytes.length;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true });
        cachedTextDecoder.decode();
        numBytesDecoded = bytes.length;
    }
    return cachedTextDecoder.decode(bytes);
}

const cachedTextEncoder = new TextEncoder();

if (!("encodeInto" in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length,
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === "function" && module instanceof Response) {
        if (!module.ok) {
            throw new Error(
                `failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`,
            );
        }

        if (typeof WebAssembly.instantiateStreaming === "function") {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (
                    validResponse &&
                    module.headers.get("Content-Type") !== "application/wasm"
                ) {
                    console.warn(
                        "`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n",
                        e,
                    );
                } else {
                    throw e;
                }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case "basic":
            case "cors":
            case "default":
                return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;

    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({ module } = module);
        } else {
            console.warn(
                "using deprecated parameters for `initSync()`; pass a single object instead",
            );
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

let __wbg_init_promise;
async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;
    if (__wbg_init_promise === undefined) {
        __wbg_init_promise = __wbg_init_once(module_or_path);
        __wbg_init_promise.catch(() => {
            __wbg_init_promise = undefined;
        });
    }
    return __wbg_init_promise;
}

async function __wbg_init_once(module_or_path) {
    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({ module_or_path } = module_or_path);
        } else {
            console.warn(
                "using deprecated parameters for the initialization function; pass a single object instead",
            );
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL("fulgur_wasm_proto_bg.wasm", import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (
        typeof module_or_path === "string" ||
        (typeof Request === "function" && module_or_path instanceof Request) ||
        (typeof URL === "function" && module_or_path instanceof URL)
    ) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(
        await module_or_path,
        imports,
    );

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
