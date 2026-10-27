import test from 'node:test'
import assert from 'node:assert/strict'

import { materialIndex, sanitizeSheetCites, sourcesBlock, verifyCitation } from '../src/core/citation.js'

const MATERIALS = [
  { id: 'mat_aaaaaaaa', title: '讲义', pages: 12 },
  { id: 'mat_bbbbbbbb', title: 'Slides', slides: 4 },
  { id: 'not-a-material', title: 'Junk', pages: 3 },
]

test('the index keeps real materials and reads pages or slides', () => {
  assert.deepEqual(materialIndex(MATERIALS), [
    { id: 'mat_aaaaaaaa', title: '讲义', pages: 12 },
    { id: 'mat_bbbbbbbb', title: 'Slides', pages: 4 },
  ])
  assert.deepEqual(materialIndex(null), [])
})

test('a citation is only good when it names a known material and a page inside it', () => {
  const index = materialIndex(MATERIALS)
  assert.equal(verifyCitation(null, index).reason, 'missing')
  assert.equal(verifyCitation({ page: 2 }, index).reason, 'no-material')
  assert.equal(verifyCitation({ materialId: 'mat_cccccccc', page: 2 }, index).reason, 'unknown-material')
  assert.equal(verifyCitation({ materialId: 'mat_aaaaaaaa', page: 0 }, index).reason, 'no-page')
  assert.equal(verifyCitation({ materialId: 'mat_aaaaaaaa', page: 13 }, index).reason, 'page-out-of-range')

  const ok = verifyCitation({ materialId: 'mat_aaaaaaaa', page: 3, source: '原文' }, index)
  assert.equal(ok.ok, true)
  assert.equal(ok.page, 3)
  assert.equal(ok.material.title, '讲义')
})

test('a sheet keeps cited content and drops citations it cannot check', () => {
  const sheet = {
    title: '速查',
    sections: [{
      title: '公式',
      items: [
        { kind: 'formula', tex: 'T=2\\pi\\sqrt{L/g}', cite: { materialId: 'mat_aaaaaaaa', page: 2, source: '振动' } },
        { kind: 'fact', text: '伪造来源', cite: { materialId: 'mat_cccccccc', page: 1 } },
        { kind: 'fact', text: '页码越界', cite: { materialId: 'mat_aaaaaaaa', page: 99 } },
        { kind: 'tip', text: '没有引用' },
      ],
    }],
  }
  const { sheet: checked, kept, dropped } = sanitizeSheetCites(sheet, MATERIALS)
  assert.equal(kept, 1)
  assert.deepEqual(dropped.map(entry => entry.reason), ['unknown-material', 'page-out-of-range'])
  const [good, forged, outOfRange, plain] = checked.sections[0].items
  assert.deepEqual(good.cite, { materialId: 'mat_aaaaaaaa', materialTitle: '讲义', page: 2, source: '振动' })
  assert.equal(forged.cite, null)
  assert.equal(outOfRange.cite, null)
  assert.equal(plain.cite, undefined)
  assert.equal(forged.text, '伪造来源', 'the content stays even when the claim goes')
})

test('the prompt sees one bracketed line per material', () => {
  assert.equal(sourcesBlock(MATERIALS), '[mat_aaaaaaaa] 讲义 (12 pages)\n[mat_bbbbbbbb] Slides (4 pages)')
})
