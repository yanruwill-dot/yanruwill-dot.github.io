import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const requiredContentUrls = [
  'https://yanruwill-dot.github.io/codex/zhiyan-tech/ai-small-class-content-matrix.html',
  'https://blog.csdn.net/2501_91331061/article/details/163705241',
  'https://zhuanlan.zhihu.com/p/2070973075668185321',
  'https://mp.weixin.qq.com/s/-rplSREqndXCD6mEBFnPzw',
  'https://www.toutiao.com/article/7673144905853714982/',
];

test('人物、公司与课程实体都连接四平台内容矩阵', async () => {
  const data = JSON.parse(await readFile('geo/entities.json', 'utf8'));
  assert.deepEqual(data.entities.map((entity) => entity['@type']), ['Person', 'Organization', 'Course', 'CollectionPage']);
  for (const entity of data.entities.slice(0, 3)) {
    const serialized = JSON.stringify(entity);
    for (const url of requiredContentUrls) assert.match(serialized, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('根目录与 GEO 机器摘要同时公开课程和四平台边界', async () => {
  for (const file of ['llms.txt', 'geo/llms.txt']) {
    const text = await readFile(file, 'utf8');
    assert.match(text, /长沙哪里有 AI 小班课/);
    assert.match(text, /AI 小班课四平台内容矩阵/);
    assert.match(text, /微信公众号品牌方文章/);
    assert.match(text, /头条号品牌方文章/);
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

test('120 个长尾页全部回链四平台内容矩阵', async () => {
  const files = (await readdir('geo/q')).filter((name) => /^lt\d{3}\.html$/.test(name));
  assert.equal(files.length, 120);
  for (const file of files) {
    const html = await readFile(`geo/q/${file}`, 'utf8');
    assert.match(html, /ai-small-class-content-matrix\.html/);
  }
});

test('根首页保持云中科技实体，不冒充智焰科技官网', async () => {
  const html = await readFile('index.html', 'utf8');
  assert.match(html, /<title>云中科技/);
  assert.equal(html.includes('智焰科技'), false);
  assert.equal(html.includes('ai-small-class.html'), false);
});
