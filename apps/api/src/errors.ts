import type { ApiError, ApiErrorCode } from "@chat0110/chat-protocol";

// Ошибка, которую можно показать пользователю. Код — из контракта api.ts,
// статус — HTTP; так роутеру не нужно гадать, во что превратить исключение.
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "HttpError";
  }

  toJSON(): ApiError {
    const out: ApiError = { error: this.message, code: this.code };
    if (this.retryAfter !== undefined) out.retry_after = this.retryAfter;
    return out;
  }
}

export const badRequest = (message: string) => new HttpError(400, "bad_request", message);
export const forbidden = (message: string) => new HttpError(403, "forbidden", message);
export const notFound = (message: string) => new HttpError(404, "not_found", message);
export const unauthorized = (message = "Нужно войти через GitHub") => new HttpError(401, "unauthorized", message);

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  privacy_unavailable: 503,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  bad_request: 400,
  rate_limited: 429,
  conflict: 409,
  dispatch_cancelled: 409,
  github_error: 502,
};

export function statusForCode(code: ApiErrorCode): number {
  return STATUS_BY_CODE[code];
}
