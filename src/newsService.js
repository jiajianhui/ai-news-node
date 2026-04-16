const fs = require("fs/promises");
const { AI_KEYWORDS, DIGEST_FILE, NEWS_SOURCES, STORAGE_DIR } = require("./config");

async function runNewsPipeline() {
  // 并发抓取所有已配置的源；即使某个源失败，也尽量保留其他源的结果。
  const feedResults = await Promise.allSettled(
    NEWS_SOURCES.map(async (source) => {
      const xml = await fetchText(source.url);
      const items = parseFeed(xml, source);

      return items.map((item) => ({
        ...item,
        source: source.name,
      }));
    })
  );

  const allItems = [];
  const errors = [];

  for (const result of feedResults) {
    if (result.status === "fulfilled") {
      allItems.push(...result.value);
      continue;
    }

    errors.push(result.reason?.message || "Unknown fetch error");
  }

  const normalizedItems = normalizeItems(allItems);
  const filteredItems = filterAiNews(normalizedItems);
  const dedupedItems = dedupeByLink(filteredItems).slice(0, 20);
  const digest = buildDigest(dedupedItems, errors);

  // 将最近一次日报写入本地文件，避免每次读取都重新抓取。
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  await fs.writeFile(DIGEST_FILE, JSON.stringify(digest, null, 2), "utf8");

  return digest;
}

async function readLatestDigest() {
  try {
    const content = await fs.readFile(DIGEST_FILE, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        generatedAt: null,
        summary: "还没有生成日报，先点击“立即抓取”或者调用 POST /api/news/run。",
        items: [],
        errors: [],
      };
    }

    throw error;
  }
}

async function fetchText(url) {
  // 这里是真实的网络请求，不是本地写死的模拟数据。
  const response = await fetch(url, {
    headers: {
      "user-agent": "ai-news-demo/1.0",
      accept: "application/rss+xml, application/xml, text/xml, text/plain",
    },
  });

  if (!response.ok) {
    throw new Error(`Fetch failed for ${url}: ${response.status}`);
  }

  return response.text();
}

function parseFeed(xml, source) {
  // RSS 和 Atom 的结构不同，先判断类型再分发到对应解析函数。
  const trimmed = xml.trim();

  if (trimmed.includes("<feed")) {
    return parseAtomFeed(trimmed, source);
  }

  return parseRssFeed(trimmed, source);
}

function parseRssFeed(xml) {
  return extractBlocks(xml, "item")
    .map((itemXml) => ({
      title: decodeXml(readTag(itemXml, "title")),
      link: decodeXml(readTag(itemXml, "link")),
      description: decodeXml(readTag(itemXml, "description") || readTag(itemXml, "content:encoded")),
      publishedAt: readTag(itemXml, "pubDate"),
    }))
    .filter((item) => item.title && item.link);
}

function parseAtomFeed(xml) {
  return extractBlocks(xml, "entry")
    .map((entryXml) => ({
      title: decodeXml(readTag(entryXml, "title")),
      link: readAtomLink(entryXml),
      description: decodeXml(readTag(entryXml, "summary") || readTag(entryXml, "content")),
      publishedAt: readTag(entryXml, "published") || readTag(entryXml, "updated"),
    }))
    .filter((item) => item.title && item.link);
}

function extractBlocks(xml, tagName) {
  // 用正则做轻量提取，保持示例无额外依赖；但这里并不是完整 XML 解析器。
  const pattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  const blocks = [];
  let match = pattern.exec(xml);

  while (match) {
    blocks.push(match[0]);
    match = pattern.exec(xml);
  }

  return blocks;
}

function readTag(xml, tagName) {
  const pattern = new RegExp(`<${escapeRegExp(tagName)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegExp(tagName)}>`, "i");
  const match = xml.match(pattern);
  return match ? stripCdata(match[1]).trim() : "";
}

function readAtomLink(xml) {
  const hrefMatch = xml.match(/<link\b[^>]*href="([^"]+)"[^>]*\/?>/i);
  if (hrefMatch) {
    return decodeXml(hrefMatch[1]);
  }

  return decodeXml(readTag(xml, "link"));
}

function stripCdata(value) {
  return value.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeItems(items) {
  // 先把不同来源的数据整理成统一结构，后续过滤和排序都基于这份标准格式。
  return items.map((item) => {
    const publishedAt = normalizeDate(item.publishedAt);

    return {
      title: item.title,
      link: item.link,
      description: item.description || "",
      publishedAt,
      source: item.source,
    };
  });
}

function filterAiNews(items) {
  // 当前用关键词匹配来判断一条新闻是否属于 AI 相关内容。
  return items.filter((item) => {
    const haystack = `${item.title} ${item.description}`.toLowerCase();
    return AI_KEYWORDS.some((keyword) => haystack.includes(keyword));
  });
}

function dedupeByLink(items) {
  // 先按时间倒序，再按链接去重，避免不同源重复收录同一篇文章。
  const seen = new Set();
  const sorted = [...items].sort((left, right) => {
    const leftTs = left.publishedAt ? Date.parse(left.publishedAt) : 0;
    const rightTs = right.publishedAt ? Date.parse(right.publishedAt) : 0;
    return rightTs - leftTs;
  });

  return sorted.filter((item) => {
    const key = item.link.toLowerCase();

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function buildDigest(items, errors) {
  // 同时保留完整列表和精简高亮，分别给接口和页面展示使用。
  const topItems = items.slice(0, 8);
  const lines = topItems.map((item, index) => {
    const dateText = item.publishedAt ? item.publishedAt.slice(0, 10) : "未知时间";
    return `${index + 1}. [${item.source}] ${item.title} (${dateText})`;
  });

  return {
    generatedAt: new Date().toISOString(),
    summary:
      topItems.length > 0
        ? `本次共抓到 ${items.length} 条 AI 相关新闻，以下是前 ${topItems.length} 条重点。`
        : "这次没有筛到符合关键词的 AI 新闻，你可以调整来源或关键词。",
    items,
    highlights: lines,
    errors,
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return null;
  }

  return new Date(timestamp).toISOString();
}

module.exports = {
  readLatestDigest,
  runNewsPipeline,
};
