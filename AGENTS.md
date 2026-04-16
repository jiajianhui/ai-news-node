# Repository Guidelines

## Project Structure & Module Organization
This is a small Node.js + Express app. The HTTP entrypoint is [`server.js`](/Users/jiajianhui/Desktop/cx/ai-news-node/server.js), which serves static files from `public/` and exposes the JSON API. Core news logic lives in `src/`: `src/config.js` defines RSS sources, keywords, and storage paths, and `src/newsService.js` handles fetching, parsing, filtering, deduping, and digest persistence. Frontend assets are in `public/` (`index.html`, `main.js`, `styles.css`). Generated output is written to `data/latest-digest.json`.

## Build, Test, and Development Commands
- `npm install` — install dependencies.
- `npm run dev` — start the server with `node --watch server.js` for local development.
- `npm start` — run the app normally on `http://localhost:3000`.

There is no build step in the current project. Use `POST /api/news/run` to execute the news pipeline manually and `GET /api/news/latest` to inspect the latest stored digest.

## Coding Style & Naming Conventions
Follow the existing JavaScript style: CommonJS modules, double quotes, semicolons, and 2-space indentation. Prefer small, single-purpose functions like those in `src/newsService.js`. Use `camelCase` for variables and functions, `UPPER_SNAKE_CASE` for shared constants such as `AI_KEYWORDS`, and clear file names such as `newsService.js` or `config.js`. Keep API responses shaped consistently as `{ ok, data }` or `{ ok, error }`.

## Testing Guidelines
Automated tests are not configured yet. When adding coverage, place tests under `tests/` and use Node’s built-in test runner so setup stays minimal. Name files `*.test.js` and cover feed parsing, keyword filtering, deduplication, and the empty-digest fallback. Until a test script exists, verify changes by running `npm start` or `npm run dev` and exercising `/api/health`, `/api/news/latest`, and `/api/news/run`.

## Commit & Pull Request Guidelines
Recent commits use short, imperative subjects such as `Align ai-news-node with current Node version`. Keep commit messages concise and task-focused. For pull requests, include a short summary, list any API or config changes, describe manual verification steps, and attach screenshots only when UI behavior in `public/` changes.

## Configuration Notes
Use Node `22.12.0` through `24.x` as declared in `package.json`. Avoid hardcoding new secrets or tokens; pass them through environment variables if the project expands to external APIs.
