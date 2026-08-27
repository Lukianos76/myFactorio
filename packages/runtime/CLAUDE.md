# @myfactorio/runtime

## Owns

- Pack discovery, manifest validation, dependency resolution, and registration order.
- The failure vocabulary a player actually reads when content is missing or broken.

## Must never

- Branch on which pack is the base one (invariant 6). The shipped content pack is discovered,
  validated and ordered exactly like a third-party mod, and `loadPacks` takes no argument naming a
  privileged one — there is no privilege to name (ADR-0046).
- Throw. Every failure is a `Result`, because the shell has to open a window and show the message
  rather than die before it draws anything.
- Depend on enumeration order. Entries are sorted before anything else, and the topological sort
  breaks ties by id. Sort with `a < b` on code units, or an `Intl.Collator` pinned to a fixed
  locale if a linguistic order is ever genuinely needed — **never bare `localeCompare`**, whose
  result depends on the player's machine locale and silently reorders content between players.
  That reorders handle assignment, which reorders buffer contents. The lint bans it because the
  determinism test cannot catch it: that test runs in one locale and goes green.
