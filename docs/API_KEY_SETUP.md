# Setting up an API key

There are two ways to use it:

- **Directly in the app (simplest)**: open Settings → Tink, choose "My own API key", then choose a provider:
  - **Anthropic (Claude)**: paste the key, choose a model, tap "Test connection". The steps for creating a key and setting a spend cap are in sections 1 and 2 below.
  - **OpenAI-compatible API**: any provider, see section 7.

  The key is stored only in this phone's secure storage and sent only to the matching address.

- **For the local model relay service (developers)**: put it in the `.env` at the repository root as in section 3. The relay service supports only Claude.

M3 needs a Claude API key to connect to the real AI. **Without a key the app works as usual**, using the mock AI (the rule parser).

> A Claude Pro/Max subscription cannot replace an API key: it is explicitly not allowed to use a claude.ai login or subscription quota in a product you develop yourself (see the [Agent SDK docs](https://code.claude.com/docs/en/agent-sdk/overview)). The API is billed by usage, and the cost during development is very low (see section 4).

## 1. Create a key

1. Open the [Claude Console](https://platform.claude.com/) and sign in (register if you have no account), and add a payment method as prompted.
2. Go to the [API keys page](https://platform.claude.com/settings/keys) and click **Create key**:
   - **Name**: for example `morph-dev`.
   - **Expiry**: choose a period (for example 90 days) and replace the key when it expires.
   - **Linked account**: choose yourself (for personal development).
   - **Workspace**: choose a workspace (`Default` is fine). **You must choose one**: a key not bound to a workspace needs an extra workspace parameter on every request.
3. Copy the key. It starts with `sk-ant-` and **is shown only this once**; if lost, it can only be recreated.

## 2. Set a spend cap (strongly recommended)

Go to the [Billing page](https://platform.claude.com/settings/billing), click **Set limit** under **Spend limits**, and enter a development-period cap, for example **$10/month**.

After the cap is reached, requests are rejected and no further charges are made. It resumes next month or after you raise the cap. The app automatically falls back to the mock AI.

## 3. Put the key into the project

Run this at the repository root (only once):

```bash
cp .env.example .env
```

Open the root `.env` in an editor and put the key after the equals sign, with no quotes or spaces:

```
ANTHROPIC_API_KEY=sk-ant-api03-……
```

Check that it is filled in. This command only checks the format and does not display the key:

```bash
grep -q '^ANTHROPIC_API_KEY=sk-ant-' .env && echo "filled in" || echo "not filled in yet"
```

Check that it will not be committed to git:

```bash
git check-ignore -q .env && echo "Safe: will not be committed" || echo "Danger: will be committed, do not commit yet"
```

## 4. Usage and switching models

After starting the model relay service, the terminal shows the model in use (without a key it cannot be used; the app's built-in rules do not need it):

```bash
npm run api
```

The default model is `claude-haiku-5-5` (P-010). To change the model, add one line to `.env` (all three models passed 22/22 in the eval):

```
MORPH_AI_MODEL=claude-opus-5-5
```

To test a model with the eval set (it costs a little; one Haiku round is about $0.004):

```bash
npm run eval -- --model claude-haiku-5-5
```

## 5. Roughly how much it costs

These are averages measured on 2026-10-22 with the 22 eval cases (system prompt cached):

| Model             | Input / output (per million tokens) | About per change | About per 1000 |
| ----------------- | ----------------------------------- | ---------------- | -------------- |
| Claude Haiku 5.5  | $0.10 / $0.50                       | $0.0002          | $0.2           |
| Claude Sonnet 5.5 | $2 / $10                            | $0.003           | $3             |
| Claude Opus 5.5   | $4 / $20                            | $0.005           | $5             |

Prices follow the [official pricing](https://platform.claude.com/docs/en/about-claude/pricing). Haiku is the default (DECISIONS P-010). Actual usage can be seen on the Console's [Usage page](https://platform.claude.com/usage).

## 6. Security rules

- **The key goes only in the root `.env`**, read only by the server (`apps/api` in M3).
- It must **never** be written into the phone app's code, nor into variables starting with `EXPO_PUBLIC_`: such variables are bundled into the app and anyone can extract them.
- **Do not paste the key into a chat**, including to Claude Code. Claude Code does not read the contents of `.env` and only uses the section 3 commands to check the format.
- If you suspect a leak: immediately delete this key on the [API keys page](https://platform.claude.com/settings/keys) and create a new one.

## 7. Using a key from another provider (OpenAI-compatible API, D-241)

Settings → Tink → "My own API key" → "OpenAI-compatible API", then fill in, in order:

1. **Base URL**: tapping a provider button fills it in for you, or you can enter your own. The app appends `/chat/completions` and `/models` to it.

   | provider          | Base URL                                                  |
   | ----------------- | --------------------------------------------------------- |
   | OpenAI            | `https://api.openai.com/v1`                               |
   | OpenRouter        | `https://openrouter.ai/api/v1`                            |
   | DeepSeek          | `https://api.deepseek.com/v1`                             |
   | Gemini            | `https://generativelanguage.googleapis.com/v1beta/openai` |
   | Groq              | `https://api.groq.com/openai/v1`                          |
   | Ollama (local)    | `http://localhost:11434/v1`                               |
   | LM Studio (local) | `http://localhost:1234/v1`                                |

2. **Model name**: as written in the provider's docs (OpenRouter needs a prefix, for example `vendor/model`).
3. Tap "Save address and model", then enter the **key**. A local model needs no key.
4. Tap "Test connection": the app requests `GET {Base URL}/models` (uses no tokens) and checks the address, the key, and whether the model name is in the list.

Things to note:

- **Only Claude has been tested.** Other models get the same instructions, and their replies go through the same checks and one correction pass, so a wrong change is blocked and not applied directly; but they are more likely to misunderstand or refuse.
- **The address must be `https://`**; `http://` is only for `localhost`, `127.0.0.1` and `[::1]`. On a phone `localhost` is the phone itself, so for the phone to reach Ollama on a Mac you need to give it an https address (for example Tailscale Serve, a Cloudflare Tunnel or a reverse proxy with a certificate). In the iOS simulator `localhost` is this Mac, so it can be used directly.
- **Changing the address deletes this key**, so it is not sent to the new address. The Anthropic key and this key are stored separately, so switching provider never sends the Anthropic key to anyone else.
- What is sent is the same as with Claude: the UI config and what you say, not files or records. It goes to the provider you chose and is handled under that provider's terms.
- You pay the cost on your account with that provider; setting a spend cap there is recommended.
