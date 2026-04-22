import express from "express";
import axios from "axios";

const app = express();
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
  } catch (error) {
    console.error(`代理转发失败 [${targetPath}]:`, error);
    res.status(500).json({ error: "代理转发失败" });
  }
};

app.post("/api/tool/launch", (req, res) => proxyRequest(req, res, "/api/tool/launch"));
app.post("/api/tool/verify", (req, res) => proxyRequest(req, res, "/api/tool/verify"));
app.post("/api/tool/consume", (req, res) => proxyRequest(req, res, "/api/tool/consume"));

export default app;
