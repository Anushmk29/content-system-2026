#!/bin/sh
set -eu
# The web process owns only this database and never receives the PostgreSQL administrator password.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=app_password="$(cat /run/secrets/db-app-password)" <<'SQL'
CREATE ROLE studio2_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'app_password';
ALTER DATABASE studio2 OWNER TO studio2_app;
REVOKE CONNECT ON DATABASE studio2 FROM PUBLIC;
GRANT CONNECT ON DATABASE studio2 TO studio2_app;
SQL
