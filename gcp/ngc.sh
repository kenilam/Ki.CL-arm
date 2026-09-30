#!/usr/bin/env bash
# Puts the NGC API key from NGC_API_KEY in this shell into Secret Manager, lets
# the machine's service account read it, and has the machine log Docker in to
# nvcr.io with it. The key goes to Secret Manager over TLS and from there to
# the machine; it is never written here or passed over ssh. Run again with a
# new key to rotate it; without NGC_API_KEY it only redoes the login.
source "$(dirname "$0")/env.sh"

account="$(gcloud compute instances describe "$NAME" --zone "$ZONE" --project "$PROJECT" --format='value(serviceAccounts[0].email)')"

if [ -n "${NGC_API_KEY:-}" ]; then
  if gcloud secrets describe "$NGC_SECRET" --project "$PROJECT" >/dev/null 2>&1; then
    printf '%s' "$NGC_API_KEY" | gcloud secrets versions add "$NGC_SECRET" --project "$PROJECT" --data-file=- >/dev/null
    echo "secret $NGC_SECRET: new version"
  else
    printf '%s' "$NGC_API_KEY" | gcloud secrets create "$NGC_SECRET" --project "$PROJECT" --replication-policy automatic --data-file=- >/dev/null
    echo "secret $NGC_SECRET: created"
  fi
fi

gcloud secrets add-iam-policy-binding "$NGC_SECRET" \
  --project "$PROJECT" \
  --member "serviceAccount:$account" \
  --role roles/secretmanager.secretAccessor >/dev/null
echo "$account may read it"

gcloud compute ssh "$NAME" --zone "$ZONE" --project "$PROJECT" --tunnel-through-iap --quiet --command \
  "gcloud secrets versions access latest --secret '$NGC_SECRET' | sudo docker login nvcr.io --username '\$oauthtoken' --password-stdin" \
  2>/dev/null | grep -iE "succeeded|error|denied" || true
