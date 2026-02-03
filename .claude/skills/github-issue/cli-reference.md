# GitHub CLI Quick Reference

## Issue Commands

```bash
# List open issues
gh issue list

# View issue details
gh issue view 123

# Create issue (use GraphQL instead if using labels)
gh issue create --title "Title" --body "Body"

# With labels (fails if label doesn't exist)
gh issue create --title "Title" --label "bug" --body "..."

# Edit issue
gh issue edit 123 --add-label "needs-review"
gh issue edit 123 --title "New title"

# Close with comment
gh issue close 123 --comment "Fixed in #456"

# Reopen
gh issue reopen 123
```

## Label Commands

```bash
# List labels
gh label list

# Create label
gh label create "needs-review" \
  --description "Auto-generated, needs human review" \
  --color "FBCA04"

# Delete label
gh label delete "old-label"
```

## Get Issue Node ID (for GraphQL)

```bash
gh issue view 123 --json id --jq ".id"
# Returns: I_kwDO...
```

## Link PR to Issue

In PR body, use:

- `Fixes #123` - Closes issue when PR merges
- `Closes #123` - Same as Fixes
- `Resolves #123` - Same as Fixes
- `Ref #123` - Links without closing

## Project Commands

```bash
# Create issue in project
gh issue create --title "..." --project "Sprint 23" --body "..."

# Add existing issue to project
gh project item-add PROJECT_NUMBER --owner OWNER --url ISSUE_URL
```
