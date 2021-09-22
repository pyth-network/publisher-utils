
function isValid(item, quoter: string): boolean {

  /*
  The ratio of the confidence interval to price should fall within the following parameters:
a) 1e-5 < CI/Price < 1e-2
b) Ensure the exponent field has been correctly populated based on the metadata from
the Price account for a given Product account

3. Ensure you are not publishing a stale or off market price with a status of “TRADING.” In
the event that a publisher is not aware of the latest price, the foundation expects to see a
status of ‘UNKNOWN’ while publishing the previously known price of the asset.
   */

}

// make an error type enum