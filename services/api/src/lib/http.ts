export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function unauthorized(message = 'Unauthorized') {
  return new HttpError(401, message);
}

export function notFound(message = 'Not found') {
  return new HttpError(404, message);
}

export function badRequest(message = 'Bad request') {
  return new HttpError(400, message);
}
