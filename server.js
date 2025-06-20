import wisp from "wisp-server-node";
import { createBareServer } from "@tomphttp/bare-server-node";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import { bareModulePath } from "@mercuryworkshop/bare-as-module3";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import express from "express";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import session from "express-session";
import helmet from "helmet";
import morgan from "morgan";
import fs from "fs";

// --- Production Settings ---
const IN_PROD = process.env.NODE_ENV === "production";
const SESSION_SECRET = process.env.SESSION_SECRET || "change_in_production!";
const PORT = parseInt(process.env.PORT, 10) || 8080;

// --- Logging ---
const logStream = fs.createWriteStream(join(process.cwd(), "access.log"), { flags: "a" });

// --- App Setup ---
const app = express();
app.use(helmet({ contentSecurityPolicy: false })); // CSP is disabled for proxy compatibility
app.use(morgan("combined", { stream: logStream }));

app.set("trust proxy", 1); // Trust first proxy for secure cookies if behind reverse proxy

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: IN_PROD, // true if HTTPS
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 6, // 6 hours
    },
  })
);

// --- Static Files ---
const publicPath = "public";
const __dirname = join(fileURLToPath(import.meta.url), "..");
app.use(express.static(publicPath, { maxAge: "30d", immutable: true }));
app.use("/uv/", express.static(uvPath, { maxAge: "30d", immutable: true }));
app.use("/epoxy/", express.static(epoxyPath, { maxAge: "30d", immutable: true }));
app.use("/baremux/", express.static(baremuxPath, { maxAge: "30d", immutable: true }));
app.use("/baremod/", express.static(bareModulePath, { maxAge: "30d", immutable: true }));

// --- 404 Handler ---
app.use((req, res) => {
  res.status(404);
  res.sendFile(join(__dirname, publicPath, "404.html"));
});

// --- Proxy Engine Integration ---
const bare = createBareServer("/bare/");

// --- HTTP/HTTPS Server ---
const server = createServer();

// --- Cookie Forwarding Patch ---
// If using a recent version of bare/epoxy, cookies are handled. For special cases, patch as needed.

// --- Request Routing ---
server.on("request", (req, res) => {
  // Forward cookies and headers as needed for play.geforcenow.com
  if (bare.shouldRoute(req)) {
    bare.routeRequest(req, res);
  } else {
    app(req, res);
  }
});

server.on("upgrade", (req, socket, head) => {
  if (req.url.endsWith("/wisp/")) {
    wisp.routeRequest(req, socket, head);
  } else if (bare.shouldRoute(req)) {
    bare.routeUpgrade(req, socket, head);
  } else {
    socket.end();
  }
});

// --- Start Server ---
server.listen(PORT, () => {
  const address = server.address();
  const port = typeof address === "string" ? address : address.port;
  console.log(
    `UltraVioletProxy production server running on http://localhost:${port}\n` +
    `NODE_ENV=${process.env.NODE_ENV || "development"}`
  );
});

// --- Graceful Shutdown ---
function shutdown() {
  console.log("SIGTERM signal received: closing HTTP server");
  server.close();
  bare.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
