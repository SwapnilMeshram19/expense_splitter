#!/usr/bin/env bash
# Deploys migrations and Edge Functions to one Supabase project, chosen explicitly.
#
#   scripts/supabase-deploy.sh <dev|prod> functions [name ...]   all three functions, or the named ones
#   scripts/supabase-deploy.sh <dev|prod> db                     migrations (dry run first, then confirm)
#
# npm shortcuts: functions:deploy, functions:deploy:prod, db:push:dev, db:push:prod.
#
# Project refs aren't secret (they're in every app bundle's Supabase URL), so they live here.
# The database URL contains the password: it's read from SUPABASE_DB_URL for this run only and never
# written anywhere. Edge Function deploys need `npx supabase login` once (or SUPABASE_ACCESS_TOKEN).
#
# Production asks you to type its ref before touching anything. Dev migrations normally arrive by
# themselves (Supabase GitHub integration on push to main); `db:push:dev` is the manual fallback.
set -euo pipefail

DEV_REF="cudmaszrwrbgwsoizajd"
# Set once the production project exists (docs/production-supabase.md, step 1), then commit.
PROD_REF=""

FUNCTIONS=(sync-push fx-refresh push-send)

die() { echo "error: $*" >&2; exit 1; }

usage() {
  sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

[ $# -ge 2 ] || usage
TARGET=$1
ACTION=$2
shift 2

case "$TARGET" in
  dev) REF=$DEV_REF ;;
  prod)
    REF=$PROD_REF
    [ -n "$REF" ] || die "PROD_REF is empty in $0. Create the production project first (docs/production-supabase.md)."
    [ "$REF" != "$DEV_REF" ] || die "PROD_REF is the dev project's ref."
    ;;
  *) usage ;;
esac

[[ "$REF" =~ ^[a-z0-9]{20}$ ]] || die "'$REF' doesn't look like a Supabase project ref (20 lowercase letters/digits)."

cd "$(dirname "$0")/.."
SUPABASE=(npx --no-install supabase)

confirm_prod() {
  [ "$TARGET" = prod ] || return 0
  echo
  echo "PRODUCTION ($REF): $1"
  read -r -p "Type the production ref to continue: " typed
  [ "$typed" = "$REF" ] || die "Aborted: '$typed' is not $REF."
}

deploy_functions() {
  local names=("$@")
  (( ${#names[@]} > 0 )) || names=("${FUNCTIONS[@]}")
  for name in "${names[@]}"; do
    [ -d "supabase/functions/$name" ] || die "No function supabase/functions/$name"
  done
  confirm_prod "deploy Edge Functions: ${names[*]}"
  for name in "${names[@]}"; do
    echo "→ $name → $TARGET ($REF)"
    # All three check their own auth (user token in sync-push, x-cron-secret in the cron targets).
    "${SUPABASE[@]}" functions deploy "$name" --project-ref "$REF" --use-api --no-verify-jwt
  done
}

push_migrations() {
  local url=${SUPABASE_DB_URL:-}
  if [ -z "$url" ]; then
    echo "Database URL for $TARGET (Dashboard → Connect → Session pooler, with your DB password)."
    read -r -s -p "SUPABASE_DB_URL: " url
    echo
  fi
  [ -n "$url" ] || die "No database URL."
  # Both the pooler (postgres.<ref>@…) and direct (db.<ref>.supabase.co) URLs contain the ref, so
  # this catches pasting the other project's URL.
  [[ "$url" == *"$REF"* ]] || die "That database URL isn't for $TARGET ($REF)."

  echo "Pending migrations for $TARGET ($REF):"
  "${SUPABASE[@]}" db push --db-url "$url" --dry-run
  confirm_prod "apply the migrations listed above"
  if [ "$TARGET" = dev ]; then
    read -r -p "Apply them to dev? [y/N] " yn
    [[ "$yn" =~ ^[Yy]$ ]] || die "Aborted."
  fi
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
