#!/usr/bin/env bash
# Deploys migrations and Edge Functions to the app's single Supabase project (dev builds and the Play
# Store app both use it, so every deploy here is live).
#
#   scripts/supabase-deploy.sh functions [name ...]   all three functions, or the named ones
#   scripts/supabase-deploy.sh db                     migrations (dry run first, then confirm)
#
# npm shortcuts: functions:deploy, db:push.
#
# The project ref isn't secret (it's in the app's Supabase URL), so it lives here. The database URL
# contains the password: it's read from SUPABASE_DB_URL for this run only and never written
# anywhere. Edge Function deploys need `npx supabase login` once (or SUPABASE_ACCESS_TOKEN).
set -euo pipefail

REF="cudmaszrwrbgwsoizajd"
FUNCTIONS=(api sync-push fx-refresh push-send)

die() { echo "error: $*" >&2; exit 1; }

usage() {
  sed -n '5,6p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

[ $# -ge 1 ] || usage
ACTION=$1
shift

cd "$(dirname "$0")/.."
SUPABASE=(npx --no-install supabase)

confirm() {
  echo
  echo "LIVE project ($REF): $1"
  read -r -p "Continue? [y/N] " yn
  [[ "$yn" =~ ^[Yy]$ ]] || die "Aborted."
}

deploy_functions() {
  local names=("$@")
  (( ${#names[@]} > 0 )) || names=("${FUNCTIONS[@]}")
  for name in "${names[@]}"; do
    [ -d "supabase/functions/$name" ] || die "No function supabase/functions/$name"
  done
  confirm "deploy Edge Functions: ${names[*]}"
  for name in "${names[@]}"; do
    echo "→ $name"
    # All three check their own auth (user token in sync-push, x-cron-secret in the cron targets).
    "${SUPABASE[@]}" functions deploy "$name" --project-ref "$REF" --use-api --no-verify-jwt
  done
}

push_migrations() {
  local url=${SUPABASE_DB_URL:-}
  if [ -z "$url" ]; then
    echo "Database URL (Dashboard → Connect → Session pooler, with your DB password)."
    read -r -s -p "SUPABASE_DB_URL: " url
    echo
  fi
  [ -n "$url" ] || die "No database URL."
  # Pooler (postgres.<ref>@…) and direct (db.<ref>.supabase.co) URLs both contain the ref.
  [[ "$url" == *"$REF"* ]] || die "That database URL isn't for project $REF."

  echo "Pending migrations:"
  "${SUPABASE[@]}" db push --db-url "$url" --dry-run
  confirm "apply the migrations listed above"
  "${SUPABASE[@]}" db push --db-url "$url"
}

case "$ACTION" in
  functions) deploy_functions "$@" ;;
  db)
    (( $# == 0 )) || die "db takes no extra arguments."
    push_migrations
    ;;
  *) usage ;;
esac
