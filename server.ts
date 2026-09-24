import express from "express";
import { createServer as createViteServer } from "vite";
import compression from "compression";
import path from "path";
import fs from "fs";
import apiRouter from "./server/routes/index";
import { gameAssetInterceptor } from "./server/middleware/gameAssetInterceptor";

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // Middleware
  app.use(compression());
  app.use(express.json());

  // Modular API Routes
  app.use("/api", apiRouter);

  // Intercept local game HTML to inject storage polyfill & fix CDN hashes
  app.get(["/games/*/index.html", "/games/*"], gameAssetInterceptor);

  const publicDir = path.join(process.cwd(), "public");
  const distDir = path.join(process.cwd(), "dist");

  // Serve static fallback files directly from workspace root or dist
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

  // Compatibility route for /sigmastatic
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

  // Serve public and dist static directories BEFORE /games 404 fallback
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
  }
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
  }
  
  // Prevent missing local game assets from hitting Vite middleware / SPA fallback
  app.use('/games', (req, res) => {
    res.status(404).send('Not Found');
  });

  // Vite development middleware vs production static handler
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
