// 「知道不等于说」：判断表与默认关闭的行为。
import assert from 'node:assert/strict'
import test from 'node:test'
import { decideManners, renderMannersHint, MODES, PLACES, SENSITIVITIES, SOURCES } from '../packages/core/lib/manners.js'

test('默认关闭：不传 enabled 时恒为 say，且标记 off', () => {
  for (const place of PLACES) {
    for (const sensitivity of SENSITIVITIES) {
      for (const source of SOURCES) {
        const r = decideManners({ place, sensitivity, source })
        assert.equal(r.mode, 'say')
        assert.equal(r.off, true)
        assert.equal(r.reason, 'disabled')
      }
    }
  }
})

test('打开后：secret 在任何场合都不说', () => {
  for (const place of PLACES) {
    const r = decideManners({ enabled: true, place, sensitivity: 'secret', source: 'herself' })
    assert.equal(r.mode, 'withhold')
    assert.equal(r.reason, 'secret')
  }
})

test('打开后：私事在群/公开场合不说', () => {
  for (const place of ['group', 'public']) {
    const r = decideManners({ enabled: true, place, sensitivity: 'private', source: 'herself' })
    assert.equal(r.mode, 'withhold')
    assert.equal(r.reason, 'private-outside-owner')
  }
})

test('打开后：私事在别人的私聊里不说', () => {
  const r = decideManners({ enabled: true, place: 'other-private', sensitivity: 'private', source: 'herself' })
  assert.equal(r.mode, 'withhold')
})

test('打开后：别人说的私事，在主人私聊里只说个大概', () => {
  const r = decideManners({ enabled: true, place: 'owner-private', sensitivity: 'private', source: 'other-said' })
  assert.equal(r.mode, 'paraphrase')
  assert.equal(r.reason, 'third-party-private-in-owner-dm')
})

test('打开后：主人的事不在主人私聊之外说', () => {
  for (const place of ['other-private', 'group', 'public']) {
    const r = decideManners({ enabled: true, place, sensitivity: 'normal', source: 'owner-said' })
    assert.equal(r.mode, 'withhold')
    assert.equal(r.reason, 'owner-topic-outside-owner')
  }
})

test('打开后：来源不明 + 私密 → 拿不准就不说', () => {
  const r = decideManners({ enabled: true, place: 'owner-private', sensitivity: 'private', source: 'unknown' })
  assert.equal(r.mode, 'withhold')
  assert.equal(r.reason, 'unknown-source-private')
})

test('打开后：普通事在主人私聊照说', () => {
  const r = decideManners({ enabled: true, place: 'owner-private', sensitivity: 'normal', source: 'herself' })
  assert.equal(r.mode, 'say')
  assert.equal(r.reason, 'normal')
})

test('认不出的取值按最严：place 认不出当群，sensitivity 认不出当 secret，source 认不出当 unknown', () => {
  const r = decideManners({ enabled: true, place: 'nope', sensitivity: 'nope', source: 'nope' })
  assert.equal(r.mode, 'withhold')
  assert.equal(r.reason, 'secret')
})

test('返回的 mode 总在 MODES 里', () => {
  const cases = [
    { enabled: true, place: 'owner-private', sensitivity: 'normal', source: 'herself' },
    { enabled: true, place: 'group', sensitivity: 'private', source: 'other-said' },
    { enabled: true, place: 'public', sensitivity: 'secret', source: 'owner-said' },
  ]
  for (const c of cases) assert.ok(MODES.includes(decideManners(c).mode))
})

test('提示行：关闭时为空，打开时三种说法都与模式对应', () => {
  assert.equal(renderMannersHint(decideManners({})), '')
  assert.match(renderMannersHint({ mode: 'say' }), /可以/)
  assert.match(renderMannersHint({ mode: 'paraphrase' }), /大概/)
  assert.match(renderMannersHint({ mode: 'withhold' }), /不提/)
  assert.match(renderMannersHint({ mode: 'say' }, { lang: 'en' }), /directly/i)
})

test('提示行不含催办与感叹号', () => {
  for (const mode of MODES) {
    const line = renderMannersHint({ mode })
    assert.ok(!line.includes('！'))
    assert.ok(!/别忘了|记得|加油/.test(line))
  }
})