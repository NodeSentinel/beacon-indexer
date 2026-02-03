# Issue Templates

## Single Issue Template

```markdown
## Objective

{One sentence describing the goal}

## Scope

- {What's included}
- {What's included}

## Acceptance Criteria

- [ ] {Verifiable outcome}
- [ ] {Verifiable outcome}
- [ ] {Verifiable outcome}

## Out of Scope

- {Explicitly excluded}
- {Explicitly excluded}

## How to Test

- [ ] Unit tests for {component}
- [ ] Integration tests for {flow}
- [ ] Manual: {verification steps}

## Technical Notes

{Optional: implementation hints, suggested approach}
```

## Epic Template

```markdown
## Objective

{High-level goal for the entire feature}

## Scope

- {Major component 1}
- {Major component 2}
- {Major component 3}

## Acceptance Criteria

- [ ] All sub-issues completed
- [ ] E2E tests passing
- [ ] {Feature-specific criteria}

## Out of Scope

- {Related feature not included}
- {Future enhancement}

## Technical Context

- {Tech stack notes}
- {Architecture decisions}
```

## Preview File Template

When user chooses "Review first", create this in scratchpad:

```markdown
# Issues Preview: {Feature Name}

## Epic

**Title:** {epic title}
**Labels:** epic

**Body:**
{full epic body}

---

## Sub-Issue 1

**Title:** {issue title}
**Labels:** {labels}

**Body:**
{full issue body}

---

## Sub-Issue 2

**Title:** {issue title}
**Labels:** {labels}

**Body:**
{full issue body}

---

## Dependency Graph

{Optional: ASCII diagram showing issue relationships}
```

## Examples

### Bug Report

```markdown
## Objective

Fix the null pointer exception when user submits empty form.

## Scope

- Add null check in FormHandler.validate()
- Return appropriate error message

## Acceptance Criteria

- [ ] Empty form submission shows "Please fill required fields" error
- [ ] No crash occurs
- [ ] Existing valid submissions still work

## Out of Scope

- Form redesign
- Additional validation rules

## How to Test

- [ ] Unit test: FormHandler.validate(null) returns error
- [ ] E2E: Submit empty form, verify error message
- [ ] Manual: Test with various empty field combinations
```

### Feature Request

```markdown
## Objective

Add dark mode toggle to user settings.

## Scope

- Toggle component in settings page
- CSS variables for dark theme
- Persist preference in localStorage

## Acceptance Criteria

- [ ] Toggle switches between light/dark mode
- [ ] Preference persists across sessions
- [ ] All pages respect the theme setting
- [ ] No flash of wrong theme on page load

## Out of Scope

- System preference detection (future enhancement)
- Per-page theme overrides

## How to Test

- [ ] Unit tests for theme toggle logic
- [ ] E2E: Toggle theme, refresh, verify persistence
- [ ] Manual: Check all pages in both modes
```
