import { describe, expect, it } from 'vitest'

import { createSignedState, isOwnState, verifySignedState } from '@/lib/crypto'
import { UnauthorizedError } from '@/lib/errors'

/**
 * Connect `state` davranışı.
 *
 * İki akış vardır ve ayrı ele alınmalıdır:
 *  - Eklenti başlatır  → state'i BİZ imzalarız, katı doğrulanır.
 *  - Marketplace başlatır → state'i PLATFORM üretir, bize opaktır; doğrulanamaz.
 *    Bu akışta gerçek bariyer tek kullanımlık `code` + sunucu tarafı `client_secret`'tir.
 */

const SECRET = 'connect-test-secret'
const TTL_SECONDS = 600
const NOW = 1_700_000_000

describe('kendi ürettiğimiz state', () => {
  it('üretilen state kendimize ait olarak tanınır', async () => {
    expect(isOwnState(await createSignedState(NOW, SECRET))).toBe(true)
  })

  it('geçerli state doğrulamayı geçer', async () => {
    const state = await createSignedState(NOW, SECRET)
    await expect(verifySignedState(state, SECRET, NOW, TTL_SECONDS)).resolves.toBeUndefined()
  })

  it('🔴 imza oynanmışsa reddedilir', async () => {
    const state = await createSignedState(NOW, SECRET)
    const tampered = `${state.slice(0, -4)}AAAA`
    await expect(verifySignedState(tampered, SECRET, NOW, TTL_SECONDS)).rejects.toBeInstanceOf(
      UnauthorizedError,
    )
  })

  it('🔴 başka secret ile imzalanmışsa reddedilir', async () => {
    const state = await createSignedState(NOW, 'baska-secret')
    await expect(verifySignedState(state, SECRET, NOW, TTL_SECONDS)).rejects.toBeInstanceOf(
      UnauthorizedError,
    )
  })

  it('🔴 TTL dolmuşsa reddedilir', async () => {
    const state = await createSignedState(NOW, SECRET)
    const late = NOW + TTL_SECONDS + 1
    await expect(verifySignedState(state, SECRET, late, TTL_SECONDS)).rejects.toBeInstanceOf(
      UnauthorizedError,
    )
  })
})

describe('platform kaynaklı state', () => {
  it('bizim önekimizi taşımaz → doğrulama denenmez', () => {
    // Gerçek kurulumda platformun gönderdiği biçim: opak, önekimiz yok.
    expect(isOwnState('Zm9vYmFyLW9wYXF1ZS1zdGF0ZQ')).toBe(false)
    expect(isOwnState('')).toBe(false)
  })

  it('🔴 önekimizi taşıyan sahte state yine de imzadan geçemez', async () => {
    // Saldırgan önekimizi taklit ederse katı doğrulamaya DÜŞER, sessizce geçemez.
    await expect(
      verifySignedState('rmp1.1700000000.nonce.sahteimza', SECRET, NOW, TTL_SECONDS),
    ).rejects.toBeInstanceOf(UnauthorizedError)
  })
})
