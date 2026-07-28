// Mirrors apps/web's src/lib/shared/utils/money.ts calcTimeAmount/calcFrameAmount.

pub fn duration_minutes(start: &str, end: &str) -> i64 {
    if start.is_empty() || end.is_empty() {
        return 0;
    }
    let parse = |s: &str| -> Option<(i64, i64)> {
        let mut parts = s.split(':');
        let h: i64 = parts.next()?.parse().ok()?;
        let m: i64 = parts.next()?.parse().ok()?;
        Some((h, m))
    };
    let (Some((sh, sm)), Some((eh, em))) = (parse(start), parse(end)) else {
        return 0;
    };
    let mut mins = (eh * 60 + em) - (sh * 60 + sm);
    if mins < 0 {
        mins += 24 * 60;
    }
    mins
}

pub fn calc_time_amount(start: &str, end: &str, hour_rate: i64, half_rate: i64) -> i64 {
    let mins = duration_minutes(start, end);
    let hours = mins / 60;
    let rem = mins % 60;
    let mut amt = hours * hour_rate;
    if rem > 0 {
        amt += if half_rate > 0 {
            (half_rate as f64 * (rem as f64 / 30.0)) as i64
        } else {
            (hour_rate as f64 * (rem as f64 / 60.0)) as i64
        };
    }
    amt
}

pub fn calc_frame_amount(rate: i64) -> i64 {
    rate
}

// Applies one Offer's effect to an already-computed base amount, returning
// (final_amount, discount_amount). extraTime reduces the billable duration
// before the caller's own rate math would apply -- callers pass the
// *already rate-multiplied* base amount for extraTime too, since the
// reduced-duration recompute happens in sessions.rs (money.rs stays a pure
// amount-in/amount-out function, matching calc_time_amount/calc_frame_amount's
// existing shape) via a separate helper below.
pub fn apply_discount_effect(base_amount: i64, effect_type: &str, effect_value: i64) -> (i64, i64) {
    let final_amount = match effect_type {
        "percentOff" => ((base_amount as f64) * ((100 - effect_value.clamp(0, 100)) as f64) / 100.0).round() as i64,
        "flatOff" => (base_amount - effect_value).max(0),
        // "extraTime" is handled by the caller recomputing calc_time_amount on a
        // reduced duration and passing the result here as base_amount with
        // effect_value 0, so this function's job for that case is a no-op --
        // the discount is simply base_amount(full duration) - base_amount(reduced).
        _ => base_amount,
    };
    (final_amount, (base_amount - final_amount).max(0))
}

// The extraTime-specific piece: how many minutes are actually billable after
// N minutes are given free. Floors at 0 -- a session shorter than the free
// allowance is simply billed as 0 minutes, never negative.
pub fn billable_minutes_after_extra_time(actual_minutes: i64, free_minutes: i64) -> i64 {
    (actual_minutes - free_minutes).max(0)
}

// Same math as calc_time_amount, but takes an already-known duration instead
// of re-deriving one from a start/end pair. Used only by the offer-effect
// recompute path in sessions.rs: after an extraTime offer reduces the actual
// duration by its free-minutes allowance, there is no real "reduced end
// time" to hand to calc_time_amount's string-based API, only a minute count.
pub fn calc_time_amount_for_duration(minutes: i64, hour_rate: i64, half_rate: i64) -> i64 {
    let hours = minutes / 60;
    let rem = minutes % 60;
    let mut amt = hours * hour_rate;
    if rem > 0 {
        amt += if half_rate > 0 {
            (half_rate as f64 * (rem as f64 / 30.0)) as i64
        } else {
            (hour_rate as f64 * (rem as f64 / 60.0)) as i64
        };
    }
    amt
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn charges_only_the_hourly_rate_for_exact_hours() {
        assert_eq!(calc_time_amount("09:00", "11:00", 200, 100), 400);
    }

    #[test]
    fn adds_the_half_hour_rate_for_a_30_minute_remainder() {
        assert_eq!(calc_time_amount("09:00", "10:30", 200, 100), 300);
    }

    #[test]
    fn seeds_the_amount_from_the_per_frame_rate() {
        assert_eq!(calc_frame_amount(150), 150);
    }

    #[test]
    fn percent_off_rounds_to_nearest_rupee() {
        let (final_amount, discount) = apply_discount_effect(600, "percentOff", 10);
        assert_eq!(final_amount, 540);
        assert_eq!(discount, 60);
    }

    #[test]
    fn flat_off_never_goes_negative() {
        let (final_amount, discount) = apply_discount_effect(30, "flatOff", 50);
        assert_eq!(final_amount, 0);
        assert_eq!(discount, 30);
    }

    #[test]
    fn billable_minutes_floors_at_zero() {
        assert_eq!(billable_minutes_after_extra_time(90, 30), 60);
        assert_eq!(billable_minutes_after_extra_time(20, 30), 0);
    }

    #[test]
    fn duration_based_amount_matches_the_string_based_calculation() {
        // 1h at 400/hr + 200/half (30 of the 90 minutes) = 600, same as
        // calc_time_amount("13:00", "14:30", 400, 200) would give.
        assert_eq!(calc_time_amount_for_duration(90, 400, 200), 600);
    }

    #[test]
    fn percent_off_at_100_zeroes_the_amount() {
        let (final_amount, discount) = apply_discount_effect(600, "percentOff", 100);
        assert_eq!(final_amount, 0);
        assert_eq!(discount, 600);
    }

    #[test]
    fn percent_off_at_0_is_a_no_op() {
        let (final_amount, discount) = apply_discount_effect(600, "percentOff", 0);
        assert_eq!(final_amount, 600);
        assert_eq!(discount, 0);
    }

    #[test]
    fn flat_off_at_0_is_a_no_op() {
        let (final_amount, discount) = apply_discount_effect(600, "flatOff", 0);
        assert_eq!(final_amount, 600);
        assert_eq!(discount, 0);
    }

    #[test]
    fn billable_minutes_at_exactly_the_free_allowance_is_zero_not_negative() {
        // effect_value equal to the actual duration -- the whole session is free,
        // not an error and not a negative duration.
        assert_eq!(billable_minutes_after_extra_time(30, 30), 0);
    }
}
