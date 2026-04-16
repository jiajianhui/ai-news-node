const path = require("path");

const STORAGE_DIR = path.join(__dirname, "..", "data");
const DIGEST_FILE = path.join(STORAGE_DIR, "latest-digest.json");

const NEWS_SOURCES = [
  {
    name: "Google News - AI",
    type: "rss",
    url: "https://news.google.com/rss/search?q=AI&hl=en-US&gl=US&ceid=US:en",
  },
  {
    name: "OpenAI Newsroom",
    type: "rss",
    url: "https://openai.com/news/rss.xml",
  },
  {
    name: "Anthropic Newsroom",
    type: "rss",
    url: "https://www.anthropic.com/news/rss",
  },
];

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
