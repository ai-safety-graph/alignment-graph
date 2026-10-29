---
name: review-pr
description: AI-first code review of a PR or branch with escalation to human verification. Use before merging any PR, or when asked to "review this PR", "review the branch", or "is this ready to merge". Applies .claude/review-rules.md, gives an ESCALATE or AI-CLEARED verdict, and posts it as a PR comment.
---

# Review a PR

Argument: a PR number, a branch name, or nothing (current branch).

The rules live in `.claude/review-rules.md`. Read it first and apply it as
written; don't restate or loosen it here.

## 1. Resolve the target

- PR number given: `gh pr view <n> --json number,headRefName,baseRefName,headRefOid,url`.
- Branch or nothing: `gh pr view <branch> --json ...` for that branch. If no PR
  exists, review `git diff main...<branch>` locally and skip posting (step 5).
- Get the diff: `gh pr diff <n>` (or `git diff main...<branch>`), plus the file
  list with `gh pr diff <n> --name-only`.

## 2. Check the risk paths

Match the changed files and diff hunks against every rule in the "Risk paths"
table. Record each triggered rule with the files that triggered it. Do this
yourself, deterministically. Don't leave it to the reviewer.

## 3. Run the AI review in a fresh context

Spawn a `general-purpose` subagent so the review doesn't share the context of
the session that wrote the code. Give it:

- the PR number or branch, and how to fetch the diff (it can read any file in the repo for context);
- the full text of `.claude/review-rules.md`;
- the instruction to look for correctness bugs and invariant violations, trace
  each candidate to a concrete failure before reporting it, and return a list of
  findings with `file:line`, severity, confidence and a one-sentence failure
  scenario. Say there are no findings rather than padding the list.

Don't take the subagent's findings on trust: open each cited location and drop
any finding that doesn't hold up.

## 4. Decide the verdict

Apply the "Escalation rule" from the rules file to the triggered risk paths
(step 2) and the surviving findings (step 3). Fill in the verdict comment
template, with one "Human verification" checklist item per triggered rule and
per escalating finding.

## 5. Show, then post

Print the verdict comment to the user. The repo is public, so post only after
the user confirms:

- Look for an existing review comment:
  `gh api repos/{owner}/{repo}/issues/<n>/comments --paginate --jq '.[] | select(.body | startswith("<!-- ai-review -->")) | .id'`
- If one exists, update it: `gh api -X PATCH repos/{owner}/{repo}/issues/comments/<id> -F body=@<file>`.
- Otherwise: `gh pr comment <n> --body-file <file>`.

Write the body to a file in the scratchpad directory first, not inline, so the
markdown survives quoting.

## 6. Offer a fix pass

If there are findings, offer to fix them on the PR branch. After the fixes are
committed and pushed, re-run this skill so the comment reflects the new head.
On ESCALATE, remind the user that the checklist items are theirs to verify;
don't tick them on their behalf.
