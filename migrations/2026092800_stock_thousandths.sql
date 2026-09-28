-- Shares are now stored as whole thousandths (12.785 shares → 12785), so a share can be bought to 3
-- decimals (src/components/units.ts). Converts every STOCK row, which was stored in hundredths.
-- CRYPTO and OPTION rows keep their own scales, and SPLIT rows have NULL shares.
UPDATE transactions SET shares = shares * 10 WHERE sec_type = 'STOCK';

-- holdings and tx_history hold quantities at the old scale. Both are rebuilt from transactions for
-- every member at startup (rebuildAll), so empty them rather than convert them.
DELETE FROM holdings;
DELETE FROM tx_history;
