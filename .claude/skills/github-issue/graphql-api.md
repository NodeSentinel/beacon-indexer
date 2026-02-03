# GitHub GraphQL API for Issues

Use GraphQL for reliable issue creation. The `gh issue create --label` command fails if labels don't exist.

## Get Repository ID (Required Once)

```bash
gh api graphql -f query='
query {
  repository(owner: "OWNER", name: "REPO") {
    id
  }
}'
# Returns: {"data":{"repository":{"id":"R_kgDO..."}}}
```

## Create Issue

```bash
gh api graphql -f query='
mutation($repositoryId: ID!, $title: String!, $body: String!) {
  createIssue(input: {
    repositoryId: $repositoryId
    title: $title
    body: $body
  }) {
    issue {
      id
      number
      url
    }
  }
}' -f repositoryId="R_kgDO..." -f title="Issue title" -f body="$(cat <<'EOF'
## Objective
...

## Acceptance Criteria
- [ ] ...
EOF
)"
```

## Add Labels After Creation

```bash
# Safe - won't fail if label missing
gh issue edit 123 --add-label "feature" --add-label "auth"
```

## Link Sub-Issue to Epic

```bash
# Get node IDs
PARENT_ID=$(gh issue view 122 --json id --jq ".id")
CHILD_ID=$(gh issue view 123 --json id --jq ".id")

# Link sub-issue to parent
gh api graphql \
  -H "GraphQL-Features: sub_issues" \
  -f query='
    mutation($parentId: ID!, $childId: ID!) {
      addSubIssue(input: { issueId: $parentId, subIssueId: $childId }) {
        issue { title number }
        subIssue { title number }
      }
    }
  ' \
  -f parentId="$PARENT_ID" \
  -f childId="$CHILD_ID"
```

## Complete Workflow Script

**CRITICAL**: All operations MUST be in a SINGLE script to minimize permission prompts.

```bash
#!/bin/bash
# ALL OPERATIONS IN ONE SCRIPT - Single permission prompt

set -e

# 1. Get repo info dynamically
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
OWNER=$(echo "$REPO" | cut -d'/' -f1)
NAME=$(echo "$REPO" | cut -d'/' -f2)

# 2. Get repo ID
REPO_ID=$(gh api graphql -f query="query { repository(owner: \"$OWNER\", name: \"$NAME\") { id } }" -q '.data.repository.id')

# 3. Create epic
EPIC=$(gh api graphql -f query='
mutation($repoId: ID!, $title: String!, $body: String!) {
  createIssue(input: { repositoryId: $repoId, title: $title, body: $body }) {
    issue { number id }
  }
}' -f repoId="$REPO_ID" -f title="[Epic] Feature Name" -f body="Epic description...")
EPIC_NUM=$(echo "$EPIC" | jq -r '.data.createIssue.issue.number')
EPIC_ID=$(echo "$EPIC" | jq -r '.data.createIssue.issue.id')

# 4. Create sub-issues
ISSUE1=$(gh api graphql -f query='
mutation($repoId: ID!, $title: String!, $body: String!) {
  createIssue(input: { repositoryId: $repoId, title: $title, body: $body }) {
    issue { number id }
  }
}' -f repoId="$REPO_ID" -f title="Sub-issue 1" -f body="Issue body...")
ISSUE1_NUM=$(echo "$ISSUE1" | jq -r '.data.createIssue.issue.number')
ISSUE1_ID=$(echo "$ISSUE1" | jq -r '.data.createIssue.issue.id')

# Repeat for additional sub-issues...

# 5. Link sub-issues to epic (may not be available on all repos)
gh api graphql \
  -H "GraphQL-Features: sub_issues" \
  -f query='mutation($parentId: ID!, $childId: ID!) {
    addSubIssue(input: { issueId: $parentId, subIssueId: $childId }) {
      issue { number }
    }
  }' \
  -f parentId="$EPIC_ID" \
  -f childId="$ISSUE1_ID" 2>/dev/null || true

# 6. Add labels to all issues
for issue in $EPIC_NUM $ISSUE1_NUM; do
  gh issue edit "$issue" --add-label "needs-review" --repo "$REPO" 2>/dev/null || true
done

echo "Created Epic #$EPIC_NUM with sub-issues"
```

## Why GraphQL Over CLI

| Method                        | Missing Labels                 |
| ----------------------------- | ------------------------------ |
| `gh issue create --label "X"` | **Fails**                      |
| GraphQL + `gh issue edit`     | Succeeds, skips missing labels |
