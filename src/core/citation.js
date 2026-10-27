// Citations are claims about where an item came from. A claim that names a
// material the course does not have, or a page beyond that material, is a
// fabrication: the content may stand, the provenance must go.
//
// Pure functions: the host builds the index from stored material metadata and
// decides what to do with the result.

const MATERIAL_ID = /^mat_[a-z0-9]{6,40}$/u

// The materials a citation may point at, with the page count that bounds it.
export function materialIndex(materials) {
  return (Array.isArray(materials) ? materials : [])
    .filter(Boolean)
    .map(material => ({
      id: String(material.id ?? ''),
      title: String(material.title ?? '').slice(0, 200),
      pages: Number(material.pages ?? material.slides) || 0,
    }))
    .filter(material => MATERIAL_ID.test(material.id))
}

export function verifyCitation(citation, index) {
  if (!citation) return { ok: false, reason: 'missing' }
  const materialId = String(citation.materialId ?? '')
  if (!MATERIAL_ID.test(materialId)) return { ok: false, reason: 'no-material' }
  const material = (index ?? []).find(entry => entry.id === materialId)
  if (!material) return { ok: false, reason: 'unknown-material' }
  const page = Math.round(Number(citation.page))
  if (!Number.isFinite(page) || page < 1) return { ok: false, reason: 'no-page' }
  if (material.pages > 0 && page > material.pages) return { ok: false, reason: 'page-out-of-range' }
  return { ok: true, material, page }
}

// Keep cited content, drop the claim that cannot be checked. Returns the same
// sheet with verified citations enriched and bad ones removed, plus a report.
export function sanitizeSheetCites(sheet, materials) {
  const index = materialIndex(materials)
  const dropped = []
  let kept = 0
  for (const section of sheet?.sections ?? []) {
    for (const item of section.items ?? []) {
      if (!item?.cite) continue
      const check = verifyCitation(item.cite, index)
      if (check.ok) {
        item.cite = {
          materialId: check.material.id,
          materialTitle: check.material.title,
          page: check.page,
          source: String(item.cite.source ?? '').slice(0, 200),
        }
        kept += 1
      } else {
        dropped.push({ reason: check.reason, page: item.cite.page ?? null, title: item.title ?? '' })
        item.cite = null
      }
    }
  }
  return { sheet, kept, dropped }
}

// One line per material for the prompt, so the model cites ids that exist.
export function sourcesBlock(materials) {
  return materialIndex(materials)
    .map(material => `[${material.id}] ${material.title}${material.pages ? ` (${material.pages} pages)` : ''}`)
    .join('\n')
}
