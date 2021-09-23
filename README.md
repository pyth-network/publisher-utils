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

At the moment, this script sends alerts to stdout.
If you would like notifications via another medium (e.g., Slack), please let us know!