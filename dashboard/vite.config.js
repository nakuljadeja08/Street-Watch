import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");

// Dev only: serve the Vercel functions in ../api (GET/POST web handlers) from
// the Vite dev server, with the repo-root .env loaded into process.env, so the
// AI features work under `npm run dev` exactly as they do on Vercel.
function vercelApi() {
  return {
    name: "street-watch-api",
    apply: "serve",
    configureServer(server) {
      Object.assign(process.env, loadEnv("development", ROOT, ""));
      server.middlewares.use("/api", async (req, res) => {
        try {
          const url = new URL(req.url, "http://localhost");
          const name = url.pathname.replace(/^\/+|\/+$/g, "");
          if (!/^[a-z][a-z0-9-]*$/.test(name)) throw Object.assign(new Error("Not found"), { status: 404 });
          const file = path.join(ROOT, "api", `${name}.js`);
          const mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
          const handler = mod[req.method];
          if (!handler) throw Object.assign(new Error("Method not allowed"), { status: 405 });
          const chunks = [];
          for await (const c of req) chunks.push(c);
          const body = chunks.length ? Buffer.concat(chunks) : undefined;
          const request = new Request(`http://localhost/api${req.url}`, {
            method: req.method,
            headers: req.headers,
            body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
          });
          const response = await handler(request);
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (e) {
          const missing = e.code === "ERR_MODULE_NOT_FOUND";
          res.statusCode = e.status || (missing ? 404 : 500);
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: missing ? "Not found" : e.message }));
        }
      });
    },
  };
}

// base: "./" keeps asset paths relative so the built dist/ works whether it's
// served from a domain root (Netlify/Vercel) or a subpath (GitHub Pages).
export default defineConfig({
  plugins: [react(), vercelApi()],
  base: "./",
});
