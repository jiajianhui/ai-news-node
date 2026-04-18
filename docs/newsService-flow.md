# newsService 流程梳理

这份文档只讲一件事：

`src/newsService.js` 是怎么把远程返回的 RSS / Atom XML，一步步变成项目最终要的 JS 对象和 digest 文件的。

建议一边看这份文档，一边对照 [src/newsService.js](/Users/jiajianhui/Desktop/ai-news-node/src/newsService.js:1)。

## 先记住这条主线

```text
远程新闻源 URL
-> fetchText 拿到 XML 字符串
-> parseFeed / parseRssFeed / parseAtomFeed 解析成 JS 对象数组
-> 给每条新闻补 source
-> normalizeItems 统一字段格式
-> filterAiNews 按关键词过滤
-> dedupeByLink 去重并只保留前 20 条
-> buildDigest 组装成最终结果对象
-> 写入 data/latest-digest.json
```

## 这个文件真正做的事情

`newsService.js` 不是单纯“解析 RSS”。

它做了两类事：

1. 数据源适配
   把 RSS / Atom XML 读进来，再解析成项目能用的 JS 对象。

2. 业务处理
   过滤、去重、生成摘要、写入本地文件。

## Step 0：新闻源和关键词从哪里来

在 [src/config.js](/Users/jiajianhui/Desktop/ai-news-node/src/config.js:1) 里定义了：

- `NEWS_SOURCES`
  要抓哪些新闻源

- `AI_KEYWORDS`
  哪些关键词算 AI 相关新闻

示例：

```js
const NEWS_SOURCES = [
  { name: "OpenAI Newsroom", url: "https://openai.com/news/rss.xml" },
];

const AI_KEYWORDS = ["ai", "gpt", "llm", "agent", "openai"];
```

## Step 1：`runNewsPipeline` 启动整条流程

入口函数是：

```js
async function runNewsPipeline()
```

它会对 `NEWS_SOURCES` 里的每个源做同样的事情：

```js
NEWS_SOURCES.map(async (source) => {
  const xml = await fetchText(source.url);
  const items = parseFeed(xml);

  return items.map((item) => ({
    ...item,
    source: source.name,
  }));
})
```

也就是：

1. 用 `fetchText` 抓原始 XML
2. 用 `parseFeed` 把 XML 解析成 JS 对象数组
3. 给每条新闻补一个 `source`

## Step 2：`fetchText` 拿到原始 XML

`fetchText(url)` 只做一件事：

请求一个新闻源 URL，然后把响应体按文本读出来。

```js
const response = await fetch(url, ...);
return response.text();
```

返回值长这样：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>OpenAI releases new model</title>
      <link>https://openai.com/news/xxx</link>
      <description>This is summary</description>
      <pubDate>Fri, 18 Apr 2026 08:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>
```

注意：

这时候拿到的还只是一个很长的字符串，不是 JS 对象。

## Step 3：`parseFeed` 判断是 RSS 还是 Atom

`parseFeed(xml)` 会先做一个很轻量的判断：

```js
if (trimmed.includes("<feed")) {
  return parseAtomFeed(trimmed);
}

return parseRssFeed(trimmed);
```

规则很简单：

- 看到 `<feed`，按 Atom 解析
- 否则按 RSS 解析

### RSS 和 Atom 的最小区别

RSS 常见结构：

```xml
<rss>
  <channel>
    <item>
      <title>...</title>
      <link>...</link>
      <description>...</description>
      <pubDate>...</pubDate>
    </item>
  </channel>
</rss>
```

Atom 常见结构：

```xml
<feed>
  <entry>
    <title>...</title>
    <link href="..." />
    <summary>...</summary>
    <published>...</published>
  </entry>
</feed>
```

## Step 4：`parseRssFeed` / `parseAtomFeed` 把 XML 解析成 JS 对象

### 4.1 RSS 示例

原始 RSS `item`：

```xml
<item>
  <title>OpenAI releases new model</title>
  <link>https://openai.com/news/xxx</link>
  <description>This is summary</description>
  <pubDate>Fri, 18 Apr 2026 08:00:00 GMT</pubDate>
</item>
```

经过 `parseRssFeed` 后会变成：

```js
{
  title: "OpenAI releases new model",
  link: "https://openai.com/news/xxx",
  description: "This is summary",
  publishedAt: "Fri, 18 Apr 2026 08:00:00 GMT"
}
```

### 4.2 Atom 示例

原始 Atom `entry`：

```xml
<entry>
  <title>Anthropic releases something</title>
  <link href="https://www.anthropic.com/news/xxx" />
  <summary>This is summary</summary>
  <published>2026-04-18T08:00:00Z</published>
</entry>
```

经过 `parseAtomFeed` 后会变成：

```js
{
  title: "Anthropic releases something",
  link: "https://www.anthropic.com/news/xxx",
  description: "This is summary",
  publishedAt: "2026-04-18T08:00:00Z"
}
```

### 4.3 这一步内部又做了什么

以 `parseAtomFeed` 为例：

```js
return extractBlocks(xml, "entry")
  .map((entryXml) => ({
    title: decodeXml(readTag(entryXml, "title")),
    link: readAtomLink(entryXml),
    description: decodeXml(readTag(entryXml, "summary") || readTag(entryXml, "content")),
    publishedAt: readTag(entryXml, "published") || readTag(entryXml, "updated"),
  }))
  .filter((item) => item.title && item.link);
