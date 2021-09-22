import {Connection, PublicKey, clusterApiUrl, Cluster, Commitment, AccountInfo, Account} from '@solana/web3.js'
import {
  Base, Magic,
  parseMappingData,
  parsePriceData,
  parseProductData, Price, PriceData, Product, ProductData,
  Version,
} from '@pythnetwork/client'

// TODO: this entire file should be moved into pyth-client

const ONES = '11111111111111111111111111111111'

const PC_ACCTYPE_MAPPING=1
const PC_ACCTYPE_PRODUCT=2
const PC_ACCTYPE_PRICE=3
const PC_ACCTYPE_TEST=4

const networkNameToPythProgramKey: Record<Cluster, string> = {
  'mainnet-beta': 'FsJ3A3u2vn5cTVofAjvy6y5kwABJAqYWpe4975bi2epH',
  'devnet': 'gSbePebfvPy7tRqimPoVecS2UsBvYv46ynrzWocc92s',
  'testnet': '8tfDNiaEyrV6Q1U4DEXrEigs9DoDtkugzFbybENEbCDz',
}
export function getPythProgramKey(networkName: Cluster): PublicKey {
  return new PublicKey(networkNameToPythProgramKey[networkName]);
}

function parseBaseData(data: Buffer): Base | undefined {
  // NOTE: this should work if buffer is empty.
  // pyth magic number
  const magic = data.readUInt32LE(0)
  if (magic == Magic) {
    // program version
    const version = data.readUInt32LE(4)
    // account type
    const type = data.readUInt32LE(8)
    // account used size
    const size = data.readUInt32LE(12)
    return { magic, version, type, size }
  } else {
    return undefined
  }
}

export type PythPriceCallback = (product: Product, price: PriceData) => void

export class PythConnection {
  connection: Connection
  pythProgramKey: PublicKey
  commitment: Commitment

  productAccountKeyToProduct: Record<string, Product> = {}
  priceAccountKeyToProductAccountKey: Record<string, string> = {}

  callbacks: PythPriceCallback[] = []

  private handleProductAccount(key: PublicKey, account: AccountInfo<Buffer>) {
    const {priceAccountKey, type, product} = parseProductData(account.data)
    this.productAccountKeyToProduct[key.toString()] = product
    if (priceAccountKey.toString() !== ONES) {
      this.priceAccountKeyToProductAccountKey[priceAccountKey.toString()] = key.toString()
    }
  }

  private handlePriceAccount(key: PublicKey, account: AccountInfo<Buffer>) {
    const product = this.productAccountKeyToProduct[this.priceAccountKeyToProductAccountKey[key.toString()]]
    if (product === undefined) {
      // This shouldn't happen since we're subscribed to all of the program's accounts,
      // but let's be good defensive programmers.
      throw new Error('Got a price update for an unknown product. This is a bug in the library, please report it to the developers.')
    }

    const priceData = parsePriceData(account.data)
    for (let callback of this.callbacks) {
      callback(product, priceData)
    }
  }
  
  private handleAccount(key: PublicKey, account: AccountInfo<Buffer>, productOnly: boolean) {
    const base = parseBaseData(account.data)
    // The pyth program owns accounts that don't contain pyth data, which we can safely ignore.
    if (base) {
      switch (base.type) {
        case PC_ACCTYPE_MAPPING:
          // We can skip these because we're going to get every account owned by this program anyway.
          break;
        case PC_ACCTYPE_PRODUCT:
          this.handleProductAccount(key, account)
          break;
        case PC_ACCTYPE_PRICE:
          if (!productOnly) {
            this.handlePriceAccount(key, account)
          }
          break;
        case PC_ACCTYPE_TEST:
          break;
        default:
          throw new Error(`Unknown account type: ${base.type}. Try upgrading pyth-client.`)
      }
    }
  }

  constructor(connection: Connection, pythProgramKey: PublicKey, commitment: Commitment = 'finalized') {
    this.connection = connection
    this.pythProgramKey = pythProgramKey
    this.commitment = commitment
  }

  public async start() {
    const accounts = await this.connection.getProgramAccounts(this.pythProgramKey, this.commitment)
    for (let account of accounts) {
      this.handleAccount(account.pubkey, account.account, true)
    }

    this.connection.onProgramAccountChange(
      this.pythProgramKey,
      (keyedAccountInfo, context) => {
        this.handleAccount(keyedAccountInfo.accountId, keyedAccountInfo.accountInfo, false)
      },
      this.commitment,
      []
    )
  }

  public onPriceChange(callback: PythPriceCallback) {
    this.callbacks.push(callback)
  }

  public async stop() {
    // There's no way to actually turn off the solana web3 subscription x_x, but there should be.
    // Leave this method in so we don't have to update our API when solana fixes theirs.
  }

}