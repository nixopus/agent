---
name: self-heal
description: Self-healing loop for failed deployments — diagnose, fix, redeploy up to 3 attempts, then escalate or rollback. Load when a deployment fails or build errors occur.
metadata:
  version: "1.0"
---

# Self-Heal

## Flow (max 3 attempts)
On build_failed: get_deployment_logs → diagnose → write fix → push via branch+PR if needed → redeploy → resume monitoring.
- Do not stop to ask the user unless the fix is ambiguous or requires credentials you do not have.
- After each failed attempt, tell the user what broke and what you are trying next.
- Maximum 3 self-heal attempts.
- After 3 failures, read_skill("rollback-strategy") to decide whether to rollback or escalate.
- If escalation is required, tell the user plainly that you could not complete the deployment automatically and that a Nixopus team member will reach out shortly to help finish it.
