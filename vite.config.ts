import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { publicPages, type HtmlPublicPageDefinition } from './src/sites/publicPages'
import { siteConfigs, type SiteId } from './src/sites/siteConfig'

const port = Number(process.env.VITE_DEV_PORT ?? 5173)
const strictPort = process.env.VITE_DEV_STRICT_PORT === '0' ? false : true
const commitSha =
  process.env.VITE_COMMIT_SHA ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  (() => {
    try {
      return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim()
    } catch {
      return 'unknown'
    }
  })()
const buildTime = process.env.VITE_BUILD_TIME || new Date().toISOString()

const siteOutputDirs: Record<SiteId, string> = {
  makeMyIdea: 'makemyidea',
  makeMyProblem: 'makemyproblem',
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const isHtmlPublicPage = (page: (typeof publicPages)[number]): page is HtmlPublicPageDefinition =>
  'bodyHtml' in page

const renderPublicPageHtml = (page: (typeof publicPages)[number]) => {
  const site = siteConfigs[page.siteId]
  const canonicalUrl = `${site.canonicalUrl}${page.pathname}`
  const escapedTitle = escapeHtml(page.title)
  const escapedDescription = escapeHtml(page.description)
  const escapedCanonicalUrl = escapeHtml(canonicalUrl)

  const bodyContent = isHtmlPublicPage(page)
    ? page.bodyHtml
    : `<header>
      <p>${escapeHtml(site.brandName)}</p>
    </header>
    <main>
      <h1>${escapeHtml(page.heading)}</h1>
      ${page.body.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('\n      ')}
      <a href="${escapeHtml(page.cta.href)}">${escapeHtml(page.cta.label)}</a>
    </main>`
  const styles = isHtmlPublicPage(page) ? `\n    <style>${page.styles}\n    </style>` : ''

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapedTitle}</title>
    <meta name="description" content="${escapedDescription}" />
    <link rel="canonical" href="${escapedCanonicalUrl}" />
    <meta property="og:title" content="${escapedTitle}" />
    <meta property="og:description" content="${escapedDescription}" />
    <meta property="og:url" content="${escapedCanonicalUrl}" />
    <meta property="og:type" content="website" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapedTitle}" />
    <meta name="twitter:description" content="${escapedDescription}" />
    ${styles}
  </head>
  <body>
    ${bodyContent}
  </body>
</html>
`
}

const renderPublicPageHead = (page: (typeof publicPages)[number]) => {
  const site = siteConfigs[page.siteId]
  const canonicalUrl = `${site.canonicalUrl}${page.pathname}`
  const escapedTitle = escapeHtml(page.title)
  const escapedDescription = escapeHtml(page.description)
  const escapedCanonicalUrl = escapeHtml(canonicalUrl)

  return `    <title>${escapedTitle}</title>
    <meta name="description" content="${escapedDescription}" />
    <link rel="canonical" href="${escapedCanonicalUrl}" />
    <meta property="og:title" content="${escapedTitle}" />
    <meta property="og:description" content="${escapedDescription}" />
    <meta property="og:url" content="${escapedCanonicalUrl}" />
    <meta property="og:type" content="website" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapedTitle}" />
    <meta name="twitter:description" content="${escapedDescription}" />`
}

const renderPublicAppShellHtml = (page: (typeof publicPages)[number], spaHtml: string) => {
  const head = renderPublicPageHead(page)
  return spaHtml
    .replace(/    <title>[\s\S]*?<\/title>/, head)
}

const publicSitesPlugin = (): Plugin => {
  let outDir = 'dist'

  return {
    name: 'generate-public-sites',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== '/') {
          next()
          return
        }
        const host = String(req.headers.host || '').split(':')[0]?.toLowerCase()
        if (host !== 'makemyproblem.localhost') {
          next()
          return
        }
        const page = publicPages.find((item) => item.siteId === 'makeMyProblem' && item.pathname === '/')
        if (!page) {
          next()
          return
        }
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(renderPublicPageHtml(page))
      })
    },
    async closeBundle() {
      const spaHtml = await readFile(path.join(outDir, 'index.html'), 'utf8')
      await Promise.all(
        publicPages.map(async (page) => {
          const siteDir = siteOutputDirs[page.siteId]
          const outputDir = path.join(outDir, '_sites', siteDir)
          await mkdir(outputDir, { recursive: true })
          const html =
            page.siteId === 'makeMyIdea'
              ? renderPublicAppShellHtml(page, spaHtml)
              : renderPublicPageHtml(page)
          await writeFile(path.join(outputDir, 'index.html'), html, 'utf8')
        })
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), publicSitesPlugin()],
  define: {
    'import.meta.env.VITE_COMMIT_SHA': JSON.stringify(commitSha),
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(buildTime),
  },
  server: {
    host: '127.0.0.1',
    port,
    strictPort,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})
