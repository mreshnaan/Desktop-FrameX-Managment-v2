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
}
