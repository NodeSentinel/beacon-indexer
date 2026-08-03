#!/usr/bin/env bash

set -euo pipefail

if (($# > 0)); then
  input=(cat -- "$@")
else
  input=(cat)
fi

"${input[@]}" | perl -pe '
  s/\e\[[0-9;?]*[ -\/]*[@-~]//g;
  s{(https?://)[^/@\s]+:[^/@\s]+@}{$1<redacted>@}gi;
  s{(/beacon/)[^/?\s]+(?=/eth/)}{$1<redacted>}gi;
  s{((?:GET|POST)\s+/v2/)[^/?\s]+}{$1<redacted>}gi;
  s{(https?://[^/\s]+/v2/)[^/?\s]+}{$1<redacted>}gi;
  s~([?&](?:api[_-]?key|token|access[_-]?token|auth|secret|password)=)[^&\s,"}]+~$1<redacted>~gi;
  s~((?:authorization|proxy-authorization)"?\s*[:=]\s*"?)\s*(?:Bearer\s+)?[^\s,"}]+~$1<redacted>~gi;
  s~((?:x-api-key|api-key)"?\s*[:=]\s*"?)\s*[^\s,"}]+~$1<redacted>~gi;
'
