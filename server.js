const express = require("express");
const path = require("path");
const { runNewsPipeline, readLatestDigest } = require("./src/newsService");

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    service: "ai-news-node",
    now: new Date().toISOString(),
  });
});

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

app.listen(PORT, () => {
  console.log(`AI news demo is running at http://localhost:${PORT}`);
});
