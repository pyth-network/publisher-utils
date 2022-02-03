# publisher-utils

Utilities for Pyth publishers to monitor their behavior. 

## Installation

Install the dependencies for the project by running:

```
npm install
```

Configure your local run by copying `.env.sample` to `.env` and populating the variables listed.
These variables can also be configured using environment variables.

## Monitoring

The library includes a monitoring script that tracks published prices and alerts if it sees suspicious data, such as a published price that deviates significantly from the aggregate. 
Run this script using:


```
npm run monitor 
```

By default, the script will alert if any publisher's activity is suspicious. If you would like to restrict the alerts 
to a specific publisher, please set the `PUBLISHER_KEY` variable in your environment or `.env` file.
See `.env.sample` for more documentation on configuration options.

The monitoring script will log an output whenever a publisher starts or stops publishing to a specific product.
It also publishes the following alerts:

1. `bad-confidence` -- a publisher published a confidence of 0
2. `price-deviation` -- a published price is greater than 15% away from the aggregate price
3. `improbable-aggregate` -- a publisher's price/confidence interval are such that the aggregate price is more than 20 confidence intervals away. This
   error code means that either the price is far from the aggregate, or the confidence interval is too small.
4. `low-slot-hit-rate` -- a publisher is active for a product, but publishing a price for < 30% of slots.
5. `low-balance` -- a publisher's account balance is low. This alert fires when the account balance drops below 
                    100, 75, 50, 25, 10, and 5 SOL.

At the moment, this script sends alerts to stdout.
If you would like notifications via another medium (e.g., Slack), please let us know!

## RPC Benchmark

Pyth publishers often need high-performance Solana RPC nodes in order to handle the transaction load.
This package comes with a program to benchmark RPC node performance:

```
npm run benchmark
```

The benchmark program will use the RPC node configured in the `.env` file.
This program will generate synthetic load on the RPC node at a fixed number of queries/second, then measure the latency of additional specific API calls.
Example output from the program is as follows:

```
Warming up RPC node...
Testing at 0 queries per second
  getSlot: 47.7 ± 6.5 ms p90: 58.0 p95: 60.6 p99: 70.4
  getRecentBlockhash: 69.1 ± 54.8 ms p90: 164.5 p95: 181.5 p99: 338.9
  getProgramAccounts for Pyth: 108.5 ± 54.4 ms p90: 145.9 p95: 213.6 p99: 391.0
  getAccount for Pyth BTC/USD price feed: 52.2 ± 25.3 ms p90: 72.1 p95: 110.8 p99: 238.5
...
Testing at 100 queries per second
  getSlot: 51.0 ± 23.0 ms p90: 73.7 p95: 116.8 p99: 182.8
  getRecentBlockhash: 65.4 ± 44.7 ms p90: 147.5 p95: 155.6 p99: 172.0
  getProgramAccounts for Pyth: 118.7 ± 159.6 ms p90: 172.4 p95: 295.1 p99: 1432.2
  getAccount for Pyth BTC/USD price feed: 49.7 ± 23.2 ms p90: 62.5 p95: 91.1 p99: 162.5
Testing at 200 queries per second
  getSlot: 65.7 ± 68.1 ms p90: 147.9 p95: 168.5 p99: 567.3
  getRecentBlockhash: 59.1 ± 59.1 ms p90: 129.0 p95: 146.9 p99: 542.3
  getProgramAccounts for Pyth: 150.8 ± 91.6 ms p90: 295.5 p95: 420.4 p99: 472.9
  getAccount for Pyth BTC/USD price feed: 47.8 ± 16.8 ms p90: 59.5 p95: 64.9 p99: 167.0
```

This output shows how average and tail latency of each API call grows as load increases.
