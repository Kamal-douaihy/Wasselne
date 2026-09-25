#!/usr/bin/env bash
# Phase 3 reproducible local smoke test, isolated from your development data.
#
# Starts (only) local postgres + redis from infra/local, creates a THROWAWAY database and a
# unique Redis key prefix, migrates it, boots the built API on a free port, and walks the
# contract-shaped sign-in flow: health, 401 without a token, OTP request, OTP verify
# (NEEDS_PROFILE), complete-profile, /me, wrong-code error body, resend-cooldown 429 with
# Retry-After, and X-Correlation-Id on responses. The throwaway database is dropped on exit.
# Exits non-zero on any failure.  Usage: npm run smoke   (requires Docker)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT_DIR/apps/api"
COMPOSE=(docker compose -f "$ROOT_DIR/infra/local/docker-compose.yml" --env-file "$ROOT_DIR/infra/local/.env")
API_PID=""
DB_NAME="wasselne_smoke_$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
REDIS_PREFIX="smoke:$DB_NAME:"
LOG_FILE="$(mktemp -t wasselne-smoke-api.XXXXXX)"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31mFAIL: %s\033[0m\n' "$1"; [[ -s "$LOG_FILE" ]] && { echo "--- API log tail ---"; tail -30 "$LOG_FILE"; }; exit 1; }

cleanup() {
  local status=$?
  if [[ -n "$API_PID" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
  "${COMPOSE[@]}" exec -T postgres psql -U "${POSTGRES_USER:-wasselne}" -d postgres -qc "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE)" >/dev/null 2>&1 || true
  "${COMPOSE[@]}" exec -T redis sh -c "redis-cli --scan --pattern '${REDIS_PREFIX}*' | xargs -r redis-cli del" >/dev/null 2>&1 || true
  rm -f "$LOG_FILE"
  exit $status
}
trap cleanup EXIT

json_field() { # $1 json, $2 dotted path; exit 1 if missing
  node -e '
    const v = process.argv[2].split(".").reduce((o, k) => (o == null ? o : o[k]), JSON.parse(process.argv[1]));
    if (v === undefined) process.exit(1);
    process.stdout.write(String(v));
  ' "$1" "$2"
}

# One request: sets HTTP_CODE, BODY and HEADERS (lower-cased) for the caller.
http() { # method path [json-body] [bearer]
  local method=$1 path=$2 body=${3:-} token=${4:-} out
  local args=(-s -D - -X "$method" "http://127.0.0.1:$API_PORT$path" -H 'content-type: application/json')
  [[ -n "$body" ]] && args+=(-d "$body")
  [[ -n "$token" ]] && args+=(-H "Authorization: Bearer $token")
  out=$(curl "${args[@]}")
  HTTP_CODE=$(printf '%s' "$out" | head -1 | awk '{print $2}')
  HEADERS=$(printf '%s' "$out" | sed -n '1,/^\r$/p' | tr -d '\r' | tr 'A-Z' 'a-z')
  BODY=$(printf '%s' "$out" | sed '1,/^\r$/d')
}
expect() { [[ "$HTTP_CODE" == "$1" ]] || fail "$2: expected HTTP $1, got $HTTP_CODE ($BODY)"; }
has_header() { printf '%s' "$HEADERS" | grep -q "^$1:" || fail "missing response header $1"; }

[[ -f "$ROOT_DIR/infra/local/.env" ]] || cp "$ROOT_DIR/infra/local/.env.example" "$ROOT_DIR/infra/local/.env"
set -a; . "$ROOT_DIR/infra/local/.env"; set +a

log "Starting postgres and redis"
"${COMPOSE[@]}" up -d postgres redis
for i in $(seq 1 40); do
  ready=1
  for svc in postgres redis; do
    cid=$("${COMPOSE[@]}" ps -q "$svc")
    [[ -n "$cid" && "$(docker inspect -f '{{.State.Health.Status}}' "$cid")" == "healthy" ]] || ready=0
  done
  [[ $ready == 1 ]] && break
  [[ $i == 40 ]] && fail "postgres/redis did not become healthy in 40s"
  sleep 1
done

log "Creating throwaway database $DB_NAME"
"${COMPOSE[@]}" exec -T postgres psql -U "${POSTGRES_USER:-wasselne}" -d postgres -qc "CREATE DATABASE \"$DB_NAME\""

API_PORT=$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
export API_PORT NODE_ENV=development SMS_ADAPTER=dev OTP_RESEND_INTERVAL_S=30 REDIS_KEY_PREFIX="$REDIS_PREFIX"
export DATABASE_URL="postgres://${POSTGRES_USER:-wasselne}:${POSTGRES_PASSWORD:-wasselne_local}@127.0.0.1:${POSTGRES_PORT:-5432}/$DB_NAME"
export REDIS_URL="redis://127.0.0.1:${REDIS_PORT:-6379}"
export JWT_ACCESS_SECRET="smoke-test-only-secret-not-used-anywhere-else"

log "Migrating and building"
(cd "$API_DIR" && npm run --silent db:migrate | tail -3 && npm run --silent build)

log "Starting the API on port $API_PORT"
(cd "$API_DIR" && exec node dist/main.api.js) >"$LOG_FILE" 2>&1 &
API_PID=$!
for i in $(seq 1 30); do
  kill -0 "$API_PID" 2>/dev/null || fail "API process exited during startup"
  curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1 && break
  [[ $i == 30 ]] && fail "API did not become healthy in 30s"
  sleep 1
done

log "GET /health"
http GET /health; expect 200 "health"; echo "$BODY"
[[ "$(json_field "$BODY" status)" == "ok" ]] || fail "/health not ok"

log "GET /v1/me without a token -> 401 NOT_AUTHENTICATED with correlation id"
http GET /v1/me; expect 401 "/v1/me unauthenticated"
[[ "$(json_field "$BODY" code)" == "NOT_AUTHENTICATED" ]] || fail "wrong error code: $BODY"
has_header x-correlation-id; json_field "$BODY" correlation_id >/dev/null || fail "no correlation_id in error body"

PHONE="+9613$((RANDOM % 9000000 + 1000000))"
log "POST /v1/auth/otp/request"
http POST /v1/auth/otp/request "{\"phone_e164\":\"$PHONE\",\"app\":\"RIDER\"}"; expect 200 "otp request"; echo "$BODY"
has_header x-correlation-id
CHALLENGE_ID=$(json_field "$BODY" challenge_id); json_field "$BODY" resend_after >/dev/null
printf '%s' "$BODY" | grep -q dev_code && fail "response must not contain the code"

log "Immediate second request -> 429 OTP_RATE_LIMITED with Retry-After"
http POST /v1/auth/otp/request "{\"phone_e164\":\"$PHONE\",\"app\":\"RIDER\"}"; expect 429 "resend cooldown"
[[ "$(json_field "$BODY" code)" == "OTP_RATE_LIMITED" ]] || fail "wrong code: $BODY"
has_header retry-after

log "Wrong code -> 400 OTP_INVALID"
http POST /v1/auth/otp/verify "{\"challenge_id\":\"$CHALLENGE_ID\",\"code\":\"000000\"}"
expect 400 "wrong code"
[[ "$(json_field "$BODY" code)" == "OTP_INVALID" ]] || fail "wrong code: $BODY"

log "Reading the dev code from Redis (the API never returns it) and verifying"
CODE=$("${COMPOSE[@]}" exec -T redis redis-cli GET "${REDIS_PREFIX}dev:sms:$CHALLENGE_ID" | tr -d '\r\n')
[[ -n "$CODE" ]] || fail "dev SMS code not found in Redis"
http POST /v1/auth/otp/verify "{\"challenge_id\":\"$CHALLENGE_ID\",\"code\":\"$CODE\"}"; expect 200 "otp verify"
[[ "$(json_field "$BODY" status)" == "NEEDS_PROFILE" ]] || fail "expected NEEDS_PROFILE for a new number: $BODY"
NP_TOKEN=$(json_field "$BODY" needs_profile_token)

log "POST /v1/me/complete-profile -> 201"
http POST /v1/me/complete-profile '{"first_name":"Smoke","last_name":"Test","gender":"FEMALE","accepted_legal_version_ids":[]}' "$NP_TOKEN"
expect 201 "complete-profile"
ACCESS=$(json_field "$BODY" access_token)

log "GET /v1/me with the issued token"
http GET /v1/me "" "$ACCESS"; expect 200 "/v1/me"; echo "$BODY"
[[ "$(json_field "$BODY" phone_e164)" == "$PHONE" ]] || fail "/v1/me returned the wrong account"

log "PASS: isolated database $DB_NAME, port $API_PORT, contract-shaped sign-in flow verified (dropped on exit)"
