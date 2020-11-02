import sha512 from 'js-sha512'
import Database from 'better-sqlite3'
import stacks_transactions from '@blockstack/stacks-transactions'
const { getAddressFromPublicKey, TransactionVersion } = stacks_transactions
import secp256k1 from 'secp256k1'
import c32 from 'c32check'




export async function getMinerInfo() {
  
  const root = ''

  const burnchain_db_path = 'burnchain/db/bitcoin/regtest/burnchain.db'

  const sortition_db_path = "burnchain/db/bitcoin/regtest/sortition.db/marf"

  const vm_db_path = "chainstate/chain-00000080-testnet/vm/index"

  const staging_db_path = 'chainstate/chain-00000080-testnet/blocks/staging.db'

  const data_root_path = `${root}${process.argv[3] || process.argv[2]}`
  console.log(data_root_path)
  const use_txs = process.argv[2] === '-t'

  const burnchain_db = new Database(`${data_root_path}/${burnchain_db_path}`, {
    readonly: true,
    fileMustExist: true,
  })

  const sortition_db = new Database(`${data_root_path}/${sortition_db_path}`, {
    readonly: true,
    fileMustExist: true,
  })

  // const headers_db = new Database(`${data_root_path}/${headers_db_path}`, {
  const headers_db = new Database(`${data_root_path}/${vm_db_path}`, {
    readonly: true,
    fileMustExist: true,
  })

  const staging_db = new Database(`${data_root_path}/${staging_db_path}`, {
    readonly: true,
    fileMustExist: true,
  })

  // burnchain queries
  const stmt_all_burnchain_headers = burnchain_db.prepare('SELECT * FROM burnchain_db_block_headers order by block_height asc')
  const stmt_all_burnchain_ops = burnchain_db.prepare('SELECT * FROM burnchain_db_block_ops')

  // sortition queries
  const stmt_all_blocks = sortition_db.prepare('SELECT * FROM snapshots order by block_height desc')
  const stmt_all_block_commits = sortition_db.prepare('SELECT * FROM block_commits ')
  const stmt_all_leader_keys = sortition_db.prepare('SELECT * FROM leader_keys')

  // header queries
  const stmt_all_payments = headers_db.prepare('SELECT * FROM payments')
  const stmt_all_block_headers = headers_db.prepare('SELECT * FROM block_headers')

  // staging queries
  const stmt_all_staging_blocks = staging_db.prepare('SELECT * FROM staging_blocks')

  // transactions query
  const stmt_all_transactions = use_txs ? headers_db.prepare('SELECT * FROM transactions') : null

  let transaction_count = 0
  let burn_blocks_by_height = []
  let burn_blocks_by_burn_header_hash = {}
  let burn_blocks_by_consensus_hash = {}
  let stacks_blocks_by_stacks_block_hash = {}
  let transactions_by_stacks_block_id = {}
  let burnchain_blocks_by_burn_hash = {}
  let burnchain_ops_by_burn_hash = {}

  let burn_orphans = []
  let miners = {}
  let win_total = 0
  let actual_win_total = 0

  const branches = [
    {
      tip: '0000000000000000000000000000000000000000000000000000000000000000',
      name: 'br1',
      index: 1,
      height_created: 0,
      seen: 0,
      last_seen: '',
      depth: 0,
    },
  ]

  function branch_from_parent(block_hash, parent_hash) {
    const branch_info = branches.find(b => b.tip === parent_hash)
    if (branch_info) {
      branch_info.tip = block_hash
      branch_info.last_seen = stacks_blocks_by_stacks_block_hash[block_hash].block_height
      branch_info.seen++
      branch_info.depth++
      return branch_info
    }
    const current_height = stacks_blocks_by_stacks_block_hash[parent_hash] ? stacks_blocks_by_stacks_block_hash[parent_hash].block_height : 1
    const new_branch_info = {
      tip: block_hash,
      name: `br${branches.length + 1}`,
      index: branches.length + 1,
      height_created: current_height,
      seen: 1,
      last_seen: stacks_blocks_by_stacks_block_hash[block_hash].block_height,
      depth: current_height + 1,
    }
    branches.push(new_branch_info)
    // console.log("create branch", `p:${parent_hash}`, new_branch_info.name, new_branch_info.height_created)
    return new_branch_info
  }


  function find_leader_key(block_height, vtxindex) {
    const block = burn_blocks_by_height[block_height]
    const leader_key = block.leader_keys.find(lk => lk.vtxindex === vtxindex)
    if (!leader_key) {
      console.log("leader_key not found", block_height, vtxindex)
    }
    return leader_key
  }

  function post_process_block_commits() {
    for (let block of burn_blocks_by_height) {
      for (let block_commit of block.block_commits) {
        block_commit.leader_key = find_leader_key(block_commit.key_block_ptr, block_commit.key_vtxindex)
        block_commit.leader_key_address = block_commit.leader_key.address
      }
    }
  }

  function post_process_miner_stats() {
    let total_burn_prev = 0
    console.log(burn_blocks_by_height[500])
    for (let block of burn_blocks_by_height) {
      const total_burn = parseInt(block.total_burn) - total_burn_prev
      block.actual_burn = total_burn
      total_burn_prev = parseInt(block.total_burn)
      // console.log(block.block_height, total_burn)
      for (let block_commit of block.block_commits) {
        if (!miners[block_commit.leader_key_address]) {
          miners[block_commit.leader_key_address] = {
            mined: 0,
            won: 0,
            burned: 0,
            total_burn: 0,
            paid: 0,
            actual_win: 0,
          }
        }
        const miner = miners[block_commit.leader_key_address]
        miner.mined++
        miner.burned += parseInt(block_commit.burn_fee)
        miner.total_burn += total_burn
        if (block_commit.txid === block.winning_block_txid) {
          miner.won++
          win_total++
        }
      }
    }
  }

  function process_snapshots() {
    const result = stmt_all_blocks.all()
    // console.log("tip", result[0])
    const tip_height = result[0].block_height

    if (result[1].block_height === tip_height) {
      console.log("tip is not unique")
      process.exit()  // TODO(psq): this is a bit too drastic... but what's the alternative?
    }

    let parent = undefined

    for (let row of result) {
      if (row.pox_valid === 0) {
        //console.log("pox invalid", row.block_height, row.burn_header_hash, parent.parent_burn_header_hash)
      }
      else if (!parent || row.burn_header_hash === parent.parent_burn_header_hash) {
        burn_blocks_by_height[row.block_height] = row
        burn_blocks_by_burn_header_hash[row.burn_header_hash] = row
        burn_blocks_by_consensus_hash[row.consensus_hash] = row
        row.block_commits = []
        row.leader_keys = []
        row.payments = []
        row.staging_blocks = []
        row.block_headers = []
        parent = row
      } else {
        console.log("no match", row.block_height, row.burn_header_hash, parent.parent_burn_header_hash)
      }
    }
    // console.log(burn_blocks_by_height.map(b => b.block_height))
    if (burn_blocks_by_height.filter(b => !b).length !== 0) {
      console.log("missing blocks", burn_blocks_by_height.filter(b => !b))
      process.exit()
    }
    console.log(burn_blocks_by_height.length)
    // console.log("burn_blocks_by_height", JSON.stringify(burn_blocks_by_height, null, 2))
  }

  function process_leader_keys() {
    const result = stmt_all_leader_keys.all()
    // console.log("leader_keys", result)
    // console.log("process_leader_keys.length", result.length)
    for (let row of result) {
      if (burn_blocks_by_burn_header_hash[row.burn_header_hash]) {
        burn_blocks_by_burn_header_hash[row.burn_header_hash].leader_keys.push(row)    
      }
    }
  }

  function process_block_commits() {
    const result = stmt_all_block_commits.all()
    // console.log("block_commits", result)
    // console.log("process_block_commits.length", result.length)
    for (let row of result) {
      if (burn_blocks_by_burn_header_hash[row.burn_header_hash]) {
        burn_blocks_by_burn_header_hash[row.burn_header_hash].block_commits.push(row)      
      }
    }
  }

  function process_payments() {
    const result = stmt_all_payments.all()
    // console.log("payments", result)
    // console.log("payments.length", result.length)
    // console.log("burn_blocks_by_consensus_hash", burn_blocks_by_consensus_hash)
    for (let row of result) {
      // console.log(row.burn_header_hash, row)
      burn_blocks_by_consensus_hash[row.consensus_hash].payments.push(row)
    }
  }

  function process_staging_blocks() {
    const result = stmt_all_staging_blocks.all()
    // console.log("staging_blocks", result)
    // console.log("staging_blocks.length", result.length)
    // console.log("burn_blocks_by_consensus_hash", burn_blocks_by_consensus_hash)
          for (let row of result) {
            // console.log(row.consensus_hash, row)
            burn_blocks_by_consensus_hash[row.consensus_hash].staging_blocks.push(row)
          }
  }

  function process_block_headers() {
    const result = stmt_all_block_headers.all()
    // console.log("stmt_all_block_headers", result)
    // console.log("stmt_all_block_headers.length", result.length)
    for (let row of result) {
      if (burn_blocks_by_burn_header_hash[row.burn_header_hash]) {
        burn_blocks_by_burn_header_hash[row.burn_header_hash].block_headers.push(row)
        stacks_blocks_by_stacks_block_hash[row.block_hash] = row
      }
    }
  }

  function post_process_winning_fork() {
    const sorted_branches = branches.sort((a, b) => a.depth - b.depth)
    const highest_branch = sorted_branches[sorted_branches.length - 1]
    // console.log(highest_branch)
    let current_tip = highest_branch.tip
    while (current_tip !== '0000000000000000000000000000000000000000000000000000000000000000') {
      const stacks_block = stacks_blocks_by_stacks_block_hash[current_tip]
      const burn_block = burn_blocks_by_burn_header_hash[stacks_block.burn_header_hash]
      burn_block.on_winning_fork = true
      burn_block.branch_info.winning_fork = true
      const winning_block_txid = burn_block.winning_block_txid
      const winner = burn_block.block_commits.find(bc => bc.txid === burn_block.winning_block_txid)
      const winning_miner = miners[winner.leader_key_address]
      winning_miner.actual_win++
      actual_win_total++
      // console.log(stacks_block.block_height)
      current_tip = stacks_block.parent_block
    }
  }

  function post_process_branches() {
    for (let block of burn_blocks_by_height) {
      if (block.block_headers.length) {
        block.branch_info = branch_from_parent(block.block_headers[0].block_hash, block.block_headers[0].parent_block)
      }
    }
  }

  function Sha512Trunc256Sum(block_hash, consensus_hash) {
    return sha512.sha512_256(Buffer.concat([block_hash, consensus_hash]))
  }

  function process_transactions() {
    const result = stmt_all_transactions.all()
    // console.log("transactions", result)
    // console.log("staging_blocks.length", result.length)
    // console.log("burn_blocks_by_consensus_hash", burn_blocks_by_consensus_hash)
    for (let row of result) {
      // console.log(row.consensus_hash, row)
      if (!transactions_by_stacks_block_id[row.index_block_hash]) {
        transactions_by_stacks_block_id[row.index_block_hash] = []
      }
      transactions_by_stacks_block_id[row.index_block_hash].push(row)  // TODO(psq): only txid enough?
    }
    // console.log("transactions_by_stacks_block_id", transactions_by_stacks_block_id)
    for (let key of Object.keys(transactions_by_stacks_block_id)) {
      transaction_count += transactions_by_stacks_block_id[key].length - 1
    }
  }


  // CREATE TABLE burnchain_db_block_headers (
  //     block_height INTEGER NOT NULL,
  //     block_hash TEXT UNIQUE NOT NULL,
  //     parent_block_hash TEXT NOT NULL,
  //     num_txs INTEGER NOT NULL,
  //     timestamp INTEGER NOT NULL,
  function process_burnchain_blocks() {
    const result = stmt_all_burnchain_headers.all()
    // console.log("process_burnchain_blocks", result)
    for (let burn_block of result) {
      burn_block
    }

  }

  // CREATE TABLE burnchain_db_block_ops (
  //     block_hash TEXT NOT NULL,
  //     op TEXT NOT NULL,
  function process_burnchain_ops() {

    const result = stmt_all_burnchain_ops.all()
    // console.log("process_burnchain_ops", result)
    console.log("========================================================================================================================")
    console.log("Leader key registrations")
    for (let row of result) {
      if (!burnchain_ops_by_burn_hash[row.block_hash]) {
        burnchain_ops_by_burn_hash[row.block_hash] = []
      }
      const op = JSON.parse(row.op)
      if (op.LeaderBlockCommit) {
        op.LeaderBlockCommit.burn_header_hash_hex = Buffer.from(op.LeaderBlockCommit.burn_header_hash).toString('hex')
        op.LeaderBlockCommit.public_key = secp256k1.publicKeyConvert(Buffer.from(op.LeaderBlockCommit.input.public_keys[0].key, 'hex'), op.LeaderBlockCommit.input.public_keys[0].compressed).toString('hex')
        //console.log(Buffer.from(op.LeaderBlockCommit.input.public_keys[0].key, 'hex'), op.LeaderBlockCommit.public_key)
        op.LeaderBlockCommit.stacks_address = getAddressFromPublicKey(op.LeaderBlockCommit.public_key, TransactionVersion.Testnet)
        op.LeaderBlockCommit.btc_address = c32.c32ToB58(op.LeaderBlockCommit.stacks_address)
        //console.log(op.LeaderBlockCommit.burn_header_hash_hex, op.LeaderBlockCommit.public_key, op.LeaderBlockCommit.stacks_address, op.LeaderBlockCommit.btc_address)
      } else if (op.LeaderKeyRegister) {
        op.LeaderKeyRegister.stacks_address = c32.c32address(op.LeaderKeyRegister.address.version, op.LeaderKeyRegister.address.bytes)
        // console.log(op.LeaderKeyRegister)
        //console.log(op.LeaderKeyRegister.block_height, op.LeaderKeyRegister.vtxindex, op.LeaderKeyRegister.stacks_address, )
      }
      burnchain_ops_by_burn_hash[row.block_hash].push(op)
    }
    // console.log("burnchain_ops_by_burn_hash", JSON.stringify(burnchain_ops_by_burn_hash, null, 2))
    console.log("========================================================================================================================")
  }

  
  process_burnchain_blocks()
  process_burnchain_ops()
  process_snapshots()
  process_leader_keys()
  process_block_commits()
  process_payments()
  process_staging_blocks()
  process_block_headers()

  if (use_txs) {
    process_transactions()   
  }

  post_process_block_commits()
  post_process_miner_stats()
  post_process_branches()
  post_process_winning_fork()

  let stacks_block_height_max = 0
  let parent_hash = null
  let parent_winner_address = null
  for (let block of burn_blocks_by_height) {
    let at_tip = ' '
    if (block.payments.length && block.payments[0].stacks_block_height > stacks_block_height_max) {
      stacks_block_height_max = block.payments[0].stacks_block_height
      at_tip = '>'
    }
    const current_winner_address = block.block_commits.find(bc => bc.txid === block.winning_block_txid)
    // const is_argon_or_psq = current_winner_address ? (current_winner_address.leader_key_address === argon_address || current_winner_address.leader_key_address === psq_address) : false

    const stacks_block_id = block.block_headers.length ? Sha512Trunc256Sum(Buffer.from(block.block_headers[0].block_hash, 'hex'), Buffer.from(block.block_headers[0].consensus_hash, 'hex')) : '-'
    const txids = block.block_headers.length && use_txs ? `[${transactions_by_stacks_block_id[stacks_block_id].map(tx => tx.txid.substring(0, 10)).join(',')}]` : ''
    
    console.log(block.block_height,
      // block.block_commits.map(bc => `${bc.leader_key_address.substring(0, 10)}${bc.txid === block.winning_block_txid ? '*' : ' '}(${bc.key_block_ptr})`).sort((a, b) => a.localeCompare(b)).join(' '),
      block.block_commits.map(bc => `${bc.leader_key_address.substring(0, 10)}${bc.txid === block.winning_block_txid ? '*' : ' '}`).sort((a, b) => a.localeCompare(b)).join(''),
      // block.payments.length,
      // block.staging_blocks.length,
      // block.stacks_block_height,
      block.payments.length ? `${block.payments[0].stacks_block_height}${at_tip}` : '',
      block.block_headers.length ? `${block.block_headers[0].block_height}` : '-',
      block.branch_info ? `${block.branch_info.name}${block.on_winning_fork ? '$' : ' '}` : ' ',
      // block.branch_info ? block.branch_info.height_created : '-',
      block.block_headers.length ? `s:${block.block_headers[0].block_hash.substring(0, 10)}` : '-',
      block.block_headers.length ? `p:${block.block_headers[0].parent_block.substring(0, 10)}` : '-',
      block.block_headers.length ? `c:${block.block_headers[0].consensus_hash.substring(0, 10)}` : '-',
      stacks_block_id !== '-' ? `i:${stacks_block_id.substring(0, 10)}` : '',
      block.block_headers.length ? `b:${block.block_headers[0].burn_header_hash.substring(0, 10)}` : '-',

      block.block_headers.length ? `${block.block_headers[0].parent_block === parent_hash ? ((parent_winner_address ? parent_winner_address.leader_key_address : null) === (current_winner_address ? current_winner_address.leader_key_address : null) ? '@+' : '@@') : '  '}` : '  ',
      block.actual_burn,
      txids,
      // (is_argon_or_psq || block.block_headers.length === 0) ? '' : `<================================= ${current_winner_address ? current_winner_address.leader_key_address : 'no winner'}`

      // block.payments.length ? block.payments[0].index_block_hash : '',
    )
    
    parent_winner_address = current_winner_address
    parent_hash = block.block_headers.length ? block.block_headers[0].block_hash : null
  }

  if (use_txs) {
    console.log("========================================================================================================================")
    console.log("total transactions (excl coinbase)", transaction_count)
  }
  console.log("========================================================================================================================")
  console.log("STX address/BTC address - actual wins/total wins/total mined %won %actual wins - paid satoshis Th[theoritical win%] (avg paid)")
  
  let miners_result = []

  for (let miner_key of Object.keys(miners).sort()) {
    const miner = miners[miner_key]
    console.log(`${miner_key}/${c32.c32ToB58(miner_key)} ${miner.actual_win}/${miner.won}/${miner.mined} ${(miner.won / miner.mined * 100).toFixed(2)}% ${(miner.actual_win / actual_win_total * 100).toFixed(2)}% - ${miner.burned} - Th[${(miner.burned / miner.total_burn * 100).toFixed(2)}%] (${miner.burned / miner.mined})`)
    miner.average_burn = miner.burned / miner.mined
    miner.normalized_wins = miner.won / miner.average_burn
    const miner_result = {
      stx_address:miner_key,
      btc_address:c32.c32ToB58(miner_key),
      actual_win:miner.actual_win,
      total_win:miner.won,
      total_mined: miner.mined,
      miner_burned: miner.burned
    }
    miners_result.push(miner_result)
  }
  console.log(miners_result)
  return miners_result;
}