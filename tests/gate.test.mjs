import test from 'node:test'
import assert from 'node:assert/strict'

import { applyEvidence, createConceptState } from '../src/core/mastery.js'
import {
  CONFIDENCE_CAP,
  QUALITATIVE_PASS,
  evaluateGate,
  gateThreshold,
  lessonGate,
  normalizeType,
  recentAccuracy,
  recordQualitative,
  scoredHistory,
} from '../src/core/gate.js'

const AT = Date.parse('2026-01-01T00:00:00.000Z')

function concept(id, scores, { confidence = 'sure' } = {}) {
  return scores.reduce(
    (state, score, index) => applyEvidence(state, { kind: 'practice', score, confidence }, AT + index * 1000),
    createConceptState(id, id),
  )
}

test('a fresh concept has no evidence and cannot pass', () => {
  const gate = evaluateGate(createConceptState('c1', 'Concept'), { type: 'memory' })
  assert.equal(gate.passed, false)
  assert.equal(gate.reason, 'no-evidence')
  assert.equal(gate.score, 0)
})

test('one correct answer is capped and cannot master a concept', () => {
  const gate = evaluateGate(concept('c1', [1]), { type: 'memory' })
  assert.equal(gate.passed, false)
  assert.equal(gate.score, CONFIDENCE_CAP[1])
  assert.equal(gate.raw, 1)
})

test('two correct answers stay under the cap', () => {
  const gate = evaluateGate(concept('c1', [1, 1]), { type: 'memory', minAttempts: 1 })
  assert.equal(gate.score, CONFIDENCE_CAP[2])
  assert.equal(gate.passed, false)
})

test('three correct answers clear the gate', () => {
  const gate = evaluateGate(concept('c1', [1, 1, 1]), { type: 'memory' })
  assert.equal(gate.passed, true)
  assert.equal(gate.reason, 'passed')
  assert.ok(gate.score >= gate.threshold)
})

test('a recent mistake drops the concept back under the gate', () => {
  const gate = evaluateGate(concept('c1', [1, 1, 1, 1, 0]), { type: 'procedure' })
  assert.equal(gate.passed, false)
  assert.equal(gate.reason, 'below-threshold')
  assert.ok(gate.score < gate.threshold)
})

test('partial credit counts, but only what the weights allow', () => {
  const gate = evaluateGate(concept('c1', [0.5, 1, 1, 1, 1]), { type: 'memory' })
  assert.equal(gate.passed, true)
  assert.ok(gate.score > 0.9 && gate.score < 1)
})

test('self ratings and re-explanations are not scored evidence', () => {
  const state = concept('c1', [1, 1])
  const withUnscored = [
    { kind: 'self', rating: 5, at: new Date(AT).toISOString() },
    { kind: 'reexplain', at: new Date(AT + 5000).toISOString() },
    ...state.history,
  ]
  assert.equal(scoredHistory({ history: withUnscored }).length, 2)
  const gate = evaluateGate({ ...state, history: withUnscored }, { type: 'memory' })
  assert.equal(gate.attempts, 2)
})

test('recentAccuracy ignores unknown scores and empty histories', () => {
  assert.deepEqual(recentAccuracy([]), { score: 0, raw: 0, attempts: 0, cap: 0 })
  const state = { history: [{ kind: 'practice', score: 'nope' }, { kind: 'practice' }] }
  assert.equal(recentAccuracy(state.history).attempts, 0)
})

test('concept and design types need a recorded explanation, not accuracy', () => {
  const state = concept('c1', [1, 1, 1, 1, 1])
  const missing = evaluateGate(state, { type: 'concept' })
  assert.equal(missing.passed, false)
  assert.equal(missing.reason, 'qualitative-missing')

  const failed = evaluateGate({ ...state, qualitative: { passed: false, score: 0.4 } }, { type: 'design' })
  assert.equal(failed.passed, false)
  assert.equal(failed.reason, 'qualitative-failed')

  const passed = evaluateGate(recordQualitative(state, { score: QUALITATIVE_PASS + 0.1 }), { type: 'concept' })
  assert.equal(passed.passed, true)
  assert.equal(passed.reason, 'passed')
})

test('recordQualitative refuses a non-numeric score and keeps the BKT estimate', () => {
  const state = concept('c1', [1, 1, 1])
  assert.throws(() => recordQualitative(state, { score: 'good' }), TypeError)
  const next = recordQualitative(state, { score: 0.9, at: new Date(AT).toISOString() })
  assert.equal(next.qualitative.passed, true)
  assert.equal(next.pKnown, state.pKnown)
  assert.equal(next.attempts, state.attempts)
})

test('unknown types fall back to the strict memory gate', () => {
  assert.equal(normalizeType('vibes'), 'memory')
  assert.equal(gateThreshold('vibes'), gateThreshold('memory'))
  assert.equal(gateThreshold('concept'), QUALITATIVE_PASS)
})

test('lessonGate reports the concepts that block advancement', () => {
  const ready = concept('c1', [1, 1, 1])
  const stuck = concept('c2', [1])
  const result = lessonGate([ready, stuck], { c1: 'memory', c2: 'procedure' })
  assert.equal(result.passed, false)
  assert.equal(result.blocking.length, 1)
  assert.equal(result.blocking[0].conceptId, 'c2')

  const all = lessonGate([ready, concept('c3', [1, 1, 1])], { c1: 'memory' })
  assert.equal(all.passed, true)
  assert.equal(all.blocking.length, 0)
})

test('an empty lesson never counts as passed', () => {
  assert.equal(lessonGate([], {}).passed, false)
})
