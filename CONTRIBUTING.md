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
