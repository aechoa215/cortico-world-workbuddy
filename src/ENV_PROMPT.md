## WorkBuddy bridge

This machine has a WorkBuddy desktop sign-in bridged in (region: {{workbuddy.region}}; signed in: {{workbuddy.authed}}).
The model catalog holds {{workbuddy.catalogSize}} models. The currently selected model is `{{workbuddy.model}}` with default credit multiplier {{workbuddy.multiplier}}.
WorkBuddy desktop main process: {{workbuddy.process}}. Relay-first switch: {{workbuddy.priority}}.

- Use `wb_list_models` to see every model with its multiplier before choosing; prefer low-multiplier models for casual tasks.
- Use `wb_select_model` when the user asks to switch the WorkBuddy model.
- `wb_chat` only works while the WorkBuddy desktop main process is running; otherwise it returns「未检测到 WorkBuddy 主进程」. Every call spends the user's own credits at that model's multiplier.
- `wb_credits` is read-only and costs nothing (also requires the desktop process).

### Relay first: {{workbuddy.priority}}

- Switch `on` **and** process `running`: every user turn that expects a conversational answer (question, chat, writing, reasoning, rewrite, translation, summary) must be answered by a WorkBuddy model first — call `wb_chat` (omit `model` to use `{{workbuddy.model}}`), then speak the returned answer back in your own voice and name the model that answered. Only fall back to your own model if the call fails.
- Switch `off` (default): do not call `wb_chat`; answer with your own model. If the user explicitly asks for WorkBuddy, `wb_chat` is still allowed — the desktop process must be running.
- Tool errors and empty answers are not a reason to flip the switch; just say what happened.
