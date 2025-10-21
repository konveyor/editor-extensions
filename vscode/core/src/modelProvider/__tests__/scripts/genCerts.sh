set -euo pipefail

# Usage: ./genCerts.sh [.outdir]
OUT="${1:-.certs}"
DAYS="2"

mkdir -p "$OUT"

echo "→ Generating Root CA (valid ${DAYS} days)"
openssl genrsa -out "$OUT/ca.key" 2048 >/dev/null 2>&1
openssl req -x509 -new -nodes -key "$OUT/ca.key" -sha256 -days "$DAYS" \
  -subj "/CN=Test CA" -out "$OUT/ca.crt" >/dev/null 2>&1

echo "→ Generating server key/cert for localhost"
openssl genrsa -out "$OUT/srv.key" 2048 >/dev/null 2>&1
openssl req -new -key "$OUT/srv.key" -subj "/CN=localhost" -out "$OUT/srv.csr" >/dev/null 2>&1
cat > "$OUT/srv.ext" <<EOF
subjectAltName=DNS:localhost,IP:127.0.0.1
extendedKeyUsage=serverAuth
basicConstraints=CA:FALSE
keyUsage = digitalSignature, keyEncipherment
EOF
openssl x509 -req -in "$OUT/srv.csr" -CA "$OUT/ca.crt" -CAkey "$OUT/ca.key" -CAcreateserial -CAserial "$OUT/ca.srl" \
  -out "$OUT/srv.crt" -days "$DAYS" -sha256 -extfile "$OUT/srv.ext" >/dev/null 2>&1

echo "✓ Done. Files:"
ls -1 "$OUT" | sed "s/^/  $OUT\//"

echo
echo "Verify chain:"
echo "  openssl verify -CAfile $OUT/ca.crt $OUT/srv.crt"
