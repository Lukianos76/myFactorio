# End-of-session checklist

Run this before ending any session. Say "apply the end-of-session checklist" and follow it.
It takes thirty seconds and it is the only reason `state.md` and `decisions.md` stay real
instead of becoming a good intention.

1. `pnpm check` is green.
2. `docs/state.md` rewritten — it is a snapshot, replace it, do not append to it.
3. `docs/decisions.md` extended if a structuring decision was made — it is a journal,
   append only, never edit an entry in place.
4. Commits are atomic: one per logical unit.
5. Everything still open is listed in `state.md`. Nothing is left implicit.

# Start-of-session prompt

Copy this verbatim when opening a session:

> Lis `CLAUDE.md`, `docs/state.md` et `docs/decisions.md` avant toute chose.
> Puis dis-moi où on en est et ce que tu comprends de la prochaine étape,
> avant d'écrire quoi que ce soit.

The instruction to understand before acting matters as much as the reading itself.
