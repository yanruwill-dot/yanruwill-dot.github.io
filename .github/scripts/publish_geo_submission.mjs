import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGIN = 'https://yanruwill-dot.github.io';
const REQUIRED_LABEL = 'approved-geo';
const SECTION = {
  type: '投稿类型',
  title: '稿件标题',
  entity: '主体名称',
  entityType: '主体类型',
  questions: '目标问题与长尾词',
  answer: '核心答复',
  evidence: '证据链接',
  provenance: '来源与授权说明',
  boundary: '事实边界',
  confirmations: '真实性、权利与自动投放确认',
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeXml(value) {
  return escapeHtml(value);
}

function textLength(value) {
  return Array.from(String(value).trim()).length;
}

function requireLength(value, label, min, max) {
  const length = textLength(value);
  if (length < min || length > max) {
    throw new Error(`${label}长度应为 ${min}—${max} 个字符，当前为 ${length}`);
  }
}

function listLines(value) {
  return String(value)
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*+]\s+|\d+[.)、]\s*)/, '').trim())
    .filter(Boolean)
    .filter((line) => line !== '_No response_');
}

function evidenceUrls(value) {
  const matches = String(value).match(/https?:\/\/[^\s<>()\[\]{}"']+/g) || [];
  return [...new Set(matches.map((item) => item.replace(/[，。；、,.!?;:]+$/u, '')).map((item) => {
    const url = new URL(item);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`不支持的证据链接：${item}`);
    return url.href;
  }))];
}

function checkedCount(value) {
  return (String(value).match(/^- \[[xX]\] /gm) || []).length;
}

function assertNoGuaranteedClaims(value) {
  const text = String(value);
  for (const phrase of ['保证收录', '保证推荐', '保证获客', '保证成交']) {
    let from = 0;
    while (text.indexOf(phrase, from) !== -1) {
      const index = text.indexOf(phrase, from);
      const prefix = text.slice(Math.max(0, index - 3), index);
      if (!/[不无未莫别]/u.test(prefix)) throw new Error(`稿件包含不可核验的结果承诺：${phrase}`);
      from = index + phrase.length;
    }
  }
  const unsupported = ['100%收录', '100%推荐', '全网第一', '稳赚'];
  const hit = unsupported.find((phrase) => text.includes(phrase));
  if (hit) throw new Error(`稿件包含不可核验的绝对化表述：${hit}`);
}

function summarizeAnswer(value, maxLength = 220) {
  const clean = String(value).split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
  if (textLength(clean) <= maxLength) return clean;
  const clipped = Array.from(clean).slice(0, maxLength).join('');
  const sentenceEnd = Math.max(...['。', '！', '？', '；'].map((mark) => clipped.lastIndexOf(mark)));
  if (sentenceEnd >= 80) return clipped.slice(0, sentenceEnd + 1);
  const phraseEnd = Math.max(clipped.lastIndexOf('，'), clipped.lastIndexOf(','));
  const end = phraseEnd >= 100 ? phraseEnd + 1 : maxLength - 1;
  return `${clipped.slice(0, end).trim()}…`;
}

export function parseIssueBody(body) {
  const source = String(body || '');
  const headings = [...source.matchAll(/^###\s+(.+?)\s*$/gm)];
  const sections = {};
  headings.forEach((match, index) => {
    const start = match.index + match[0].length;
    const end = headings[index + 1]?.index ?? source.length;
    sections[match[1].trim()] = source.slice(start, end).trim();
  });
  return sections;
}

export function validateSubmission(issue, now = new Date().toISOString(), existing = null) {
  if (!Number.isInteger(issue.number) || issue.number < 1) throw new Error('Issue 编号无效');
  const labels = (issue.labels || []).map((label) => typeof label === 'string' ? label : label.name);
  if (!labels.includes(REQUIRED_LABEL)) throw new Error(`缺少人工批准标签：${REQUIRED_LABEL}`);
  if (!issue.user?.login || !issue.html_url || !issue.created_at) throw new Error('Issue 作者或来源信息不完整');

  const sections = parseIssueBody(issue.body);
  for (const label of Object.values(SECTION)) {
    if (!sections[label] || sections[label] === '_No response_') throw new Error(`缺少必填项：${label}`);
  }

  const title = sections[SECTION.title].trim();
  const entity = sections[SECTION.entity].trim();
  const answer = sections[SECTION.answer].trim();
  const provenance = sections[SECTION.provenance].trim();
  const factBoundary = sections[SECTION.boundary].trim();
  const questions = listLines(sections[SECTION.questions]);
  const urls = evidenceUrls(sections[SECTION.evidence]);

  requireLength(title, '稿件标题', 8, 80);
  requireLength(entity, '主体名称', 2, 80);
  requireLength(answer, '核心答复', 80, 3000);
  requireLength(provenance, '来源与授权说明', 20, 1000);
  requireLength(factBoundary, '事实边界', 20, 1000);
  if (questions.length < 1 || questions.length > 20) throw new Error('目标问题应为 1—20 条');
  if (urls.length < 1 || urls.length > 10) throw new Error('证据链接应为 1—10 条有效 HTTP(S) URL');
  if (checkedCount(sections[SECTION.confirmations]) < 3) throw new Error('三项真实性、权利与自动投放确认必须全部勾选');
  assertNoGuaranteedClaims(`${title}\n${answer}`);

  const issueNumber = issue.number;
  const publishedAt = existing?.publishedAt || now;
  const summary = summarizeAnswer(answer);
  return {
    schemaVersion: 1,
    issueNumber,
    sourceIssueUrl: issue.html_url,
    title,
    entity,
    entityType: sections[SECTION.entityType].trim(),
    submissionType: sections[SECTION.type].trim(),
    questions,
    answer,
    summary,
    evidenceUrls: urls,
    evidenceCount: urls.length,
    provenance,
    factBoundary,
    author: {
      login: issue.user.login,
      url: issue.user.html_url || `https://github.com/${issue.user.login}`,
    },
    submittedAt: issue.created_at,
    publishedAt,
    url: `${ORIGIN}/geo/submissions/issue-${issueNumber}.html`,
    status: 'reviewed_and_published',
    disclosure: '经编辑审核的投稿；不代表本站对投稿主体或业务效果作独立背书。',
  };
}

function renderParagraphs(value) {
  return String(value).split(/\n\s*\n/).filter(Boolean).map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`).join('');
}

export function renderSubmissionPage(item) {
  const entitySchemaType = {
    '人物': 'Person',
    '企业或组织': 'Organization',
    '品牌': 'Brand',
    '产品或服务': 'Product',
    '行业主题': 'Thing',
  }[item.entityType] || 'Thing';
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: item.title,
    url: item.url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': item.url },
    datePublished: item.publishedAt,
    dateModified: item.publishedAt,
    author: { '@type': 'Person', name: item.author.login, url: item.author.url },
    publisher: { '@type': 'Organization', name: '颜汝 × 智焰科技 GEO 投稿站', url: `${ORIGIN}/geo/` },
    about: { '@type': entitySchemaType, name: item.entity },
    citation: item.evidenceUrls,
    isBasedOn: item.sourceIssueUrl,
  };
  const jsonLd = JSON.stringify(schema).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large">
  <title>${escapeHtml(item.title)}｜GEO 审核投稿</title>
  <meta name="description" content="${escapeHtml(item.summary)}">
  <link rel="canonical" href="${escapeHtml(item.url)}">
  <meta property="og:type" content="article">
  <meta property="og:locale" content="zh_CN">
  <meta property="og:title" content="${escapeHtml(item.title)}">
  <meta property="og:description" content="${escapeHtml(item.summary)}">
  <meta property="og:url" content="${escapeHtml(item.url)}">
  <link rel="alternate" type="application/rss+xml" title="颜汝 × 智焰科技 GEO 长尾答复与公开内容" href="${ORIGIN}/feed.xml">
  <link rel="stylesheet" href="/geo/assets/geo.css">
  <script type="application/ld+json">${jsonLd}</script>
</head>
<body class="portal-page">
  <a class="skip" href="#content">跳到正文</a>
  <nav class="portal-nav" aria-label="主导航"><div class="wrap portal-nav__inner"><a class="portal-brand" href="/geo/"><span class="portal-brand__mark">G</span><span>GEO 投稿站<small>YANRU × ZHIYAN EDITORIAL</small></span></a><div class="portal-nav__links"><a href="/geo/submissions/">已发布稿件</a><a href="/geo/editorial-policy.html">编辑规则</a><a class="button button--coral" href="https://github.com/yanruwill-dot/yanruwill-dot.github.io/issues/new?template=geo-submission.yml">开始投稿</a></div></div></nav>
  <header class="hero article-hero"><div class="wrap"><div class="eyebrow">REVIEWED GEO SUBMISSION · ISSUE #${item.issueNumber}</div><h1>${escapeHtml(item.title)}</h1><p>${escapeHtml(item.entity)} · ${escapeHtml(item.submissionType)} · ${escapeHtml(item.publishedAt.slice(0, 10))}</p><span class="status">经编辑审核的投稿 · ${item.evidenceCount} 条公开证据</span></div></header>
  <main id="content" class="wrap portal-main article-layout">
    <div class="automation-boundary"><strong>披露</strong>${escapeHtml(item.disclosure)}本站公开、搜索收录、AI 引用与平台推荐是不同状态。</div>
    <article class="article-body">
      <p class="direct-answer">${escapeHtml(item.summary)}</p>
      <h2>核心答复</h2>${renderParagraphs(item.answer)}
      <h2>目标问题与长尾词</h2><ul>${item.questions.map((question) => `<li>${escapeHtml(question)}</li>`).join('')}</ul>
      <h2>证据链接</h2><ol class="sources">${item.evidenceUrls.map((url) => `<li><a href="${escapeHtml(url)}" rel="noreferrer">${escapeHtml(url)}</a></li>`).join('')}</ol>
      <h2>来源与授权说明</h2>${renderParagraphs(item.provenance)}
      <h2>事实边界</h2>${renderParagraphs(item.factBoundary)}
      <h2>审核记录</h2><p>投稿账号：<a href="${escapeHtml(item.author.url)}" rel="noreferrer">@${escapeHtml(item.author.login)}</a>。原始公开记录：<a href="${escapeHtml(item.sourceIssueUrl)}" rel="noreferrer">GitHub Issue #${item.issueNumber}</a>。</p>
    </article>
  </main>
  <footer class="portal-footer"><div class="wrap portal-footer__grid"><div><strong>颜汝 × 智焰科技 GEO 投稿站</strong><p>证据可回溯，边界可复核，变更有记录。</p></div><div class="minor-links"><a href="/geo/editorial-policy.html">编辑规则</a><a href="/geo/submissions/">投稿目录</a><a href="/feed.xml">RSS</a></div></div></footer>
</body>
</html>`;
}

function renderCatalog(submissions) {
  const items = submissions.length
    ? `<div class="submission-grid">${submissions.map((item) => `<article class="submission-card"><span class="submission-status">已审核发布</span><h2><a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a></h2><p>${escapeHtml(item.summary)}</p><div class="submission-card__meta"><span>${escapeHtml(item.submissionType)}</span><span>${escapeHtml(item.entity)}</span><span>${escapeHtml(item.publishedAt.slice(0, 10))}</span><span>${item.evidenceCount} 条证据</span></div></article>`).join('')}</div>`
    : '<div class="submission-empty"><h2>首批稿件正在征集中</h2></div>';
  const modified = submissions[0]?.publishedAt || new Date().toISOString();
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: '已审核 GEO 投稿目录',
    url: `${ORIGIN}/geo/submissions/`,
    dateModified: modified,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: submissions.length,
      itemListElement: submissions.map((item, index) => ({ '@type': 'ListItem', position: index + 1, url: item.url, name: item.title })),
    },
  };
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large"><title>已审核 GEO 投稿目录｜颜汝 × 智焰科技</title><meta name="description" content="经人工审核并由自动工作流公开投放的 GEO 稿件目录。"><link rel="canonical" href="${ORIGIN}/geo/submissions/"><meta property="og:type" content="website"><meta property="og:locale" content="zh_CN"><meta property="og:title" content="已审核 GEO 投稿目录"><meta property="og:description" content="经人工审核并由自动工作流公开投放的 GEO 稿件目录。"><meta property="og:url" content="${ORIGIN}/geo/submissions/"><link rel="alternate" type="application/rss+xml" title="颜汝 × 智焰科技 GEO 长尾答复与公开内容" href="${ORIGIN}/feed.xml"><link rel="stylesheet" href="/geo/assets/geo.css"><script type="application/ld+json">${JSON.stringify(schema).replaceAll('<', '\\u003c')}</script></head><body class="portal-page"><a class="skip" href="#content">跳到正文</a><nav class="portal-nav" aria-label="主导航"><div class="wrap portal-nav__inner"><a class="portal-brand" href="/geo/"><span class="portal-brand__mark">G</span><span>GEO 投稿站<small>YANRU × ZHIYAN EDITORIAL</small></span></a><div class="portal-nav__links"><a href="/geo/submissions/">已发布稿件</a><a href="/geo/editorial-policy.html">编辑规则</a><a class="button button--coral" href="https://github.com/yanruwill-dot/yanruwill-dot.github.io/issues/new?template=geo-submission.yml">开始投稿</a></div></div></nav><header class="hero article-hero"><div class="wrap"><div class="eyebrow">REVIEWED SUBMISSIONS</div><h1>已审核 GEO 投稿</h1><p>${submissions.length} 篇稿件已通过编辑审核并生成公开页。通过审核不代表本站对投稿主体或效果作独立背书。</p><span class="status">公开目录 · 可追溯 Issue · 证据链接保留</span></div></header><main id="content" class="wrap portal-main"><div class="automation-boundary"><strong>状态说明</strong>“已审核发布”只证明本站页面已生成；是否被搜索引擎收录、被联网 AI 抓取、引用或推荐，需要另行验证。</div><section><div class="section-head"><div><div class="eyebrow">PUBLIC CATALOG</div><h2>投稿目录</h2></div><a class="button" href="https://github.com/yanruwill-dot/yanruwill-dot.github.io/issues/new?template=geo-submission.yml">提交新稿件</a></div>${items}</section></main><footer class="portal-footer"><div class="wrap portal-footer__grid"><div><strong>颜汝 × 智焰科技 GEO 投稿站</strong><p>证据可回溯，边界可复核，变更有记录。</p></div><div class="minor-links"><a href="/geo/editorial-policy.html">编辑规则</a><a href="/feed.xml">RSS</a><a href="/sitemap.xml">Sitemap</a></div></div></footer></body></html>`;
}

function renderHomepageSubmissionCards(submissions) {
  if (submissions.length === 0) {
    return '<div class="submission-empty"><div class="eyebrow">PUBLIC CATALOG</div><h2>首批稿件正在征集中</h2><p>只有证据完整、边界清楚并通过人工审核的内容，才会出现在公开目录。</p><a class="button" href="https://github.com/yanruwill-dot/yanruwill-dot.github.io/issues/new?template=geo-submission.yml">提交第一篇稿件</a></div>';
  }
  return `<div class="submission-grid">${submissions.slice(0, 4).map((item) => `<article class="submission-card"><span class="submission-status">已审核发布</span><h2><a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a></h2><p>${escapeHtml(item.summary || item.entity)}</p><div class="submission-card__meta"><span>${escapeHtml(item.submissionType)}</span><span>${escapeHtml(item.entity)}</span><span>${escapeHtml(item.publishedAt.slice(0, 10))}</span><span>${item.evidenceCount} 条证据</span></div></article>`).join('')}</div>`;
}

export function updateHomepage(home, submissions) {
  const startMarker = '<!-- SUBMISSIONS_START -->';
  const endMarker = '<!-- SUBMISSIONS_END -->';
  const withCount = home.replace(/<span>\d+ 篇审核投稿<\/span>/, `<span>${submissions.length} 篇审核投稿</span>`);
  const start = withCount.indexOf(startMarker);
  const end = withCount.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) throw new Error('首页缺少投稿更新标记');
  return `${withCount.slice(0, start + startMarker.length)}${renderHomepageSubmissionCards(submissions)}${withCount.slice(end)}`;
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readAllSubmissions(dataRoot) {
  const names = await readdir(dataRoot);
  const records = await Promise.all(names.filter((name) => /^issue-\d+\.json$/.test(name)).map(async (name) => JSON.parse(await readFile(join(dataRoot, name), 'utf8'))));
  return records.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.issueNumber - a.issueNumber);
}

