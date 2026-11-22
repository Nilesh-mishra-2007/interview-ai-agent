// THE WEB SERVER - start here.
// Serves /api/... routes from routes.js and static pages from public/.
// Also starts the optional background AI Job Agent scanner.
// Zero npm dependencies — uses only Node.js 22 built-ins.

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const { routes, getCookie } = require("./routes");
const auth = require("./auth");
const { startBackgroundAgent } = require("./jobs");
const { AppError } = require("./errors");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_BODY_BYTES = 5 * 1024 * 1024; // allows 3 MB PDF encoded as base64

const compiledRoutes = routes.map((route) => ({
  ...route,
  pattern: new RegExp("^" + route.path.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"),
}));

// ---------- reading request body ----------

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers["content-length"] || 0) > MAX_BODY_BYTES) {
      return reject(new AppError(413, "Upload is too large"));
    }
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new AppError(413, "Upload is too large"));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        resolve(body && typeof body === "object" ? body : {});
      } catch {
        reject(new AppError(400, "Invalid JSON request"));
      }
    });
    req.on("error", reject);
  });
}

// ---------- API dispatcher ----------

async function handleApi(req, res, pathname) {
  let match = null;
  let route = null;
  for (const candidate of compiledRoutes) {
    if (candidate.method !== req.method) continue;
    match = pathname.match(candidate.pattern);
    if (match) {
      route = candidate;
      break;
    }
  }
  if (!route) throw new AppError(404, "Not found");

  const ctx = {
    req,
    params: match.groups || {},
    body: {},
    user: null,
    status: 200,
    headers: {},
    rawContentType: null,
  };

  if (route.login) {
    ctx.user = auth.getUserFromToken(getCookie(req, "session"));
    if (!ctx.user) throw new AppError(401, "Please log in");
  }
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "DELETE") {
    ctx.body = await readJsonBody(req);
  }

  const data = await route.handler(ctx);

  if (ctx.rawContentType) {
    res.writeHead(ctx.status, {
      "Content-Type": ctx.rawContentType,
      "Cache-Control": "no-store",
      ...ctx.headers,
    });
    res.end(data);
    return;
  }

  res.writeHead(ctx.status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...ctx.headers,
  });
  res.end(JSON.stringify(data));
}

function sendJsonError(res, status, message) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ message }));
}

// ---------- Static files ----------

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function serveFile(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") return sendJsonError(res, 405, "Method not allowed");

  if (pathname === "/") pathname = "/index.html";
  const filePath = path.join(PUBLIC_DIR, path.normalize(pathname));

  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return sendJsonError(res, 403, "Forbidden");

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Page not found");
    }
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
    });
    res.end(req.method === "HEAD" ? undefined : content);
  });
}

// ---------- Server startup ----------

const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://avatars.githubusercontent.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  );

  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, pathname);
    } else {
      serveFile(req, res, pathname);
    }
  } catch (err) {
    if (res.headersSent) return;
    if (err instanceof AppError) return sendJsonError(res, err.status, err.message);
    console.error(err);
    sendJsonError(res, 500, "Something went wrong on the server");
  }
});

server.listen(PORT, () => {
  console.log(`Interview AI Career Agent is running:  http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENAI_API_KEY) {
    console.log("WARNING: GEMINI_API_KEY is not set - AI features will not work yet.");
  }
  startBackgroundAgent();
});
