#!/bin/bash
# Hook: PostToolUse for Bash
# Compresses verbose stdout on successful commands to save agent context tokens.
# Failed commands pass through unmodified so the agent can debug.

INPUT=$(cat)

EXIT_CODE=$(echo "$INPUT" | jq -r '.tool_response.exit_code // 0')
STDOUT=$(echo "$INPUT" | jq -r '.tool_response.stdout // empty')

# Failed commands or empty output: pass through
if [ "$EXIT_CODE" != "0" ] || [ -z "$STDOUT" ]; then
  exit 0
fi

LINE_COUNT=$(echo "$STDOUT" | wc -l | tr -d ' ')

# Short output: pass through as-is
if [ "$LINE_COUNT" -le 30 ]; then
  exit 0
fi

# Compress: first 5 + last 10 lines
HIDDEN=$((LINE_COUNT - 15))

cat >&2 <<EOF
Command succeeded. Output compressed: ${LINE_COUNT} lines → first 5 + last 10 (${HIDDEN} hidden).

$(echo "$STDOUT" | head -5)

... (${HIDDEN} lines hidden) ...

$(echo "$STDOUT" | tail -10)
EOF

exit 2
