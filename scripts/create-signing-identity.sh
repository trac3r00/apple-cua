#!/usr/bin/env bash
# Creates the dedicated signing keychain + self-signed code-signing identity for apple-cua.
# Run once per machine. The keychain lives next to this script; the private key never leaves it.
set -euo pipefail
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KC="$dir/apple-cua-signing.keychain-db"
PASS="apple-cua-local-signing"
openssl req -x509 -newkey rsa:3072 -nodes -days 3650 \
	-subj "/CN=apple-cua dev/O=apple-cua local" \
	-addext "keyUsage=digitalSignature" \
	-addext "extendedKeyUsage=codeSigning" \
	-keyout "$dir/signing.key" -out "$dir/signing.crt"
openssl pkcs12 -export -legacy -out "$dir/signing.p12" -inkey "$dir/signing.key" -in "$dir/signing.crt" -passout "pass:$PASS"
security create-keychain -p "$PASS" "$KC" 2>/dev/null || true
security import "$dir/signing.key" -k "$KC" -T /usr/bin/codesign -P ""
security import "$dir/signing.crt" -k "$KC" -T /usr/bin/codesign
security add-trusted-cert -r trustRoot -k "$KC" "$dir/signing.crt"
security set-key-partition-list -S apple-tool:,apple: -s -k "$PASS" "$KC" >/dev/null
security find-identity -p codesigning -v "$KC"
echo "identity ready; sign with APPLE_CUA_CODESIGN_ID='apple-cua dev' APPLE_CUA_CODESIGN_KEYCHAIN=$KC"
