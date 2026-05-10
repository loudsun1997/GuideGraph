# Real Postgres Tests

This repo can run the Postgres storage adapter against a real local Postgres server.

## Local Database

This machine has a disposable local database for FlowForge tests:

```text
database: flowforge_test
role: flowforge_test
```

The password is stored in the ignored local file:

```text
.env.local
```

That file contains:

```text
DATABASE_URL=postgres://flowforge_test:<password>@localhost:5432/flowforge_test
```

Do not commit `.env.local`.

## Run

```sh
pnpm test:postgres:real
```

The test script sets `FLOWFORGE_REAL_POSTGRES=1`. The test reads `DATABASE_URL` from the shell first, then falls back to `.env.local`.

## Recreate

If the local database needs to be recreated, use Postgres 17 tools:

```sh
PG_BIN=/opt/homebrew/opt/postgresql@17/bin
DB_NAME=flowforge_test
ROLE_NAME=flowforge_test
PASSWORD="$(openssl rand -hex 24)"

"$PG_BIN/psql" -d postgres -v ON_ERROR_STOP=1 -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$ROLE_NAME') THEN CREATE ROLE $ROLE_NAME LOGIN PASSWORD '$PASSWORD'; ELSE ALTER ROLE $ROLE_NAME LOGIN PASSWORD '$PASSWORD'; END IF; END \$\$;"

DB_EXISTS="$("$PG_BIN/psql" -d postgres -tAc "select 1 from pg_database where datname = '$DB_NAME'")"
if [ "$DB_EXISTS" != "1" ]; then
  "$PG_BIN/createdb" -O "$ROLE_NAME" "$DB_NAME"
fi

umask 077
printf "DATABASE_URL=postgres://%s:%s@localhost:5432/%s\n" "$ROLE_NAME" "$PASSWORD" "$DB_NAME" > .env.local
```
