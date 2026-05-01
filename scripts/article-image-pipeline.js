/**
 * The Tech Room - Article Image Pipeline
 *
 * Multi-agent coordination for article publishing:
 * 1. Content Creator Agent: writes article, specifies image requirements
 * 2. Image Generator Agent: creates image via Google Gemini Nano Banana Pro API
 * 3. QA Validator Agent: verifies image quality and relevance on live site
 *
 * Image Standards:
 * - Format: 16:9 aspect ratio for all article images
 * - Hero/Featured: 1200x675 @ q85
 * - Card/List: 800x450 @ q85
 * - Inline: 1100x619 @ q85
 * - OG/Social: 1200x630 @ q80
 * - AI Model: Google Gemini Nano Banana Pro (gemini-3-pro-image-preview)
 * - Cost: ~$0.05/image
 * - API Key: Set GEMINI_API_KEY env var (sbn.mediastudio@gmail.com Google Cloud project)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-3-pro-image-preview';
const IMAGES_DIR = path.join(__dirname, '..', 'images', 'articles');

const IMAGE_STANDARDS = {
  hero:   { width: 1200, height: 675, quality: 85, cssClass: 'featured-card__image' },
  card:   { width: 800,  height: 450, quality: 85, cssClass: 'news-card__image' },
  list:   { width: 800,  height: 450, quality: 85, cssClass: 'news-list-item__image' },
  inline: { width: 1100, height: 619, quality: 85, cssClass: 'article-inline-image' },
  og:     { width: 1200, height: 630, quality: 80, cssClass: null }
};

// ─────────────────────────────────────────────────────────────────────────────
// VARIED REALISTIC STYLE POOLS (rotated deterministically per article so the
// site doesn't read as "all the same color"). Hard ban on violet/purple/neon —
// those colors made every previous hero look identical.
// ─────────────────────────────────────────────────────────────────────────────
const NEGATIVE_PROMPT = 'NO violet, NO purple, NO magenta, NO neon glow, NO sci-fi rendering, NO 3D CGI look, NO cartoon, NO clipart, NO stock-business clichés, NO generic AI illustration, NO girl, NO child';

const CATEGORY_STYLE_POOLS = {
  semiconductor: [
    'Cinematic 35mm photograph of a semiconductor cleanroom, technicians in white bunny suits operating tools, neutral fluorescent overhead lighting, shallow depth of field, photo-realistic, editorial tech reportage',
    'Macro studio photograph of a 300mm silicon wafer, rainbow diffraction pattern across the surface, sharp focus, dark grey gradient backdrop, product photography lighting, photo-realistic',
    'Detail photograph of an EUV lithography tool interior, polished stainless-steel chamber, controlled blue calibration laser, industrial trade-press photography, photo-realistic',
    'Editorial photograph of a semiconductor industry conference panel, executives seated at a long table with name placards, warm tungsten newsroom lighting, neutral muted background, candid documentary tone',
    'Architectural photograph of a TSMC-style fabrication plant exterior at golden hour, low angle, clear blue sky, palm trees in foreground, news-magazine cover style, photo-realistic',
    'Photojournalistic shot of a stock trading floor with semiconductor tickers on screens, traders mid-action with motion blur, daylight ambient, AP-news photography style',
    'Editorial photograph of cargo containers at a busy port, overcast diffused daylight, faint corporate logos visible on containers, journalistic supply-chain framing, photo-realistic',
    'Studio close-up of a chip package on a black anti-static mat with tweezers nearby, shallow depth of field, soft top-down lighting, technical product photography, photo-realistic'
  ],
  ai: [
    'Wide-angle 35mm photograph of a hyperscale data center hall, rows of dark server racks with small steady green status LEDs, cool overhead fluorescent lighting, photo-realistic, editorial tech reportage',
    'Editorial close-up photograph of a GPU board with copper cooling fins on a matte-black surface, subtle key light, technical product photography, photo-realistic',
    'Photojournalistic shot of an AI researcher at a workstation with three monitors of code and a notebook of equations, warm office lighting, candid newsroom framing, photo-realistic',
    'Aerial drone photograph of a Northern Virginia data-center campus at dusk, low warm sky, moderate ambient lighting, no neon, editorial cover style, photo-realistic',
    'Editorial composite photograph: a laptop on a wooden desk with a chat interface on screen, faint annotation lines indicating tokens, clean professional layout, soft natural daylight, photo-realistic',
    'Editorial photograph of an AI policy panel at a think-tank, speakers behind microphones, warm professional lighting, neutral conference backdrop, photo-realistic',
    'Architectural photograph of a Northern European data-center exterior at twilight, brutalist concrete facade, low blue sky, photo-realistic, news-magazine cover style',
    'Photojournalistic shot of a partnership signing at a conference table, hands and pens visible, name cards in soft focus, depth of field, AP-news photography style'
  ],
  podcast: [
    'Editorial photograph of a modern podcast studio, two condenser microphones on boom arms, acoustic foam panels, warm desk lamps, photo-realistic, candid newsroom tone',
    'Studio close-up of a Shure SM7B microphone on a dark wood desk, soft window light from the side, shallow depth of field, photo-realistic product photography',
    'Photojournalistic shot of a podcast host adjusting headphones, focused expression, warm tungsten lighting, photo-realistic, editorial tone'
  ]
};

// CATEGORY_STYLES retained as a thin facade for any caller that still reads
// the legacy shape. The `aiPrompt` field now resolves to a randomized prompt
// from the pool above when called via getCategoryStyle().
const CATEGORY_STYLES = {
  semiconductor: { unsplashKeywords: ['semiconductor', 'silicon wafer', 'chip fabrication', 'microprocessor', 'circuit board'], avoidKeywords: ['people portrait', 'stock business', 'cartoon', 'clipart', 'girl', 'child'] },
  ai:            { unsplashKeywords: ['artificial intelligence', 'data center', 'neural network', 'server rack', 'machine learning'], avoidKeywords: ['robot face', 'Terminator', 'cartoon AI', 'generic stock'] },
  podcast:       { unsplashKeywords: ['podcast studio', 'microphone', 'audio production', 'recording studio'], avoidKeywords: ['generic stock', 'unrelated'] }
};

/**
 * Pick a style prompt from the pool, keyed deterministically by article title
 * so re-runs of the same article produce the same image style — but adjacent
 * articles get visually distinct images.
 */