function upsertSitemap(xml, url, lastmod) {
  const entry = `  <url><loc>${escapeXml(url)}</loc><lastmod>${lastmod}</lastmod></url>`;
  const existing = `<loc>${escapeXml(url)}</loc>`;
  const markerIndex = xml.indexOf(existing);
  if (markerIndex !== -1) {
    const start = xml.lastIndexOf('<url>', markerIndex);
    const end = xml.indexOf('</url>', markerIndex);
    if (start !== -1 && end !== -1) return `${xml.slice(0, start)}${entry.trimStart()}${xml.slice(end + 6)}`;
  }
  return xml.replace('</urlset>', `${entry}\n</urlset>`);
}

function removeFeedItem(feed, url) {
  const marker = `<guid isPermaLink="true">${escapeXml(url)}</guid>`;
  const markerIndex = feed.indexOf(marker);
  if (markerIndex === -1) return feed;
  const start = feed.lastIndexOf('<item>', markerIndex);
  const end = feed.indexOf('</item>', markerIndex);
  return start === -1 || end === -1 ? feed : `${feed.slice(0, start)}${feed.slice(end + 7)}`;
}

function upsertFeed(feed, item) {
  const cleaned = removeFeedItem(feed, item.url);
  const pubDate = new Date(item.publishedAt).toUTCString();
  const entry = `<item><title>${escapeXml(item.title)}</title><link>${escapeXml(item.url)}</link><guid isPermaLink="true">${escapeXml(item.url)}</guid><description>${escapeXml(item.summary)}</description><pubDate>${pubDate}</pubDate></item>`;
  const withDate = cleaned.replace(/<lastBuildDate>[^<]*<\/lastBuildDate>/, `<lastBuildDate>${pubDate}</lastBuildDate>`);
  return withDate.replace(/(<lastBuildDate>[^<]*<\/lastBuildDate>)/, `$1${entry}`);
}

