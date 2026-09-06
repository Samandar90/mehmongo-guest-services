/**
 * Its own module so the money kernel can raise the same error the repository
 * does without importing the repository, which would put lib/admin/money.ts in
 * an import cycle with lib/admin/requests.ts and drag Supabase in behind it.
 * lib/admin/requests.ts re-exports both names, so existing imports still work.
 */
export type AdminRequestErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'REQUEST_NOT_FOUND'
  | 'RETRY_FAILED';

export class AdminRequestError extends Error {
  constructor(readonly code: AdminRequestErrorCode, message: string = code) {
    super(message);
    this.name = 'AdminRequestError';
  }
}
