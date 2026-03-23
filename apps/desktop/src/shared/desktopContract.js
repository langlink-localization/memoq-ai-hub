const fs = require('fs');
const path = require('path');

const contractCandidates = [
  path.resolve(__dirname, '..', '..', '..', '..', 'packages', 'contracts', 'desktop-contract.json'),
  path.resolve(__dirname, '..', '..', '..', '..', 'desktop-contract.json'),
  path.join(process.resourcesPath || '', 'desktop-contract.json'),
  path.join(process.resourcesPath || '', 'packages', 'contracts', 'desktop-contract.json')
];

const contractPath = contractCandidates.find((candidate) => fs.existsSync(candidate));

if (!contractPath) {
  throw new Error('desktop-contract.json not found');
}

const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));

module.exports = {
  PRODUCT_NAME: contract.productName,
  CONTRACT_VERSION: String(contract.contractVersion),
  DEFAULT_HOST: String(process.env.MEMOQ_AI_DESKTOP_HOST || contract.defaultHost),
  DEFAULT_PORT: Number(process.env.MEMOQ_AI_DESKTOP_PORT || contract.defaultPort),
  ROUTES: contract.routes,
  PREVIEW: contract.preview || {},
  INTEGRATION: contract.integration,
  ERROR_CODES: contract.errorCodes,
  raw: contract
};
