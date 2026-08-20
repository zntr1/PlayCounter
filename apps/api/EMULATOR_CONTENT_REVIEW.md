# Reviewing shared emulator matches

Manual picks wait in `emulator_content_suggestions`; matching never reads that
table. Only an explicitly curated `emulator_content_identifiers` row is served
automatically. Anonymous install counts are advisory and never auto-approve.

## What the submitter sees

The desktop polls review outcomes through the normal community contribution
feed. Approval and rejection are delivered once through PlayCounter's standard
notifications; rejected matches do not keep a permanent status badge.

Keep rejected suggestion rows and set `status = 'rejected'`: deleting a row
prevents the submitter from receiving the decision. A rejected content/game
tuple remains closed, so posting it again returns the existing rejection rather
than reopening moderation. Revocation must both reject the suggestion and
delete its curated identifier, as shown below.

## Queue

```sql
SELECT s.emulator_id, s.content_kind, s.content_value, s.game_id,
       g.name AS game, g.igdb_id, s.created_at, count(sub.id) AS installs
FROM emulator_content_suggestions s
JOIN igdb_games g ON g.id = s.game_id
LEFT JOIN emulator_content_submissions sub
  ON (sub.emulator_id, sub.content_kind, sub.content_value, sub.game_id)
   = (s.emulator_id, s.content_kind, s.content_value, s.game_id)
WHERE s.status = 'pending'
GROUP BY s.emulator_id, s.content_kind, s.content_value, s.game_id,
         g.name, g.igdb_id, s.created_at
ORDER BY installs DESC, s.created_at ASC;
```

## Approve

This status-scoped statement is atomic. A conflicting curated game makes the
partial unique index reject and roll back the whole statement.

```sql
WITH approved AS (
  UPDATE emulator_content_suggestions
  SET status = 'approved', review_note = NULL,
      reviewed_at = now(), updated_at = now()
  WHERE emulator_id = 'dosbox' AND content_kind = 'program'
    AND content_value = 'doom3.exe' AND game_id = 42
    AND status = 'pending'
  RETURNING emulator_id, content_kind, content_value, game_id
)
INSERT INTO emulator_content_identifiers
  (emulator_id, content_kind, content_value, game_id, confidence)
SELECT emulator_id, content_kind, content_value, game_id, 'curated'
FROM approved
ON CONFLICT (emulator_id, content_kind, content_value, game_id)
DO UPDATE SET confidence = 'curated';
```

## Reject

```sql
UPDATE emulator_content_suggestions
SET status = 'rejected', review_note = 'Wrong game',
    reviewed_at = now(), updated_at = now()
WHERE emulator_id = 'dosbox' AND content_kind = 'program'
  AND content_value = 'doom3.exe' AND game_id = 99
  AND status = 'pending';
```

## Revoke

```sql
WITH revoked AS (
  UPDATE emulator_content_suggestions
  SET status = 'rejected', review_note = 'Superseded',
      reviewed_at = now(), updated_at = now()
  WHERE emulator_id = 'dosbox' AND content_kind = 'program'
    AND content_value = 'doom3.exe' AND game_id = 42
    AND status = 'approved'
  RETURNING emulator_id, content_kind, content_value, game_id
)
DELETE FROM emulator_content_identifiers i
USING revoked r
WHERE (i.emulator_id, i.content_kind, i.content_value, i.game_id)
    = (r.emulator_id, r.content_kind, r.content_value, r.game_id)
  AND i.confidence = 'curated';
```

Delete a wrong curated row; never demote it to `candidate`. A single candidate
is returned as `probable` and is auto-applied by the desktop.

## Drift audit

```sql
SELECT s.*
FROM emulator_content_suggestions s
LEFT JOIN emulator_content_identifiers i
  ON i.emulator_id = s.emulator_id
 AND i.content_kind = s.content_kind
 AND i.content_value = s.content_value
 AND i.game_id = s.game_id
 AND i.confidence = 'curated'
WHERE s.status = 'approved' AND i.game_id IS NULL;
```

Rows returned here are reported to clients as pending, never already curated.
Re-approve or reject them deliberately.
