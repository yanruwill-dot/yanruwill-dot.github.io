import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const endpoint = 'https://api.indexnow.org/indexnow';
const host = 'yanruwill-dot.github.io';
const key = 'bce7b14a9d4b9cd1cd949ae80bf053c4';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) args[argv[index].replace(/^--/, '')] = argv[index + 1];
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['result-file']) throw new Error('缺少 --result-file');
  const publication = JSON.parse(await readFile(resolve(args['result-file']), 'utf8'));
  const urlList = [publication.pageUrl, publication.catalogUrl, `https://${host}/feed.xml`, `https://${host}/sitemap.xml`];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let result;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host, key, keyLocation: `https://${host}/${key}.txt`, urlList }),
      signal: controller.signal,
    });
    result = { ok: response.ok, status: response.status, submittedAt: new Date().toISOString(), urlList };
  } catch (error) {
    result = { ok: false, status: null, submittedAt: new Date().toISOString(), urlList, error: error.message };
  } finally {
    clearTimeout(timer);
  }
  await writeResult(args.output || '/tmp/indexnow-result.json', result);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function writeResult(path, value) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
