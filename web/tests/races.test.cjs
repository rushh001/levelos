const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
function load(file, mocks) {
  const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8').replaceAll('import.meta.env', '{}')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  new Function('require', 'exports', code)((id) => {
    if (!(id in mocks)) throw new Error(`Missing mock ${id}`)
    return mocks[id]
  }, exports)
  return exports
}
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b }); return { promise, resolve, reject } }
const tick = () => new Promise(setImmediate)
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true })
globalThis.window = { setTimeout, clearTimeout, setInterval: () => 0, dispatchEvent: () => {}, addEventListener: () => {}, removeEventListener: () => {} }
globalThis.localStorage = { getItem: () => 'session' }
function cacheDb(initial = {}) {
  const rows = new Map(Object.entries(initial).map(([key,value]) => [key, { key, value }]))
  const cache = { get: async k => rows.get(k), put: async row => rows.set(row.key,row), bulkPut: async list => list.forEach(row => rows.set(row.key,row)) }
  return { rows, cache, transaction: async (_mode,_table,fn) => fn() }
}
test('saved reads return during a hung flush; older responses cannot cache or notify', async () => {
  const db = cacheDb({ '/classes': ['saved'] })
  let flush = deferred()
  const calls = [], events = []
  window.dispatchEvent = e => events.push(e)
  globalThis.CustomEvent = class { constructor(type, options) { this.type=type; this.detail=options.detail } }
  globalThis.fetch = () => { const d=deferred(); calls.push(d); return d.promise }
  const { api } = load('api.ts', { './db': { db }, './lib/idmap': { realPath: async p => p, pathAliases: async p => [p] }, './lib/outbox': { flushOutbox: () => flush.promise, outboxCount: async () => 0, changesSent: () => 0 }, './lib/fromPhone': { overlay: async (_p,v) => v } })
  assert.deepEqual(await api('/classes'), ['saved'])
  assert.equal(calls.length, 0)
  flush.resolve(); await tick()
  assert.deepEqual(await api('/classes'), ['saved']); await tick()
  calls[1].resolve(new Response(JSON.stringify(['new']))); await tick(); await tick()
  calls[0].resolve(new Response(JSON.stringify(['old']))); await tick(); await tick()
  assert.deepEqual(db.rows.get('/classes').value, ['new'])
  assert.equal(events.filter(e => e.type === 'levelos:fresh').length, 1)
})
test('pack saves keep newer additions and reject a different session', async () => {
  const db = cacheDb(), requests=[]
  let token='first'
  const { saveClassPagesNow } = load('lib/saveOffline.ts', { react: {}, '../api': { Api: { offlinePack: () => { const d=deferred(); requests.push(d); return d.promise } }, ApiError: class extends Error {}, getToken: () => token }, '../db': { db }, '../i18n': {}, './localActivity': {}, './outbox': { outboxCount: async () => 0, changesSent: () => 0 }, './speech': {} })
  const pack = name => ({ dashboards: { en: { children: [name] } }, students: {}, default_language: 'en' })
  const old=saveClassPagesNow('c'); await tick()
  const fresh=saveClassPagesNow('c'); await tick()
  requests[1].resolve(pack('new-child')); await fresh
  requests[0].resolve(pack('old')); await old
  assert.deepEqual(db.rows.get('/classes/c/dashboard').value.children, ['new-child'])
  const swapped=saveClassPagesNow('c'); await tick(); token='second'; requests[2].resolve(pack('other')); await swapped
  assert.deepEqual(db.rows.get('/classes/c/dashboard').value.children, ['new-child'])
})
test('useAsync ignores both stale success and stale failure', async () => {
  const state=[], refs=[]; let si=0, ri=0
  const react={ useState: value => { const i=si++; state[i] ??= value; return [state[i], v => { state[i]=v }] }, useRef: value => { const i=ri++; return refs[i] ??= { current:value } }, useCallback: fn => fn, useEffect: () => {} }
  const requests=[]
  const { useAsync }=load('lib/useAsync.ts', { react, '../api': {} })
  const { reload }=useAsync(() => { const d=deferred(); requests.push(d); return d.promise })
  const a=reload(), b=reload(); requests[1].resolve('new'); await b; requests[0].resolve('old'); await a
  assert.equal(state[0], 'new'); assert.equal(state[2], false)
  const c=reload(), d=reload(); requests[2].reject(new Error('old failure')); await c
  assert.equal(state[1], null); assert.equal(state[2], true)
  requests[3].resolve('latest'); await d; assert.equal(state[0], 'latest')
})
test('finished phone checks replace in-progress entries; a fresh child page cannot retire a stale dashboard overlay', async () => {
  const phone={ localId:'local', serverId:'check', studentId:'s', classId:'c', language:'en', status:'synced', provisionalLevel:'word', startedAt:2000 }
  const listed=[{ id:'check', language:'en', status:'in_progress', started_at:new Date(2000).toISOString() }]
  const row={ id:'s', language:'en', levels:{}, patterns:[], last_checkin_at:null }
  let merged
  const db=cacheDb({ '/students/s': { ...row, checkins_list:[{ ...listed[0], status:'scored' }] } })
  db.checkins={ where: () => ({ anyOf: () => ({ toArray: async () => [phone] }) }) }
  const { overlay }=load('lib/fromPhone.ts', { '../db':{ db }, './content':{}, './idmap':{ aliases:async id => [id] }, './rescore':{ restate:(x, checks) => { merged=checks; return { ...x, level:'word' } }, place:(d, next) => { d.not_assessed=[next] } } })
  assert.equal((await overlay('/students/s', { ...row, checkins_list:listed })).level, 'word')
  assert.equal(merged.length, 1); assert.equal(merged[0].status, 'scored')
  const board={ class:{id:'c'}, cohorts:[], not_assessed:[row] }
  assert.equal((await overlay('/classes/c/dashboard', board)).not_assessed[0].level, 'word')
  const caughtUp={ ...board, not_assessed:[{ ...row, last_checkin_at:new Date(2000).toISOString() }] }
  assert.deepEqual(await overlay('/classes/c/dashboard', caughtUp), caughtUp)
})
test('background responses preserve pending edits and reject a changed session', async () => {
  const db=cacheDb({ '/classes':['local'] }), calls=[], events=[]
  let pending=0, token='one'
  localStorage.getItem=() => token
  window.dispatchEvent=e => events.push(e)
  globalThis.fetch=() => { const d=deferred(); calls.push(d); return d.promise }
  const { api }=load('api.ts', { './db':{ db }, './lib/idmap':{ realPath:async p => p, pathAliases:async p => [p] }, './lib/outbox':{ flushOutbox:async () => {}, outboxCount:async () => pending, changesSent:() => 0 }, './lib/fromPhone':{ overlay:async (_p,v) => v } })
  await api('/classes'); await tick(); pending=1
  calls[0].resolve(new Response(JSON.stringify(['remote']))); await tick(); await tick()
  assert.deepEqual(db.rows.get('/classes').value,['local'])
  pending=0; await api('/classes'); await tick(); token='two'
  calls[1].resolve(new Response(JSON.stringify(['old-session']))); await tick(); await tick()
  assert.deepEqual(db.rows.get('/classes').value,['local'])
  assert.equal(events.filter(e => e.type === 'levelos:fresh').length,0)
})

test('an older pack that arrives first is saved at once (a slow network may not bring the newer one in time)', async () => {
  const db = cacheDb(), requests = []
  const { saveClassPagesNow } = load('lib/saveOffline.ts', { react: {}, '../api': { Api: { offlinePack: () => { const d = deferred(); requests.push(d); return d.promise } }, ApiError: class extends Error {}, getToken: () => 'session' }, '../db': { db }, '../i18n': {}, './localActivity': {}, './outbox': { outboxCount: async () => 0, changesSent: () => 0 }, './speech': {} })
  const pack = name => ({ dashboards: { en: { children: [name] } }, students: { [name]: { id: name } }, default_language: 'en' })
  const first = saveClassPagesNow('c'); await tick()
  const second = saveClassPagesNow('c'); await tick()
  requests[0].resolve(pack('first')); await first
  assert.deepEqual(db.rows.get('/classes/c/dashboard').value.children, ['first'], 'the first pack is on the phone before the second comes')
  requests[1].resolve(pack('second')); await second
  assert.deepEqual(db.rows.get('/classes/c/dashboard').value.children, ['second'])
})
