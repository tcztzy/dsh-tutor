// Deterministic mastery gate: the engine, not the tutor, decides when a
// concept counts as mastered. `mastery.js` keeps the Bayesian estimate used
// for display and pacing; this module answers one question — is the evidence
// strong enough to advance past this concept?
//
// The rule differs by knowledge type:
//   memory / procedure  recent weighted accuracy >= 0.9, with a confidence
//                       cap so one or two lucky answers cannot pass
//   concept / design    a recorded explanation assessment; a Feynman-style
//                       answer has no canonical string to match against

export const CONCEPT_TYPES = Object.freeze(['memory', 'concept', 'procedure', 'design'])

export const QUANTITATIVE_GATE = Object.freeze({ memory: 0.9, procedure: 0.9 })

export const QUALITATIVE_TYPES = Object.freeze(['concept', 'design'])

// The score a recorded explanation must reach to count as a qualitative pass.
export const QUALITATIVE_PASS = 0.8

// Newer attempts count more, so recovering after an early mistake is
// rewarded without letting a single answer erase a long record.
export const RECENCY_WEIGHTS = Object.freeze([0.5, 0.7, 0.85, 0.95, 1])

// Mastery cannot exceed these until enough attempts accumulate.
export const CONFIDENCE_CAP = Object.freeze({ 1: 0.5, 2: 0.8 })

// Fewer scored attempts than this never passes, even at the cap.
export const MIN_SCORED_ATTEMPTS = 3

export const GATE_REASONS = Object.freeze([
  'passed',
  'no-evidence',
  'below-evidence',
  'below-threshold',
  'qualitative-missing',
  'qualitative-failed',
])

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value))
const round4 = value => Math.round(value * 10000) / 10000

const scored = entry => Boolean(entry) && entry.kind !== 'reexplain' && entry.kind !== 'self' && Number.isFinite(Number(entry.score))

export function gateThreshold(type) {
  return QUALITATIVE_TYPES.includes(type) ? QUALITATIVE_PASS : QUANTITATIVE_GATE[type] ?? 0.9
}

export function normalizeType(value) {
  return CONCEPT_TYPES.includes(value) ? value : 'memory'
}

// The scored evidence behind a concept, oldest first.
export function scoredHistory(state) {
  return (Array.isArray(state?.history) ? state.history : []).filter(scored)
}

// Recency-weighted accuracy over the last attempts, capped until enough
// evidence exists. Returns the cap as well so callers can explain a failure
// that looks high enough on its own.
export function recentAccuracy(entries) {
  const list = (Array.isArray(entries) ? entries : []).filter(scored)
  const recent = list.slice(-RECENCY_WEIGHTS.length)
  if (!recent.length) return { score: 0, raw: 0, attempts: 0, cap: 0 }
  const weights = RECENCY_WEIGHTS.slice(-recent.length)
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const weighted = recent.reduce((sum, entry, index) => sum + weights[index] * clamp(Number(entry.score)), 0)
  const raw = total ? weighted / total : 0
  const cap = CONFIDENCE_CAP[recent.length] ?? 1
  return { score: round4(Math.min(raw, cap)), raw: round4(raw), attempts: recent.length, cap }
}

// Evaluate one concept. `qualitative` is the recorded explanation result
// ({ passed, score, at }) for concept / design types.
export function evaluateGate(state, { type = 'memory', qualitative = state?.qualitative ?? null, minAttempts = MIN_SCORED_ATTEMPTS } = {}) {
  const kind = normalizeType(type)
  const threshold = gateThreshold(kind)

  if (QUALITATIVE_TYPES.includes(kind)) {
    const passed = qualitative?.passed === true
    const score = Number.isFinite(Number(qualitative?.score)) ? round4(clamp(Number(qualitative.score))) : null
    return {
      passed,
      type: kind,
      reason: passed ? 'passed' : qualitative ? 'qualitative-failed' : 'qualitative-missing',
      score,
      threshold,
      attempts: Number(state?.attempts) || 0,
    }
  }

  const evidence = recentAccuracy(scoredHistory(state))
  if (!evidence.attempts) {
    return { passed: false, type: kind, reason: 'no-evidence', score: 0, threshold, attempts: 0, cap: 0 }
  }
  if (evidence.attempts < minAttempts) {
    return { passed: false, type: kind, reason: 'below-evidence', ...evidence, threshold }
  }
  if (evidence.score < threshold) {
    return { passed: false, type: kind, reason: 'below-threshold', ...evidence, threshold }
  }
  return { passed: true, type: kind, reason: 'passed', ...evidence, threshold }
}

// Record an explanation assessment without touching the BKT estimate: the
// gate for a qualitative concept reads only this record.
export function recordQualitative(state, { score, passed, at = new Date().toISOString(), threshold = QUALITATIVE_PASS } = {}) {
  const value = clamp(Number(score))
  if (!Number.isFinite(value)) throw new TypeError('qualitative score must be a number between 0 and 1')
  return { ...state, qualitative: { passed: passed === undefined ? value >= threshold : Boolean(passed), score: round4(value), at } }
}

// Aggregate a lesson's concepts. `types` maps concept id -> type; concepts
// without one are gated as memory. Returns the blocking concepts so a caller
// can name them instead of only refusing to advance.
export function lessonGate(states, types = {}) {
  const results = (states || []).filter(Boolean).map(state => ({
    conceptId: state.id,
    name: state.name,
    ...evaluateGate(state, { type: types[state.id], qualitative: state.qualitative }),
  }))
  const blocking = results.filter(result => !result.passed)
  return { passed: results.length > 0 && blocking.length === 0, results, blocking }
}
