## Description

<!-- This becomes the "What's new" section of the release, so write it for someone who runs the
     bot, not for a reviewer: what they can now do, in a few lines or short bullets. -->

## Upgrade notes

<!-- What a host has to do when they update: re-register commands, back up first, a setting that
     changed, anything that breaks an existing setup. Write "None." if there is nothing. This
     carries into the release as-is. -->

None.

## Changes

<!-- One bullet per meaningful change, for the reviewer. Skip what is obvious from the diff. -->

-

## Testing

<!-- The steps you actually ran, and what they showed. Delete what does not apply. -->

- [ ] `npm test`
- [ ] `docker compose up -d` and the bot logs in
- [ ] `docker compose run --rm porto-bot node dist/register.js`
- [ ] Ran the affected commands in a test server:
- [ ] `VERSION` bumped, if this should publish a release

## Notes for the reviewer

<!-- Anything untested, any follow-up left for later, any decision worth a second opinion.
     Say plainly what has not been verified. -->
