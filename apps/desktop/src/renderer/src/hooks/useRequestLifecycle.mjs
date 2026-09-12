import { useEffect, useRef } from 'react';
import { createRequestLifecycle } from '../requestLifecycle.mjs';

export function useRequestLifecycle() {
  const lifecycleRef = useRef(null);
  if (!lifecycleRef.current) lifecycleRef.current = createRequestLifecycle();
  useEffect(() => () => lifecycleRef.current.invalidate(), []);
  return lifecycleRef.current;
}
