const fs = require('fs');
const path = require('path');

function buildContractCandidates(baseDir = __dirname, resourcesPath = process.resourcesPath || '') {
  return [
    path.resolve(baseDir, '..', '..', '..', '..', 'packages', 'contracts', 'desktop-contract.json'),
    path.resolve(baseDir, '..', '..', '..', '..', '..', 'packages', 'contracts', 'desktop-contract.json'),
    path.resolve(baseDir, '..', '..', '..', '..', 'desktop-contract.json'),
    path.join(resourcesPath, 'desktop-contract.json'),
    path.join(resourcesPath, 'packages', 'contracts', 'desktop-contract.json')
  ];
}

const contractCandidates = buildContractCandidates();

const contractPath = contractCandidates.find((candidate) => fs.existsSync(candidate));

if (!contractPath) {
  throw new Error('desktop-contract.json not found');
}

const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));

const LOOPBACK_GATEWAY_HOSTS = new Set(['127.0.0.1', 'localhost']);

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeGatewayHost(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!LOOPBACK_GATEWAY_HOSTS.has(normalized)) {
    throw new Error('Desktop gateway host must be 127.0.0.1 or localhost.');
  }
  return normalized;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeGatewayPort(value) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 65535) {
    throw new Error('Desktop gateway port must be an integer between 1 and 65535.');
  }
  return normalized;
}

const defaultHost = normalizeGatewayHost(process.env.MEMOQ_AI_DESKTOP_HOST || contract.defaultHost);
const defaultPort = normalizeGatewayPort(process.env.MEMOQ_AI_DESKTOP_PORT || contract.defaultPort);

module.exports = {
  PRODUCT_NAME: contract.productName,
  CONTRACT_VERSION: String(contract.contractVersion),
  DEFAULT_HOST: defaultHost,
  DEFAULT_PORT: defaultPort,
  ROUTES: contract.routes,
  PREVIEW: contract.preview || {},
  INTEGRATION: contract.integration,
  ERROR_CODES: contract.errorCodes,
  buildContractCandidates,
  normalizeGatewayHost,
  normalizeGatewayPort,
  raw: contract
};
