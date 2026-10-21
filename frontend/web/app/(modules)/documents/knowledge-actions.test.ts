import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canDeleteKnowledgeCategory,
  canRemoveArticleMember,
  parseMemberIdentity,
  parseRetentionDelaySeconds,
  toKnowledgeCategoryUpdateBody,
} from './knowledge-actions';

test('a category can be deleted only while it has no articles', () => {
  assert.equal(canDeleteKnowledgeCategory({ articleCount: 0 }), true);
  assert.equal(canDeleteKnowledgeCategory({ article_count: 3 }), false);
  assert.equal(canDeleteKnowledgeCategory({}), true);
});

test('a member can be removed only from an article that has members', () => {
  assert.equal(canRemoveArticleMember({ articleMemberCount: 2 }), true);
  assert.equal(canRemoveArticleMember({ articleMemberCount: 0 }), false);
  assert.equal(canRemoveArticleMember({}), false);
  assert.equal(parseMemberIdentity({ member: '  0xabc ' }), '0xabc');
  assert.equal(parseMemberIdentity({ member: ' ' }), null);
  assert.equal(parseMemberIdentity(null), null);
});

test('the category update body needs a name and wraps the optional fields', () => {
  assert.equal(toKnowledgeCategoryUpdateBody({ name: ' ' }), null);
  assert.equal(toKnowledgeCategoryUpdateBody({ name: 'FAQ', color: '12' }), null);
  assert.equal(toKnowledgeCategoryUpdateBody({ name: 'FAQ', sequence: '1.5' }), null);
  const body = toKnowledgeCategoryUpdateBody({ name: ' FAQ ', description: '', color: '3', sequence: '20' });
  assert.deepEqual(body, {
    name: { some: 'FAQ' },
    color: { some: 3 },
    sequence: { some: 20 },
    company_id: { none: [] },
    description: { none: [] },
  });
});

test('the retention delay is a whole number of seconds from 1', () => {
  assert.equal(parseRetentionDelaySeconds('90'), 90);
  assert.equal(parseRetentionDelaySeconds(60), 60);
  assert.equal(parseRetentionDelaySeconds('0'), null);
  assert.equal(parseRetentionDelaySeconds('1.5'), null);
  assert.equal(parseRetentionDelaySeconds(''), null);
});