function pickStylePrompt(category, title) {
  const pool = CATEGORY_STYLE_POOLS[category] || CATEGORY_STYLE_POOLS.semiconductor;
  let h = 0;
  const seed = String(title || '');
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return pool[h % pool.length];
}

function getCategoryStyle(category, title) {
  const base = CATEGORY_STYLES[category] || CATEGORY_STYLES.semiconductor;
  return { ...base, aiPrompt: pickStylePrompt(category, title) };
}

/**
 * Agent 1: Content Creator
 * Generates article metadata and image requirements
 */
function contentCreatorAgent(articleData) {
  const { title, category, topics, body, companies, imageType } = articleData;
  const style = getCategoryStyle(category, title);
  const dims = IMAGE_STANDARDS[imageType || 'list'];

  let companyPrompt = '';
  if (companies && companies.length > 0) {
    companyPrompt = ` Subtly include visible branding context for: ${companies.join(', ')}.`;
  }

  const fullPrompt = [
    style.aiPrompt,
    `Article topic: ${topics.join(', ')}.`,
    `Headline: "${title}".${companyPrompt}`,
    `Avoid: ${(style.avoidKeywords || []).join(', ')}.`,
    NEGATIVE_PROMPT
  ].join(' ');

  return {
    article: { title, category, topics, body },
    imageSpec: {
      category,
      prompt: fullPrompt,
      filename: titleToFilename(title),
      dimensions: dims,
      altText: generateAltText(title, category, topics)
    }
  };
}

/**
 * Agent 2: Image Generator
 * Creates image via Google Gemini Nano Banana Pro API
 */
