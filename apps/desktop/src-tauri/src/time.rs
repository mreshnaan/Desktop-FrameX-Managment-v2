use chrono::{SecondsFormat, Utc};

// Plain `to_rfc3339()` uses microsecond precision and a `+00:00` offset;
// apps/api's zod `datetime()` schemas only accept millisecond precision with
// a literal `Z` (JS's `toISOString()` shape) -- use this everywhere instead.
pub fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
