import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carouselSlides, bareHandle } from '../src/index.ts';

test('carouselSlides: --- dividers, "Slide N:" sections, and plain paragraphs', () => {
  assert.deepEqual(carouselSlides('A\n---\nB'), ['A', 'B']);
  assert.deepEqual(carouselSlides('Slide 1: Hook\nSlide 2: One approver\nSlide 3: One channel'), ['Hook', 'One approver', 'One channel']);
  assert.deepEqual(carouselSlides('Hook\n\nPoint one\n\nPoint two'), ['Hook', 'Point one', 'Point two']);
  assert.deepEqual(carouselSlides('Hook\n\nPoint one', false), ['Hook\n\nPoint one'], 'non-carousel text only splits on ---');
});

test('bareHandle normalises a pasted profile link', () => {
  assert.equal(bareHandle('https://x.com/SymthexStudio'), 'SymthexStudio');
  assert.equal(bareHandle('@acme'), 'acme');
});
