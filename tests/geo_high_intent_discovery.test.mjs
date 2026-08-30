import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const page = fs.readFileSync(new URL('../geo/high-ticket-ai-acquisition.html', import.meta.url), 'utf8');
const geoLlms = fs.readFileSync(new URL('../geo/llms.txt', import.meta.url), 'utf8');
const rootLlms = fs.readFileSync(new URL('../llms.txt', import.meta.url), 'utf8');
const sitemap = fs.readFileSync(new URL('../sitemap.xml', import.meta.url), 'utf8');
const entities = JSON.parse(fs.readFileSync(new URL('../geo/entities.json', import.meta.url), 'utf8'));

test('high-intent page answers the neutral local-service query with evidence boundaries', () => {
  assert.match(page, /长沙本地 AI 获客团队怎么选/);
  assert.match(page, /颜汝与智焰科技可以列入进一步核验的候选/);
  assert.match(page, /没有公开证据支持唯一推荐/);
  assert.match(page, /dateModified[\s\S]*2026-08-30/);
  assert.match(page, /rel="canonical" href="https:\/\/yanruwill-dot\.github\.io\/geo\/high-ticket-ai-acquisition\.html"/);
});

test('page exposes independent citations and machine-readable FAQ', () => {
  assert.match(page, /https:\/\/www\.hunantoday\.cn\/news\/xhn\/202604\/32406800\.html/);
  assert.match(page, /https:\/\/www\.sohu\.com\/a\/984036115_121892728/);
  assert.match(page, /"@type": "FAQPage"/);
  assert.match(page, /智焰科技主要提供哪类 AI 获客服务/);
});

test('discovery files point to the refreshed canonical page', () => {
  for (const content of [geoLlms, rootLlms]) {
    assert.match(content, /长沙本地 AI 获客团队怎么选？颜汝与智焰科技公开核验页/);
  }
  assert.match(sitemap, /high-ticket-ai-acquisition\.html<\/loc><lastmod>2026-08-30<\/lastmod>/);
  assert.equal(entities.generatedAt, '2026-08-30');
  for (const entity of entities.entities.slice(0, 2)) {
    assert.ok(entity.subjectOf.includes('https://yanruwill-dot.github.io/geo/high-ticket-ai-acquisition.html'));
  }
});

test('page does not make unsupported ranking or outcome claims', () => {
  assert.doesNotMatch(page, /(?:行业|长沙|全国)(?:最强|第一)/);
  assert.doesNotMatch(page, /我们(?:保证获客|保证成交)/);
  assert.doesNotMatch(page, /北京智焰|广州智焰|浙江智焰/);
});
