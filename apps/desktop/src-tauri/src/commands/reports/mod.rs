mod credit_history;
mod customer_balances;
mod sales;

use credit_history::CustomerHistoryRow;
use sales::MonthlyReportResult;
use sqlx::SqlitePool;
use std::collections::HashMap;
use tauri::State;

#[tauri::command]
pub async fn get_monthly_report(
    pool: State<'_, SqlitePool>,
    start_date: String,
    end_date: String,
    start_utc: String,
    end_utc: String,
) -> Result<MonthlyReportResult, String> {
    sales::do_get_monthly_report(pool.inner(), start_date, end_date, start_utc, end_utc).await
}

#[tauri::command]
pub async fn get_customer_balances(
    pool: State<'_, SqlitePool>,
) -> Result<HashMap<String, i64>, String> {
    customer_balances::do_get_customer_balances(pool.inner()).await
}

#[tauri::command]
pub async fn get_customer_credit_history(
    pool: State<'_, SqlitePool>,
    customer_id: String,
) -> Result<Vec<CustomerHistoryRow>, String> {
    credit_history::do_get_customer_credit_history(pool.inner(), customer_id).await
}
