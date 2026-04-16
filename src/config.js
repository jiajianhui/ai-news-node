const path = require("path");

// 抓取结果统一落到 data/ 目录，便于接口读取最近一次结果。
const STORAGE_DIR = path.join(__dirname, "..", "data");
const DIGEST_FILE = path.join(STORAGE_DIR, "latest-digest.json");

// 当前项目使用的新闻源配置；后续扩展时继续在这里增减即可。
const NEWS_SOURCES = [
  {
    name: "Google News - AI",
    url: "https://news.google.com/rss/search?q=AI&hl=en-US&gl=US&ceid=US:en",
  },
  {
    name: "OpenAI Newsroom",
    url: "https://openai.com/news/rss.xml",
  },
  {
    name: "Anthropic Newsroom",
    url: "https://www.anthropic.com/news/rss",
  },
];

// 关键词决定一条新闻是否被视为 AI 相关新闻。
const AI_KEYWORDS = [
  "ai",
  "artificial intelligence",
  "gpt",
  "llm",
  "agent",
  "openai",
  "anthropic",
  "claude",
  "gemini",
  "deepseek",
  "model",
  "inference",
  "machine learning",
];

module.exports = {
  AI_KEYWORDS,
  DIGEST_FILE,
  NEWS_SOURCES,
  STORAGE_DIR,
};
