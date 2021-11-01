import {AccountInfo, Cluster, clusterApiUrl, Commitment, Connection, Context, PublicKey} from '@solana/web3.js';
import {LowSlotHitRate, Price, PublisherPrice, Validator} from "./validation";
import {getPythProgramKeyForCluster, PriceData, Product, PythConnection} from "@pythnetwork/client";

require('dotenv').config()

const SOLANA_CLUSTER_NAME: Cluster = process.env.SOLANA_CLUSTER_NAME ? process.env.SOLANA_CLUSTER_NAME as Cluster : 'mainnet-beta'
const SOLANA_CLUSTER_URL = process.env.SOLANA_RPC_ENDPOINT ? process.env.SOLANA_RPC_ENDPOINT : clusterApiUrl(SOLANA_CLUSTER_NAME)
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
// The low balance alert will go off each time a wallet balance drops below one of these thresholds.
// Must be in sorted order from low to high
const LOW_BALANCE_THRESHOLDS_SOL=[5, 10, 25, 50, 75, 100]

function onChainPriceToPrice(price: PriceData): Price {
  const latest: Record<string, PublisherPrice> = {}
  const aggregate: Record<string, PublisherPrice> = {}

  for (let publisherPrice of price.priceComponents) {
    if (publisherPrice.publisher !== undefined) {
      const publisher = publisherPrice.publisher!.toString()
      latest[publisher] = {
        price: publisherPrice.latest.price,
        confidence: publisherPrice.latest.confidence,
        status: publisherPrice.latest.status,
        slot: publisherPrice.latest.publishSlot.toString()
      }
      aggregate[publisher] = {
        price: publisherPrice.aggregate.price,
        confidence: publisherPrice.aggregate.confidence,
        status: publisherPrice.aggregate.status,
        slot: publisherPrice.aggregate.publishSlot.toString()
      }
    }
  }

  return {
    slot: price.aggregate.publishSlot.toString(),
    quoters: latest,
    quoter_aggregates: aggregate,
    aggregate: {
      price: price.aggregate.price,
      confidence: price.aggregate.confidence,
      status: price.aggregate.status,
      slot: price.aggregate.publishSlot.toString()
    },
  }
}

function handlePriceChange(product: Product, price: PriceData) {
  const subscribedPublishers: Record<string, boolean> = {}
  for (let publisherPrice of price.priceComponents) {
    const currentPublisherKey = publisherPrice.publisher?.toString()
    if (currentPublisherKey !== undefined && (PUBLISHER_KEY === undefined || PUBLISHER_KEY === currentPublisherKey)) {
      // The first time we see a publisher, subscribe to updates on their account as well so we can track their balance.
      if (!(currentPublisherKey in subscribedPublishers)) {
        connection.onAccountChange(
          new PublicKey(currentPublisherKey),
          (info, context) => handlePublisherAccountChange(currentPublisherKey, info, context),
          SOLANA_CONNECTION_COMMITMENT
        )
        subscribedPublishers[currentPublisherKey] = true
      }
    }
  }

  const myPrice = onChainPriceToPrice(price)
  handlePriceChangeHelper(product.symbol, myPrice)
}

const validators: Record<string, Validator> = {}
function handlePriceChangeHelper(symbol: string, price: Price) {
  if (!(symbol in validators)) {
    validators[symbol] = new Validator(PUBLISHER_KEY)
  }

  const events = validators[symbol].addInput(price)
  for (const event of events) {
    if (event.code == "low-slot-hit-rate") {
      console.log(`${(new Date()).toISOString()} ${symbol} ${event.publisher} ${event.code} hit rate: ${((event as LowSlotHitRate).hitRate * 100).toFixed(1)}%`)
    } else if (event.code == "start-publish" || event.code == "stop-publish") {
      console.log(`${(new Date()).toISOString()} ${symbol} ${event.publisher} ${event.code}`)
    } else {
      const aggregate = price.aggregate
      const publisherPrice = price.quoter_aggregates[event.publisher]
      console.log(`${(new Date()).toISOString()} ${symbol} ${event.publisher} ${event.code} aggregate: ${aggregate.price} ± ${aggregate.confidence} publisher: ${publisherPrice.price} ± ${publisherPrice.confidence}`)
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