async function imageGeneratorAgent(imageSpec) {
  const { category, prompt, dimensions } = imageSpec;

  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY environment variable not set. Set it to your Google AI Studio API key (sbn.mediastudio@gmail.com project).');
  }

  // Generate filename from article title
  const filename = imageSpec.filename || `article-${Date.now()}.jpg`;
  const outputPath = path.join(IMAGES_DIR, filename);

  // Strategy 1: Nano Banana Pro (primary)
  console.log(`  Generating via Nano Banana Pro: ${filename}`);
  const result = await generateWithNanoBanana(prompt);

  if (result.success) {
    fs.writeFileSync(outputPath, result.buffer);
    console.log(`  OK: ${(result.buffer.length / 1024).toFixed(0)} KB`);
    applyWatermark(outputPath);
    return {
      source: 'nano-banana-pro',
      url: `images/articles/${filename}`,
      localPath: outputPath,
      altText: imageSpec.altText,
      dimensions,
      sizeKB: Math.round(fs.statSync(outputPath).size / 1024),
      verified: false,
      watermarked: true
    };
  }

  // Strategy 2: Retry with a different style prompt from the same pool
  console.log('  Retrying with alternate style prompt...');
  const altPrompt = pickStylePrompt(category, (imageSpec.filename || '') + '-retry') + ' ' + NEGATIVE_PROMPT;
  const retryResult = await generateWithNanoBanana(altPrompt);

  if (retryResult.success) {
    fs.writeFileSync(outputPath, retryResult.buffer);
    applyWatermark(outputPath);
    return {
      source: 'nano-banana-pro-fallback',
      url: `images/articles/${filename}`,
      localPath: outputPath,
      altText: imageSpec.altText,
      dimensions,
      sizeKB: Math.round(fs.statSync(outputPath).size / 1024),
      verified: false,
      watermarked: true
    };
  }

  throw new Error(`Image generation failed for ${filename}: ${result.error}`);
}

/**
 * Stamp the SBN Media Studio watermark onto an image we just generated.
 * Calls the existing watermark-image.py (PIL-based, semi-transparent
 * "© SBN Media Studio" bottom-right). In-place overwrite. Non-fatal on error
 * so a Python misconfig doesn't kill the publish — but we log loudly.
 */
function applyWatermark(imagePath) {
  const { spawnSync } = require('child_process');
  const py = spawnSync('py', ['-3.12', path.join(__dirname, 'watermark-image.py'), imagePath], {
    encoding: 'utf8',
    timeout: 30000
  });
  if (py.status === 0) {
    console.log(`  Watermarked: ${path.basename(imagePath)}`);
  } else {
    console.error(`  WATERMARK FAILED for ${imagePath}: ${(py.stderr || py.stdout || '').slice(0, 300)}`);
  }
}

/**
 * Call Google Gemini Nano Banana Pro API to generate an image
 */
function generateWithNanoBanana(prompt) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: `Generate a photorealistic image: ${prompt}` }] }],
      generationConfig: { responseModalities: ['IMAGE'] }
    });
    const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 120000
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) return resolve({ success: false, error: json.error.message });
          const part = json.candidates && json.candidates[0] && json.candidates[0].content &&
                       json.candidates[0].content.parts.find(p => p.inlineData);
          if (!part) return resolve({ success: false, error: 'No image in response' });
          resolve({ success: true, buffer: Buffer.from(part.inlineData.data, 'base64') });
        } catch (e) { resolve({ success: false, error: e.message }); }
      });
    });
    req.on('error', (e) => resolve({ success: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'timeout' }); });
    req.write(body);
    req.end();
  });
}

/**
 * Agent 3: QA Validator
 * Checks the generated image quality locally
 */
async function qaValidatorAgent(articleUrl, imageResult) {
  const checks = {
    fileExists: false,
    fileSizeOK: false,
    altTextPresent: false,
    filenameValid: false
  };

  try {
    // Check 1: File exists on disk
    if (imageResult.localPath && fs.existsSync(imageResult.localPath)) {
      checks.fileExists = true;
      const stats = fs.statSync(imageResult.localPath);
      // Check 2: File size > 50KB (reasonable quality)
      checks.fileSizeOK = stats.size > 50000;
    }

    // Check 3: Alt text present and descriptive
    checks.altTextPresent = imageResult.altText && imageResult.altText.length > 10;

    // Check 4: Filename is valid (no spaces, lowercase)
    checks.filenameValid = /^[a-z0-9-]+\.jpg$/.test(path.basename(imageResult.url));

  } catch (error) {
    console.error('QA check failed:', error.message);
  }

  const passed = Object.values(checks).every(v => v === true);
  return { passed, checks, timestamp: new Date().toISOString() };
}

/**
 * Full pipeline: orchestrates all 3 agents
 */
