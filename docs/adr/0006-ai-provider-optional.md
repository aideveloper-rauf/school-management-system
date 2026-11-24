# ADR 0006 — AI drafting is optional, curriculum-only, and ships without a provider

**Status:** accepted (provider choice pending) · **Date:** 24 November 2026

## Context

instruction.md requires AI features to be off by default, never to receive identifying student data, and to produce drafts
for human review only. The pilot school has not decided whether to use AI at all (P0-9), and adding a provider means a new
runtime dependency, an external data flow and an API key per installation.

## Decision

- Build the framework now: `AiProvider` interface, installation switch (`FEATURE_AI`) **and** school opt-in
  (`schools.ai_enabled`), curriculum-only prompts with a personal-data guard, validation of provider output, drafts that
  must be saved and reviewed like any other question, and audit without prompt/output text.
- Ship **no provider** in this release. `createAiProvider` returns null, so AI cannot be switched on by configuration
  alone.
- When a school approves the data flow, add a Claude provider using the official `@anthropic-ai/sdk` (structured output via
  `client.messages.parse` + zod, model `claude-opus-5-5`) — a reviewed dependency change, not a runtime toggle.

## Consequences

- No external AI calls are possible from a default installation.
- Enabling AI later is a small, reviewable code change plus `ANTHROPIC_API_KEY` in the installation's environment.
