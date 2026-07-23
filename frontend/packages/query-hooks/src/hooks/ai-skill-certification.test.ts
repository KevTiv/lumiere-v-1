import assert from "node:assert/strict"
import test from "node:test"

import {
  certificationHasPassingEvidence,
  latestCertificationFor,
  type AiSkillCertificationRequestRow,
  type AiSkillTestRunRow,
} from "./ai-skill-registry"

const evidence: AiSkillTestRunRow[] = [
  {
    id: 20,
    certificationRequestId: 10,
    skillVersionId: 4,
    fixtureId: 3,
    status: "Passed",
  },
]

test("passing evidence must be current and server-authoritative", () => {
  const request: AiSkillCertificationRequestRow = {
    id: 10,
    skillVersionId: 4,
    fixtureId: 3,
    status: "Completed",
  }

  assert.equal(certificationHasPassingEvidence(3, 4, [request], evidence), false)
  assert.equal(
    certificationHasPassingEvidence(
      3,
      4,
      [{ ...request, hasCurrentPassingEvidence: true }],
      evidence,
    ),
    true,
  )
})

test("a later failed request supersedes an older pass", () => {
  const requests: AiSkillCertificationRequestRow[] = [
    {
      id: 10,
      skillVersionId: 4,
      fixtureId: 3,
      status: "Completed",
      hasCurrentPassingEvidence: true,
    },
    {
      id: 11,
      skillVersionId: 4,
      fixtureId: 3,
      status: "Errored",
      hasCurrentPassingEvidence: false,
    },
  ]

  assert.equal(latestCertificationFor(3, 4, requests)?.id, 11)
  assert.equal(certificationHasPassingEvidence(3, 4, requests, evidence), false)
})
