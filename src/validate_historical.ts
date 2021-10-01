import * as fs from "fs";

// call isValid on each item in there
// (maybe) do some statistical checks?

async function main(filename: string) {
  console.log(`Reading ${filename}...`)
  const data = fs.readFileSync(filename, 'utf8');
  const timeseries = JSON.parse(data);


}