import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: 'Fintools',
  description:
    'A self-hosted Model Context Protocol server for market data, SEC filings, cross-market fund relationships, watchlists and notes.',
  lang: 'en-US',
  // Served from a sub-path on GitHub Pages (e.g. /finance-mcp-server/).
  // CI sets DOCS_BASE; local builds and root-domain hosts default to '/'.
  base: process.env.DOCS_BASE || '/',
  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: true,
  srcExclude: ['README.md'],

  head: [
    ['meta', { name: 'theme-color', content: '#0f766e' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Fintools' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'Self-hosted MCP server for market data, SEC filings and cross-market fund analysis.',
      },
    ],
  ],

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/introduction', activeMatch: '/guide/' },
      { text: 'MCP Tools', link: '/mcp/connecting', activeMatch: '/mcp/' },
      {
        text: 'Concepts',
        link: '/concepts/fund-pipeline',
        activeMatch: '/concepts/',
      },
      {
        text: 'Operations',
        link: '/operations/docker-image',
        activeMatch: '/operations/',
      },
      {
        text: 'Links',
        items: [
          {
            text: 'GitHub',
            link: 'https://github.com/ShinChven/finance-mcp-server',
          },
          {
            text: 'Releases',
            link: 'https://github.com/ShinChven/finance-mcp-server/releases',
          },
          {
            text: 'Report an Issue',
            link: 'https://github.com/ShinChven/finance-mcp-server/issues',
          },
          {
            text: 'Docker Image',
            link: 'https://github.com/ShinChven/finance-mcp-server/pkgs/container/finance-mcp-server',
          },
        ],
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          collapsed: false,
          items: [
            { text: 'What Is Fintools', link: '/guide/introduction' },
            { text: 'Architecture', link: '/guide/architecture' },
          ],
        },
        {
          text: 'Getting Started',
          collapsed: false,
          items: [
            { text: 'Local Development', link: '/guide/local-development' },
            { text: 'Docker Deployment', link: '/guide/docker-deployment' },
            { text: 'Configuration Reference', link: '/guide/configuration' },
            { text: 'Google OAuth Setup', link: '/guide/google-oauth' },
            {
              text: 'Accounts & Security',
              link: '/guide/accounts-and-security',
            },
          ],
        },
      ],
      '/mcp/': [
        {
          text: 'The MCP Endpoint',
          collapsed: false,
          items: [
            { text: 'Connecting a Client', link: '/mcp/connecting' },
            { text: 'Authorization', link: '/mcp/authorization' },
            { text: 'Tool Index', link: '/mcp/tools' },
          ],
        },
        {
          text: 'Tool Groups',
          collapsed: false,
          items: [
            { text: 'Market Data', link: '/mcp/market-data' },
            { text: 'SEC EDGAR', link: '/mcp/sec-edgar' },
            { text: 'Fund Relationships', link: '/mcp/funds' },
            { text: 'Watchlists', link: '/mcp/watchlists' },
            { text: 'Notes', link: '/mcp/notes' },
            { text: 'Skills', link: '/mcp/skills' },
          ],
        },
      ],
      '/concepts/': [
        {
          text: 'Fund Data',
          collapsed: false,
          items: [
            { text: 'The Fund Pipeline', link: '/concepts/fund-pipeline' },
            { text: 'Providers & Ingest', link: '/concepts/providers' },
            {
              text: 'Coverage & Stability',
              link: '/concepts/coverage-and-stability',
            },
            { text: 'On-Demand Fetching', link: '/concepts/on-demand' },
          ],
        },
        {
          text: 'The Dashboard',
          collapsed: false,
          items: [
            { text: 'Pages', link: '/concepts/dashboard' },
            { text: 'URL-Driven State', link: '/concepts/url-state' },
          ],
        },
      ],
      '/operations/': [
        {
          text: 'Operations',
          collapsed: false,
          items: [
            { text: 'Docker Image Publishing', link: '/operations/docker-image' },
            {
              text: 'Database & Migrations',
              link: '/operations/database',
            },
            { text: 'Fund Data Ingest', link: '/operations/ingest' },
            { text: 'Upgrading', link: '/operations/upgrading' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/ShinChven/finance-mcp-server' },
    ],

    search: {
      provider: 'local',
    },

    editLink: {
      pattern:
        'https://github.com/ShinChven/finance-mcp-server/edit/main/docs-site/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Market data is delayed and provided as-is. Not investment advice.',
      copyright: 'Copyright © 2026 ShinChven',
    },
  },
})
