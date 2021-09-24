import {Connection, PublicKey, clusterApiUrl, Cluster, Commitment} from '@solana/web3.js';
import { PythConnection, getPythProgramKey } from './PythConnection'
import {checkValidity, isPublishing} from "./validation";
import {PriceComponent, PriceData, Product} from "@pythnetwork/client";

require('dotenv').config()

const SOLANA_CLUSTER_NAME: Cluster = process.env.SOLANA_CLUSTER_NAME ? process.env.SOLANA_CLUSTER_NAME as Cluster : 'mainnet-beta'
const SOLANA_CLUSTER_URL = clusterApiUrl(SOLANA_CLUSTER_NAME)
const SOLANA_CONNECTION_COMMITMENT: Commitment = process.env.SOLANA_CONNECTION_COMMITMENT ? process.env.SOLANA_CONNECTION_COMMITMENT as Commitment : 'finalized'
console.log(
  `Connecting to ${SOLANA_CLUSTER_URL} with commitment ${SOLANA_CONNECTION_COMMITMENT}`
)

const PYTH_PROGRAM_KEY = getPythProgramKey(SOLANA_CLUSTER_NAME)
const PUBLISHER_KEY: string | undefined = process.env.PUBLISHER_KEY

const connection = new Connection(
  SOLANA_CLUSTER_URL,
  SOLANA_CONNECTION_COMMITMENT
)
const pythConnection = new PythConnection(connection, PYTH_PROGRAM_KEY, SOLANA_CONNECTION_COMMITMENT)
const publisherStatus: Record<string, Record<string, boolean>> = {}
const publisherHitRateMovingAvg: Record<string, Record<string, {slot: bigint, avg: number}>> = {}
const HIT_RATE_MOVING_AVG_MULTIPLE = 0.95

function handlePriceChange(product: Product, price: PriceData) {
  for (let publisherPrice of price.priceComponents) {
    const currentPublisherKey = publisherPrice.publisher?.toString()
    if (currentPublisherKey !== undefined && (PUBLISHER_KEY === undefined || PUBLISHER_KEY === currentPublisherKey)) {
      if (!(currentPublisherKey in publisherStatus)) {
        publisherStatus[currentPublisherKey] = {}
        publisherHitRateMovingAvg[currentPublisherKey] = {}
      }

      const isActive = isPublishing(price, publisherPrice)
      const wasActive: boolean | undefined = publisherStatus[currentPublisherKey][product.symbol]

      if (wasActive !== undefined && wasActive != isActive) {
        if (isActive) {
          console.log(`${(new Date()).toISOString()} Started publishing ${product.symbol} ${currentPublisherKey}`)
        } else {
          console.log(`${(new Date()).toISOString()} Stopped publishing ${product.symbol} ${currentPublisherKey}`)
        }
      }

      publisherStatus[currentPublisherKey][product.symbol] = isActive

      if (publisherHitRateMovingAvg[currentPublisherKey][product.symbol] === undefined) {
        publisherHitRateMovingAvg[currentPublisherKey][product.symbol] = {
          slot: publisherPrice.aggregate.publishSlot,
          avg: 1.0,
        }
      } else {
        const currentAvg = publisherHitRateMovingAvg[currentPublisherKey][product.symbol]
        // Check if the publisher updated their price since the last update. Note that publishSlot is sent by
        // publishers and represents the slot they are targeting; this check assumes they change publishSlot
        // each time they publish a new price. They're supposed to do this, though there may be rare cases where
        // they don't (if they somehow get away from the real price).
        if (publisherPrice.aggregate.publishSlot !== currentAvg.slot) {
          publisherHitRateMovingAvg[currentPublisherKey][product.symbol] = {
            slot: publisherPrice.aggregate.publishSlot,
            avg: currentAvg.avg * HIT_RATE_MOVING_AVG_MULTIPLE + (1 - HIT_RATE_MOVING_AVG_MULTIPLE)
          }
        } else {
          publisherHitRateMovingAvg[currentPublisherKey][product.symbol].avg = currentAvg.avg * HIT_RATE_MOVING_AVG_MULTIPLE
        }

        // Notify if hit rate is too low.
        if (isActive && currentAvg.avg < 0.3) {
          console.log(`${(new Date()).toISOString()} low-slot-hit-rate ${product.symbol} ${currentPublisherKey} hit rate: ${(currentAvg.avg * 100).toFixed(1)}%`)
        }
      }

      const code = checkValidity(product, price, publisherPrice)
      if (code !== undefined) {
        console.log(`${(new Date()).toISOString()} ${code} ${product.symbol} ${currentPublisherKey} aggregate: ${price.price} ± ${price.confidence} publisher: ${publisherPrice.aggregate.price} ± ${publisherPrice.aggregate.confidence}`)
      }
    }
  }
}


pythConnection.onPriceChange(handlePriceChange)
pythConnection.start()
