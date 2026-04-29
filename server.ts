import express from "express";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";

async function startServer() {
  const app = express();
  const PORT = 3000;

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

  app.use(express.json({ limit: '50mb' }));

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

  // Robust API route handling
  const apiRouter = express.Router();

  apiRouter.use((req, res, next) => {
    console.log(`[API Router] ${req.method} ${req.path}`);
    next();
  });

  apiRouter.post("/gemini", async (req, res) => {
    console.log("Handling /api/gemini via router");
    const { model, contents, config } = req.body;
    try {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is not set in environment");
      }
      const geminiModel = genAI.getGenerativeModel({ model });
      const result = await geminiModel.generateContent({
        contents: contents.contents || contents,
        generationConfig: config
      });
      const response = await result.response;
      // Ensure we send back a clean JSON
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
        res.status(error.response.status).json(error.response.data);
      } else {
        console.error(`代理转发失败 [${targetPath}]:`, error);
        res.status(500).json({ error: "代理转发失败" });
      }
    }
  };

  apiRouter.post("/tool/launch", (req, res) => proxyRequest(req, res, "/api/tool/launch"));
  apiRouter.post("/tool/verify", (req, res) => proxyRequest(req, res, "/api/tool/verify"));
  apiRouter.post("/tool/consume", (req, res) => proxyRequest(req, res, "/api/tool/consume"));

  app.use("/api", apiRouter);

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
