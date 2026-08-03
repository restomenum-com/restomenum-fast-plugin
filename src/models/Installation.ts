import type { Scope } from '@restomenum/plugin-sdk'

/**
 * Bir tenant'ın kurulumu — SAF data model.
 * DB/driver import ETMEZ, hiçbir sorgu çalıştırmaz (§2.3).
 */

/** Kurulum kaydının şifresiz iç gösterimi. Secret alanlar yalnız sunucuda yaşar. */
export interface InstallationProps {
  readonly tenantId: string
  readonly apiKey: string
  readonly webhookSecret: string
  readonly scopes: readonly Scope[]
  /** Epoch milisaniye — zaman UTC saklanır (§2.4). */
  readonly installedAt: number
  readonly updatedAt: number
}

/** iframe ve API yanıtlarında dönen güvenli gösterim — secret İÇERMEZ. */
export interface InstallationDto {
  readonly tenantId: string
  readonly scopes: readonly Scope[]
  readonly installedAt: number
}

export class Installation {
  readonly tenantId: string
  readonly apiKey: string
  readonly webhookSecret: string
  readonly scopes: readonly Scope[]
  readonly installedAt: number
  readonly updatedAt: number

  constructor(props: InstallationProps) {
    this.tenantId = props.tenantId
    this.apiKey = props.apiKey
    this.webhookSecret = props.webhookSecret
    this.scopes = props.scopes
    this.installedAt = props.installedAt
    this.updatedAt = props.updatedAt
  }

  /** Kurulumda gerçekten verilen yetki mi? İstenen değil, DÖNEN scope'a bakılır (§4.1). */
  hasScope(scope: Scope): boolean {
    return this.scopes.includes(scope)
  }

  /**
   * Dış arayüze açılan gösterim — alan alan, spread YOK.
   * Sonradan eklenen bir alanın (secret) sessizce sızmasını engeller (§2.4).
   */
  toDto(): InstallationDto {
    return {
      tenantId: this.tenantId,
      scopes: this.scopes,
      installedAt: this.installedAt,
    }
  }
}