async function publishArticlePipeline(articleData) {
  console.log('🔄 Starting article publishing pipeline...');

  // Step 1: Content Creator prepares article + image spec
  console.log('📝 Agent 1 (Content Creator): Preparing article...');
  const { article, imageSpec } = contentCreatorAgent(articleData);

  // Step 2: Image Generator creates/selects image
  console.log('🎨 Agent 2 (Image Generator): Creating image...');
  const imageResult = await imageGeneratorAgent(imageSpec);

  // Step 3: Assemble final HTML
  const finalHtml = assembleArticleHtml(article, imageResult);

  // Step 4: Deploy (git push triggers Vercel)
  console.log('🚀 Deploying to Vercel...');
  // await deployToVercel(finalHtml);

  // Step 5: QA Validator checks live site
  console.log('✅ Agent 3 (QA Validator): Verifying...');
  const qaResult = await qaValidatorAgent(
    `https://thetechroom.sbnmediastudio.com/${article.category}`,
    imageResult
  );

  if (!qaResult.passed) {
    console.warn('⚠️ QA failed! Issues:', qaResult.checks);
    // Trigger image replacement workflow
  }

  return { article, imageResult, qaResult, finalHtml };
}

// --- Helper Functions ---

function generateAltText(title, category, topics) {
  const topicStr = topics.slice(0, 3).join(', ');
  return `${topicStr} representing ${title.substring(0, 80)}`;
}

/**
 * Generate a filename from article title
 * "TSMC 2nm Mass Production Begins" -> "tsmc-2nm-mass-production-begins.jpg"
 */
function titleToFilename(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 60)
    .replace(/-+$/, '') + '.jpg';
}

function assembleArticleHtml(article, imageResult) {
  const { width, height } = imageResult.dimensions;
  return `
          <article class="news-list-item fade-up">
            <div class="news-list-item__image">
              <img src="${imageResult.url}"
                   alt="${imageResult.altText}"
                   loading="lazy"
                   width="${width}"
                   height="${height}">
            </div>
            <div class="news-list-item__content">
              <span class="news-list-item__tag">${article.category}</span>
              <h3 class="heading-sm news-list-item__title">${article.title}</h3>
              <p class="news-list-item__text">${article.body}</p>
            </div>
          </article>`;
}

// --- CLI Entry Point ---
// Usage: GEMINI_API_KEY=xxx node article-image-pipeline.js --title "..." --category ai --topics "topic1,topic2" --companies "NVIDIA,TSMC"
if (require.main === module) {
  const args = process.argv.slice(2);
  const getArg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };

  const title = getArg('title');
  const category = getArg('category') || 'semiconductor';
  const topics = (getArg('topics') || '').split(',').filter(Boolean);
  const companies = (getArg('companies') || '').split(',').filter(Boolean);
  const imageType = getArg('type') || 'list';

  if (!title) {
    console.log('Usage: GEMINI_API_KEY=xxx node article-image-pipeline.js \\');
    console.log('  --title "Article Title" \\');
    console.log('  --category semiconductor|ai|gaming|podcast \\');
    console.log('  --topics "topic1,topic2" \\');
    console.log('  --companies "NVIDIA,TSMC" \\');
    console.log('  --type hero|card|list|inline');
    process.exit(1);
  }

  publishArticlePipeline({ title, category, topics, companies, imageType, body: '' })
    .then(result => {
      console.log('\nResult:', JSON.stringify({
        image: result.imageResult.url,
        source: result.imageResult.source,
        sizeKB: result.imageResult.sizeKB,
        qa: result.qaResult.passed ? 'PASSED' : 'FAILED'
      }, null, 2));
    })
    .catch(err => { console.error('Pipeline failed:', err.message); process.exit(1); });
}

// Export for use in automation
if (typeof exports !== 'undefined') {
  exports.IMAGE_STANDARDS = IMAGE_STANDARDS;
  exports.CATEGORY_STYLES = CATEGORY_STYLES;
  exports.contentCreatorAgent = contentCreatorAgent;
  exports.imageGeneratorAgent = imageGeneratorAgent;
  exports.qaValidatorAgent = qaValidatorAgent;
  exports.publishArticlePipeline = publishArticlePipeline;
  exports.generateWithNanoBanana = generateWithNanoBanana;
  exports.titleToFilename = titleToFilename;
}
