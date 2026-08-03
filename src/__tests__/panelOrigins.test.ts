import { describe, expect, it } from 'vitest'
import { PANEL_ORIGINS } from '@restomenum/plugin-sdk'

import { PANEL_ORIGINS_FOR_CSP } from '@/panelOrigins'

describe('CSP origin listesi', () => {
  it('SDK ile birebir aynı kalır', () => {
    // next.config.ts SDK'yı import edemediği için liste elle tutuluyor.
    // Bu test kaymayı yakalar: SDK listesi değişirse burada kırılır.
    expect([...PANEL_ORIGINS_FOR_CSP]).toEqual([...PANEL_ORIGINS])
  })
})
