// Dev entry: loaded by @hono/vite-dev-server inside the single `npm run dev`
// process. Vite serves the React SPA; this app handles the backend paths.
import "./load-env.js";
import { bootstrap } from "./bootstrap.js";
import { createApp } from "./app.js";

await bootstrap();

export default createApp();
