# Idu-pi

Telegram bridge for controlling a local Pi coding-agent session from a private Telegram bot.

## What it does

- Accepts messages only from `ALLOWED_USER_ID`.
- Sends prompts to a persistent Pi RPC session.
- Returns Pi output to Telegram.
- Supports project/session commands such as `/projects`, `/useproject`, `/trabajos`, `/ver`, `/resume`, `/last`, `/resumen`, `/mem`, `/agents`, and `/testlab`.
- Keeps secrets and local runtime state outside Git.

## Requirements

- Node.js with Corepack enabled.
- Pi CLI installed locally.
- A Telegram bot token from BotFather.
- Your numeric Telegram user id from `@userinfobot`.

## Quick setup on Windows

First run:

```text
setup-pi-telegram-bridge.bat
```

Normal start:

```text
start-pi-telegram-bridge.bat
```

The startup script validates `.env`, installs dependencies if needed, builds the project, and starts the bot.

## Manual setup

```bash
corepack pnpm install
cp .env.example .env
```

Edit `.env` with your real local values:

```env
TELEGRAM_BOT_TOKEN=replace_with_botfather_token
ALLOWED_USER_ID=123456789
DEFAULT_CWD=/absolute/path/to/your/project
ALLOWED_ROOTS=/absolute/path/to/your/project
PI_BIN=pi
PI_EXTRA_ARGS=--no-skill-registry --no-lens
PI_AGENT_PROFILES=default|Pi default
AGENT_WORKSPACE_ROOT=/absolute/path/to/bridge-agents
AGENT_WORKSPACE_MODE=clone
```

Then run:

```bash
corepack pnpm dev
```

## Telegram usage

```text
/doctor
/agents
/useproject
/trabajos
/ver T1
/nametrabajo T1 maintenance
/resume T1
/resumen
/mem login auth
/mode interactive
fix the tests in this project
```

`/trabajos` uses explicit work-session selectors like `T1`, `T2`, etc. Other menus may use their own numeric or id-based selectors.

## Test labs

Lab agents run in clone workspaces. The default/direct profile is excluded from lab execution.

```text
/testlab quick
/testlab2 3tests
/testlab3
/testlab1
/gentest_model_lab
/triagereports
/reports
/report <id>
/report <id> defer
/report <id> work
/report <id> ignore
/syncreports
```

Valid depths: `quick`, `3tests`, `5tests`, `full`.

## Agent profiles

Configure selectable Pi profiles with `PI_AGENT_PROFILES`:

```env
PI_AGENT_PROFILES=default|Pi default;codex|GPT Codex|--model provider/model
```

Format:

```text
id|Visible label|optional extra args;other_id|Other label|optional args
```

Each Pi profile keeps its own persistent RPC session per project.

## Security

- Never commit `.env`.
- Never commit bot tokens, API keys, local project registries, or runtime state.
- Keep `ALLOWED_ROOTS` as narrow as possible.
- Prefer `/mode interactive` for risky operations.

## Development

```bash
corepack pnpm build
corepack pnpm test
```
