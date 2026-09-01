import 'dotenv/config'

/**
 * Database-backed tests truncate every table between cases, so they must never
 * point at a development database. `TEST_DATABASE_URL` is the only URL they
 * will use; without it, the DB-backed suites skip and the pure ones still run.
 *
 * This is enforced again inside `resetDatabase()`, which refuses to truncate a
 * database whose name does not look like a test database.
 */
const testUrl = process.env.TEST_DATABASE_URL
if (testUrl) {
  process.env.DATABASE_URL = testUrl
} else {
  delete process.env.DATABASE_URL
}
