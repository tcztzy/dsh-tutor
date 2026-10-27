import test from 'node:test'
import assert from 'node:assert/strict'

import { conceptTypeMap, normalizeBlueprint } from '../src/core/course-model.js'

function course(concepts) {
  return normalizeBlueprint({
    title: 'Course',
    units: [{ title: 'Unit', lectures: [{ title: 'Lecture', lessons: [{ title: 'Lesson', concepts }] }] }],
  })
}

const lessonOf = result => result.units[0].lectures[0].lessons[0]
const byName = (result, name) => lessonOf(result).concepts.find(concept => concept.name === name)

test('legacy string concepts stay valid and gate as memory', () => {
  const result = course(['Limits', 'Derivatives'])
  const [limits, derivatives] = lessonOf(result).concepts
  assert.equal(limits.name, 'Limits')
  assert.equal(limits.type, 'memory')
  assert.equal(derivatives.type, 'memory')
  assert.equal(limits.prerequisites, undefined)
})

test('a concept carries its gate type, and unknown types fall back to memory', () => {
  const result = course([
    { name: 'What a limit means', type: 'concept' },
    { name: 'L Hopital', type: 'procedure' },
    { name: 'Design a proof', type: 'design' },
    { name: 'Mystery', type: 'vibes' },
  ])
  assert.equal(byName(result, 'What a limit means').type, 'concept')
  assert.equal(byName(result, 'L Hopital').type, 'procedure')
  assert.equal(byName(result, 'Design a proof').type, 'design')
  assert.equal(byName(result, 'Mystery').type, 'memory')
})

test('prerequisites resolve by name and by id, and drop unknown or self references', () => {
  const result = course([
    { id: 'cpt_a', name: 'A', type: 'memory' },
    { id: 'cpt_b', name: 'B', type: 'memory', prerequisites: ['A', 'cpt_a', 'Missing', 'B'] },
  ])
  const b = byName(result, 'B')
  assert.deepEqual(b.prerequisites, ['cpt_a'])
})

test('prerequisite edges that would close a cycle are dropped', () => {
  const result = course([
    { id: 'cpt_a', name: 'A', type: 'memory', prerequisites: ['cpt_b'] },
    { id: 'cpt_b', name: 'B', type: 'memory', prerequisites: ['cpt_a'] },
  ])
  const a = byName(result, 'A')
  const b = byName(result, 'B')
  assert.deepEqual(a.prerequisites, ['cpt_b'])
  assert.equal(b.prerequisites, undefined)
})

test('one concept keeps at most four prerequisites', () => {
  const base = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id: `cpt_${id}`, name: id.toUpperCase(), type: 'memory' }))
  const result = course([...base, { id: 'cpt_z', name: 'Z', type: 'memory', prerequisites: ['A', 'B', 'C', 'D', 'E'] }])
  assert.equal(byName(result, 'Z').prerequisites.length, 4)
})

test('conceptTypeMap reports every concept of the course', () => {
  const result = course([
    { id: 'cpt_a', name: 'A', type: 'concept' },
    { id: 'cpt_b', name: 'B', type: 'procedure' },
  ])
  assert.deepEqual(conceptTypeMap(result), { cpt_a: 'concept', cpt_b: 'procedure' })
})

test('a lesson without usable concepts falls back to the lesson title', () => {
  const result = course([{ name: '' }])
  const [concept] = lessonOf(result).concepts
  assert.equal(concept.name, 'Lesson')
  assert.equal(concept.type, 'memory')
})
