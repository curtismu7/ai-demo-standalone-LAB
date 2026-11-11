import test from 'node:test';
import assert from 'node:assert/strict';

test('no home-directory fallback: without SHELF_URL or STANDALONE_ENV the shelf URL is null', async () => {
  const { shelfInfo } = await import('../src/shelfLink.js');
  const info = shelfInfo({ HOME: '/nonexistent-home-for-test' });
  assert.equal(info.shelfUrl, null);
});

test('STANDALONE_ENV file with SHELF_URL wins; a bare SHELF_URL env wins over it', async () => {
  const { shelfInfo } = await import('../src/shelfLink.js');
  const os = await import('node:os');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelftest-'));
  const file = path.join(dir, 'env');
  fs.writeFileSync(file, 'SHELF_URL=https://shelf.example\n');
  assert.equal(shelfInfo({ STANDALONE_ENV: file }).shelfUrl, 'https://shelf.example');
  assert.equal(shelfInfo({ SHELF_URL: 'https://direct.example/', STANDALONE_ENV: file }).shelfUrl, 'https://direct.example');
});
