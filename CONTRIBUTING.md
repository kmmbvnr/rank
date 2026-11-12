# Contributing to Rank

Contributions must use **GPT Astra** or **Fable 5 or newer**.
Other models are not accepted, including Google models (such as Flash),
Sonnet, Luna, Terra, Sol, and models from Chinese providers.
This applies to every model used to produce the contribution, including subagents.

Include the following with your contribution:

- The exact model name and version used.
- The full text of every prompt you gave the model, including follow-up requests
  and corrections. A summary does not replace the prompt transcript.
- What changed, why it changed, and which checks you ran with their results.

Paste the prompt transcript into the pull request description or attach it as a
Markdown file. Contributions without the full prompts or with unapproved models
will not be accepted.

Before submitting, install dependencies with `npm ci` and run `npm test`.
See the [README](README.md) for system requirements and examples.

Local `npm test` runs distribute the demo type, differential and name-facts audits
across separate processes. The default leaves at least one CPU available and allows up to
one worker per 2 GiB of RAM. Set `RANK_DEMO_WORKERS=4` to choose the count, or
`RANK_DEMO_WORKERS=1` for serial demo audits. Existing explicit shard settings and CI
retain their current execution path. Each shard uses one Vitest worker; failures
keep their logs in the temporary directory printed by the runner. Corpus coverage
is checked after all shards finish.

Ordinary CI jobs have a 15-minute deadline. Corpus execution uses the bounded
arguments and test selections in `scripts/demo-audit-inputs.json`; published
demo defaults and their full-size assertions stay unchanged. Both execution
modes receive the same inputs. Static source checks still cover every demo.
Each bounded audit case has a 60-second deadline.

To run published inputs and the separate full-scale golden checks on GitHub,
dispatch CI with `full_scale=true`. Locally, `RANK_DEMO_AUDIT_SCALE=full` selects
the original corpus inputs; `RANK_FULL_SCALE=1` enables the expensive golden
checks inside ordinary interpreter test files. Run `full-scale-demos.test.ts`
and `euler-neighbours-full.test.ts` explicitly for the standalone full-scale suites.
