# Verifier fragment

Paste **only** the block between the markers into the step that already checks someone
else's findings. Do not add a run.

Keep it out of the hunter's prompt. Exploration and refutation are different mindsets;
mixing them in one delegation degrades both, and the verifier ends up grading a
checklist instead of tracing code.

<!-- PASTE START -->

You did not write these candidates. Try to refute each one from repository source.
Do not contact deployed endpoints or shared services. Report exactly one verdict per
candidate.

1. Verify every trace and evidence entry: file exists, line is positive and real,
   scope and description match the code. Confirm the first entry is a real
   lower-trust entrypoint and the last is the claimed sink or boundary effect.

2. Reconstruct the strongest source-visible control on the path — validation,
   identity, authorization, normalization, lifecycle, framework, containment. Note
   comparable baseline patterns as calibration, never as grounds to dismiss.

3. If the candidate claims an observed result, reproduce the minimum effect when
   that is safe and local. Verify the inputs, interface shape, and affected
   principal or resource. Never infer a stronger result than the one observed, and
   stop once the minimum effect is established. If an OS-enforced sandbox is not
   available, do not execute; convert the exact missing capability into a blocker.

4. Check that likelihood, impact, confidence, and the proposed fix match only what
   the evidence establishes. Overall severity cannot exceed demonstrated impact.

5. Keep the fingerprint of the same source-derived root cause stable across every
   verdict. A fingerprint must not include a line, wave, agent, severity, or verdict.

Allowed verdicts:

- `confirmed` — complete source trace, bounded observed result, meaningful impact
  across a stated boundary, no visible preventing layer.
- `needs_validation` — a specific source-grounded hypothesis blocked by one exact
  fact that is neither source-visible nor locally observable. No severity. Name the
  blocker and the safe check that resolves it.
- `rejected` — source refutes the trace. Record what disproved it.

Do not report a defense-in-depth gap as a vulnerability: if one layer prevents the
attack, the absence of another is a hardening note. Do not escalate a candidate you
merely could not disprove — that is `needs_validation`, not `confirmed`.

Close with one line per candidate: `path:line — verdict — why`, then one line for the
group: `Verified: n confirmed, n needs_validation, n rejected.`

<!-- PASTE END -->

Provenance: distilled from `VALIDATION-AND-REPORTING.md:11-40` (candidate-verifier
prompt and its six steps), `HUNTING.md:140-157` (candidate gate), `SKILL.md:150-179`
(severity anchors, priority vs certainty) and `SKILL.md:181-192` (anti-patterns).
Re-diff against upstream on every skill update.
