use serde::Serialize;
use sqlx::{FromRow, SqlitePool};

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DailyCategoryTotal {
    pub date: String,
    pub category_id: String,
    pub method: String,
    pub total: i64,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DailyExpenseTotal {
    pub date: String,
    pub method: String,
    pub total: i64,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DailyCafeTotal {
    pub date: String,
    pub method: String,
    pub total: i64,
    pub profit: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyReportResult {
    pub session_totals: Vec<DailyCategoryTotal>,
    pub expense_totals: Vec<DailyExpenseTotal>,
    pub cafe_totals: Vec<DailyCafeTotal>,
}

pub(crate) async fn do_get_monthly_report(
    pool: &SqlitePool,
    start_date: String,
    end_date: String,
    start_utc: String,
    end_utc: String,
) -> Result<MonthlyReportResult, String> {
    let session_totals = sqlx::query_as::<_, DailyCategoryTotal>(
        "SELECT
            s.date as date,
            st.category_id as category_id,
            s.method as method,
            CAST(SUM(s.amount) AS INTEGER) as total
         FROM sessions s
         JOIN stations st ON s.station_id = st.id
         WHERE s.date >= ? AND s.date <= ? AND s.deleted_at IS NULL
         GROUP BY s.date, st.category_id, s.method",
    )
    .bind(&start_date)
    .bind(&end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let expense_totals = sqlx::query_as::<_, DailyExpenseTotal>(
        "SELECT
            date,
            method,
            CAST(SUM(amount) AS INTEGER) as total
         FROM expenses
         WHERE date >= ? AND date <= ? AND deleted_at IS NULL
         GROUP BY date, method",
    )
    .bind(&start_date)
    .bind(&end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let cafe_totals = sqlx::query_as::<_, DailyCafeTotal>(
        "SELECT
            substr(o.updated_at, 1, 10) as date,
            o.method as method,
            CAST(SUM(o.total) AS INTEGER) as total,
            CAST(SUM(
                COALESCE(oi_agg.items_total, 0) - COALESCE(oi_agg.items_cost, 0)
            ) AS INTEGER) as profit
         FROM orders o
         LEFT JOIN (
             SELECT
                 oi.order_id,
                 SUM(oi.line_total) as items_total,
                 SUM(COALESCE(p.cost, 0) * oi.qty) as items_cost
             FROM order_items oi
             LEFT JOIN products p ON oi.product_id = p.id
             GROUP BY oi.order_id
         ) oi_agg ON o.id = oi_agg.order_id
         WHERE o.deleted_at IS NULL AND o.updated_at >= ? AND o.updated_at < ?
         GROUP BY substr(o.updated_at, 1, 10), o.method",
    )
    .bind(&start_utc)
    .bind(&end_utc)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(MonthlyReportResult {
        session_totals,
        expense_totals,
        cafe_totals,
    })
}

