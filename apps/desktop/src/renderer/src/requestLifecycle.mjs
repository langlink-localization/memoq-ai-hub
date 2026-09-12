// Ownership for asynchronous reads. IPC cannot cancel work already dispatched,
// so consumers invalidate publication when the view changes or unmounts.
export function createRequestLifecycle() {
  let generation = 0;
  return {
    begin() {
      const requestGeneration = ++generation;
      return { isCurrent: () => generation === requestGeneration };
    },
    invalidate() { generation += 1; }
  };
}

export async function runLatestRequest(lifecycle, { load, resolve, reject, settle }) {
  const request = lifecycle.begin();
  try {
    const value = await load();
    if (!request.isCurrent()) return false;
    resolve(value);
    return true;
  } catch (error) {
    if (request.isCurrent()) reject?.(error);
    return false;
  } finally {
    if (request.isCurrent()) settle?.();
  }
}
