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
// Check one holder's citation in place: keep and enrich it, or drop it and
// report why. The content around it is never touched.
function applyCite(holder, index, dropped) {
  if (!holder?.cite) return false
  const check = verifyCitation(holder.cite, index)
  if (check.ok) {
    holder.cite = {
      materialId: check.material.id,
      materialTitle: check.material.title,
      page: check.page,
      source: String(holder.cite.source ?? '').slice(0, 200),
    }
    return true
  }
  dropped.push({ reason: check.reason, page: holder.cite.page ?? null, title: holder.title ?? holder.name ?? '' })
  holder.cite = null
  return false
}

export function sanitizeSheetCites(sheet, materials) {
  const index = materialIndex(materials)
  const dropped = []
  let kept = 0
  for (const section of sheet?.sections ?? []) {
    for (const item of section.items ?? []) if (applyCite(item, index, dropped)) kept += 1
  }
  return { sheet, kept, dropped }
}

// A handout cites from its key points; the example and glossary stay prose.
export function sanitizeHandoutCites(handout, materials) {
  const index = materialIndex(materials)
  const dropped = []
  let kept = 0
  for (const point of handout?.points ?? []) if (applyCite(point, index, dropped)) kept += 1
  return { handout, kept, dropped }
}

// One line per material for the prompt, so the model cites ids that exist.
export function sourcesBlock(materials) {
  return materialIndex(materials)
    .map(material => `[${material.id}] ${material.title}${material.pages ? ` (${material.pages} pages)` : ''}`)
    .join('\n')
}
