import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextSlot, pickSlot, postParts } from './publisher.module.ts';
import { pickIntegration, settingsFor, toMetrics, connectedTo, targetsFor } from '../adapters/postiz.ts';

test('posting slots: today if still ahead, else tomorrow; never twice a day per platform', () => {
  const at = (s: string) => new Date(s);
  assert.equal(nextSlot(at('2026-09-30T02:00Z'), undefined, 4).toISOString(), '2026-09-30T04:00:00.000Z');
  assert.equal(nextSlot(at('2026-09-30T05:00Z'), undefined, 4).toISOString(), '2026-10-01T04:00:00.000Z');
  // platform already booked for 10-03 → next free day
  assert.equal(nextSlot(at('2026-09-30T05:00Z'), at('2026-10-03T04:00Z'), 4).toISOString(), '2026-10-04T04:00:00.000Z');
  // an old booking doesn't pull the slot into the past
  assert.equal(nextSlot(at('2026-09-30T05:00Z'), at('2026-09-01T04:00Z'), 4).toISOString(), '2026-10-01T04:00:00.000Z');
});

test('a future planned time from the calendar wins; a past one falls back to the next slot', () => {
  const now = new Date('2026-09-30T05:00Z');
  assert.equal(pickSlot(now, new Date('2026-10-07T13:30Z'), undefined, 4).toISOString(), '2026-10-07T13:30:00.000Z');
  assert.equal(pickSlot(now, new Date('2026-09-29T13:30Z'), undefined, 4).toISOString(), '2026-10-01T04:00:00.000Z');
  assert.equal(pickSlot(now, null, undefined, 4).toISOString(), '2026-10-01T04:00:00.000Z');
});

test('post parts: X thread with the link last, Instagram caption only, others body + CTA + link', () => {
  const utm = 'https://pratapai.com/ai-readiness?utm_source=x';
  assert.deepEqual(postParts({ platform: 'x', title: 't', body: 'one\n---\ntwo', cta: 'Thoughts?' }, utm),
    ['one', `two\n\nThoughts? ${utm}`]);
  assert.deepEqual(postParts({ platform: 'instagram', title: 't', hook: 'Hook line', body: 's1\n---\ns2', cta: 'Save this' }, utm),
    ['Hook line\n\nSave this']);
  assert.deepEqual(postParts({ platform: 'facebook', title: 't', body: 'post', cta: null }, utm), [`post\n\n${utm}`]);
  // A single image on Instagram: the body is the caption. A LinkedIn carousel: the slides aren't the caption.
  assert.deepEqual(postParts({ platform: 'instagram', format: 'quote_card', title: 't', hook: 'Headline', body: 'Caption', cta: 'Save this' }, utm),
    ['Caption\n\nSave this']);
  assert.deepEqual(postParts({ platform: 'linkedin', format: 'carousel', title: 't', hook: 'Hook line', body: 's1\n---\ns2', cta: 'Thoughts?' }, utm),
    [`Hook line\n\nThoughts? ${utm}`]);
});

test('Postiz: first live matching channel, and the settings each channel requires', () => {
  const all = [{ id: '1', identifier: 'instagram', disabled: true }, { id: '2', identifier: 'instagram-standalone' }, { id: '3', identifier: 'linkedin-page' }];
  assert.equal(pickIntegration(all, 'instagram')?.id, '2');
  assert.equal(pickIntegration(all, 'linkedin')?.id, '3');
  assert.equal(pickIntegration(all, 'facebook'), undefined);
  assert.deepEqual(settingsFor('instagram-standalone'), { __type: 'instagram-standalone', post_type: 'post', collaborators: [] });
  assert.deepEqual(settingsFor('x'), { __type: 'x', who_can_reply_post: 'everyone' });
});

test('post stats: each platform label lands in our field, newest running total wins', () => {
  const pt = (...t: number[]) => t.map((total) => ({ total: String(total), date: 'd' }));
  // X
  assert.deepEqual(toMetrics([
    { label: 'Impressions', data: pt(100, 900) }, { label: 'Likes', data: pt(40) }, { label: 'Retweets', data: pt(3) },
    { label: 'Quotes', data: pt(2) }, { label: 'Replies', data: pt(5) }, { label: 'Bookmarks', data: pt(1) },
  ]), { impressions: 900, likes: 40, shares: 5, comments: 5, saves: 1 });
  // LinkedIn page: unique impressions are reach, not impressions; an unknown label is ignored
  assert.deepEqual(toMetrics([
    { label: 'Impressions', data: pt(500) }, { label: 'Unique Impressions', data: pt(300) },
    { label: 'Clicks', data: pt(12) }, { label: 'Engagement', data: pt(9) }, { label: 'Likes', data: pt('x' as never) },
  ]), { impressions: 500, reach: 300, clicks: 12 });
  assert.deepEqual(toMetrics([]), {});
});

test('connectedTo: only platforms with an enabled Postiz channel', () => {
  const on = connectedTo([{ id: '1', identifier: 'linkedin-page' }, { id: '2', identifier: 'x', disabled: true }, { id: '3', identifier: 'reddit' }]);
  assert.deepEqual(on.filter((p) => p !== 'linkedin-page'), ['linkedin', 'reddit']);
});

test('targetsFor: chosen channels only, all of the platform when none chosen', () => {
  const all = [{ id: 'me', identifier: 'linkedin' }, { id: 'page', identifier: 'linkedin-page' }, { id: 'fb', identifier: 'facebook' }, { id: 'off', identifier: 'linkedin', disabled: true }];
  assert.deepEqual(targetsFor(all, 'linkedin', null).map((i) => i.id), ['me', 'page']);
  assert.deepEqual(targetsFor(all, 'linkedin', ['page', 'fb', 'off']).map((i) => i.id), ['page']);
});
