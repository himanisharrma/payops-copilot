export class DomainError extends Error {
  constructor(
    message: string,
    public status: 400 | 401 | 403 | 404 | 409 | 503,
  ) {
    super(message);
  }
}
