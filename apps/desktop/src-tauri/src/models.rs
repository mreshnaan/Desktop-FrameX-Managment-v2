use serde::{Deserialize, Serialize};
use sqlx::FromRow;

// #[serde(rename_all = "camelCase")] keeps the JSON wire format sent to the
// TS frontend consistent with the rest of the app (apps/api's Prisma output,
// apps/web's zod schemas) while sqlx's FromRow -- a separate derive,
// unaffected by serde attributes -- still maps by the snake_case Rust field
// names that match the SQLite column names in migrations/0001_init.sql.

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub name: String,
    pub billing_type: String,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Station {
    pub id: String,
    pub category_id: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Rate {
    pub id: String,
    pub category_id: String,
    pub hour_rate: Option<i64>,
    pub half_rate: Option<i64>,
    pub frame_rate: Option<i64>,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Customer {
    pub id: String,
    pub name: String,
    pub phone: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub station_id: String,
    pub date: String,
    pub start: String,
    pub end: String,
    pub amount: i64,
    pub method: String,
    pub customer_id: Option<String>,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Expense {
    pub id: String,
    pub date: String,
    pub description: String,
    pub amount: i64,
    pub method: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CreditEntry {
    pub id: String,
    pub customer_id: String,
    pub date: String,
    #[sqlx(rename = "type")]
    #[serde(rename = "type")]
    pub entry_type: String,
    pub amount: i64,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProductCategory {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Product {
    pub id: String,
    pub category_id: String,
    pub name: String,
    pub price: i64,
    pub cost: Option<i64>,
    pub stock_qty: i64,
    pub low_stock_threshold: i64,
    pub barcode: Option<String>,
    pub active: bool,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Order {
    pub id: String,
    pub method: String,
    pub total: i64,
    pub customer_id: Option<String>,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OrderItem {
    pub id: String,
    pub order_id: String,
    pub product_id: String,
    pub qty: i64,
    pub unit_price: i64,
    pub line_total: i64,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StockMovement {
    pub id: String,
    pub product_id: String,
    pub delta: i64,
    pub reason: String,
    pub note: Option<String>,
    pub updated_at: String,
}

// The full receipt returned by create_order -- the order row plus its line
// items, so the frontend can render a confirmation without a second round
// trip.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OrderWithItems {
    #[serde(flatten)]
    pub order: Order,
    pub items: Vec<OrderItem>,
}
