-- The previous session's close beside each price (Yahoo's chartPreviousClose), so views can show
-- the day's move: price − prev_close per share, coin or option share. NULL when Yahoo gave none,
-- and for prices stored before this column existed until the next fetch replaces them.
ALTER TABLE prices ADD COLUMN prev_close REAL;
