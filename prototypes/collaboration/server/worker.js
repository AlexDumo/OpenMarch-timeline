// The Worker in front of the sessions: creates a session from an uploaded snapshot and routes
// each show's WebSockets to its one Durable Object. Static files come from ../public.
export { ShowSession } from "./session.js";

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === "/api/sessions" && request.method === "POST") {
            // "Make collaborative": upload a snapshot, get a session and the head writer's token
            const snapshot = await request.text();
            const id = env.SHOWS.newUniqueId();
            const res = await env.SHOWS.get(id).fetch("https://session/init", {
                method: "POST",
                body: snapshot,
            });
            if (!res.ok) return res;
            const { headToken } = await res.json();
            return Response.json({ sessionId: id.toString(), headToken });
        }
        const match = url.pathname.match(
            /^\/api\/sessions\/([0-9a-f]{64})(\/.*)?$/,
        );
        if (match) {
            let id;
            try {
                id = env.SHOWS.idFromString(match[1]);
            } catch {
                return new Response("Bad session id", { status: 400 });
            }
            return env.SHOWS.get(id).fetch(request);
        }
        return env.ASSETS.fetch(request);
    },
};
