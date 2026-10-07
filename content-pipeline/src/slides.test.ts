import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { renderSlides, splitSlides, slideSvg } from './slides.ts';

test('carousel body → one 1080×1350 PNG per slide; text is XML-escaped', async () => {
  assert.deepEqual(splitSlides('Hook\n---\n  two  \n---\n\n---\nthree'), ['Hook', 'two', 'three']);
  const pngs = await renderSlides('Stop <automating> chaos\n---\nMap the workflow first & then build');
  assert.equal(pngs.length, 2);
  const meta = await sharp(pngs[0]!).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['png', 1080, 1350]);
  assert.match(slideSvg('a <b> & c', 1, 1), /a &lt;b&gt; &amp; c/);
  await assert.rejects(renderSlides(' --- '), /no slide text/);
});
