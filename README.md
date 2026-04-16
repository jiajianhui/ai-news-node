# AI 新闻抓取 Demo

这是根据 `learning-notes/ai/AI应用开发实践.md` 里的第一版思路落的一个最小 Node.js 示例：

- 用 `Express` 提供本地网页和接口
- 抓取多个 RSS 来源
- 用关键词筛选 AI 相关新闻
- 去重后生成一份简日报
- 保存到本地 `data/latest-digest.json`

## 运行环境

- `Node.js 22.12.0 - 24.x`
- `npm 10+`

## 启动方式

```bash
cd /Users/jiajianhui/Desktop/cx/ai-news-node
npm install
npm start
```

启动后打开：

```text
http://localhost:3000
```

## 接口

- `GET /api/health`：健康检查
- `GET /api/news/latest`：读取最近一次日报
- `POST /api/news/run`：立即抓取一次

## 你可以继续扩展的方向

- 接 OpenAI API 做自动摘要
- 加 `node-cron` 做每天 8 点自动跑
- 接企业微信、飞书、Telegram 做推送
- 改成 SQLite 或 PostgreSQL 持久化
