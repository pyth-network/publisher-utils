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
3. `improbable-aggregate` -- a publisher's price/confidence is such that the aggregate price is more than 20 sigma away.
4. `low-slot-hit-rate` -- a publisher is active for a product, but publishing a price for < 30% of slots.
5. `low-balance` -- a publisher's account balance is low. This alert fires when the account balance drops below 
                    100, 75, 50, 25, 10, and 5 SOL.

At the moment, this script sends alerts to stdout.
If you would like notifications via another medium (e.g., Slack), please let us know!