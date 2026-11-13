/**
 * The disposable database the integration tests run against, read from
 * TEST_DATABASE_URL. Returns undefined when it is not set.
 *
 * The tests insert and delete rows, so a database whose name does not contain
 * "test" is refused. The URL itself is never printed: it contains the password.
 */
export function testDatabaseUrl(): string | undefined {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return undefined;
  let name: string;
  try {
    name = decodeURIComponent(new URL(url).pathname.slice(1));
  } catch {
    throw new Error("TEST_DATABASE_URL is not a valid postgres:// URL.");
  }
  if (!/test/i.test(name)) {
    throw new Error(`Refusing to run integration tests against database "${name}": its name must contain "test".`);
  }
  return url;
}
