import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectOfDecision, isApprovalAction } from '../src/approvals.ts';

test('effectOfDecision maps each button to the right status machine transition', () => {
  assert.deepEqual(effectOfDecision('approve'), { status: 'approved', approvalStatus: 'approved' });
  assert.deepEqual(effectOfDecision('changes'), { status: 'draft', approvalStatus: 'changes_requested' });
  assert.deepEqual(effectOfDecision('reject'), { status: 'archived', approvalStatus: 'rejected' });
});

test('effectOfDecision rejects unknown actions (no silent default)', () => {
  assert.equal(effectOfDecision('publish'), null);
  assert.equal(effectOfDecision(''), null);
  assert.equal(effectOfDecision('APPROVE'), null); // case-sensitive on purpose
});

test('isApprovalAction is a precise guard', () => {
  assert.ok(isApprovalAction('approve'));
  assert.ok(!isApprovalAction('delete'));
});

