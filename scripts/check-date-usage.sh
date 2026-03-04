#!/usr/bin/env bash
# Guardrail: detect forbidden raw Date usage outside dateOnly utility.
# Exit 1 if violations found.

PATTERNS='new Date\(|\.getDate\(\)|\.setDate\(|\.getUTCDate\(\)|\.setUTCDate\(|\.toISOString\(\)|Date\.parse\(|Date\.UTC\('
EXCLUDE_FILES='src/utils/dateOnly\.ts|\.test\.|\.spec\.|test/setup'

VIOLATIONS=$(grep -rn -E "$PATTERNS" src/ \
  | grep -v -E "$EXCLUDE_FILES" \
  | grep -v 'node_modules' \
  || true)

if [ -n "$VIOLATIONS" ]; then
  echo "❌ Forbidden raw Date usage found outside dateOnly utility:"
  echo ""
  echo "$VIOLATIONS"
  echo ""
  echo "Use functions from src/utils/dateOnly.ts instead."
  exit 1
else
  echo "✅ No forbidden Date usage found."
  exit 0
fi
