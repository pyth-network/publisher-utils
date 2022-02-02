import {AccountInfo, Cluster, clusterApiUrl, Commitment, Connection, Context, PublicKey} from '@solana/web3.js';
import {LowSlotHitRate, Price, PublisherPrice, Validator} from "./validation";
import {getPythProgramKeyForCluster, PriceData, Product, PythConnection} from "@pythnetwork/client";

require('dotenv').config()

const SOLANA_CLUSTER_NAME: Cluster = process.env.SOLANA_CLUSTER_NAME ? process.env.SOLANA_CLUSTER_NAME as Cluster : 'mainnet-beta'
const SOLANA_CLUSTER_URL = process.env.SOLANA_RPC_ENDPOINT ? process.env.SOLANA_RPC_ENDPOINT : clusterApiUrl(SOLANA_CLUSTER_NAME)
const SOLANA_CONNECTION_COMMITMENT: Commitment = process.env.SOLANA_CONNECTION_COMMITMENT ? process.env.SOLANA_CONNECTION_COMMITMENT as Commitment : 'finalized'
console.log(
  `Connecting to ${SOLANA_CLUSTER_NAME} via ${SOLANA_CLUSTER_URL} with commitment ${SOLANA_CONNECTION_COMMITMENT}`
)

// const PUBLISHER_KEY: string | undefined = process.env.PUBLISHER_KEY

const connection = new Connection(
  SOLANA_CLUSTER_URL,
  SOLANA_CONNECTION_COMMITMENT
)
// const pythConnection = new PythConnection(connection, PYTH_PROGRAM_KEY, SOLANA_CONNECTION_COMMITMENT)

interface BenchmarkStats {
  mean: number,
  variance: number,
  numSamples: number,
  p90: number,
  p95: number,
  p99: number,
}

async function sleep(ms: number) {
  return new Promise( resolve => setTimeout(resolve, ms) );
}

export class RpcLoadGenerator {
  load_fn: () => Promise<any>;
  queries_per_second: number;
  active: boolean;

  constructor(load_fn: () => Promise<any>, queries_per_second: number) {
    this.load_fn = load_fn;
    this.queries_per_second = queries_per_second;
    this.active = false;
  }

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

  public async stop() {
    this.active = false;
  }
}

// Current time in microseconds
function milliTime(): number {
  let [secs, nanos] = process.hrtime();
  return secs * 1000 + nanos / 1000000;
}

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

    // sleep a bit to prevent rate limiting.
    sleep(50);
  }

  let mean = total / n;
  let variance = results.map(x => (x - mean) * (x - mean)).reduce((x, y) => x + y) / n;

  results.sort((a, b) => a - b)

  console.log(results)
  console.log(Math.floor(0.90 * n))

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
  const pythHttpClient = new PythHttpClient(connection, PYTH_PROGRAM_KEY, SOLANA_CONNECTION_COMMITMENT);


  let methods = {
    'getSlot': () => connection.getSlot(),
    'getRecentBlockhash': () => connection.getRecentBlockhash(),
    'getProgramAccounts(pyth)': () => connection.getProgramAccounts(PYTH_PROGRAM_KEY),

    // TODO: get a price feed account repeatedly
    'getAccount': () => connection.getAccountInfo(),
  }

  let load_conditions = [
    0,
    10,
    30,
    50,
    100,
  ]

  let benchmark_queries = 50

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
