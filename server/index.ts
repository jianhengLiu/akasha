import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { config } from "./config.ts";
import { createApp } from "./app.ts";

const app = createApp();

app.use("/*", serveStatic({ root: config.staticDir }));
// Single-page app: unknown non-API paths get index.html.
app.get("*", serveStatic({ root: config.staticDir, path: "index.html" }));

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`akasha listening on :${info.port}, paperless at ${config.paperlessUrl}`);
});
