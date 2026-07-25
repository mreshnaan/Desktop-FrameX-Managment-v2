// Rust-side counterpart to src/config/branding.ts -- the two can't literally
// share one file across the TS/Rust boundary, so this is the single place
// any Rust code should read the app's name from, instead of a second
// hardcoded copy of the string. Keep this equal to branding.ts's
// appShortName, lowercased.
pub const APP_SHORT_NAME: &str = "framex";
