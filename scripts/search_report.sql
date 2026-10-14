-- Search analytics report: paste into the Supabase SQL editor.
-- Rows come from the API's search_log table (see api/search_log.py).
-- Search-as-you-type logs prefixes ("alig", "align"), so the queries below
-- drop any query that is a prefix of a later query in the same minute.

WITH recent AS (
    SELECT * FROM search_log WHERE ts > now() - interval '30 days'
),
final AS (
    SELECT r.* FROM recent r
    WHERE NOT EXISTS (
        SELECT 1 FROM recent l
        WHERE l.id > r.id
          AND l.ts - r.ts < interval '1 minute'
          AND l.query <> r.query
          AND l.query LIKE r.query || '%'
    )
)
-- 1. Top queries
SELECT query, count(*) AS searches, round(avg(total)) AS avg_results
FROM final GROUP BY query ORDER BY searches DESC LIMIT 50;

-- 2. Zero-result queries (gaps in the corpus or in keyword matching)
-- SELECT query, count(*) AS searches
-- FROM search_log WHERE total = 0 AND ts > now() - interval '30 days'
-- GROUP BY query ORDER BY searches DESC LIMIT 50;

-- 3. Searches per day by mode
-- SELECT date_trunc('day', ts)::date AS day, mode, count(*)
-- FROM search_log WHERE ts > now() - interval '30 days'
-- GROUP BY 1, 2 ORDER BY 1 DESC, 2;
