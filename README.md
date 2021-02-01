# Mining-Monitor

Now, Daemon Technologies decide to split Mining-Monitor into a seperated project which provides:
- GUI to search Mining-related information
- Flexible RPC API to Fetch Mining-Related data

## Krypton Testnet(Not Supported)

For Krypton Testnet, we use most modules of [stacks-dump](https://github.com/psq/stacks-dump) as Mining-Monitor base repo. Only modify some details for Mining-Bot Alpha Verion.

## Mainnet & Xenon Testnet

- Use stacks-node database to computate the information.
- Create Several RPC API for searching mining_info & block_info & miner_info

### build and install

```
npm install
node server.js -t /tmp/stacks-testnet-5c87e24790411516
```

You will see 
```
Example app listening at http://localhost:23456
```

Then you can visit the rpc api by
```
curl -i http://localhost:23456/mining_info
```

