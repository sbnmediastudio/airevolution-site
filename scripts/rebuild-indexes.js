#!/usr/bin/env node
/**
 * AI Revolution — rebuild homepage + pillar pages from articles/*.html
 *
 * Single source of truth = the actual article HTML files. The script
 * scans every articles/<slug>.html, extracts metadata (title, datetime,
 * description, pillar tag, hero image), sorts by date descending, and
 * regenerates the article-grid block on index.html and each pillar page
 * between <!-- AUTO-GRID-START --> and <!-- AUTO-GRID-END --> markers.
 *
 * Also stamps "Last updated YYYY-MM-DD" between
 * <!-- LAST-UPDATED-START --> and <!-- LAST-UPDATED-END -->.
 *
 * Usage:  node scripts/rebuild-indexes.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ARTICLES_DIR = path.join(ROOT, 'articles');
const INDEX = path.join(ROOT, 'index.html');
const PILLARS = {
  models: { file: path.join(ROOT, 'models.html'), color: '#a78bfa', bg: 'rgba(167,139,250,0.15)' },
  agents: { file: path.join(ROOT, 'agents.html'), color: '#06b6d4', bg: 'rgba(6,182,212,0.15)' },
  infrastructure: { file: path.join(ROOT, 'infrastructure.html'), color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  regulation: { file: path.join(ROOT, 'regulation.html'), color: '#f43f5e', bg: 'rgba(244,63,94,0.15)' }
};
const FRESH_DAYS = 7;
const HOMEPAGE_LIMIT = 12;
const PILLAR_LIMIT = 24;

// ── Extract metadata from one article HTML ──────────────────────────────────
function extract(html, slug) {
  const get = (re) => { const m = html.match(re); return m ? m[1].trim() : ''; };
  const title = get(/<h1[^>]*class=["'][^"']*article-page__title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i)
             || get(/<title>([^<|]+)(?:\s*\|[^<]*)?<\/title>/i);
  const description = get(/<meta name="description" content="([^"]+)"/i);
  const datetime = get(/<time datetime="(\d{4}-\d{2}-\d{2})/i);
  const pillarRaw = get(/<meta property="article:tag" content="([^"]+)"/i).toLowerCase();
  const pillar = ['models','agents','infrastructure','regulation'].includes(pillarRaw) ? pillarRaw : 'models';
  // First image inside the article body — fallback to og:image
  const imgInBody = get(/<article[\s\S]*?<img[^>]+src=["']\.\.\/(images\/articles\/[^"']+)["'][^>]*alt=["']([^"']*)["']/i);
  let imageSrc = '', imageAlt = '';
  if (imgInBody) { imageSrc = imgInBody; }
  else {
    imageSrc = get(/<meta property="og:image" content="[^"]*\/(images\/articles\/[^"]+)"/i);
  }
  imageAlt = get(/<article[\s\S]*?<img[^>]+alt=["']([^"']+)["']/i) || description;
  return { slug, title, description, datetime, pillar, imageSrc, imageAlt };
}

function readArticles() {
  const files = fs.readdirSync(ARTICLES_DIR).filter(f => f.endsWith('.html'));
  const out = [];
  for (const f of files) {
    try {
      const html = fs.readFileSync(path.join(ARTICLES_DIR, f), 'utf8');
      const slug = f.replace(/\.html$/, '');
      const meta = extract(html, slug);
      if (!meta.datetime || !meta.title || !meta.imageSrc) continue;
      out.push(meta);
    } catch (e) { console.warn(`  skip ${f}: ${e.message}`); }
  }
  out.sort((a, b) => b.datetime.localeCompare(a.datetime));
  return out;
}

function isFresh(datetime) {
  const ageDays = (Date.now() - new Date(datetime + 'T00:00:00Z').getTime()) / 86400000;
  return ageDays >= 0 && ageDays <= FRESH_DAYS;
}

function fmtDate(datetime) {
  const [y, m, d] = datetime.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function htmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Render a single card ────────────────────────────────────────────────────
function card(article) {
  const p = PILLARS[article.pillar] || PILLARS.models;
  const freshBadge = isFresh(article.datetime)
    ? `<span class="article-card__new" aria-label="New">NEW</span>`
    : '';
  return `        <a class="article-card" href="/articles/${article.slug}.html" data-pillar="${article.pillar}">
          <div class="article-card__image">
            <img src="/${article.imageSrc}" alt="${htmlEscape(article.imageAlt)}" loading="lazy" width="800" height="450">
            ${freshBadge}
          </div>
          <div class="article-card__body">
            <span class="article-card__pillar" style="background:${p.bg};color:${p.color};">${article.pillar.charAt(0).toUpperCase() + article.pillar.slice(1)}</span>
            <h3>${htmlEscape(article.title)}</h3>
            <p>${htmlEscape((article.description || '').slice(0, 200))}</p>
            <time datetime="${article.datetime}">${fmtDate(article.datetime)}</time>
          </div>
        </a>`;
}

function renderGrid(articles) {
  return articles.map(card).join('\n');
}

function replaceBlock(html, startMarker, endMarker, replacement) {
  const re = new RegExp(`(${startMarker})[\\s\\S]*?(${endMarker})`, 'i');
  // Use a function replacer so `$` characters inside `replacement` (e.g. "$15")
  // are NOT interpreted as regex backreferences. String.prototype.replace
  // treats $1..$9, $&, $`, $' specially when the replacement is a string.
  if (re.test(html)) return html.replace(re, (_m, a, b) => `${a}\n${replacement}\n        ${b}`);
  // First-run: marker missing — inject around the existing .article-grid block
  return html.replace(
    /(<div class="article-grid">)([\s\S]*?)(<\/div>\s*<\/div>\s*<\/section>)/i,
    (_m, a, _b, c) => `${a}\n        ${startMarker}\n${replacement}\n        ${endMarker}\n        ${c}`
  );
}

function replaceLastUpdated(html, datetime) {
  const banner = `<span class="last-updated-pill">Last updated <time datetime="${datetime}">${fmtDate(datetime)}</time></span>`;
  if (/<!-- LAST-UPDATED-START -->/.test(html)) {
    return html.replace(
      /<!-- LAST-UPDATED-START -->[\s\S]*?<!-- LAST-UPDATED-END -->/,
      `<!-- LAST-UPDATED-START -->${banner}<!-- LAST-UPDATED-END -->`
    );
  }
  return html; // injected into templates separately
}

// ── Main ────────────────────────────────────────────────────────────────────
function main() {
  const articles = readArticles();
  console.log(`Scanned ${articles.length} articles. Newest: ${articles[0] ? articles[0].datetime : 'none'}`);

  // Homepage — newest HOMEPAGE_LIMIT across all pillars
  let indexHtml = fs.readFileSync(INDEX, 'utf8');
  const homepageArticles = articles.slice(0, HOMEPAGE_LIMIT);
  indexHtml = replaceBlock(indexHtml, '<!-- AUTO-GRID-START -->', '<!-- AUTO-GRID-END -->', renderGrid(homepageArticles));
  indexHtml = replaceLastUpdated(indexHtml, articles[0] ? articles[0].datetime : new Date().toISOString().slice(0, 10));
  fs.writeFileSync(INDEX, indexHtml);
  console.log(`Rebuilt index.html with ${homepageArticles.length} articles`);

  // Each pillar — newest PILLAR_LIMIT for that pillar
  for (const [pillar, cfg] of Object.entries(PILLARS)) {
    if (!fs.existsSync(cfg.file)) { console.log(`  skip ${pillar} (no file)`); continue; }
    const filtered = articles.filter(a => a.pillar === pillar).slice(0, PILLAR_LIMIT);
    let h = fs.readFileSync(cfg.file, 'utf8');
    h = replaceBlock(h, '<!-- AUTO-GRID-START -->', '<!-- AUTO-GRID-END -->', renderGrid(filtered));
    h = replaceLastUpdated(h, filtered[0] ? filtered[0].datetime : new Date().toISOString().slice(0, 10));
    fs.writeFileSync(cfg.file, h);
    console.log(`Rebuilt ${pillar}.html with ${filtered.length} articles`);
  }

  console.log('Done.');
}

if (require.main === module) main();
module.exports = { readArticles, renderGrid, card };
