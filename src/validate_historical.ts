import * as fs from "fs";
import {LowSlotHitRate, Price, Validator} from "./validation";

async function main(dir: string, publisherKey: string | undefined) {
  const validators: Record<string, Validator> = {}
  const subdirs = fs.readdirSync(dir)

  // String sort gives you chronological order because the dates are YYYY-MM-DD
  subdirs.sort()
  for (const subdir of subdirs) {
    const filenames = fs.readdirSync(`${dir}/${subdir}`)
    for (const filename of filenames) {
      const symbol = filename.split(".")[0]
      if (!(symbol in validators)) {
        validators[symbol] = new Validator(publisherKey)
      }
      const validator = validators[symbol]

      const data = fs.readFileSync(`${dir}/${subdir}/${filename}`, 'utf8');
      const timeseries: Price[] = JSON.parse(data);

      for (const price of timeseries) {
        const events = validator.addInput(price)
        for (const event of events) {
          if (event.code == "low-slot-hit-rate") {
            console.log(`${price.slot} ${symbol} ${event.publisher} ${event.code} hit rate: ${((event as LowSlotHitRate).hitRate * 100).toFixed(1)}%`)
          } else if (event.code == "start-publish" || event.code == "stop-publish") {
            console.log(`${price.slot} ${symbol} ${event.publisher} ${event.code}`)
          } else {
            const aggregate = price.aggregate
            const publisherPrice = price.quoter_aggregates[event.publisher]
            console.log(`${price.slot} ${symbol} ${event.publisher} ${event.code} aggregate: ${aggregate.price} ± ${aggregate.confidence} publisher: ${publisherPrice.price} ± ${publisherPrice.confidence}`)
          }
        }
      }
    }
  }
}

// Expected usage:
// npm run validate ../pyth-writer/testnet_archive/ 6s5gDyLyfNXP6WHUEn4YSMQJVcGETpKze7FCPeg9wxYT
//
// The first argument is a historical data archive as produced by load_archive.js in pyth-writer. This
// directory shards the data into per-hour subdirectories, with one price file per symbol in each per-hour
// directory. The second argument is the publisher to show alerts for.
main(process.argv[2], process.argv[3])