```

可以拆成 3 步：

1. `extractBlocks(xml, "entry")`
   把每个 `<entry>...</entry>` 整块取出来

2. `.map(...)`
   从每一块 XML 里取出标题、链接、摘要、时间，组织成 JS 对象

3. `.filter(...)`
   去掉缺少 `title` 或 `link` 的条目

## Step 5：给每条新闻补 `source`

在 `runNewsPipeline` 里，解析完之后会补上新闻来源：

```js
return items.map((item) => ({
  ...item,
  source: source.name,
}));
```

比如原来是：

```js
{
  title: "OpenAI releases new model",
  link: "https://openai.com/news/xxx",
  description: "This is summary",
  publishedAt: "Fri, 18 Apr 2026 08:00:00 GMT"
}
```

补完后变成：

```js
{
  title: "OpenAI releases new model",
  link: "https://openai.com/news/xxx",
  description: "This is summary",
  publishedAt: "Fri, 18 Apr 2026 08:00:00 GMT",
  source: "OpenAI Newsroom"
}
```

## Step 6：汇总所有新闻源结果

`Promise.allSettled(...)` 结束后，代码会把：

- 成功的结果合并到 `allItems`
- 失败的错误信息放进 `errors`

示例：

```js
const allItems = [
  { title: "A", link: "https://a.com", source: "OpenAI Newsroom" },
  { title: "B", link: "https://b.com", source: "Google News - AI" },
];

const errors = [
  "[Anthropic Newsroom] Fetch failed for https://www.anthropic.com/news/rss: 404",
];
```

## Step 7：`normalizeItems` 统一字段格式

这一步会把时间统一转成 ISO 字符串，并确保字段结构一致。

例如：

```js
{
  title: "OpenAI releases new model",
  link: "https://openai.com/news/xxx",
  description: "This is summary",
  publishedAt: "Fri, 18 Apr 2026 08:00:00 GMT",
  source: "OpenAI Newsroom"
}
```

会变成：

```js
{
  title: "OpenAI releases new model",
  link: "https://openai.com/news/xxx",
  description: "This is summary",
  publishedAt: "2026-04-18T08:00:00.000Z",
  source: "OpenAI Newsroom"
}
```

这一步对应函数：

```js
normalizeItems(items)
```

## Step 8：`filterAiNews` 按关键词过滤

这一步把标题和摘要拼起来，再和 `AI_KEYWORDS` 逐个匹配。

代码核心：

```js
const haystack = `${item.title} ${item.description}`.toLowerCase();
return AI_KEYWORDS.some((keyword) => haystack.includes(keyword));
```

示例：

```js
item = {
  title: "OpenAI releases new model",
  description: "This is summary"
}
```

拼出来：

```js
"openai releases new model this is summary"
```

因为里面包含：

- `openai`
- `model`

所以这条会被保留。

## Step 9：`dedupeByLink` 去重并只保留前 20 条

这一步做两件事：

1. 按发布时间倒序排序
2. 按 `link` 去重

然后在 `runNewsPipeline` 里只保留前 20 条：

```js
const dedupedItems = dedupeByLink(filteredItems).slice(0, 20);
```

意思是：

- 先把重复链接的新闻去掉
- 再只取最新的 20 条

## Step 10：`buildDigest` 组装最终结果对象

这一步不是再解析 XML，而是把已经处理好的新闻列表整理成最终输出格式。

核心结果大概长这样：

```js
{
  generatedAt: "2026-04-18T09:00:00.000Z",
  summary: "本次共抓到 12 条 AI 相关新闻，以下是前 8 条重点。",
  items: [
    {
      title: "OpenAI releases new model",
      link: "https://openai.com/news/xxx",
      description: "This is summary",
      publishedAt: "2026-04-18T08:00:00.000Z",
      source: "OpenAI Newsroom"
    }
  ],
  highlights: [
    "1. [OpenAI Newsroom] OpenAI releases new model (2026-04-18)"
  ],
  errors: []
}
```

### `buildDigest` 里主要做了什么

1. `topItems = items.slice(0, 8)`
   取前 8 条作为重点新闻

2. `highlights`
   把这 8 条转成一行行便于展示的文本

3. `summary`
   生成一句总说明

4. 返回最终 digest 对象

## Step 11：写入本地文件

最终结果会写入：

```text
data/latest-digest.json
```

对应代码：

```js
await fs.mkdir(STORAGE_DIR, { recursive: true });
await fs.writeFile(DIGEST_FILE, JSON.stringify(digest, null, 2), "utf8");
```

所以前端不一定每次都重新抓新闻，它也可以直接读取最近一次已经生成好的 digest。

## 一句话总结每个核心函数

- `runNewsPipeline`
  整条新闻处理流程的总入口

- `fetchText`
  抓单个新闻源的 XML 文本

- `parseFeed`
  判断当前 XML 是 RSS 还是 Atom

- `parseRssFeed`
  把 RSS XML 解析成 JS 对象数组

- `parseAtomFeed`
  把 Atom XML 解析成 JS 对象数组

- `normalizeItems`
  把字段格式统一，尤其是时间

- `filterAiNews`
  按关键词筛选 AI 相关新闻

- `dedupeByLink`
  按链接去重，并保留较新的记录

- `buildDigest`
  把新闻列表整理成最终输出对象

- `readLatestDigest`
  读取上一次已经生成好的结果

## 最后一张图

```text
RSS / Atom XML
-> parseFeed
-> JS 对象数组
-> 补 source
-> normalizeItems
-> filterAiNews
-> dedupeByLink
-> buildDigest
-> latest-digest.json
```
