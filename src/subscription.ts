import {Connection, PublicKey, clusterApiUrl, Commitment} from '@solana/web3.js'
import {
  parseMappingData,
  parsePriceData,
  parseProductData,
  Version,
} from '@pythnetwork/client'

// FsJ3A3u2vn5cTVofAjvy6y5kwABJAqYWpe4975bi2epH

async function pythSubscription(connection: Connection, oracleKey: PublicKey, commitment: Commitment = 'finalized') {
  connection.onProgramAccountChange(oracleKey, , commitment, )
}