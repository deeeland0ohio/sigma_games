import express from "express";
import { createServer as createViteServer } from "vite";
import compression from "compression";
import path from "path";
import fs from "fs";

try {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    // @ts-ignore
    if (typeof process.loadEnvFile === "function") {
      // @ts-ignore
      process.loadEnvFile(envPath);
    } else {
      const content = fs.readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
          const idx = trimmed.indexOf("=");
          const key = trimmed.slice(0, idx).trim();
          const val = trimmed.slice(idx + 1).trim().replace(/^['"](.*)['"]$/, "$1");
          if (key && !process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  }
} catch (e) {
  console.warn("[Server] Note: Could not load .env file:", e);
}

import apiRouter from "./server/routes/index";

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  app.use(compression());
  app.use(express.json());

  app.use("/api", apiRouter);

  const publicDir = path.join(process.cwd(), "public");
  const distDir = path.join(process.cwd(), "dist");

  app.get("/static.html", (req, res) => {
    const rootPath = path.join(process.cwd(), "static.html");
    const distFallback = path.join(distDir, "static.html");
    if (fs.existsSync(rootPath)) {
      res.sendFile(rootPath);
    } else if (fs.existsSync(distFallback)) {
      res.sendFile(distFallback);
    } else {
      res.status(404).send('Not Found');
    }
  });

  app.get("/static.svg", (req, res) => {
    const rootPath = path.join(process.cwd(), "static.svg");
    const distFallback = path.join(distDir, "static.svg");
    if (fs.existsSync(rootPath)) {
      res.sendFile(rootPath);
    } else if (fs.existsSync(distFallback)) {
      res.sendFile(distFallback);
    } else {
      res.status(404).send('Not Found');
    }
  });

  app.get("/sigmastatic", (req, res) => {
    const rootPath = path.join(process.cwd(), "static.html");
    const distFallback = path.join(distDir, "static.html");
    if (fs.existsSync(rootPath)) {
      res.sendFile(rootPath);
    } else if (fs.existsSync(distFallback)) {
      res.sendFile(distFallback);
    } else {
      res.status(404).send('Not Found');
    }
  });

  if (fs.existsSync(distDir)) {
    const distAssetsDir = path.join(distDir, "assets");
    if (fs.existsSync(distAssetsDir)) {
      app.use("/assets", express.static(distAssetsDir, {
        maxAge: "1y",
        immutable: true
      }));
    }
    app.use(express.static(distDir));
  }
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
  }

  app.use('/games', (req, res) => {
    res.status(404).send('Not Found');
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.get("*", (req, res) => {
      res.sendFile("dist/index.html", { root: "." });
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
