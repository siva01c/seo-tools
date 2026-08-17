#!/usr/bin/env sh
# Blocks commits that would publish internal infrastructure details.
#
# seo-tools is a PUBLIC repository. Internal Docker service names, host IPs, mail relays and
# real operator mailboxes belong in .env / private ops docs — never in tracked files. A leaked
# hostname is not a credential, but it hands an attacker the internal topology for free (this
# repo is a crawler, i.e. an SSRF-prone class of app — see docs/security.md).
#
# Escape hatch: put `allow-internal-ref` in a comment on the same line for a deliberate
# exception. Run with --all to scan every tracked file instead of just the staged ones.

set -eu

SELF="scripts/check-no-internal-refs.sh"

# Internal container names (<service>-<n>: or known service hostnames), the production VPS IP,
# the mail relay, and operator mailboxes. Deliberately published contact addresses
# (info@/privacy@/gdpr@/dpo@/contact@) are excluded — a GDPR data-controller contact belongs
# in the privacy notice, unlike an internal ops mailbox.
PATTERN='[a-z0-9][a-z0-9-]*-(assistant|nginx|mcp|gateway)-[0-9]+|(sales-assistant|ragchat|osintbot|seo-tools|mcpserver)[a-z0-9-]*:[0-9]{2,5}|[a-z0-9.-]+@ludekkvapil\.cz|185\.8\.165\.241|mail\.gigaserver\.cz'
PUBLIC_CONTACTS='(info|privacy|gdpr|dpo|contact)@ludekkvapil\.cz'

if [ "${1:-}" = "--all" ]; then
    FILES=$(git ls-files)
else
    FILES=$(git diff --cached --name-only --diff-filter=ACM)
fi

FOUND=0
for f in $FILES; do
    [ -f "$f" ] || continue
    [ "$f" = "$SELF" ] && continue
    case "$f" in
        package-lock.json | *.lock) continue ;;
    esac
    hits=$(grep -nEI "$PATTERN" "$f" 2>/dev/null |
        grep -v 'allow-internal-ref' |
        grep -vE "$PUBLIC_CONTACTS" || true)
    if [ -n "$hits" ]; then
        if [ "$FOUND" -eq 0 ]; then
            echo "✖ Internal infrastructure details found in tracked files:"
            echo
        fi
        FOUND=1
        echo "$hits" | while IFS= read -r line; do
            echo "  $f:$line"
        done
    fi
done

if [ "$FOUND" -ne 0 ]; then
    cat <<'EOF'

seo-tools is a PUBLIC repo. Replace these with placeholders (mail-api:8000,
noreply@example.com, …) and keep the real values in .env or a private ops doc.
If a match is deliberate, add `allow-internal-ref` in a comment on the same line.
EOF
    exit 1
fi

exit 0
