#!/usr/bin/env sh
set -eu

PUBLIC_PORT="${PORT:-10000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
BACKEND_PORT="${BACKEND_PORT:-8080}"

export FRONTEND_PORT
export BACKEND_PORT
export PUBLIC_PORT

envsubst '${PUBLIC_PORT} ${FRONTEND_PORT} ${BACKEND_PORT}' \
  < /app/deploy/nginx.conf.template \
  > /etc/nginx/conf.d/default.conf

/app/bin/backend &
backend_pid=$!

HOSTNAME=0.0.0.0 PORT="${FRONTEND_PORT}" node /app/frontend/server.js &
frontend_pid=$!

shutdown() {
  kill "${backend_pid}" "${frontend_pid}" 2>/dev/null || true
}

trap shutdown INT TERM

nginx -g 'daemon off;' &
nginx_pid=$!

wait "${nginx_pid}"
