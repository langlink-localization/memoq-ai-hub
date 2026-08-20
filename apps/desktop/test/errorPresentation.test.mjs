import test from 'node:test';
import assert from 'node:assert/strict';

import { getLocalizedDesktopError } from '../src/renderer/src/errorPresentation.mjs';

const t = (key) => `translated:${key}`;

test('desktop errors present actionable localized secure-storage guidance', () => {
  assert.equal(
    getLocalizedDesktopError({ code: 'OS_SECRET_STORAGE_UNAVAILABLE' }, t, 'fallback'),
    'translated:feedback.secretStorageUnavailable'
  );
  assert.equal(
    getLocalizedDesktopError({ message: 'Error invoking remote method: Windows secure credential storage is unavailable.' }, t, 'fallback'),
    'translated:feedback.secretStorageUnavailable'
  );
});

test('desktop errors localize worker timeouts and preserve ordinary messages', () => {
  assert.equal(
    getLocalizedDesktopError({ code: 'DESKTOP_WORKER_REQUEST_TIMEOUT' }, t, 'fallback'),
    'translated:feedback.workerRequestTimeout'
  );
  assert.equal(getLocalizedDesktopError({ message: 'ordinary failure' }, t, 'fallback'), 'ordinary failure');
});
