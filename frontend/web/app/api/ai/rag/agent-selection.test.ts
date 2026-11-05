import assert from 'node:assert/strict'
import test from 'node:test'

import { parseRagAgentSelection } from './agent-selection'

test('JSON and SSE use the same explicit agent or persona intent', () => {
  assert.deepEqual(parseRagAgentSelection({}), {})
  assert.deepEqual(parseRagAgentSelection({ agentId: 42 }), { agent_id: 42 })
  assert.deepEqual(parseRagAgentSelection({ agent_id: '42', agentId: 42 }), { agent_id: 42 })
  assert.deepEqual(parseRagAgentSelection({ teamMemberId: '7' }), { team_member_id: 7 })
  assert.deepEqual(parseRagAgentSelection({ agent_id: 2, org_id: 99, stdb_token: 'forged' }), { agent_id: 2 })
})

test('invalid, conflicting and unsafe selectors fail instead of falling back to another agent', () => {
  for (const value of [null, '', 0, -1, 1.5, '01', '1x', ' 1', Number.MAX_SAFE_INTEGER + 1, '9007199254740992']) {
    assert.throws(() => parseRagAgentSelection({ agent_id: value }))
    assert.throws(() => parseRagAgentSelection({ team_member_id: value }))
  }
  assert.throws(() => parseRagAgentSelection({ agentId: 1, agent_id: 2 }))
  assert.throws(() => parseRagAgentSelection({ agent_id: 1, team_member_id: 2 }))
})
