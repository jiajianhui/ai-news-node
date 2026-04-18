const fs = require("fs/promises");
const { AI_KEYWORDS, DIGEST_FILE, NEWS_SOURCES, STORAGE_DIR } = require("./config");

/*
  这个模块负责新闻抓取、把 RSS / Atom XML 解析为项目要的 JS 对象、再做过滤/去重并落盘。
  RSS / Atom 都是网站提供的文章列表订阅格式，本质上都是 XML。
  RSS 常见根标签是 <rss>，每篇文章通常在 <item> 里。
  Atom 常见根标签是 <feed>，每篇文章通常在 <entry> 里。
  阅读顺序建议：先看 runNewsPipeline，再看 parseFeed / parseRssFeed / parseAtomFeed，
  最后看 normalizeItems / filterAiNews / dedupeByLink / buildDigest。
*/

// 总入口：并发抓取所有源，汇总后生成 digest 并写入本地文件。
async function runNewsPipeline() {
  const feedResults = await Promise.allSettled(
    // 1. 遍历所有新闻源并发执行抓取任务。
    /*
      map(...) 会返回一个新数组；...item 表示把原字段展开后再补 source。
      Promise.allSettled() 会保留每个源的成功/失败结果，不会因为一个源报错就整体中断。
    */
    NEWS_SOURCES.map(async (source) => {
      // 2. fetchText：请求当前源的 RSS / Atom XML 原文。
      const xml = await fetchText(source.url);

      // 3. parseFeed：把 XML 解析为新闻条目对应的 JS 对象数组。
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
  /*
    Promise.allSettled() 的每一项只会有两种状态。
    fulfilled 表示成功，结果在 result.value；rejected 表示失败，错误在 result.reason。
    for...of 遍历数组里的每个元素本身；for...in 遍历的是下标/键名。
  */
  for (const result of feedResults) {
    if (result.status === "fulfilled") {
      allItems.push(...result.value);
      continue;
    }

    errors.push(result.reason?.message || "Unknown fetch error");
  }

  // 6. normalizeItems：把前面解析出来的 JS 对象再整理成项目统一结构，并标准化发布时间。
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
    // fs.readFile(..., "utf8") 读取出来的是字符串，不是对象。
    const content = await fs.readFile(DIGEST_FILE, "utf8");
    // JSON.parse(...) 把 JSON 字符串转回 JS 对象。
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
  // fetch(...) 是 Node 18+ 内置的 HTTP 请求方法。
  const response = await fetch(url, {
    headers: {
      "user-agent": "ai-news-demo/1.0",
      accept: "application/rss+xml, application/xml, text/xml, text/plain",
    },
  });

  // response.ok 表示这次 HTTP 请求是否成功，一般对应 2xx 状态码。
  if (!response.ok) {
    throw new Error(`Fetch failed for ${url}: ${response.status}`);
  }

  // response.text() 表示把响应体按纯文本读出来；这里要的是 XML 字符串，不是 JSON。
  return response.text();
}

/*
  解析入口：根据 XML 结构判断是 RSS 还是 Atom，再解析为项目要的 JS 对象数组。
  这里用的是很轻量的判断：看到 <feed> 就按 Atom 解析，否则按 RSS 解析。
*/
function parseFeed(xml) {
  // trim() 先去掉首尾空白，避免前面有换行或空格影响判断。
  const trimmed = xml.trim();

  // includes("<feed") 是字符串方法，表示这个字符串里是否包含 "<feed" 这段内容。
  if (trimmed.includes("<feed")) {
    return parseAtomFeed(trimmed);
  }

  return parseRssFeed(trimmed);
}

// RSS 解析：把 RSS xml 里的每个 <item>...</item>，整理成项目要的 JS 对象。
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

// Atom 解析：把 Atom xml 里的每个 <entry>...</entry>，整理成项目要的 JS 对象。
function parseAtomFeed(xml) {
  // 1. 先把每个 <entry>...</entry> 整块取出来。
  return extractBlocks(xml, "entry")
    .map((entryXml) => ({
      // 2. 再从每个 entry 里取出需要的字段，组装成统一结构。
      title: decodeXml(readTag(entryXml, "title")),
      link: readAtomLink(entryXml),
      description: decodeXml(readTag(entryXml, "summary") || readTag(entryXml, "content")),
      // 当前项目统一用 publishedAt 这个字段接收时间：
      // 先读 published，没有时再退回 updated。
      publishedAt: readTag(entryXml, "published") || readTag(entryXml, "updated"),
    }))
    // 3. 过滤掉缺少标题或链接的条目。
    .filter((item) => item.title && item.link);
}

// XML 辅助：用正则抽取某类标签的完整块，比如所有 <item>...</item>。
function extractBlocks(xml, tagName) {
  /*
    new RegExp(...) 是运行时动态创建正则；"g" 表示全局匹配，"i" 表示忽略大小写。
    如果 tagName 是 "item"，这个正则大致就是在匹配：
    <item>...</item> 或 <item ...>...</item>
    正则拆开看：
    <${tagName}           匹配开始标签，如 <item
    (?:\\s[^>]*)?         可选匹配开始标签里的属性，如 <item type="x">
    >                     匹配开始标签结束的 >
    ([\\s\\S]*?)          匹配中间内容；? 表示尽量少匹配，避免一口气吃掉多个 item
    <\\/${tagName}>       匹配结束标签，如 </item>
  */
  const pattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  const blocks = [];
  /*
    执行顺序：
    1. 先执行一次 exec(...)，找出第一个匹配。
    2. while (match) 判断这次有没有找到内容。
    3. 找到了就把当前匹配放进 blocks。
    4. 再执行一次 exec(...)，继续找下一个匹配。
    5. exec(...) 返回 null 时，while 结束。
  */
  // exec(...) 本身不会循环；这里只是先找一次，后面的 while 再反复继续找。
  let match = pattern.exec(xml);

  while (match) {
    // match[0] 是本次完整命中的内容。
    blocks.push(match[0]);
    // 因为正则带了 g，下一次 exec(...) 会从上次后面继续找。
    match = pattern.exec(xml);
  }

  return blocks;
}

// XML 辅助：读取某个 XML 块里指定标签的文本内容。
function readTag(xml, tagName) {
  // escapeRegExp(...) 是为了避免 tagName 里的特殊字符影响正则匹配。
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
    // some(...) 会依次检查每个关键词；=> 表示一个小函数：判断 haystack 里是否包含当前关键词。
    return AI_KEYWORDS.some((keyword) => haystack.includes(keyword));
  });
}

// 业务处理：先按发布时间倒序，再按 link 去重，优先保留较新的记录。
function dedupeByLink(items) {
  // Set 适合做去重；同一个 key 放进去多次也只会保留一份。
  const seen = new Set();
  // [...items] 先复制一份数组，避免 sort(...) 直接改原数组。
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
  // slice(0, 8) 表示只取前 8 条做高亮摘要，不影响 items 里的完整列表。
  const topItems = items.slice(0, 8);
  const lines = topItems.map((item, index) => {
    const dateText = item.publishedAt ? item.publishedAt.slice(0, 10) : "未知时间";
    return `${index + 1}. [${item.source}] ${item.title} (${dateText})`;
  });

  return {
    generatedAt: new Date().toISOString(),
    // 三元表达式：条件 ? 成立时的值 : 不成立时的值。
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
