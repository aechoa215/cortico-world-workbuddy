# ENV\_PROMPT

## WorkBuddy bridge

This machine has a WorkBuddy desktop sign-in bridged in (region: {{workbuddy.region}}; signed in: {{workbuddy.authed}}).
The model catalog holds {{workbuddy.catalogSize}} models. The currently selected model is `{{workbuddy.model}}` with default credit multiplier {{workbuddy.multiplier}}.

- Use `wb_list_models` to see every model with its multiplier before choosing; prefer low-multiplier models for casual tasks.
- Use `wb_select_model` when the user asks to switch the WorkBuddy model.
- Use `wb_chat` only when the user explicitly wants a WorkBuddy model to answer; every call spends the user's own credits at that model's multiplier.
- `wb_credits` is read-only and costs nothing.
