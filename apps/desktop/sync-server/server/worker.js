// The Worker in front of the sessions (docs/collaboration/spike/CONTRACT.md, "HTTP endpoints"):
// "make collaborative" creates a session from an uploaded snapshot, and each show's snapshot
// and WebSocket requests go to its one Durable Object. Local only (wrangler dev).
export { ShowSession } from "./session.js";

// The renderer runs on another origin (Vite, the browser harness), so the JSON endpoints allow
// any origin. Spike only: there are no accounts and nothing is deployed.
const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

function withCors(response) {
    if (response.webSocket) return response;
    const out = new Response(response.body, response);
    for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
    return out;
}

async function route(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/sessions" && request.method === "POST") {
        const body = await request.text();
        const id = env.SHOWS.newUniqueId();
        const res = await env.SHOWS.get(id).fetch("https://session/init", {
            method: "POST",
            body,
        });
        if (!res.ok) return res;
        const { ownerToken, droppedColumns } = await res.json();
        return Response.json({
            sessionId: id.toString(),
            ownerToken,
            droppedColumns,
        });
    }
    const match = url.pathname.match(
        /^\/api\/sessions\/([0-9a-f]{64})\/(snapshot|ws)$/,
    );
    if (match) {
        let id;
        try {
            id = env.SHOWS.idFromString(match[1]);
        } catch {
            // not an id this namespace made
            return Response.json({ error: "No such session" }, { status: 404 });
        }
        return env.SHOWS.get(id).fetch(request);
    }
    if (url.pathname === "/")
        return new Response("OpenMarch sync server (spike)");
    return Response.json({ error: "Not found" }, { status: 404 });
}

const worker = {
    async fetch(request, env) {
        if (request.method === "OPTIONS")
            return new Response(null, { status: 204, headers: CORS });
        return withCors(await route(request, env));
    },
};
export default worker;
