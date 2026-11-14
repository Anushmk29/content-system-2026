import { test } from 'node:test';
import assert from 'node:assert/strict';
import { igHooks, igSkill, igSlop, type IgSkill } from './ig-skills.ts';
import { buildDraftPrompt } from './draft.ts';
import { buildScriptPrompt } from './scripts.ts';
import { humanScore } from '../humanizer.ts';
import { measureFacts } from '../creative-check/report.ts';

const ALL: IgSkill[] = ['ig-audit', 'ig-caption', 'ig-carousel', 'ig-comment', 'ig-dm', 'ig-human', 'ig-plan',
  'ig-profile', 'ig-reel', 'ig-reply', 'ig-repurpose', 'ig-story', 'ig-viral'];

test('every vendored skill loads, front-matter dropped, behind the pipeline header', () => {
  for (const s of ALL) {
    const t = igSkill(s);
    assert.match(t, new RegExp(`^=== INSTAGRAM SKILL: ${s} ===\\nYou are inside an automated pipeline`));
    assert.ok(!/^name:/m.test(t), `${s} still has front-matter`);
    assert.ok(t.endsWith(`=== END SKILL: ${s} ===`));
  }
  assert.match(igHooks(), /^1\. Cost Confession:/m);
});

test('slop.json: terms and structural tells feed the human score', () => {
  assert.equal(igSlop().structures.length, 16);
  const h = humanScore("It's not just a tool, it's a system. Follow for more. What are your thoughts?");
  assert.ok(h.phrases.includes('follow for more') && h.phrases.includes('what are your thoughts?'), h.phrases.join());
  assert.ok(h.tells.some((t) => t.startsWith('"It\'s not just X, it\'s Y"')), h.tells.join(' | '));
});

test('Instagram prompts carry their skills only when Instagram is in play', () => {
  const ig = buildDraftPrompt({ topicTitle: 't', platforms: ['linkedin', 'instagram'] });
  assert.ok(ig.includes('INSTAGRAM SKILL: ig-carousel') && ig.includes('INSTAGRAM SKILL: ig-caption'));
  assert.ok(ig.lastIndexOf('Respond with ONLY a JSON object') > ig.lastIndexOf('END SKILL'), 'our JSON format must come last');
  const image = buildDraftPrompt({ topicTitle: 't', platforms: ['instagram'], formats: { instagram: 'image' } });
  assert.ok(!image.includes('ig-carousel ===') && image.includes('"body" is the caption'));
  assert.ok(!buildDraftPrompt({ topicTitle: 't', platforms: ['linkedin'] }).includes('INSTAGRAM SKILL'));
  assert.ok(buildScriptPrompt({ topicTitle: 't', targets: ['instagram_reel'] }).includes('INSTAGRAM SKILL: ig-reel'));
  assert.ok(!buildScriptPrompt({ topicTitle: 't', targets: ['linkedin_video'] }).includes('INSTAGRAM SKILL'));
});

test('Creative Check: Instagram caption cut-off and hashtag cap', () => {
  const facts = measureFacts({ platform: 'instagram', hook: 'x'.repeat(140), body: 'Slide', cta: 'Save it.\n#a #b #c #d #e #f #g #h' });
  assert.equal(facts.find((f) => f.key === 'before_more')!.meaning, 'Cut after 125 characters: the feed hides the last 15.');
  assert.equal(facts.find((f) => f.key === 'hashtags')!.value, '8');
  assert.ok(!measureFacts({ platform: 'linkedin', hook: 'h', body: 'b', cta: 'c' }).some((f) => f.key === 'hashtags'));
});
