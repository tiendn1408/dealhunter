-- Migration: 000005_matching.down.sql
-- Description: Drop product_match_suggestions table

DROP TABLE IF EXISTS product_match_suggestions CASCADE;
