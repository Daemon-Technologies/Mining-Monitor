# Mining-Monitor

## Krypton Testnet

For Krypton Testnet, we use most modules of [stacks-dump](https://github.com/psq/stacks-dump) as Mining-Monitor base repo. Only modify some details for Mining-Bot Alpha Verion.

## Xenon Testnet

- Only use Bitcoind rpc api.
- Service layer.

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

