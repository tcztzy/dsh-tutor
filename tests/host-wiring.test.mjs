import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { getRuntime } from '../src/host/runtime.js'

const BLUEPRINT = JSON.stringify({ title: '线性代数', emoji: '🧮', units: [{ title: '向量', lectures: [{ title: '基础', lessons: [{ title: '什么是向量', concepts: [{ name: '向量', type: 'concept' }] }] }] }], projects: [] })
const EXPLANATION_GRADE = '{"score":0.9,"missing":[],"feedback":"抓住了方向与大小。"}'

function fakeLlm(calls) {
  return {
    async prepareCall(config, signal, configure) {
      // A reasoning model, so the port's controls (effort, room) show up.
      const model = { reasoning: { efforts: [{ id: 'off' }, { id: 'high' }], defaultEffort: 'high' }, defaultMaxTokens: 64_000 }
      calls.push({ config, controls: configure ? configure({ maxTokens: config.maxTokens }, model) : null })
      return {
        config: { ...config },
        inputModalities: ['text'],
        async *stream(request) {
          calls.push({ request })
          const prompt = request.messages[0].content[0].text
          const text = prompt.includes('Design the course blueprint') ? BLUEPRINT
            : prompt.includes('Score how well the explanation') ? EXPLANATION_GRADE
              : prompt.includes('Answer in Markdown') ? '位移向右时回复力向左，所以写成负号。'
                : '{"questions":[]}'
          yield { type: 'block-start', index: 0, blockType: 'text' }
          for (const piece of text.match(/[\s\S]{1,20}/gu)) yield { type: 'text-delta', index: 0, text: piece }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      }
    },
    async resolveModelInfo() {
      return { inputModalities: ['text'] }
    },
    listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
    listModels: async () => [{ id: 'deepseek-flash', name: 'Flash', inputModalities: ['text', 'image'] }],
  }
}

function fakeCtx({ llm }) {
  const disposers = []
  const handlers = {}
  const fetchRoutes = {}
  const records = new Map()
  const credentials = {
    readRecord: async key => records.get(JSON.stringify(key)),
    describeRecord: async key => ({ configured: records.has(JSON.stringify(key)), writable: true }),
    modifyRecord: async (key, update) => { records.set(JSON.stringify(key), await update(records.get(JSON.stringify(key)))) },
    deleteRecord: async key => { records.delete(JSON.stringify(key)) },
  }
  const connection = {
    rpc: { handle: (channel, handler) => { handlers[channel] = handler; return () => delete handlers[channel] } },
    fetch: { register: route => { fetchRoutes[route.path] = route; return async () => undefined } },
  }
  const child = { connection, webServer: {}, effect: (fn) => disposers.push(fn()) }
  const ctx = {
    llm,
    logger: { warn() {}, debug() {} },
    get: name => ({ credentials, agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash' }) } })[name],
    on: () => undefined,
    inject: (names, callback) => callback(child),
    effect: fn => disposers.push(fn()),
  }
  return { ctx, handlers, fetchRoutes, records, dispose: () => { for (const fn of disposers.reverse()) if (typeof fn === 'function') fn() } }
}

test('the host row serves the browser channel, HTTP routes and the preset runtime', async () => {
  const home = await mkdtemp(join(tmpdir(), 'aha-home-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const calls = []
  const harness = fakeCtx({ llm: fakeLlm(calls) })
  try {
    const { apply, CHANNEL, inject } = await import('../src/index.js')
    assert.deepEqual(inject, ['llm'])
    apply(harness.ctx)
    const handler = harness.handlers[CHANNEL]
    assert.equal(typeof handler, 'function')
    const owner = { principal: { kind: 'owner' } }
    const call = async (endpoint, payload = {}) => {
      const response = await handler(endpoint, payload, new AbortController().signal, owner)
      if (!response.ok) throw Object.assign(new Error(response.error.message), { code: response.error.code })
      return response.value
    }
    const follow = async value => {
      let job = value.job
      for (let attempt = 0; attempt < 500 && job.status === 'running'; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 2))
        job = await call('job/get', { id: job.id })
      }
      assert.equal(job.status, 'done', job.error?.message)
      return job.result
    }

    assert.equal((await handler('course/list', {}, new AbortController().signal, { principal: { kind: 'guest' } })).ok, false)
    assert.deepEqual(await call('course/list'), [])
    assert.equal((await call('app/info', { language: 'en-US' })).language, 'en')
    const settings = await call('settings/get')
    assert.equal(settings.voiceEngine, 'browser')
    assert.equal(settings.keys.openai, false)
    await call('settings/set-key', { provider: 'azure', key: 'abcdefgh12345678' })
    assert.equal((await call('settings/get')).keys.azure, true)
    assert.ok(![...harness.records.values()].some(record => JSON.stringify(record).length && false))
    assert.equal(JSON.stringify(await call('settings/get')).includes('abcdefgh12345678'), false, 'keys never return to the browser')
    await assert.rejects(call('settings/set-key', { provider: 'azure', key: 'short' }), error => error.code === 'aha-tutor/bad-key' && /looks wrong/u.test(error.message))
    const saved = await call('settings/save', { settings: { teachProvider: 'deepseek-official', teachModel: 'deepseek-pro', voiceEngine: 'cloud', voiceRate: 7, tts: { azure: { region: 'westus', apiKey: 'leak' } } } })
    assert.equal(saved.voiceRate, 2)
    assert.equal(saved.tts.azure.region, 'westus')
    assert.equal(saved.tts.azure.apiKey, undefined)
    assert.deepEqual((await call('models/list')).map(row => row.model), ['deepseek-flash'])

    const quick = await follow(await call('course/start', { goal: 'learn linear algebra', quick: true }))
    const blueprint = await follow(await call('course/intake', { courseId: quick.courseId, timeline: 'intensive' }))
    assert.equal(blueprint.course.title, '线性代数')
    const teachCall = calls.find(entry => entry.config?.model === 'deepseek-pro')
    assert.ok(teachCall, 'the teaching route follows the saved preference')
    assert.equal(teachCall.controls.reasoningEffort, undefined, 'course design keeps the model\'s own effort')
    assert.ok(teachCall.controls.maxTokens > teachCall.config.maxTokens, '…with room for its reasoning')
    assert.match(calls.find(entry => entry.request)?.request.system ?? '', /Aha/u)

    const upload = harness.fetchRoutes['/api/aha-tutor/upload']
    const response = await upload.fetch(new Request('http://127.0.0.1/api/aha-tutor/upload?name=notes.md', { method: 'POST', body: '# 标题\n\n内容段落。', duplex: 'half' }))
    const body = await response.json()
    assert.equal(body.ok, true)
    const material = await follow(body.value)
    assert.equal(material.material.kind, 'markdown')
    assert.ok(harness.fetchRoutes['/api/aha-tutor/tts'])
    const tts = await harness.fetchRoutes['/api/aha-tutor/tts'].fetch(new Request('http://127.0.0.1/api/aha-tutor/tts', { method: 'POST', body: JSON.stringify({ text: 'hi' }) }))
    assert.equal(tts.status, 401, 'no key for the chosen provider yet')
    assert.equal((await tts.json()).error.code, 'aha-tutor/tts-no-key')

    assert.ok(getRuntime().studio, 'the preset tools can reach the services')
    const samples = await call('samples/list')
    assert.deepEqual(samples.map(sample => sample.id), ['bayes-thinking', 'harmonic-motion'])
    const sample = await call('samples/import', { id: 'harmonic-motion' })
    assert.equal(sample.status, 'ready')
    const detail = await call('course/get', { courseId: sample.id })
    const firstLesson = detail.course.units[0].lectures[0].lessons[0]
    const lesson = await call('lesson/get', { courseId: sample.id, lessonId: firstLesson.id })
    assert.equal(lesson.board.steps.length, 9, 'the sample lesson is ready to teach without a model')
    assert.ok(lesson.board.steps.some(step => step.check?.conceptIds?.length))
    assert.equal(lesson.practice.items.length, 5)
    await assert.rejects(call('samples/import', { id: '../secret' }), /Unknown sample/u)
    // A question may name the job writing its board; the id is checked like any other.
    await assert.rejects(call('lesson/reexplain', { scope: { kind: 'lesson', courseId: sample.id, lessonId: firstLesson.id, jobId: 'job_../../x' } }), error => error.code === 'aha-tutor/invalid')

    // A lesson does not count as finished until its concepts clear the gate.
    const gated = await follow(await call('course/start', { goal: 'learn vectors', quick: true }))
    await follow(await call('course/intake', { courseId: gated.courseId, timeline: 'intensive' }))
    const gatedDetail = await call('course/get', { courseId: gated.courseId })
    const gatedLesson = gatedDetail.course.units[0].lectures[0].lessons[0]
    const conceptId = gatedLesson.concepts[0].id
    assert.equal(gatedLesson.concepts[0].type, 'concept', 'the blueprint can mark a concept type')
    const blocked = await call('lesson/complete', { courseId: gated.courseId, lessonId: gatedLesson.id })
    assert.equal(blocked.blocked, true)
    assert.equal(blocked.completed, false)
    assert.equal(blocked.gate.passed, false)
    assert.equal(blocked.gate.blocking[0].reason, 'qualitative-missing')

    // Looking something up or solving it adds no evidence and moves no gate.
    const explored = await call('lesson/explore', { courseId: gated.courseId, lessonId: gatedLesson.id, mode: 'research', request: '为什么负号表示方向相反？' })
    assert.equal(explored.mode, 'research')
    assert.equal(explored.skipped, 'unavailable', 'this harness has no web service, and the answer says so')
    assert.deepEqual(explored.sources, [])
    assert.match(explored.answer, /负号/u)
    const solved = await call('lesson/explore', { courseId: gated.courseId, lessonId: gatedLesson.id, mode: 'solve', request: '解 $x^2=4$' })
    assert.equal(solved.mode, 'solve')
    assert.equal((await call('lesson/complete', { courseId: gated.courseId, lessonId: gatedLesson.id })).blocked, true, 'exploring never completes a lesson')

    // Quiz evidence never clears a qualitative concept; an explanation does.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await call('lesson/record', { courseId: gated.courseId, lessonId: gatedLesson.id, evidence: { kind: 'practice', score: 1, confidence: 'sure' } })
    }
    assert.equal((await call('lesson/complete', { courseId: gated.courseId, lessonId: gatedLesson.id })).blocked, true)
    const assessed = await call('lesson/assess', { courseId: gated.courseId, lessonId: gatedLesson.id, conceptId, explanation: '向量是既有方向又有大小的量。' })
    assert.equal(assessed.score, 0.9)
    assert.equal(assessed.passed, true)
    const cleared = await call('lesson/complete', { courseId: gated.courseId, lessonId: gatedLesson.id })
    assert.equal(cleared.completed, true)
    assert.equal(cleared.gate.passed, true)
  } finally {
    harness.dispose()
    assert.throws(() => getRuntime(), /still starting/u)
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
})
