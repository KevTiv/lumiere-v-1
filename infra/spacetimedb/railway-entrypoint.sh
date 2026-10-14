#!/bin/sh
set -eu

port="${PORT:-3000}"
case "$port" in
  ''|*[!0-9]*)
    echo "lumiere-spacetimedb: PORT must be numeric" >&2
    exit 1
    ;;
esac
if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
  echo "lumiere-spacetimedb: PORT is outside 1-65535" >&2
  exit 1
fi

mkdir -p /data/auth
chown -R 1000:1000 /data

exec su -s /bin/sh spacetime -c "exec spacetime start \
  --listen-addr 0.0.0.0:${port} \
  --data-dir /data \
  --jwt-pub-key-path /data/auth/id_ecdsa.pub \
  --jwt-priv-key-path /data/auth/id_ecdsa \
  --non-interactive"
