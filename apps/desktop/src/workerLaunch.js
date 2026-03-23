function buildWorkerForkOptions(baseEnv = {}) {
  return {
    env: {
      ...baseEnv,
      ELECTRON_RUN_AS_NODE: '1'
    },
    execArgv: [],
    windowsHide: true,
    silent: true
  };
}

module.exports = {
  buildWorkerForkOptions
};
