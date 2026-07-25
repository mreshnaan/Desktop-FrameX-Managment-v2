use chrono::{SecondsFormat, Utc};

// `Utc::now().to_rfc3339()` emits RFC3339 with a `+00:00` offset and
// microsecond precision (e.g. "2026-07-25T00:13:26.391634+00:00"). Zod's
// `z.string().datetime()` (used by every apps/api sync/timestamp schema)
// only accepts the JS `Date::toISOString()` shape: millisecond precision
// with a literal `Z`. Every Rust-originated timestamp must go through this
// so it round-trips through validation instead of being silently rejected.
pub fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
