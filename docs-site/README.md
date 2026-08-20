# Finance MCP Server Documentation Site

A [VitePress](https://vitepress.dev) documentation site for Finance MCP Server.

This site has its own `package.json` and dependencies. VitePress is **not**
installed in the main app, and `docs-site/` is excluded by `.dockerignore`, so
the docs never reach the application's Docker image.

## Local development

From the repository root:

```bash
npm run docs:install  # one-time: install docs dependencies (in docs-site/)
npm run docs:dev      # dev server (http://localhost:5174)
npm run docs:build    # static build into docs-site/.vitepress/dist
npm run docs:preview  # preview the production build
```

The dev server runs on port 5174 so it never collides with the app on 5173.
Or run the equivalent `npm install` / `npm run dev` directly inside `docs-site/`.

## Structure

```
docs-site/
├── .vitepress/config.ts   # site config, nav, sidebar
├── public/                # static assets
├── index.md               # home page
├── guide/                 # introduction, deployment, configuration
├── mcp/                   # the MCP endpoint and every tool group
├── concepts/              # fund pipeline, data quality, dashboard pages
└── operations/            # image publishing, database, upgrades
```

## Deploying

`.github/workflows/docs.yml` builds this directory and deploys it to GitHub
Pages on every push to `main` that touches `docs-site/`. The build sets
`DOCS_BASE=/<repo>/` for the project-page sub-path; local builds default to `/`.

The output in `docs-site/.vitepress/dist` is a plain static site, so any static
host (Cloudflare Pages, Netlify, Vercel, S3) works just as well.
