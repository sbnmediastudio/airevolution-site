#!/usr/bin/env node
/**
 * AI Revolution — regenerate sitemap.xml and feed.xml from articles/*.html
 * Newest-first ordering. Run after rebuild-indexes.js.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { readArticles } = require('./rebuild-indexes.js');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://airevolution.sbnmediastudio.com';
const SITEMAP = path.join(ROOT, 'sitemap.xml');
const FEED = path.join(ROOT, 'feed.xml');

function buildSitemap(articles) {
  const today = new Date().toISOString().slice(0, 10);
  const staticUrls = [
    { loc: '/', priority: '1.0', changefreq: 'daily', lastmod: articles[0] ? articles[0].datetime : today },
    { loc: '/models.html', priority: '0.9', changefreq: 'weekly', lastmod: today },
    { loc: '/agents.html', priority: '0.9', changefreq: 'weekly', lastmod: today },
    { loc: '/infrastructure.html', priority: '0.9', changefreq: 'weekly', lastmod: today },
    { loc: '/regulation.html', priority: '0.9', changefreq: 'weekly', lastmod: today },
    { loc: '/podcast.html', priority: '0.8', changefreq: 'weekly', lastmod: today },
    { loc: '/about.html', priority: '0.5', changefreq: 'monthly', lastmod: today },
    { loc: '/subscribe.html', priority: '0.7', changefreq: 'monthly', lastmod: today },
    { loc: '/privacy.html', priority: '0.3', changefreq: 'yearly', lastmod: today }
  ];

  const urls = [
    ...staticUrls.map(u => `  <url><loc>${SITE}${u.loc}</loc><lastmod>${u.lastmod}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`),
    ...articles.map(a => `  <url><loc>${SITE}/articles/${a.slug}.html</loc><lastmod>${a.datetime}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>`)
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function buildFeed(articles) {
  const items = articles.slice(0, 30).map(a => {
    const pubDate = new Date(a.datetime + 'T08:00:00Z').toUTCString();
    return `    <item>
      <title>${esc(a.title)}</title>
      <link>${SITE}/articles/${a.slug}.html</link>
      <guid isPermaLink="true">${SITE}/articles/${a.slug}.html</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${esc(a.description || '')}</description>
      <category>${esc(a.pillar)}</category>
    </item>`;
  }).join('\n');

  const lastBuild = new Date().toUTCString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>AI Revolution — Frontier AI Models, Agents &amp; Infrastructure News</title>
    <link>${SITE}/</link>
    <description>Weekly intelligence on frontier AI models, agents, infrastructure, regulation, and enterprise adoption.</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
    <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;
}

function main() {
  const articles = readArticles();
  fs.writeFileSync(SITEMAP, buildSitemap(articles));
  fs.writeFileSync(FEED, buildFeed(articles));
  console.log(`Sitemap: ${articles.length + 9} URLs · Feed: ${Math.min(articles.length, 30)} items`);
}
if (require.main === module) main();
