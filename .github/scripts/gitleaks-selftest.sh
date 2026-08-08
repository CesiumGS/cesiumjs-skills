#!/usr/bin/env bash
# Positive control for the secret scanner.
#
# The repository's .gitleaks.toml declared a single [allowlist] with no [[rules]]
# and no [extend] useDefault, which loads ZERO detection rules. Every
# check-secrets.sh history scan therefore reported "no leaks found" because it
# could not report anything else. Verified empirically: the same planted
# credential yields 2 findings with gitleaks' default rules and 0 findings with
# the rule-less config. This script fails if that state ever returns, whether by
# a config edit or by a gitleaks version bump.
#
# It asserts on the FINDING, not merely on a non-zero exit: gitleaks exits
# non-zero for a malformed config, an unknown flag, or a corrupt repository too,
# and a control that accepts any non-zero exit is its own kind of theater.
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Every step here is checked explicitly. This script deliberately runs without
# `set -e` (the `code=$?` capture below needs gitleaks' non-zero exit to be
# survivable), so an unchecked mktemp followed by `cd "$work"` would leave the
# script running in the CALLER'S repository and commit a planted credential into
# it, plus overwrite user.name/user.email. Harmless on an ephemeral runner,
# genuinely bad for a developer running `bash .github/scripts/gitleaks-selftest.sh`
# from the repo root.
work="$(mktemp -d)" || { echo "::error title=Scanner self-test inconclusive::mktemp -d failed." >&2; exit 1; }
[ -n "$work" ] && [ -d "$work" ] || { echo "::error title=Scanner self-test inconclusive::mktemp -d produced no usable directory." >&2; exit 1; }
trap 'rm -rf "$work"' EXIT

cd "$work" || { echo "::error title=Scanner self-test inconclusive::could not enter the scratch directory." >&2; exit 1; }
git init -q .
# A bare identity, deliberately not email-shaped: git accepts any string here,
# and an address-shaped literal in a tracked file trips this repository's own
# `check public-artifacts` email pattern. Do not "fix" this into an address.
git config user.email selftest
git config user.name  selftest

# The planted value is DERIVED at runtime, never written as a literal, so no
# tracked file in this repository ever contains a credential-shaped string that
# would trip the repository's own scanners (including this very scan).
#
# Shape: a GitHub personal access token, ghp_ followed by 36 [0-9a-zA-Z]. The
# body is the first 36 hex characters of a sha256 over a fixed, non-secret
# phrase, so the value is deterministic, reproducible, and obviously synthetic.
#
# Do NOT substitute the AWS example access key (the AKIA-prefixed one printed
# throughout AWS's own documentation). Recent gitleaks allowlists it as a known
# example, so a self-test planted with it reports "no leaks found" even against a
# fully armed config: the control would fail for a reason that has nothing to do
# with the config it is meant to check. Verified on 8.30.1.
#
# Do not name that key literally here either, even inside a comment. gitleaks
# 8.18.2, the version this repository pins, has an aws-access-token rule that
# matches the literal wherever it appears, comments included, so writing it out
# makes this file itself a finding. That is not hypothetical: it failed exactly
# this way once.
body="$(node -e 'process.stdout.write(require("crypto").createHash("sha256").update("cesiumjs-skills-gitleaks-selftest").digest("hex").slice(0,36))')"
if [ "${#body}" -ne 36 ]; then
  echo "::error title=Scanner self-test inconclusive::could not derive the planted token body." >&2
  exit 1
fi
printf 'github_token = "%s%s"\n' 'ghp_' "$body" > planted.txt

# Second control: a JWT, which is the shape of a Cesium ion token.
#
# This one guards the ALLOWLIST rather than the rule set. base64url is
# [A-Za-z0-9_-] and '.' is the JWT separator, so a value-shaped allowlist regex
# over dotted word-character strings silently swallows any JWT that happens to
# contain no '-', which is roughly 44% of real ion tokens. That regression
# shipped once and no existing control could see it: the ghp_ control above
# still passed, because no plausible allowlist swallows that shape.
#
# Built to be the hard case on purpose: segments are regenerated until none
# contains '-' and the signature starts with a letter or underscore, so the
# token is exactly what such an allowlist would match.
jwt="$(node -e '
const c = require("crypto");
const b64 = (s) => Buffer.from(s).toString("base64url");
const header = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
const payload = b64(JSON.stringify({ jti: "0".repeat(24), iat: 1700000000, scopes: ["assets:read"], aid: "00000" }));
let sig;
do { sig = c.randomBytes(32).toString("base64url"); } while (sig.includes("-") || !/^[A-Za-z_]/.test(sig));
if ([header, payload, sig].some((s) => s.includes("-"))) { process.exit(3); }
process.stdout.write(header + "." + payload + "." + sig);
')" || { echo "::error title=Scanner self-test inconclusive::could not derive the planted JWT." >&2; exit 1; }
printf 'ion_access_token = "%s"\n' "$jwt" > planted_jwt.txt

git add planted.txt planted_jwt.txt
git commit -qm "planted credentials for scanner self-test"

cp "$repo_root/.gitleaks.toml" .gitleaks.toml

gitleaks detect --no-banner --redact --log-opts="--all" \
  --config .gitleaks.toml --report-format json \
  --report-path "$work/report.json" >/dev/null 2>&1
code=$?

if [ "$code" -eq 0 ]; then
  echo "::error title=Secret scanner is disarmed::gitleaks did NOT detect a planted credential using this repository's .gitleaks.toml. The config almost certainly declares an [allowlist] with no [[rules]] and no '[extend] useDefault = true', which disables ALL detection rules. Every secret scan in this repository is currently a no-op." >&2
  exit 1
fi

if [ "$code" -ne 1 ]; then
  echo "::error title=Scanner self-test inconclusive::gitleaks exited $code; expected 1 (leaks found). A code other than 0 or 1 means the scanner failed to run rather than that it detected anything." >&2
  exit 1
fi

# Assert on the RULES that fired, not merely on the finding count. Counting alone
# lets one control mask the other: if the ghp_ token is detected and the JWT is
# silently allowlisted, the total is still non-zero and a count check passes
# while the ion-token hole is wide open. That is exactly how the allowlist
# regression got through the first time.
rules=$(node -e '
const f = require("fs");
try {
  const r = JSON.parse(f.readFileSync(process.argv[1], "utf8"));
  process.stdout.write([...new Set(r.map((x) => x.RuleID))].join(" "));
} catch { process.stdout.write(""); }
' "$work/report.json")

missing=""
case " $rules " in *" github-pat "*) ;; *) missing="$missing github-pat" ;; esac
case " $rules " in *" jwt "*) ;; *) missing="$missing jwt" ;; esac

if [ -n "$missing" ]; then
  echo "::error title=Secret scanner has a hole::gitleaks did not fire these rules on planted credentials:$missing. Rules that did fire: ${rules:-none}. A missing 'jwt' almost always means an [allowlist] regex is swallowing dotted base64url strings, which is the shape of a Cesium ion token; a missing 'github-pat' means the default rule set is not loaded." >&2
  exit 1
fi

echo "[gitleaks-selftest] OK: planted credentials detected by rules: $rules"
