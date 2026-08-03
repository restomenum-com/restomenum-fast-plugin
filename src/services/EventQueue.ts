import type { VerifiedEvent } from '@/services/WebhookService'

/**
 * Doğrulanmış olayların dayanıklı taşıyıcısı.
 *
 * 🔴 `waitUntil` TEK BAŞINA yeterli değildir: isolate ölürse iş kaybolur **ve**
 * dedup sahiplenmesi geri verilemez — olay "görüldü" kalır, platformun retry'ı
 * dedup'a takılır ve iş hiçbir zaman yapılmaz. Kuyruk bu pencereyi kapatır.
 *
 * Mesajda SECRET TAŞINMAZ: yalnız zarf (imzası doğrulanmış iş verisi) ve
 * ortam+tenant kimliği gider.
 */
export interface EventQueue {
  enqueue(event: VerifiedEvent): Promise<void>
}

/** Cloudflare Queues implementasyonu. */
export class CloudflareEventQueue implements EventQueue {
  readonly #queue: { send(body: unknown): Promise<void> }

  constructor(queue: { send(body: unknown): Promise<void> }) {
    this.#queue = queue
  }

  async enqueue(event: VerifiedEvent): Promise<void> {
    await this.#queue.send({ envelope: event.envelope, ref: event.ref })
  }
}

/**
 * Kuyruk binding'i yokken kullanılan yedek: işi `waitUntil` ile yürütür.
 *
 * Yerel geliştirme ve testler için. Dayanıklı DEĞİLDİR — üretimde kuyruk bağlanmalıdır;
 * bu yüzden kullanıldığında uyarı yazar (sessizce daha zayıf davranmaz).
 */
export class InlineEventQueue implements EventQueue {
  readonly #run: (event: VerifiedEvent) => Promise<void>
  readonly #waitUntil: (promise: Promise<unknown>) => void

  constructor(params: {
    run: (event: VerifiedEvent) => Promise<void>
    waitUntil: (promise: Promise<unknown>) => void
  }) {
    this.#run = params.run
    this.#waitUntil = params.waitUntil
  }

  async enqueue(event: VerifiedEvent): Promise<void> {
    console.log('webhook: kuyruk binding yok — waitUntil ile yürütülüyor (dayanıklı değil)')
    this.#waitUntil(
      this.#run(event).catch((error: unknown) => {
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : 'bilinmeyen'
        console.error(`webhook: işleme hatası ${detail}`)
      }),
    )
  }
}
