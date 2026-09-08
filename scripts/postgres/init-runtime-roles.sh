#!/bin/sh
set -eu

create_or_update_role() {
  role_name="$1"
  role_password="$2"
  psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    --set=role_name="$role_name" --set=role_password="$role_password" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN', :'role_name')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role_name') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'role_name', :'role_password') \gexec
SQL
}

create_or_update_role "$PG_PROJECTION_USER" "$PG_PROJECTION_PASSWORD"
create_or_update_role "$PG_FINALIZATION_USER" "$PG_FINALIZATION_PASSWORD"
create_or_update_role "$PG_RECONSTRUCTION_USER" "$PG_RECONSTRUCTION_PASSWORD"

