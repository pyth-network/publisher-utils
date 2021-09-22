// use solana web3 api to watch all pyth products
// get price updates, check isValid
// add some notification schemes

import {Connection, PublicKey, clusterApiUrl, Cluster, Commitment} from '@solana/web3.js';
import { PythConnection, getPythProgramKey } from './PythConnection'

require('dotenv').config()

// TODO: these values should really be validated instead of just cast.
const SOLANA_CLUSTER_NAME: Cluster = process.env.SOLANA_CLUSTER_NAME as Cluster
const SOLANA_CLUSTER_URL = clusterApiUrl(SOLANA_CLUSTER_NAME)
const SOLANA_CONNECTION_COMMITMENT: Commitment = process.env.SOLANA_CONNECTION_COMMITMENT as Commitment
console.log(
  `Connecting to ${SOLANA_CLUSTER_URL} with commitment ${SOLANA_CONNECTION_COMMITMENT}`
)

const PYTH_PROGRAM_KEY = getPythProgramKey(SOLANA_CLUSTER_NAME)

const connection = new Connection(
  SOLANA_CLUSTER_URL,
  SOLANA_CONNECTION_COMMITMENT
)
const pythConnection = new PythConnection(connection, PYTH_PROGRAM_KEY, SOLANA_CONNECTION_COMMITMENT)
pythConnection.onPriceChange((product, price) => {
  console.log(`${product.symbol} -> ${price.price}`)
})
pythConnection.start()
