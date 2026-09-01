export class ForbiddenError extends Error {
  readonly code = 'FORBIDDEN'
}
export class NotFoundError extends Error {
  readonly code = 'NOT_FOUND'
}
export class ConflictError extends Error {
  readonly code = 'CONFLICT'
}
