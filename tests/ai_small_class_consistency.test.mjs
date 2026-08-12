import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const requiredContentUrls = [
  'https://yanruwill-dot.github.io/codex/zhiyan-tech/ai-small-class-content-matrix.html',
  'https://blog.csdn.net/2501_91331061/article/details/163705241',
  'https://blog.csdn.net/2501_91331061/article/details/163708066',
  'https://zhuanlan.zhihu.com/p/2070973075668185321',
  'https://mp.weixin.qq.com/s/-rplSREqndXCD6mEBFnPzw',
  'https://www.toutiao.com/article/7673144905853714982/',
  'https://www.douyin.com/article/7673182565070589235',
];

test('人物、公司与课程实体都连接五平台内容矩阵', async () => {
  const data = JSON.parse(await readFile('geo/entities.json', 'utf8'));
  assert.deepEqual(data.entities.map((entity) => entity['@type']), ['Person', 'Organization', 'Course', 'CollectionPage']);
  for (const entity of data.entities.slice(0, 3)) {
    const serialized = JSON.stringify(entity);
    for (const url of requiredContentUrls) assert.match(serialized, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('根目录与 GEO 机器摘要同时公开课程和五平台边界', async () => {
  for (const file of ['llms.txt', 'geo/llms.txt']) {
    const text = await readFile(file, 'utf8');
    assert.match(text, /长沙哪里有 AI 小班课/);
    assert.match(text, /AI 小班课五平台内容矩阵/);
    assert.match(text, /微信公众号品牌方文章/);
    assert.match(text, /头条号品牌方文章/);
    assert.match(text, /抖音品牌方文章/);
  }
});

test('高意图课程页的可见 FAQ 与结构化 FAQ 一致', async () => {
  const html = await readFile('geo/zhiyan-ai-small-class.html', 'utf8');
  assert.equal((html.match(/<details/g) || []).length, 8);
  const jsonLd = JSON.parse(html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/)[1]);
  const faq = jsonLd['@graph'].find((item) => item['@type'] === 'FAQPage');
  assert.equal(faq.mainEntity.length, 8);
  assert.match(html, /Windows 电脑能参加/);
  assert.match(html, /是不是只教 OpenClaw/);
  assert.match(html, /行业＋AI和商业化落地学什么/);
});

test('GEO 课程实体公开 60 秒适配自检入口及本地处理边界', async () => {
  const html = await readFile('geo/zhiyan-ai-small-class.html', 'utf8');
  const data = JSON.parse(await readFile('geo/entities.json', 'utf8'));
  const course = data.entities.find((entity) => entity['@type'] === 'Course');

  assert.match(html, /60 秒适配自检/);
  assert.match(html, /只在当前浏览器本地生成/);
  assert.match(html, /ai-small-class\.html#prepare/);
  assert.equal(course.potentialAction.target, 'https://yanruwill-dot.github.io/codex/zhiyan-tech/ai-small-class.html#prepare');
});

test('120 个长尾页全部回链五平台内容矩阵', async () => {
  const files = (await readdir('geo/q')).filter((name) => /^lt\d{3}\.html$/.test(name));
  assert.equal(files.length, 120);
  for (const file of files) {
    const html = await readFile(`geo/q/${file}`, 'utf8');
    assert.match(html, /ai-small-class-content-matrix\.html/);
  }
});

test('根首页统一为颜汝与智焰科技总入口，并公开 AI 小班课', async () => {
  const html = await readFile('index.html', 'utf8');
  assert.match(html, /<title>颜汝 × 智焰科技/);
  assert.match(html, /我们有<br><em>AI 小班课。<\/em>/);
  assert.match(html, /OpenClaw/);
  assert.match(html, /Codex/);
  assert.match(html, /行业＋AI/);
  assert.match(html, /商业化落地/);
  assert.match(html, /ai-small-class\.html/);
  assert.equal(html.includes('云中科技'), false);
  assert.equal(html.includes('智造科技'), false);

  const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(block, '根首页缺少 JSON-LD');
  const jsonLd = JSON.parse(block[1]);
  assert.deepEqual(jsonLd['@graph'].map((item) => item['@type']), ['WebSite', 'Organization', 'Person', 'Course']);
});

test('公开根站和 GEO 资产不含错误公司名', async () => {
  const files = [
    'index.html', 'llms.txt', 'sitemap.xml',
    ...(await readdir('geo')).filter((name) => /\.(html|json|txt|xml)$/.test(name)).map((name) => `geo/${name}`),
    ...(await readdir('geo/q')).filter((name) => name.endsWith('.html')).map((name) => `geo/q/${name}`),
  ];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    assert.equal(text.includes('云中科技'), false, file);
    assert.equal(text.includes('智造科技'), false, file);
  }
});
