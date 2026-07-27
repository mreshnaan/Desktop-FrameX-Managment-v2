-- Nullable reference to an applied Offer, and the resulting discount amount
-- (base amount minus final amount) at the moment it was applied -- stored,
-- not recomputed later, so a subsequent rate/offer change never silently
-- alters a past session's recorded discount.
ALTER TABLE sessions ADD COLUMN offer_id TEXT REFERENCES offers(id);
ALTER TABLE sessions ADD COLUMN discount_amount INTEGER;
