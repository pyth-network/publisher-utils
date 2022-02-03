import {Cluster, clusterApiUrl, Commitment, Connection, PublicKey} from '@solana/web3.js';
import {getPythProgramKeyForCluster} from "@pythnetwork/client";

require('dotenv').config()

const SOLANA_CLUSTER_NAME: Cluster = process.env.SOLANA_CLUSTER_NAME ? process.env.SOLANA_CLUSTER_NAME as Cluster : 'mainnet-beta'
const SOLANA_CLUSTER_URL = process.env.SOLANA_RPC_ENDPOINT ? process.env.SOLANA_RPC_ENDPOINT : clusterApiUrl(SOLANA_CLUSTER_NAME)
const SOLANA_CONNECTION_COMMITMENT: Commitment = process.env.SOLANA_CONNECTION_COMMITMENT ? process.env.SOLANA_CONNECTION_COMMITMENT as Commitment : 'finalized'
console.log(
  `Connecting to ${SOLANA_CLUSTER_NAME} via ${SOLANA_CLUSTER_URL} with commitment ${SOLANA_CONNECTION_COMMITMENT}`
)

const connection = new Connection(
  SOLANA_CLUSTER_URL,
  SOLANA_CONNECTION_COMMITMENT
)

/** Mapping from solana clusters to the BTC/USD price account key. */
const clusterToBtcUsd: Record<Cluster, string> = {
  'mainnet-beta': 'GVXRSBjFk6e6J3NbVPXohDJetcTjaeeuykUpbQF8UoMU',
  devnet: 'HovQMDrbAgAYPCmHVSrezcSmkMtXSSUsLDFANExrZh2J',
  testnet: 'DJW6f4ZVqCnpYNN9rNuzqUcCvkVtBgixo8mq9FKSsCbJ',
}

/** Latency statistics produced by benchmarking an endpoint. */
interface BenchmarkStats {
  // mean / variance of latency, in milliseconds
  mean: number,
  variance: number,
  numSamples: number,
  // 90th, 95th, and 99th percentile latencies, in milliseconds
  p90: number,
  p95: number,
  p99: number,
}

/**
 * Generates load against an RPC server.
 * When started, this will invoke `load_fn` at a rate of `queries_per_second`.
 * Expected usage is to pass a `load_fn` that invokes an API on the RPC server.
 */
export class RpcLoadGenerator {
  load_fn: () => Promise<any>;
  queries_per_second: number;
  active: boolean;

  constructor(load_fn: () => Promise<any>, queries_per_second: number) {
    this.load_fn = load_fn;
    this.queries_per_second = queries_per_second;
    this.active = false;
  }

  /**
   * Start generating load. load_fn will be continuously invoked until `stop()` is called.
   * You shouldn't await this method, as it will run forever.
   */
  public async start() {
    if (this.queries_per_second == 0) {
      return;
    }

    this.active = true;
    while (this.active) {
      this.load_fn();
      await sleep(1000 / this.queries_per_second);
    }
  }

  /** Stop generating load. */
  public stop() {
    this.active = false;
  }
}

async function sleep(ms: number) {
  return new Promise( resolve => setTimeout(resolve, ms) );
}

// Current time in microseconds
function milliTime(): number {
  let [secs, nanos] = process.hrtime();
  return secs * 1000 + nanos / 1000000;
}

/**
 * Invoke `method` `n` times and time how long each invocation takes.
 * Returns summary statistics about invocation latency.
 */
async function benchmark(method: (() => Promise<any>), n: number): Promise<BenchmarkStats> {
  let results: number[] = []

  let total: number = 0;
  for (let i = 0; i < n; i++) {
    let start = milliTime()
    await method()
    let end = milliTime()

    let latency = end - start
    results.push(latency)
    total += latency
  }

  let mean = total / n;
  let variance = results.map(x => (x - mean) * (x - mean)).reduce((x, y) => x + y) / n;

  results.sort((a, b) => a - b)

  return {
    mean,
    variance,
    numSamples: n,
    p90: results[Math.floor(0.90 * n)],
    p95: results[Math.floor(0.95 * n)],
    p99: results[Math.floor(0.99 * n)],
  };
}

async function main() {
  const PYTH_PROGRAM_KEY = getPythProgramKeyForCluster(SOLANA_CLUSTER_NAME);
  const priceAccountKey = new PublicKey(clusterToBtcUsd[SOLANA_CLUSTER_NAME]);

  // The API calls to benchmark
  let methods = {
    'getSlot': () => connection.getSlot(),
    'getRecentBlockhash': () => connection.getRecentBlockhash(),
    'getProgramAccounts for Pyth': () => connection.getProgramAccounts(PYTH_PROGRAM_KEY),
    'getAccount for Pyth BTC/USD price feed': () => connection.getAccountInfo(priceAccountKey),
  }

  // Benchmarking conditions. Each item is the number of queries per second we are sending while the benchmark is running.
  let load_conditions = [
    0,
    100,
    200,
    300,
    500,
    1000
  ]

  let benchmark_queries = 100

  // Warm up the RPC node (the first queries are usually slower)
  console.log("Warming up RPC node...")
  await benchmark(() => connection.getSlot(), 5);

  for (let i = 0; i < load_conditions.length; i++) {
    let qps = load_conditions[i];
    console.log(`Testing at ${qps} queries per second`)

    let load = new RpcLoadGenerator(() => connection.getSlot(), qps);
    load.start()

    for (let [name, bench_fn] of Object.entries(methods)) {
      let results = await benchmark(bench_fn, benchmark_queries);
      console.log(`  ${name}: ${results.mean.toFixed(1)} ± ${Math.sqrt(results.variance).toFixed(1)} ms p90: ${results.p90.toFixed(1)} p95: ${results.p95.toFixed(1)} p99: ${results.p99.toFixed(1)}`)
    }

    load.stop()
  }
}

main()
