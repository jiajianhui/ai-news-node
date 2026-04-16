const statusElement = document.querySelector("#status");
const summaryElement = document.querySelector("#summary");
const highlightsElement = document.querySelector("#highlights");
const newsListElement = document.querySelector("#news-list");
const runButton = document.querySelector("#run-button");
const refreshButton = document.querySelector("#refresh-button");

// 点击后主动触发一次后端抓取，再把结果渲染到页面。
runButton.addEventListener("click", async () => {
  setStatus("正在抓取新闻，请稍等...");
  toggleButtons(true);

  try {
    const response = await fetch("/api/news/run", { method: "POST" });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "抓取失败");
    }

    renderDigest(payload.data);
    setStatus(`抓取完成，生成时间：${formatDate(payload.data.generatedAt)}`);
  } catch (error) {
    setStatus(`抓取失败：${error.message}`);
  } finally {
    toggleButtons(false);
  }
});

// 只读取本地最新结果，不重新抓源。
refreshButton.addEventListener("click", async () => {
  await loadLatestDigest();
});

// 页面首次加载时，先展示最近一次生成的日报。
loadLatestDigest();

async function loadLatestDigest() {
  setStatus("正在读取最近一次日报...");

  try {
    const response = await fetch("/api/news/latest");
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "读取失败");
    }

    renderDigest(payload.data);
    if (payload.data.generatedAt) {
      setStatus(`最近一次生成时间：${formatDate(payload.data.generatedAt)}`);
      return;
    }

    setStatus("还没有生成日报，点击“立即抓取”开始。");
  } catch (error) {
    setStatus(`读取失败：${error.message}`);
  }
}

function renderDigest(digest) {
  // 每次重绘前先清空旧内容，避免重复追加。
  summaryElement.textContent = digest.summary || "-";
  highlightsElement.innerHTML = "";
  newsListElement.innerHTML = "";

  (digest.highlights || []).forEach((line) => {
    const item = document.createElement("li");
    item.textContent = line;
    highlightsElement.appendChild(item);
  });

  (digest.items || []).forEach((news) => {
    const article = document.createElement("article");
    article.className = "news-card";
    article.innerHTML = `
      <p class="news-card__meta">${escapeHtml(news.source || "未知来源")} · ${formatDate(news.publishedAt)}</p>
      <h3>${escapeHtml(news.title || "无标题")}</h3>
      <p>${escapeHtml(news.description || "没有摘要")}</p>
      <a href="${news.link}" target="_blank" rel="noreferrer">查看原文</a>
    `;
    newsListElement.appendChild(article);
  });
}

function formatDate(value) {
  if (!value) {
    return "未知时间";
  }

  return new Date(value).toLocaleString("zh-CN", {
    hour12: false,
  });
}

function setStatus(text) {
  statusElement.textContent = text;
}

function toggleButtons(isLoading) {
  runButton.disabled = isLoading;
  refreshButton.disabled = isLoading;
}

function escapeHtml(value) {
  // 页面使用 innerHTML 组装卡片，因此先做基础转义，避免注入风险。
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
