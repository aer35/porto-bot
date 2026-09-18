-- Human-facing transaction references (BS01, SS02, SP01). Users type these into /amend and
-- /delete; the integer id stays the primary key and is never shown.
ALTER TABLE transactions ADD COLUMN ref TEXT;

-- Next number to hand out per prefix. A counter never goes backwards, so a deleted
-- transaction's reference is never reused by a later one.
CREATE TABLE ref_counters (
  prefix TEXT PRIMARY KEY,
  next INTEGER NOT NULL
);

-- Backfill rows written before this migration, numbering each type oldest first.
WITH numbered AS (
  SELECT id,
         CASE WHEN sec_type = 'SPLIT' THEN 'SP' WHEN side = 'BUY' THEN 'BS' ELSE 'SS' END AS prefix,
         ROW_NUMBER() OVER (
           PARTITION BY CASE WHEN sec_type = 'SPLIT' THEN 'SP' WHEN side = 'BUY' THEN 'BS' ELSE 'SS' END
           ORDER BY id
         ) AS seq
  FROM transactions
)
UPDATE transactions
SET ref = (SELECT printf('%s%02d', prefix, seq) FROM numbered WHERE numbered.id = transactions.id);

-- Seed the counters past the highest backfilled number of each type.
INSERT INTO ref_counters (prefix, next)
SELECT substr(ref, 1, 2), MAX(CAST(substr(ref, 3) AS INTEGER)) + 1
FROM transactions
GROUP BY substr(ref, 1, 2);

CREATE UNIQUE INDEX transactions_ref ON transactions (ref);
