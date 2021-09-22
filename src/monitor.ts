// use solana web3 api to watch all pyth products
// get price updates, check isValid
// add some notification schemes

import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { PythConnection } from './subscription'

require('dotenv').config()

const AWS = require('aws-sdk')
AWS.config.update({ region: process.env.AWS_REGION })
const s3 = new AWS.S3()

const ONES = '11111111111111111111111111111111'

const { v4: uuidv4 } = require('uuid')

const ARCHIVER_UUID = uuidv4()
console.log(`Starting archiver with UUID: ${ARCHIVER_UUID}`)

const SOLANA_CLUSTER_NAME = process.env.SOLANA_CLUSTER_NAME
const SOLANA_CLUSTER_URL = clusterApiUrl(SOLANA_CLUSTER_NAME)
const SOLANA_CONNECTION_COMMITMENT = process.env.SOLANA_CONNECTION_COMMITMENT
console.log(
  `Connecting to ${SOLANA_CLUSTER_URL} with commitment ${SOLANA_CONNECTION_COMMITMENT}`
)

const PYTH_VERSION = Version
const ORACLE_MAPPING_PUBLIC_KEY =
  process.env.ORACLE_MAPPING_PUBLIC_KEY ||
  (SOLANA_CLUSTER_NAME === 'devnet'
    ? 'BmA9Z6FjioHJPpjT39QazZyhDRUdZy2ezwx4GiDdE2u2'
    : 'AHtgzX45WTKfkPG53L6WYhGEXwQkN1BVknET3sVsLL8J')
console.log(`Subscribing to mapping account ${ORACLE_MAPPING_PUBLIC_KEY}`)

const S3_BUCKET = 'archive.pyth.network'
const S3_BASE_KEY = `${SOLANA_CLUSTER_NAME}/${ORACLE_MAPPING_PUBLIC_KEY}/${ARCHIVER_UUID}`
console.log(`Logging to S3 bucket ${S3_BUCKET} at ${S3_BASE_KEY}`)

const DATABASE_NAME = process.env.AWS_TIMESTREAM_DB_NAME
const TABLE_NAME = 'prices'
const timestreamWriter = db.defaultWriter(AWS, PYTH_VERSION, SOLANA_CLUSTER_NAME, DATABASE_NAME, TABLE_NAME)

const connection = new Connection(
  SOLANA_CLUSTER_URL,
  SOLANA_CONNECTION_COMMITMENT
)
const publicKey = new PublicKey(ORACLE_MAPPING_PUBLIC_KEY)

let trackTime = Date.now()
let updates = []

function trackUpdate(accountKey, type, slot, wallTime, data) {
  updates.push({
    key: accountKey.toBase58(),
    type,
    slot,
    wallTime,
    data: data.toString('base64'),
  })
}
function storeTracks() {
  const fromTime = new Date(trackTime).toISOString()
  trackTime = Date.now()
  const toTime = new Date(trackTime).toISOString()
  console.log(fromTime, toTime)
  const filePath = `${S3_BASE_KEY}/${fromTime}_${toTime}.json.gz`
  const numRecords = updates.length
  gzip(JSON.stringify(updates), (err, buffer) => {
    if (err) {
      console.error(err)
    } else {
      s3.putObject(
        {
          Bucket: S3_BUCKET,
          Key: filePath,
          Body: buffer,
        },
        (err) => {
          if (err) {
            console.error(
              `the following error occurred writing ${numRecords} updates to ${filePath}:`
            )
            console.error(err)
          } else {
            console.log(`wrote ${numRecords} updates to ${filePath}`)
          }
        }
      )
    }
  })
  updates = []
}
setInterval(storeTracks, 60000)

function fetchAccount(accountKey, handler) {
  connection
    .getAccountInfoAndContext(accountKey)
    .then(({ context: { slot }, value: accountInfo }) =>
      handler(accountKey, slot, accountInfo)
    )
    .catch((e) => {
      console.error('Error fetching account', accountKey.toString())
      console.error(e)
      console.log('Retrying in 30s')
      setTimeout(() => fetchAccount(accountKey, handler), 30000)
    })
}

