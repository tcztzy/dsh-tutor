import { useEffect, useRef, useState } from 'react'

import { BoardExport } from '../BoardExport.jsx'
import { Classroom } from '../Classroom.jsx'
import { ErrorLine, Modal, Spinner } from '../components.jsx'
import { RichText } from '../markdown.jsx'
import { useApp, useLoad } from '../hooks.js'
import { useVideoExport } from '../useVideoExport.js'

export function LessonScreen({ courseId, lessonId }) {
  const { api, t, navigate } = useApp()
  const detail = useLoad(() => api.call('lesson/get', { courseId, lessonId }), [courseId, lessonId])
  const [source, setSource] = useState(null)
  const [error, setError] = useState(null)
  const [finished, setFinished] = useState(false)
  const [assessing, setAssessing] = useState(false)
  const [exploring, setExploring] = useState(false)
  const [version, setVersion] = useState(0)
  const saveTimer = useRef(null)
  const video = useVideoExport()

  // Use the saved board, or start/attach to its generation.
  useEffect(() => {
    if (!detail.value) return
    if (detail.value.board && version === 0) {
      setSource({ steps: detail.value.board.steps, stream: null })
      return
    }
    let live = true
    api.call('lesson/prepare', { courseId, lessonId, force: version > 0 })
      .then(result => { if (live) setSource(result.board ? { steps: result.board.steps, stream: null } : { steps: [], stream: result.job }) })
      .catch(failure => { if (live) setError(failure) })
    return () => { live = false }
  }, [detail.value, version])

  useEffect(() => () => clearTimeout(saveTimer.current), [])

  if (detail.loading && !detail.value) return <div className="aha-page"><Spinner label={t('loading')} /></div>
  if (!detail.value) return <div className="aha-page"><ErrorLine error={detail.error} /></div>
  const { lesson, unit, lecture, language, state } = detail.value
  const startIndex = state?.status === 'learning' ? Math.max(0, (state.stepIndex ?? 0)) : 0

  const savePosition = index => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      api.call('lesson/position', { courseId, lessonId, stepIndex: index }).catch(() => undefined)
    }, 800)
  }

  return <div className="aha-page" data-wide="true">
    {error ? <ErrorLine error={error} /> : null}
    {source ? <Classroom
      key={`${version}`}
      scope={{ kind: 'lesson', courseId, lessonId }}
      title={lesson.title}
      crumb={`${unit.title} · ${lecture.title}`}
      steps={source.steps}
      stream={source.stream}
      asides={version === 0 ? detail.value.asides ?? [] : []}
      objectives={lesson.objectives ?? []}
      language={language}
      startIndex={source.stream ? 0 : startIndex}
      onPosition={savePosition}
      onEnded={() => setFinished(true)}
      onStreamDone={result => { if (result?.board?.steps?.length) setSource(current => ({ ...current, steps: result.board.steps })) }}
      header={({ steps }) => <>
        <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={() => navigate('course', { courseId })}>← {t('backToCourse')}</button>
        <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={() => navigate('practice', { courseId, lessonId })}>{t('practice')}</button>
        <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" disabled={!lesson.concepts?.length} onClick={() => setAssessing(true)}>{t('assess')}</button>
        <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={() => setExploring(true)}>{t('explore')}</button>
        <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" disabled={!steps.length} title={t('handoutHint')} onClick={() => navigate('handout', { courseId, lessonId })}>{t('handout')}</button>
        <BoardExport steps={steps} title={lesson.title} />
        {video.exporting
          ? <><Spinner label={t('exporting', { percent: video.exporting.percent })} /><button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={video.cancel}>{t('cancel')}</button></>
          : <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" disabled={!source.steps.length} title={video.cloud ? '' : t('exportNeedsCloud')} onClick={() => video.start({ steps: source.steps, title: lesson.title })}>{t('exportVideo')}</button>}
        <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={() => { setSource(null); setFinished(false); setVersion(value => value + 1) }}>{t('regenerateLesson')}</button>
      </>}
    /> : <Spinner label={t('preparingLesson')} />}
    {finished ? <Completion courseId={courseId} lessonId={lessonId} onClose={() => setFinished(false)} /> : null}
    {assessing ? <Assess courseId={courseId} lessonId={lessonId} concepts={lesson.concepts ?? []} onClose={() => setAssessing(false)} /> : null}
    {exploring ? <Explore courseId={courseId} lessonId={lessonId} onClose={() => setExploring(false)} /> : null}
  </div>
}

