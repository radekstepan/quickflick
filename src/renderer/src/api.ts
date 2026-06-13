import type { Api } from '@shared/types';

// The contextBridge exposes window.api; we re-export for convenience.
export const api: Api = window.api;
