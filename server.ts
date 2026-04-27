import express from "express";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import path from "path";
import { GoogleGenAI } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;

  const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

  app.use(express.json({ limit: '10mb' }));

  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Content-Security-Policy", "frame-ancestors *");
    
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }
    next();
  });

  app.post("/api/gemini", async (req, res) => {
    const { model, contents, config } = req.body;
    try {
      const response = await genAI.models.generateContent({
        model: model,
        contents: contents.contents || contents, // Handle both standard and nested structures
        ...config
      });
      res.json(response);
    } catch (error: any) {
      console.error("Gemini API error:", error);
      res.status(500).json({ error: error.message || "Gemini API error" });
    }
  });

  const proxyRequest = async (req: express.Request, res: express.Response, targetPath: string) => {
    const targetUrl = `http://aibigtree.com${targetPath}`;
    try {
      const response = await axios({
        method: req.method,
        url: targetUrl,
        data: req.body,
        headers: { 'Content-Type': 'application/json' }
      });
      res.status(response.status).json(response.data);
    } catch (error: any) {
      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        res.status(error.response.status).json(error.response.data);
      } else {
        console.error(`代理转发失败 [${targetPath}]:`, error);
        res.status(500).json({ error: "代理转发失败" });
      }
    }
  };

  app.post("/api/tool/launch", (req, res) => proxyRequest(req, res, "/api/tool/launch"));
  app.post("/api/tool/verify", (req, res) => proxyRequest(req, res, "/api/tool/verify"));
  app.post("/api/tool/consume", (req, res) => proxyRequest(req, res, "/api/tool/consume"));

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
