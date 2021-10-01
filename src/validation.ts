import { PriceComponent, PriceData, PriceStatus, MAX_SLOT_DIFFERENCE } from "@pythnetwork/client";

export type ErrorCode = "price-deviation" | "bad-confidence" | "improbable-aggregate" |
  "low-slot-hit-rate" | "start-publish" | "stop-publish"

export interface ValidationEvent {
  code: ErrorCode
  publisher: string
}

export interface LowSlotHitRate extends ValidationEvent {
  code: "low-slot-hit-rate",
  hitRate: number
}

export interface Price {
  slot: string,
  quoters: Record<string, PublisherPrice>,
  quoter_aggregates: Record<string, PublisherPrice>,
  aggregate: PublisherPrice,
}

export interface PublisherPrice {
  price: number,
  confidence: number,
  status: number,
  slot: string
}

export class Validator {
  publisherKey: string | undefined = undefined
  publisherStatus: Record<string, boolean> = {}
  publisherHitRateMovingAvg: Record<string, {slot: bigint, avg: number}> = {}

  hitRateMovingAvgMultiple: number
  hitRateAlertThreshold: number

  constructor(publisherKey: string | undefined = undefined) {
    this.publisherKey = publisherKey
    // TODO: make configurable
    this.hitRateMovingAvgMultiple = 0.95
    this.hitRateAlertThreshold = 0.3
  }

  addInput(price: Price): ValidationEvent[] {
    const errorCodes: ValidationEvent[] = []

    for (let currentPublisherKey in price.quoters) {
      if (this.publisherKey === undefined || this.publisherKey === currentPublisherKey) {
        const isActive = isPublishing(price, currentPublisherKey)
        let wasActive: boolean | undefined = this.publisherStatus[currentPublisherKey]
        // assume everyone starts as inactive.
        if (wasActive === undefined) {
          wasActive = false;
        }

        if (wasActive != isActive) {
          if (isActive) {
            errorCodes.push({code: "start-publish", publisher: currentPublisherKey})
          } else {
            errorCodes.push({code: "stop-publish", publisher: currentPublisherKey})
          }
        }

        this.publisherStatus[currentPublisherKey] = isActive

        const publisherAggregate = price.quoter_aggregates[currentPublisherKey]
        if (this.publisherHitRateMovingAvg[currentPublisherKey] === undefined) {
          this.publisherHitRateMovingAvg[currentPublisherKey] = {
            slot: BigInt(publisherAggregate.slot),
            avg: 1.0,
          }
        } else {
          const currentAvg = this.publisherHitRateMovingAvg[currentPublisherKey]
          // Check if the publisher updated their price since the last update. Note that publishSlot is sent by
          // publishers and represents the slot they are targeting; this check assumes they change publishSlot
          // each time they publish a new price. They're supposed to do this, though there may be rare cases where
          // they don't (specifically, if their estimate of the slot is different from the actual slot).
          if (BigInt(publisherAggregate.slot) !== currentAvg.slot) {
            this.publisherHitRateMovingAvg[currentPublisherKey] = {
              slot: BigInt(publisherAggregate.slot),
              avg: currentAvg.avg * this.hitRateMovingAvgMultiple + (1 - this.hitRateMovingAvgMultiple)
            }
          } else {
            this.publisherHitRateMovingAvg[currentPublisherKey].avg = currentAvg.avg * this.hitRateMovingAvgMultiple
          }

          // Notify if hit rate is too low.
          if (isActive && currentAvg.avg < this.hitRateAlertThreshold) {
            errorCodes.push({code: "low-slot-hit-rate", publisher: currentPublisherKey, hitRate: currentAvg.avg} as ValidationEvent)
            // console.log(`${(new Date()).toISOString()} low-slot-hit-rate ${symbol} ${currentPublisherKey} hit rate: ${(currentAvg.avg * 100).toFixed(1)}%`)
          }
        }

        const code = checkValidity(price, currentPublisherKey)
        if (code !== undefined) {
          errorCodes.push({code, publisher: currentPublisherKey})
          // console.log(`${(new Date()).toISOString()} ${code} ${symbol} ${currentPublisherKey} aggregate: ${price.aggregate.price} ± ${price.aggregate.confidence} publisher: ${publisherAggregate.price} ± ${publisherAggregate.confidence}`)
        }
      }
    }

    return errorCodes
  }
}


/** Check if a published price is valid. Returns undefined if the price is ok, or an error code otherwise. */
export function checkValidity(price: Price, publisherKey: string): (ErrorCode | undefined) {
  if (isPublishing(price, publisherKey) && publisherKey in price.quoter_aggregates) {
    const publisherAggregate = price.quoter_aggregates[publisherKey]
    if (publisherAggregate.confidence <= 0) {
      return "bad-confidence"
    }

    // The aggregate price is far away from the quoter's price in probability terms.
    // Either the quoter's price is wrong, or their confidence interval is too small.
    const delta = publisherAggregate.price - price.aggregate.price;
    const ciNormalizedDelta = delta / publisherAggregate.confidence
    if (Math.abs(ciNormalizedDelta) > 20) {
      return "improbable-aggregate";
    }

    // The published price is more than 15% away from the aggregate price
    if (Math.abs(delta / price.aggregate.price) > 0.15) {
      return "price-deviation";
    }
  }

  return undefined;
}


/** Returns true if the publisher's price is currently being included in the aggregate. */
export function isPublishing(price: Price, publisherKey: string): boolean {
  const publisherAggregate = price.quoter_aggregates[publisherKey]
  if (publisherAggregate === undefined) {
    return false
  }
  const slot_diff = Number(price.slot) - Number(publisherAggregate.slot)
  return (PriceStatus[publisherAggregate.status] === 'Trading' && publisherAggregate.confidence !== 0 && slot_diff < MAX_SLOT_DIFFERENCE)
}