// The learner explains a concept; the host scores it and the gate records the
// result. The score is evidence, not a verdict: the gate decides the pass.
function Assess({ courseId, lessonId, concepts, onClose }) {
  const { api, t } = useApp()
  const [conceptId, setConceptId] = useState(concepts[0]?.id ?? '')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const concept = concepts.find(item => item.id === conceptId)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      setResult(await api.call('lesson/assess', { courseId, lessonId, conceptId, explanation: text }))
    } catch (failure) {
      setError(failure)
    } finally {
      setBusy(false)
    }
  }

  return <Modal title={t('assess')} onClose={onClose}>
    {concepts.length > 1 ? <div className="aha-row">
      {concepts.map(item => <button key={item.id} type="button" className="aha-chip" data-active={item.id === conceptId} onClick={() => { setConceptId(item.id); setResult(null) }}>{item.name}</button>)}
    </div> : null}
    {!result ? <>
      <p>{t('assessHint')}</p>
      <textarea className="aha-textarea" rows={6} value={text} placeholder={t('assessPlaceholder', { concept: concept?.name ?? '' })} onChange={event => setText(event.currentTarget.value)} />
      <div className="aha-row">
        <button type="button" className="aha-btn" data-kind="primary" disabled={busy || !text.trim()} onClick={submit}>{t('assessSubmit')}</button>
      </div>
      {busy ? <Spinner /> : null}
    </> : <div className="aha-col">
      <div className="aha-feedback" data-ok={result.passed ? 'true' : undefined}>{t('assessScore', { score: Math.round(result.score * 100) })} · {result.passed ? t('assessPassed') : t('assessFailed')}</div>
      {result.feedback ? <p>{result.feedback}</p> : null}
      {result.missing?.length ? <ul>{result.missing.map(item => <li key={item}>{item}</li>)}</ul> : null}
      <div className="aha-row">
        <button type="button" className="aha-btn" onClick={() => { setResult(null); setText('') }}>{t('assessAgain')}</button>
        <button type="button" className="aha-btn" data-kind="primary" onClick={onClose}>{t('close')}</button>
      </div>
    </div>}
    <ErrorLine error={error} />
  </Modal>
}

function Completion({ courseId, lessonId, onClose }) {
  const { api, t, navigate } = useApp()
  const [rating, setRating] = useState(null)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function finish(value) {
    setRating(value)
    setBusy(true)
    try {
      setResult(await api.call('lesson/complete', { courseId, lessonId, selfRating: value }))
    } catch (failure) {
      setError(failure)
    } finally {
      setBusy(false)
    }
  }

  return <Modal title={t('lessonDone')} onClose={onClose}>
    {!result ? <>
      <p>{t('selfRate')}</p>
      <div className="aha-row">
        {[[1, 'rate1'], [2, ''], [3, 'rate3'], [4, ''], [5, 'rate5']].map(([value, label]) => <button key={value} type="button" className="aha-chip" data-active={rating === value} disabled={busy} onClick={() => finish(value)}>{value}{label ? ` · ${t(label)}` : ''}</button>)}
      </div>
      {busy ? <Spinner /> : null}
    </> : <div className="aha-col">
      {result.blocked ? <div className="aha-feedback">{t('gateBlocked', { names: (result.gate?.blocking ?? []).map(item => item.name).join(', ') })}</div> : null}
      {result.inserted ? <div className="aha-feedback">{t('remedialAdded', { title: result.inserted.title })}</div> : null}
      {result.recommendation?.action === 'challenge' ? <div className="aha-feedback" data-ok="true">{t('challengeNote')}</div> : null}
      <div className="aha-row">
        {result.next ? <button type="button" className="aha-btn" data-kind="primary" onClick={() => navigate('lesson', { courseId, lessonId: result.next.id }, { replace: true })}>{t('nextLesson')}: {result.next.title}</button> : null}
        <button type="button" className="aha-btn" onClick={() => navigate('practice', { courseId, lessonId })}>{t('doPractice')}</button>
        <button type="button" className="aha-btn" onClick={() => navigate('handout', { courseId, lessonId })}>{t('handoutOfLesson')}</button>
        <button type="button" className="aha-btn" data-kind="ghost" onClick={() => navigate('course', { courseId }, { replace: true })}>{t('backToCourse')}</button>
      </div>
    </div>}
    <ErrorLine error={error} />
  </Modal>
}

// A question beyond the lesson: web research or a worked solution, answered as
// text. It never adds evidence, so it cannot move the mastery gate.
function Explore({ courseId, lessonId, onClose }) {
  const { api, t } = useApp()
  const [mode, setMode] = useState('research')
  const [request, setRequest] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      setResult(await api.call('lesson/explore', { courseId, lessonId, mode, request }))
    } catch (failure) {
      setError(failure)
    } finally {
      setBusy(false)
    }
  }

  return <Modal title={t('explore')} onClose={onClose}>
    {!result ? <>
      <div className="aha-row">
        {['research', 'solve'].map(value => <button key={value} type="button" className="aha-chip" data-active={mode === value} onClick={() => setMode(value)}>{t(value === 'research' ? 'exploreResearch' : 'exploreSolve')}</button>)}
      </div>
      <p>{t('exploreHint')}</p>
      <textarea className="aha-textarea" rows={4} value={request} placeholder={t('explorePlaceholder')} onChange={event => setRequest(event.currentTarget.value)} />
      <div className="aha-row">
        <button type="button" className="aha-btn" data-kind="primary" disabled={busy || !request.trim()} onClick={submit}>{t('exploreSubmit')}</button>
      </div>
      {busy ? <Spinner /> : null}
    </> : <div className="aha-col">
      <RichText text={result.answer} />
      {result.mode === 'research' && result.skipped ? <p className="aha-feedback">{t('exploreNoSearch')}</p> : null}
      {result.sources?.length ? <div>
        <strong>{t('exploreSources')}</strong>
        <ol>{result.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ol>
      </div> : null}
      <div className="aha-row">
        <button type="button" className="aha-btn" onClick={() => { setResult(null); setRequest('') }}>{t('exploreAgain')}</button>
        <button type="button" className="aha-btn" data-kind="primary" onClick={onClose}>{t('close')}</button>
      </div>
    </div>}
    <ErrorLine error={error} />
  </Modal>
}
