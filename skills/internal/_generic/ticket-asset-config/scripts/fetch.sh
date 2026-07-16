#!/bin/sh
set -eu

ticket_number=${1:-}
case "$ticket_number" in
  ''|*[!0-9]*)
    echo "Usage: fetch.sh <numeric-ticket-number>" >&2
    exit 2
    ;;
esac

if [ -n "${SCOGO_API_TOKEN:-}" ] && [ -n "${SCOGO_ORG_ID:-}" ]; then
  scogo_token=$SCOGO_API_TOKEN
  scogo_org_id=$SCOGO_ORG_ID
else
  auth_file=${SCOGO_AUTH_FILE:-"$HOME/.sia/scogo-auth.json"}
  if [ ! -r "$auth_file" ]; then
    echo "Scogo authentication not found. Sign in to SIA and retry." >&2
    exit 3
  fi
  if ! command -v jq >/dev/null 2>&1; then
    echo "jq is required to read SIA authentication." >&2
    exit 4
  fi
  scogo_token=$(jq -er '.accessToken | select(type == "string" and length > 0)' "$auth_file") || {
    echo "SIA authentication has no accessToken. Sign in again and retry." >&2
    exit 3
  }
  scogo_org_id=$(jq -er '.activeOrgId | select(type == "string" and length > 0)' "$auth_file") || {
    echo "SIA authentication has no activeOrgId. Select an active organisation and retry." >&2
    exit 3
  }
fi

exec curl -sS --fail-with-body \
  "https://api.production.scogo.in/v1/asset-configs/search?ticket_number=$ticket_number" \
  --header "Authorization: Bearer $scogo_token" \
  --header "x-org-id: $scogo_org_id"
