const axios = require('axios');

const getSpendableUTXOs = async (address) => {
  try {
    const response = await axios.get(`http://inscription-indexer:3000/api/spendable-utxos/${address}`);
    return response.data;
  } catch (error) {
    console.error('Failed to fetch spendable UTXOs:', error);
    throw error;
  }
};

const checkUTXOs = async (req, res) => {
  const { walletAddress } = req.body;
  if (!walletAddress) {
    return res.status(400).send('walletAddress is required');
  }

  try {
    const spendableUTXOs = await getSpendableUTXOs(walletAddress);
    res.json({ utxos: spendableUTXOs });
  } catch (error) {
    console.error('Failed to list UTXOs:', error);
    res.status(500).send('Failed to list UTXOs');
  }
};

module.exports = {
  checkUTXOs
};
