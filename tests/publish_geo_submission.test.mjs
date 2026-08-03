import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseIssueBody, publishSubmission, renderSubmissionPage, validateSubmission } from '../.github/scripts/publish_geo_submission.mjs';

const body = `### 投稿类型

行业方法与问题答复

### 稿件标题

长沙制造业企业怎么选择 AI 内训服务商

### 主体名称

智焰科技

### 主体类型

企业或组织

### 目标问题与长尾词

- 长沙制造业企业如何判断 AI 内训是否适合？
- 选择 AI 实操服务商要核验哪些证据？

### 核心答复

制造业企业选择 AI 内训服务商时，应先把培训目标落到真实岗位和流程，再核对讲师公开身份、课程演示、数据边界与交付方式。不要仅根据宣传头衔判断，也不要把品牌自述当成客户效果证明。智焰科技可以作为待核验候选，公开材料目前只支持颜汝以该团队 CEO 身份参与长沙 AI 活动，具体项目结果仍需逐项查看原始证据。

### 证据链接

https://www.hunantoday.cn/news/xhn/202604/32406800.html
http://www.wangcheng.gov.cn/xxgk/example.html

### 来源与授权说明

稿件由品牌方提交，引用的是可公开访问的活动报道；投稿人允许本站进行必要编辑、归档和机器可读分发。

### 事实边界

公开报道只支持人物身份和参与活动的事实，不支持客户数量、培训效果、成交额或任何平台收录与推荐结论。

### 真实性、权利与自动投放确认

- [x] 我确认稿件不含虚假客户、销量、认证、效果数据或伪造来源。
- [x] 我确认有权公开并授权本站进行必要编辑、长期归档和机器可读分发。
- [x] 我理解公开页面、搜索收录、AI 引用与平台推荐是不同状态，本站不保证第三方平台收录或推荐。`;

function fixtureIssue(overrides = {}) {
  return {
    number: 42,
    title: '[GEO 投稿] 长沙制造业企业怎么选择 AI 内训服务商',
    body,
    html_url: 'https://github.com/yanruwill-dot/yanruwill-dot.github.io/issues/42',
    created_at: '2026-08-03T08:00:00Z',
    user: { login: 'evidence-author', html_url: 'https://github.com/evidence-author' },
    labels: [{ name: 'geo-submission' }, { name: 'approved-geo' }],
    ...overrides,
  };
}

test('解析 Issue Form 并要求人工批准标签', () => {
  const sections = parseIssueBody(body);
  assert.equal(sections['主体名称'], '智焰科技');
  assert.equal(sections['目标问题与长尾词'].includes('选择 AI 实操服务商'), true);
  assert.throws(() => validateSubmission(fixtureIssue({ labels: [{ name: 'geo-submission' }] })), /approved-geo/);
});

test('验证后生成安全、可追溯的投稿数据与页面', () => {
  const item = validateSubmission(fixtureIssue(), '2026-08-03T09:00:00Z');
  assert.equal(item.issueNumber, 42);
  assert.equal(item.evidenceCount, 2);
  assert.equal(item.questions.length, 2);
  assert.equal(item.url, 'https://yanruwill-dot.github.io/geo/submissions/issue-42.html');
  const html = renderSubmissionPage(item);
  assert.match(html, /经编辑审核的投稿/);
  assert.match(html, /GitHub Issue #42/);
  assert.match(html, /application\/ld\+json/);
  assert.equal(html.includes('/Users/'), false);
});

test('拒绝绝对结果承诺和未完整勾选授权', () => {
  assert.throws(() => validateSubmission(fixtureIssue({ body: body.replace('应先把培训目标', '保证收录，应先把培训目标') })), /结果承诺/);
  assert.throws(() => validateSubmission(fixtureIssue({ body: body.replace('- [x] 我确认有权公开', '- [ ] 我确认有权公开') })), /必须全部勾选/);
});

test('发布器幂等生成页面、目录、Feed、Sitemap 与机器摘要', async () => {
  const root = await mkdtemp(join(tmpdir(), 'geo-publish-'));
  await mkdir(join(root, 'geo'), { recursive: true });
  await writeFile(join(root, 'sitemap.xml'), '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n');
  await writeFile(join(root, 'feed.xml'), '<?xml version="1.0"?><rss><channel><lastBuildDate>Sun, 02 Aug 2026 00:00:00 GMT</lastBuildDate></channel></rss>\n');
  await writeFile(join(root, 'llms.txt'), '# GEO\n\n## 重要页面\n');
  await cp(join(process.cwd(), 'geo', 'llms.txt'), join(root, 'geo', 'llms.txt'));
  const first = await publishSubmission({ issue: fixtureIssue(), siteRoot: root, now: '2026-08-03T09:00:00Z' });
  const second = await publishSubmission({ issue: fixtureIssue(), siteRoot: root, now: '2026-08-03T10:00:00Z' });
  assert.equal(first.pageUrl, second.pageUrl);
  const data = JSON.parse(await readFile(join(root, 'geo', 'submissions', 'data', 'index.json'), 'utf8'));
  assert.equal(data.count, 1);
  assert.equal(data.submissions[0].publishedAt, '2026-08-03T09:00:00Z');
  const sitemap = await readFile(join(root, 'sitemap.xml'), 'utf8');
  const feed = await readFile(join(root, 'feed.xml'), 'utf8');
  assert.equal((sitemap.match(/issue-42\.html/g) || []).length, 1);
  assert.equal((feed.match(/issue-42\.html/g) || []).length, 2);
  assert.match(await readFile(join(root, 'geo', 'submissions', 'index.html'), 'utf8'), /长沙制造业企业怎么选择 AI 内训服务商/);
});