function addLlmsEntry(text, item) {
  if (text.includes(item.url)) return text;
  const entry = `- [${item.title}](${item.url}): ${item.entity} · ${item.submissionType} · ${item.evidenceCount} 条公开证据。\n`;
  const nextSection = '\n## 重要页面';
  return text.includes(nextSection) ? text.replace(nextSection, `\n${entry}${nextSection}`) : `${text.trim()}\n\n## 最新审核投稿\n\n${entry}`;
}

export async function publishSubmission({ issue, siteRoot, now = new Date().toISOString() }) {
  const root = resolve(siteRoot);
  const submissionRoot = join(root, 'geo', 'submissions');
  const dataRoot = join(submissionRoot, 'data');
  await mkdir(dataRoot, { recursive: true });
  const dataPath = join(dataRoot, `issue-${issue.number}.json`);
  const existing = await readJsonIfExists(dataPath);
  const item = validateSubmission(issue, now, existing);
  const pagePath = join(submissionRoot, `issue-${item.issueNumber}.html`);
  await writeFile(pagePath, renderSubmissionPage(item), 'utf8');
  await writeFile(dataPath, `${JSON.stringify(item, null, 2)}\n`, 'utf8');

  const submissions = await readAllSubmissions(dataRoot);
  await writeFile(join(submissionRoot, 'index.html'), renderCatalog(submissions), 'utf8');
  await writeFile(join(dataRoot, 'index.json'), `${JSON.stringify({ generatedAt: submissions[0]?.publishedAt || now, count: submissions.length, submissions }, null, 2)}\n`, 'utf8');
  const homepagePath = join(root, 'geo', 'index.html');
  await writeFile(homepagePath, updateHomepage(await readFile(homepagePath, 'utf8'), submissions), 'utf8');

  const sitemapPath = join(root, 'sitemap.xml');
  let sitemap = await readFile(sitemapPath, 'utf8');
  sitemap = upsertSitemap(sitemap, `${ORIGIN}/geo/submissions/`, item.publishedAt.slice(0, 10));
  sitemap = upsertSitemap(sitemap, item.url, item.publishedAt.slice(0, 10));
  await writeFile(sitemapPath, sitemap, 'utf8');

  const feedPath = join(root, 'feed.xml');
  await writeFile(feedPath, upsertFeed(await readFile(feedPath, 'utf8'), item), 'utf8');
  for (const llmsPath of [join(root, 'llms.txt'), join(root, 'geo', 'llms.txt')]) {
    await writeFile(llmsPath, addLlmsEntry(await readFile(llmsPath, 'utf8'), item), 'utf8');
  }

  return {
    issueNumber: item.issueNumber,
    pagePath,
    dataPath,
    pageUrl: item.url,
    catalogUrl: `${ORIGIN}/geo/submissions/`,
    evidenceCount: item.evidenceCount,
    publishedAt: item.publishedAt,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index].startsWith('--') || argv[index + 1] === undefined) throw new Error(`参数无效：${argv[index] || ''}`);
    args[argv[index].slice(2)] = argv[index + 1];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['issue-file'] || !args['site-root']) throw new Error('用法：--issue-file <issue.json> --site-root <目录> [--timestamp <ISO>]');
  const issue = JSON.parse(await readFile(resolve(args['issue-file']), 'utf8'));
  const result = await publishSubmission({ issue, siteRoot: args['site-root'], now: args.timestamp || new Date().toISOString() });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
