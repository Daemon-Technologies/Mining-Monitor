import express from 'express';
import { getMinerInfo } from './report-pox-krypton.js'
import heapdump from 'heapdump';

const app = express()
const port = 23456

const root = ''
const data_root_path = `${root}${process.argv[3] || process.argv[2]}`
const use_txs = process.argv[2] === '-t'

app.get('/minerList', async (req, res) => {
  console.log(req.query)
  let result = await getMinerInfo(req.query)
  console.log("result:", result)
  res.send(result)
})

setInterval(function(){
  heapdump.writeSnapshot('./' + Date.now() + '.heapsnapshot');
}, 360000);

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`)
})

