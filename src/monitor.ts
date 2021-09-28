import {Connection, PublicKey, clusterApiUrl, Cluster, Commitment, AccountInfo, Context} from '@solana/web3.js';
import {checkValidity, isPublishing} from "./validation";
import {PriceData, Product, PythConnection, getPythProgramKeyForCluster} from "@pythnetwork/client";

require('dotenv').config()

const SOLANA_CLUSTER_NAME: Cluster = process.env.SOLANA_CLUSTER_NAME ? process.env.SOLANA_CLUSTER_NAME as Cluster : 'mainnet-beta'
const SOLANA_CLUSTER_URL = clusterApiUrl(SOLANA_CLUSTER_NAME)
const SOLANA_CONNECTION_COMMITMENT: Commitment = process.env.SOLANA_CONNECTION_COMMITMENT ? process.env.SOLANA_CONNECTION_COMMITMENT as Commitment : 'finalized'
console.log(
  `Connecting to ${SOLANA_CLUSTER_URL} with commitment ${SOLANA_CONNECTION_COMMITMENT}`
)

const PYTH_PROGRAM_KEY = getPythProgramKeyForCluster(SOLANA_CLUSTER_NAME)
const PUBLISHER_KEY: string | undefined = process.env.PUBLISHER_KEY

const connection = new Connection(
  SOLANA_CLUSTER_URL,
  SOLANA_CONNECTION_COMMITMENT
)
const pythConnection = new PythConnection(connection, PYTH_PROGRAM_KEY, SOLANA_CONNECTION_COMMITMENT)
const publisherStatus: Record<string, Record<string, boolean>> = {}
const publisherHitRateMovingAvg: Record<string, Record<string, {slot: bigint, avg: number}>> = {}
const HIT_RATE_MOVING_AVG_MULTIPLE = 0.95
const HIT_RATE_ALERT_THRESHOLD = 0.3
// The low balance alert will go off each time a wallet balance drops below one of these thresholds.
// Must be in sorted order from low to high
const LOW_BALANCE_THRESHOLDS_SOL=[5, 10, 25, 50, 75, 100]

function handlePriceChange(product: Product, price: PriceData) {
  for (let publisherPrice of price.priceComponents) {
    const currentPublisherKey = publisherPrice.publisher?.toString()
    if (currentPublisherKey !== undefined && (PUBLISHER_KEY === undefined || PUBLISHER_KEY === currentPublisherKey)) {
      if (!(currentPublisherKey in publisherStatus)) {
        publisherStatus[currentPublisherKey] = {}
        publisherHitRateMovingAvg[currentPublisherKey] = {}

        // The first time we see a publisher, subscribe to updates on their account as well so we can track their balance.
        connection.onAccountChange(
          new PublicKey(currentPublisherKey),
          (info, context) => handlePublisherAccountChange(currentPublisherKey, info, context),
          SOLANA_CONNECTION_COMMITMENT
        )
      }

      const isActive = isPublishing(price, publisherPrice)
      const wasActive: boolean | undefined = publisherStatus[currentPublisherKey][product.symbol]

      if (wasActive !== undefined && wasActive != isActive) {
        if (isActive) {
          console.log(`${(new Date()).toISOString()} start-publish ${product.symbol} ${currentPublisherKey}`)
        } else {
          console.log(`${(new Date()).toISOString()} stop-publish ${product.symbol} ${currentPublisherKey}`)
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
        // they don't (specifically, if their estimate of the slot is different from the actual slot).
        if (publisherPrice.aggregate.publishSlot !== currentAvg.slot) {
          publisherHitRateMovingAvg[currentPublisherKey][product.symbol] = {
            slot: publisherPrice.aggregate.publishSlot,
            avg: currentAvg.avg * HIT_RATE_MOVING_AVG_MULTIPLE + (1 - HIT_RATE_MOVING_AVG_MULTIPLE)
          }
        } else {
          publisherHitRateMovingAvg[currentPublisherKey][product.symbol].avg = currentAvg.avg * HIT_RATE_MOVING_AVG_MULTIPLE
        }

        // Notify if hit rate is too low.
        if (isActive && currentAvg.avg < HIT_RATE_ALERT_THRESHOLD) {
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

const publisherBalances: Record<string, number> = {}
function handlePublisherAccountChange(key: string, info: AccountInfo<Buffer>, context: Context) {
  // default previousBalance to the highest possible value so that you get an alert on program start
  // if the publisher's balance is below the largest threshold.
  let previousBalance = LOW_BALANCE_THRESHOLDS_SOL[LOW_BALANCE_THRESHOLDS_SOL.length - 1] + 1
  if (publisherBalances[key] !== undefined) {
    previousBalance = publisherBalances[key]
  }

  const currentBalance = info.lamports / 1000000000

  const previousBalanceBin = LOW_BALANCE_THRESHOLDS_SOL.find((v) => previousBalance < v)
  const currentBalanceBin = LOW_BALANCE_THRESHOLDS_SOL.find((v) => currentBalance < v)

  if (previousBalanceBin !== currentBalanceBin) {
    console.log(`${(new Date()).toISOString()} low-balance ${key} ${currentBalance} SOL`)
  }

  publisherBalances[key] = currentBalance
}

pythConnection.onPriceChange(handlePriceChange)
pythConnection.start()
