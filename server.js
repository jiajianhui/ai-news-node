const express = require("express");
const path = require("path");
const { runNewsPipeline, readLatestDigest } = require("./src/newsService");

const app = express();
const PORT = Number(process.env.PORT || 3000);

// 解析 JSON 请求体，并暴露 public/ 下的静态页面。
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// 最基础的健康检查接口，用来确认服务进程是否正常响应。
app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    service: "ai-news-node",
    now: new Date().toISOString(),
  });
});

// 读取本地缓存的最近一次日报，不主动触发抓取。
app.get("/api/news/latest", async (_request, response) => {
  try {
    const digest = await readLatestDigest();
    response.json({
      ok: true,
      data: digest,
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

// 手动触发一次完整抓取流程，并返回最新生成的日报。
app.post("/api/news/run", async (_request, response) => {
  try {
    const digest = await runNewsPipeline();
    response.json({
      ok: true,
      message: "AI 新闻抓取完成",
      data: digest,
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

// 启动 HTTP 服务，默认监听 3000 端口。
app.listen(PORT, () => {
  console.log(`AI news demo is running at http://localhost:${PORT}`);
});
