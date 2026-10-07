import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTopicScore } from './score-parse.ts';
import { parseExtractedTopic } from './topic-extract.ts';
import { parseReview } from './review-parse.ts';

// --- score-parse -----------------------------------------------------------
test('parseTopicScore clamps factors and accepts snake_case aliases', () => {
  const out = parseTopicScore(JSON.stringify({
    score_lead_intent: 9, reach: 4, brandFit: 5, proof: 0, score_repurpose: 5,
  }));
  assert.deepEqual(out, { leadIntent: 5, reach: 4, brandFit: 5, proof: 1, repurpose: 5 });
});

test('parseTopicScore keeps a valid pillar/funnel and drops invalid ones', () => {
  const a = parseTopicScore(JSON.stringify({ leadIntent: 3, reach: 3, brandFit: 3, proof: 3, repurpose: 3, pillar: 'proof_and_use_cases', funnelStage: 'conversion' }));
  assert.equal(a.pillar, 'proof_and_use_cases');
  assert.equal(a.funnelStage, 'conversion');
  const b = parseTopicScore(JSON.stringify({ leadIntent: 3, reach: 3, brandFit: 3, proof: 3, repurpose: 3, pillar: 'nope' }));
  assert.equal(b.pillar, undefined);
});

// --- topic-extract ---------------------------------------------------------
test('parseExtractedTopic returns a grounded topic with defaults', () => {
  const out = parseExtractedTopic(JSON.stringify({ title: 'How AI stops leads slipping through the cracks' }));
  assert.equal(out.title, 'How AI stops leads slipping through the cracks');
  assert.equal(out.pillar, 'practical_ai_for_operators'); // default
  assert.equal(out.funnelStage, 'awareness');             // default
  assert.equal(out.customerLanguage, null);
});

test('parseExtractedTopic throws without a title', () => {
  assert.throws(() => parseExtractedTopic(JSON.stringify({ pillar: 'proof_and_use_cases' })), /no title/);
});

// --- review-parse ----------------------------------------------------------
test('parseReview extracts summary + capped recommendations', () => {
  const out = parseReview(JSON.stringify({ summary: 'Good week', recommendations: ['Do X', '', 'Do Y', 5] }));
  assert.equal(out.summary, 'Good week');
  assert.deepEqual(out.recommendations, ['Do X', 'Do Y']);
});

test('parseReview throws when there are no recommendations', () => {
  assert.throws(() => parseReview(JSON.stringify({ summary: 'x', recommendations: [] })), /no recommendations/);
});
