#!/bin/bash
# P7: checks this lab's own CSS against the family's CSS standard (the rule that colours
# come from tokens, never literals, outside token definition lines and the vendored
# shared stylesheet). Pattern copied from coding-agents-LAB's scripts/check-css.sh; this
# copy is repo-local so CI needs no checkout of another repo.
#
# Vendored files are NOT this lab's CSS to fix (standalone-ui.css, the floating-dialog,
# evidence and tokenchain copies) — they are skipped; their integrity is the sha pins'
# job (scripts/check-ui-standard.sh, web/src/floating-dialog.pin.test.js, no-ai-demo2).
# Usage: scripts/check-css.sh
set -u
root="$(cd "$(dirname "$0")/.." && pwd)"
fail=0

css_files() {
  find "$root/web/src" -name '*.css' -not -path '*/node_modules/*' -not -path '*/dist/*' 2>/dev/null |
    grep -v -E 'styles/standalone-ui\.css|floating-dialog/|evidence/|components/tokenchain/|return-link/|tokens\.css'
}

check() { # $1 label, $2 regex, $3 "fail"|"report"
  local label="$1" pattern="$2" mode="$3" hits
  hits="$(for f in $(css_files); do grep -n -E "$pattern" "$f" 2>/dev/null | sed "s|^|$f:|"; done)"
  if [ -n "$hits" ]; then
    echo "$hits" | head -20 | sed 's/^/    /'
    n=$(echo "$hits" | wc -l | tr -d ' ')
    if [ "$mode" = "fail" ]; then echo "  FAIL  $label ($n)"; fail=1; else echo "  note  $label ($n)"; fi
  else
    echo "  ok    $label"
  fi
}

# Colour literals are allowed on a token DEFINITION line (--x: #hex, the tokens.css and
# diagram-overlay re-pins) and inside a var() fallback (var(--x, #fff)); what fails is a
# literal used directly as a value.
# A literal inside a var() fallback (var(--x, #fff)) is the standard's allowed form.
strip_var_fallbacks() { perl -pe 's/var\([^()]*(?:\([^()]*\)[^()]*)*\)/VAR()/g'; }
hits="$(for f in $(css_files); do grep -n -E '(^|[^-a-zA-Z0-9()])(background|color|border(-[a-z]+)?|outline|fill|stroke|box-shadow|text-shadow):[^;]*#[0-9a-fA-F]{3,8}' "$f" 2>/dev/null | grep -v ':[[:space:]]*--' | strip_var_fallbacks | grep -E '#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(' | sed "s|^|$f:|"; done)"
if [ -n "$hits" ]; then
  echo "$hits" | head -20 | sed 's/^/    /'
  n=$(echo "$hits" | wc -l | tr -d ' ')
  echo "  FAIL  colour literals (use tokens) ($n)"; fail=1
else
  echo "  ok    colour literals (use tokens)"
fi
check "no prefers-color-scheme outside the vendored files" '@media[^{]*prefers-color-scheme' fail
check "no !important" '!important' fail
check "no italics" 'font-style:[[:space:]]*italic' fail

exit $fail
