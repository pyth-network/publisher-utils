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

function handlePriceChange(product: Product, price: PriceData) {
  for (let publisherPrice of price.priceComponents) {
    const currentPublisherKey = publisherPrice.publisher?.toString()
    if (currentPublisherKey !== undefined && (PUBLISHER_KEY === undefined || PUBLISHER_KEY === currentPublisherKey)) {
      if (!(currentPublisherKey in publisherStatus)) {
        publisherStatus[currentPublisherKey] = {}
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

      const code = checkValidity(product, price, publisherPrice)
      if (code !== undefined) {
        console.log(`${(new Date()).toISOString()} ${code} ${product.symbol} ${currentPublisherKey} aggregate: ${price.price} ± ${price.confidence} publisher: ${publisherPrice.aggregate.price} ± ${publisherPrice.aggregate.confidence}`)
      }
    }
  }
}


pythConnection.onPriceChange(handlePriceChange)
pythConnection.start()
