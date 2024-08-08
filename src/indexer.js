const Database = require('better-sqlite3');
const bitcoin = require('bitcoinjs-lib');
const axios = require('axios');
const zmq = require('zeromq');
const express = require('express');
require('dotenv').config();

const db = new Database('/usr/src/app/data/inscriptions.db', { verbose: console.log });
const app = express();
const port = process.env.PORT || 3000;

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS inscriptions (
    txid TEXT,
    vout INTEGER,
    type TEXT,
    content TEXT,
    timestamp INTEGER,
    PRIMARY KEY (txid, vout)
  );

  CREATE TABLE IF NOT EXISTS utxos (
    txid TEXT,
    vout INTEGER,
    address TEXT,
    value INTEGER,
    PRIMARY KEY (txid, vout)
  );

  CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_utxos_address ON utxos(address);
  CREATE INDEX IF NOT EXISTS idx_inscriptions_type ON inscriptions(type);
`);

async function syncBlock(blockHash) {
  console.log(`Syncing block ${blockHash}`);
  try {
    const { data: block } = await axios.get(`http://${process.env.BITCOIN_CORE_HOST}:${process.env.BITCOIN_CORE_PORT}/rest/block/${blockHash}.bin`, {
      responseType: 'arraybuffer',
      auth: {
        username: process.env.BITCOIN_RPC_USER,
        password: process.env.BITCOIN_RPC_PASSWORD
      }
    });
    const decodedBlock = bitcoin.Block.fromBuffer(block);

    db.transaction(() => {
      for (const tx of decodedBlock.transactions) {
        const txid = tx.getId();

        tx.outs.forEach((out, vout) => {
          const script = bitcoin.script.toASM(out.script);

          if (script.includes('OP_FALSE OP_IF 6f7264')) {
            db.prepare('INSERT OR REPLACE INTO inscriptions (txid, vout, type, content, timestamp) VALUES (?, ?, ?, ?, ?)').run(txid, vout, 'ordinal', script, Date.now());
          } else if (script.includes('OP_FALSE OP_IF 7361747472')) {
            db.prepare('INSERT OR REPLACE INTO inscriptions (txid, vout, type, content, timestamp) VALUES (?, ?, ?, ?, ?)').run(txid, vout, 'satribute', script, Date.now());
          } else if (script.includes('OP_FALSE OP_IF 72756E65')) {
            db.prepare('INSERT OR REPLACE INTO inscriptions (txid, vout, type, content, timestamp) VALUES (?, ?, ?, ?, ?)').run(txid, vout, 'rune', script, Date.now());
          }

          const address = bitcoin.address.fromOutputScript(out.script, bitcoin.networks.bitcoin);
          db.prepare('INSERT OR REPLACE INTO utxos (txid, vout, address, value) VALUES (?, ?, ?, ?)').run(txid, vout, address, out.value);
        });

        tx.ins.forEach(input => {
          db.prepare('DELETE FROM utxos WHERE txid = ? AND vout = ?').run(input.hash.reverse().toString('hex'), input.index);
        });
      }
    })();

    console.log(`Synced block ${blockHash}`);
  } catch (error) {
    console.error(`Error syncing block ${blockHash}:`, error);
  }
}

// ZMQ setup for instant updates
const zmqSocket = zmq.socket('sub');
zmqSocket.connect(`tcp://${process.env.BITCOIN_CORE_HOST}:${process.env.BITCOIN_CORE_ZMQ_PORT}`);
zmqSocket.subscribe('hashblock');

zmqSocket.on('message', async (topic, message) => {
  if (topic.toString() === 'hashblock') {
    const blockHash = message.toString('hex');
    await syncBlock(blockHash);
  }
});

// API endpoint to get spendable UTXOs for a wallet
app.get('/api/spendable-utxos/:address', (req, res) => {
  const { address } = req.params;

  try {
    const utxos = db.prepare(`
      SELECT utxos.* FROM utxos
      LEFT JOIN inscriptions ON utxos.txid = inscriptions.txid AND utxos.vout = inscriptions.vout
      WHERE utxos.address = ? AND inscriptions.txid IS NULL
    `).all(address);

    res.json(utxos);
  } catch (error) {
    console.error('Failed to retrieve spendable UTXOs:', error);
    res.status(500).send('Failed to retrieve spendable UTXOs');
  }
});

// Start the API server
app.listen(port, '0.0.0.0', () => {
  console.log(`Indexer API listening at http://0.0.0.0:${port}`);
});

// Initial sync
async function initialSync() {
  try {
    const { data: { bestblockhash } } = await axios.get(`http://${process.env.BITCOIN_CORE_HOST}:${process.env.BITCOIN_CORE_PORT}/rest/chaininfo.json`, {
      auth: {
        username: process.env.BITCOIN_RPC_USER,
        password: process.env.BITCOIN_RPC_PASSWORD
      }
    });
    await syncBlock(bestblockhash);
  } catch (error) {
    console.error('Initial sync failed:', error);
  }
}

initialSync();
