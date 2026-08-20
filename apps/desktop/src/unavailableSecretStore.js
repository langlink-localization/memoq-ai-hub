const DEFAULT_ERROR_CODE = 'OS_SECRET_STORAGE_UNAVAILABLE';

function createUnavailableSecretStore(options = {}) {
  const message = String(options.message || 'Secure credential storage is unavailable in this runtime mode.');

  function unavailableError() {
    const error = new Error(message);
    error.code = DEFAULT_ERROR_CODE;
    error.statusCode = 503;
    return error;
  }

  return {
    ready: async () => {},
    handleMessage() {},
    has() {
      return false;
    },
    async get() {
      return '';
    },
    async set() {
      throw unavailableError();
    },
    async delete() {}
  };
}

module.exports = {
  createUnavailableSecretStore
};
