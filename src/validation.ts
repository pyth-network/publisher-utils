import {Connection, PublicKey, clusterApiUrl, Cluster, Commitment} from '@solana/web3.js';
import {Product, PriceComponent, PriceData} from "@pythnetwork/client";
import {PC_STATUS_TRADING, PC_MAX_SLOT_DIFFERENCE} from './PythConnection'

export type ErrorCode = "price-deviation" | "bad-confidence" | "improbable-aggregate"

/** Check if a published price is valid. Returns undefined if the price is ok, or an error code otherwise. */
export function checkValidity(product: Product, price: PriceData, publisherPrice: PriceComponent): (ErrorCode | undefined) {
  if (publisherPrice && publisherPrice.aggregate.status === PC_STATUS_TRADING) {
    if (publisherPrice.aggregate.confidence <= 0) {
      return "bad-confidence"
    }

    // The aggregate price is far away from the quoter's price in probability terms.
    // Either the quoter's price is wrong, or their confidence interval is too small.
    const delta = publisherPrice.aggregate.price - price.price;
    const ciNormalizedDelta = delta / publisherPrice.aggregate.confidence
    if (Math.abs(ciNormalizedDelta) > 10) {
      return "improbable-aggregate";
    }

    // The published price is more than 10% away from the aggregate price
    if (Math.abs(delta / price.price) > 0.1) {
      return "price-deviation";
    }
  }

  return undefined;
}


/** Returns true if the publisher's price is currently being included in the aggregate. */
export function isPublishing(price: PriceData, publisherPrice: PriceComponent) {
  const slot_diff = price.publishSlot - publisherPrice.aggregate.publishSlot
  return (publisherPrice.aggregate.status === PC_STATUS_TRADING && publisherPrice.aggregate.confidence !== 0 && slot_diff < PC_MAX_SLOT_DIFFERENCE)
}
