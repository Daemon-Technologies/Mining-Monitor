import express from 'express';
import { getMinerInfo } from './report-pox-krypton.js'

const app = express()
const port = 23456

const root = ''
const data_root_path = `${root}${process.argv[3] || process.argv[2]}`
const use_txs = process.argv[2] === '-t'

app.get('/minerList', async (req, res) => {
  let result = await getMinerInfo()
  console.log("result:", result)
  res.send(result)
})

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`)
})