const subscribedAccounts = {}
const subscribeToAccount = (accountKey, handler) => {
  const accountKeyStr = accountKey.toString()
  if (subscribedAccounts[accountKeyStr]) return
  console.log(`Subscribing to updates for ${accountKeyStr}`)
  subscribedAccounts[accountKeyStr] = connection.onAccountChange(
    accountKey,
    (accountInfo, { slot }) => handler(accountKey, slot, accountInfo),
    SOLANA_CONNECTION_COMMITMENT
  )
}

const productAccountKeyToProduct = {}
const priceAccountKeyToProductAccountKey = {}
// maps price accounts -> publisher accounts -> slot number
const priceAccountKeyToPublisherUpdate = {}
function handlePriceAccount(accountKey, slot, accountInfo) {
  const wallTime = Date.now()
  const priceData = parsePriceData(accountInfo.data)
  const { type, nextPriceAccountKey, price, confidence, twap, avol, priceComponents } = priceData
  trackUpdate(accountKey, type, slot, wallTime, accountInfo.data)

  const accountKeyString = accountKey.toString()

  if (priceAccountKeyToPublisherUpdate[accountKeyString] === undefined) {
    priceAccountKeyToPublisherUpdate[accountKeyString] = {}
  }

  const symbol =
    productAccountKeyToProduct[priceAccountKeyToProductAccountKey[accountKeyString]]
      ?.symbol

  if (!symbol) {
    console.error(`Unknown symbol for ${accountKeyString}`)
  } else {
    // Write the aggregate price at the current time
    timestreamWriter.writeAggregatePrice(
      symbol,
      slot,
      wallTime,
      price,
      confidence,
      twap,
      avol
    )

    for (let component of priceComponents) {
      // Write the price for any publisher that has published an update. We count an update when it influences the
      // aggregate price (i.e., when aggregate.publishSlot changes) so that each publisher's timeseries can be directly
      // joined with the aggregate timeseries above.
      const previousSlot = priceAccountKeyToPublisherUpdate[accountKeyString][component.publisher.toString()]
      if (component.aggregate.publishSlot !== previousSlot && previousSlot !== undefined) {
        timestreamWriter.writePublisher(
          component.publisher,
          symbol,
          wallTime,
          component.latest.price,
          component.latest.confidence,
        )
      }

      priceAccountKeyToPublisherUpdate[accountKeyString][component.publisher.toString()] = component.aggregate.publishSlot
    }
  }

  if (nextPriceAccountKey) {
    priceAccountKeyToProductAccountKey[nextPriceAccountKey.toString()] =
      priceAccountKeyToProductAccountKey[accountKey.toString()]
    subscribeToAccount(nextPriceAccountKey, handlePriceAccount)
  }
}

function handleProductAccount(accountKey, slot, accountInfo) {
  const wallTime = Date.now()
  const { priceAccountKey, type, product } = parseProductData(accountInfo.data)
  productAccountKeyToProduct[accountKey.toString()] = product
  priceAccountKeyToProductAccountKey[priceAccountKey.toString()] =
    accountKey.toString()
  trackUpdate(accountKey, type, slot, wallTime, accountInfo.data)
  if (priceAccountKey.toString() !== ONES) {
    subscribeToAccount(priceAccountKey, handlePriceAccount)
  }
}

function handleMappingAccount(accountKey, slot, accountInfo) {
  const wallTime = Date.now()
  const { productAccountKeys, nextMappingAccount, type } = parseMappingData(
    accountInfo.data
  )
  trackUpdate(accountKey, type, slot, wallTime, accountInfo.data)
  console.log('next mapping account: ', nextMappingAccount)
  if (nextMappingAccount) {
    fetchAccount(nextMappingAccount, handleMappingAccount)
    subscribeToAccount(nextMappingAccount, handleMappingAccount)
  }
  console.log(accountKey.toString(), 'products: ', productAccountKeys.length)
  for (let i = 0; i < productAccountKeys.length; i++) {
    fetchAccount(productAccountKeys[i], handleProductAccount)
    subscribeToAccount(productAccountKeys[i], handleProductAccount)
  }
}

fetchAccount(publicKey, handleMappingAccount)
subscribeToAccount(publicKey, handleMappingAccount)
