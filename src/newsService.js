const fs = require("fs/promises");
const { AI_KEYWORDS, DIGEST_FILE, NEWS_SOURCES, STORAGE_DIR } = require("./config");

// 这个模块负责新闻抓取、解析、过滤、去重和 digest 持久化。
// RSS / Atom 都是网站提供的文章列表订阅格式，本质上都是 XML。
// 阅读顺序建议：先看 runNewsPipeline，再看 parseFeed / parseRssFeed / parseAtomFeed，
// 最后看 normalizeItems / filterAiNews / dedupeByLink / buildDigest。

// 总入口：并发抓取所有源，汇总后生成 digest 并写入本地文件。
async function runNewsPipeline() {
  const feedResults = await Promise.allSettled(
    // 1. 遍历所有新闻源并发执行抓取任务。
    //    map(...) 会返回一个新数组；...item 表示把原字段展开后再补 source。
    //    Promise.allSettled() 会保留每个源的成功/失败结果，不会因为一个源报错就整体中断。
    NEWS_SOURCES.map(async (source) => {
      // 2. fetchText：请求当前源的 RSS / Atom XML 原文。
      const xml = await fetchText(source.url);

      // 3. parseFeed：把 XML 解析成新闻条目数组。
      const items = parseFeed(xml);

      // 4. 给每条新闻补上来源名，后面摘要展示时会用到。
      return items.map((item) => ({
        ...item,
        source: source.name,
      }));
    }),
  );

  const allItems = [];
  const errors = [];

  // 5. 汇总并发抓取结果：成功的新闻合并到 allItems，失败信息记到 errors。
  //    Promise.allSettled() 的每一项只会有两种状态。
  //    fulfilled 表示成功，结果在 result.value；rejected 表示失败，错误在 result.reason。
  for (const result of feedResults) {
    if (result.status === "fulfilled") {
      allItems.push(...result.value);
      continue;
    }

    errors.push(result.reason?.message || "Unknown fetch error");
  }

  // 6. normalizeItems：把不同源返回的字段整理成统一结构，并标准化发布时间。
  const normalizedItems = normalizeItems(allItems);

  // 7. filterAiNews：用标题和摘要做关键词匹配，只保留 AI 相关新闻。
  const filteredItems = filterAiNews(normalizedItems);

  // 8. dedupeByLink：先按发布时间倒序，再按 link 去重，最后只保留前 20 条。
  const dedupedItems = dedupeByLink(filteredItems).slice(0, 20);

  // 9. buildDigest：把结果包装成最终摘要对象 digest，包含 summary、items、highlights、errors。
  const digest = buildDigest(dedupedItems, errors);

  // 10. 把本次结果写入本地文件，避免每次读取都重新抓取。
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  await fs.writeFile(DIGEST_FILE, JSON.stringify(digest, null, 2), "utf8");

  return digest;
}

// 对外读取入口：读取最近一次已生成的 digest；如果文件还不存在，返回空结果。
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

// 抓取 XML 原文：向新闻源发起 HTTP 请求，拿到 RSS / Atom 文本。
async function fetchText(url) {
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

// 解析入口：根据 XML 结构判断是 RSS 还是 Atom，再分发给对应解析函数。
function parseFeed(xml) {
  const trimmed = xml.trim();

  if (trimmed.includes("<feed")) {
    return parseAtomFeed(trimmed);
  }

  return parseRssFeed(trimmed);
}

// RSS 解析：RSS 的每篇文章通常放在 <item>...</item> 里。
function parseRssFeed(xml) {
  return extractBlocks(xml, "item")
    .map((itemXml) => ({
      title: decodeXml(readTag(itemXml, "title")),
      link: decodeXml(readTag(itemXml, "link")),
      // 不同 RSS 源摘要字段可能不同，这里做兼容。
      description: decodeXml(readTag(itemXml, "description") || readTag(itemXml, "content:encoded")),
      publishedAt: readTag(itemXml, "pubDate"),
    }))
    .filter((item) => item.title && item.link);
}

// Atom 解析：Atom 的每篇文章通常放在 <entry>...</entry> 里。
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

// XML 辅助：用正则抽取某类标签的完整块，比如所有 <item>...</item>。
function extractBlocks(xml, tagName) {
  const pattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  const blocks = [];
  let match = pattern.exec(xml);

  while (match) {
    blocks.push(match[0]);
    match = pattern.exec(xml);
  }

  return blocks;
}

// XML 辅助：读取某个 XML 块里指定标签的文本内容。
function readTag(xml, tagName) {
  const pattern = new RegExp(`<${escapeRegExp(tagName)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegExp(tagName)}>`, "i");
  const match = xml.match(pattern);
  return match ? stripCdata(match[1]).trim() : "";
}

// Atom 辅助：Atom 的链接常放在 <link href="..."> 属性里，不一定是标签文本。
function readAtomLink(xml) {
  const hrefMatch = xml.match(/<link\b[^>]*href="([^"]+)"[^>]*\/?>/i);
  if (hrefMatch) {
    return decodeXml(hrefMatch[1]);
  }

  return decodeXml(readTag(xml, "link"));
}

// XML 辅助：去掉 <![CDATA[ ... ]]> 这层包装。
function stripCdata(value) {
  return value.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

// XML 辅助：把 XML 实体、CDATA 和简单 HTML 标签清洗成普通文本。
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

// 业务处理：把不同源的条目整理成统一结构，并标准化发布时间。
function normalizeItems(items) {
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

// 业务处理：用标题和摘要做关键词匹配，只保留 AI 相关新闻。
function filterAiNews(items) {
  return items.filter((item) => {
    const haystack = `${item.title} ${item.description}`.toLowerCase();
    return AI_KEYWORDS.some((keyword) => haystack.includes(keyword));
  });
}

// 业务处理：先按发布时间倒序，再按 link 去重，优先保留较新的记录。
function dedupeByLink(items) {
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

// 业务处理：把最终文章列表包装成接口返回的 digest 对象。
function buildDigest(items, errors) {
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

// 通用工具：转义正则特殊字符，避免 tagName 影响匹配规则。
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 通用工具：把日期字符串统一转成 ISO 格式；解析失败时返回 null。
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
