# Skill style guide (project)

A skill is a **runtime contract for an LLM**, not a page-limited document. Its
job is to tell the model when to load it, what rules it must not break, how to
decide, what to do, and what to return.

## Core principle: information first, no quotas

- **Length follows the information.** Do not cap a skill by tokens, lines, or
  section count. A rule, a decision, or an example stays if it changes what the
  agent does.
- **Compress only when asked**, or when the same information is repeated. Do not
  pre-shrink a skill to satisfy an arbitrary number.
- **References are part of the skill.** Move catalogs, long examples, and
  background into `references/` when that makes the main contract easier to
  scan — not to hit a target. Critical rules stay in the main file.
- **Structure is a default, not a mandate.** The usual order is frontmatter,
  activation, hard rules, decision gates, execution steps, output contract, and
  references. Merge, split, or rename sections when the artifact is clearer that
  way. Never add an empty section to look compliant.

## Frontmatter

- `name` must identify the skill.
- `description` must include the trigger phrases and the scope. There is no
  arbitrary character cap; keep it discoverable and unambiguous.
- Include `license` and `metadata` when the repository has a license policy.
  Do not invent a license the repository does not have.
- `metadata` can carry `author`, `version`, `updated`, `sources`, and tags.

## Style-bearing vs style-neutral skills

- A skill that carries an aesthetic must say so in the description and separate
  its **craft** from its **named look**. Craft is reusable under any declared
  style; the look is a preset.
- A named preset is opt-in. Never make a skill's palette, typography, signature
  background, or effects the default answer for an unrelated request.
- The selected visual language comes from the project's art direction, not from
  the skill that happens to render it. A skill that cannot run without imposing
  its look must provide a craft-only mode or state that it cannot be used.
- A lane or router names a production capability, never an aesthetic. "Vector
  explainer" is a way of producing images, not a palette.
- Artistic quality is audited separately from technical correctness. A skill must
  not treat a passing technical gate as proof that the result reads.

## Body

- Write imperative runtime instructions: load X, check Y, return Z.
- Put the activation contract and the hard rules before examples.
- Use compact tables for branching decisions.
- Keep examples executable and short; move long explanations to references.
- Do not hide a critical rule below background or a long example.
- Do not add generic advice the model cannot execute.

## References

- Link local files only.
- A reference is for detail, not for quota compliance. If a rule must be read
  every time the skill loads, keep it in the main file.
- Every referenced file must exist in the installed skill directory.

## Evaluation

Judge a skill by whether an agent can:

1. Decide when to load it from the description and activation contract.
2. Execute it without the author's conversation context.
3. Follow non-contradictory hard rules and decision gates.
4. Resolve every local reference.
5. Produce the required output without guessing.

Do **not** reject a skill for length, section count, or description length
alone. Those are packaging preferences. If a downstream marketplace imposes a
hard limit, treat it as a target-specific packaging constraint, not as a
quality rule; compress for that target only.

## Output language

Generated technical artifacts default to English. User-facing conversation
follows the active persona and language. Public comments follow the target
context unless the user overrides.
