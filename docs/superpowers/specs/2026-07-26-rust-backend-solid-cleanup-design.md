# Rust backend SOLID cleanup — design

> Sub-project 3 of the codebase-cleanup refactor (branch `refactor/codebase-cleanup`).
> Sub-projects 1 (web's bounded day-scoped reads) and 2 (hooks + types cleanup) are
> complete. The remaining area (shared table/form components across apps/desktop and
> apps/web) is scoped separately and not started.

## Goal

Fix the three genuine SOLID/structure issues found in `apps/desktop/src-tauri/src/commands/`
during the codebase audit — `sync.rs`'s 230-line match statement, `orders.rs`'s 157-line
checkout function, and `reports.rs`'s file-level responsibility mixing — without changing
any observable behavior. Every `do_*` function and `#[tauri::command]` wrapper keeps its
existing name and signature, because the existing unit test suites (7 tests in `sync.rs`,
12 in `orders.rs`, 10 in `reports.rs`) call the `do_*` functions directly against an
in-memory SQLite pool; preserving those signatures means the existing tests are the
regression safety net for this refactor, not new tests to write.

`reports.rs` was confirmed during scoping to have no true SOLID violation (no giant
function, no cross-file coupling) — its "mixed responsibilities" label was about three
independent report domains sharing one file by convention. The user chose to include a
lighter pass on it anyway (file split + extracting embedded business-rule constants),
alongside the two files with real problems.

## 1. `sync.rs` — split `apply_one`'s 230-line match into a dispatcher + per-table functions

**Current shape** (`apply_one`, lines 99-332): one `match table { "categories" => {...}, ... }`
with 12 arms (`categories`, `stations`, `rates`, `customers`, `sessions`, `expenses`,
`creditEntries`, `productCategories`, `products`, `orders`, `orderItems`,
`stockMovements`), each arm inlining: an optional `is_newer` early-return (skipped only
for `categories`/`stations`/`productCategories`, which have no `updated_at` column), then
a single `INSERT ... ON CONFLICT DO UPDATE` built from `row["wireKey"].as_type()` field
extractions. This is Single-Responsibility and Open/Closed violations at once: one
function owns all 12 tables' upsert logic, and adding a 13th synced table means editing
this function instead of adding a new, independent one.

**Fix:** `apply_one` becomes a ~20-line dispatcher:

```rust
async fn apply_one(tx: &mut Transaction<'_, Sqlite>, table: &str, row: &Value) -> Result<(), sqlx::Error> {
    let id = row["id"].as_str().unwrap_or_default().to_string();
    match table {
        "categories" => apply_categories(tx, &id, row).await,
        "stations" => apply_stations(tx, &id, row).await,
        "rates" => apply_rates(tx, &id, row).await,
        "customers" => apply_customers(tx, &id, row).await,
        "sessions" => apply_sessions(tx, &id, row).await,
        "expenses" => apply_expenses(tx, &id, row).await,
        "creditEntries" => apply_credit_entries(tx, &id, row).await,
        "productCategories" => apply_product_categories(tx, &id, row).await,
        "products" => apply_products(tx, &id, row).await,
        "orders" => apply_orders(tx, &id, row).await,
        "orderItems" => apply_order_items(tx, &id, row).await,
        "stockMovements" => apply_stock_movements(tx, &id, row).await,
        _ => Ok(()),
    }
}
```

Each `apply_<table>` function is a private `async fn(tx: &mut Transaction<'_, Sqlite>, id:
&str, row: &Value) -> Result<(), sqlx::Error>` moved verbatim from its current match arm
body — same SQL string, same binds, same `is_newer` early-return where the arm currently
has one. No SQL changes, no bind-order changes, no new dynamic query construction (this
was decided against during scoping: a data-driven generic upsert was considered and
rejected in favor of keeping each table's SQL static and independently type-checked, so a
mistake in one table's function cannot affect another's).

**One shared helper extracted**, since it is genuinely duplicated (not just structurally
similar) in exactly two of the twelve functions:

```rust
// sessions and order_items both carry an optional JSON metadata blob that's stored
// as a nullable TEXT column -- Value::Null must become a real SQL NULL, not the
// string "null".
fn json_metadata(row: &Value) -> Option<String> {
    match &row["metadata"] {
        Value::Null => None,
        v => Some(v.to_string()),
    }
}
```

`apply_sessions` and `apply_order_items` call `json_metadata(row)` instead of inlining the
match. No other helper is extracted — the `is_newer` early-return is already a one-line
call to the existing shared `is_newer` function in each of the 9 arms that need it, so
there's nothing further to factor there without adding indirection for its own sake.

`is_newer`, `enqueue_outbox_tx`, `OutboxEntryRow`, `do_drain_outbox`,
`do_delete_outbox_entries`, `do_apply_pulled_rows`, and their `#[tauri::command]` wrappers
are unchanged.

## 2. `orders.rs` — decompose `do_create_order`'s 157-line body

**Current shape** (`do_create_order`, lines 21-177): validates the whole cart with no
writes (pass 1), inserts the `orders` row (pass 2), then loops over validated items
decrementing stock, inserting a `stock_movements` row, and inserting an `order_items` row
— each with its own outbox enqueue (pass 3). All three passes share the same `&mut
Transaction`, which cannot be split across functions in parallel, only threaded through
sequential calls — that constraint is unchanged by this refactor.

**Fix**, three extracted async helpers, `do_create_order` becomes an orchestrator that
calls them in sequence on the same `tx` and commits at the end:

```rust
async fn validate_cart(
    tx: &mut Transaction<'_, Sqlite>,
    items: &[CartItemInput],
) -> Result<Vec<(Product, i64, i64)>, String> {
    // pass 1's body, verbatim: fetch each product, check active/stock_qty,
    // compute (product, qty, line_total), accumulate, no writes.
}

async fn insert_order_row(
    tx: &mut Transaction<'_, Sqlite>,
    order_id: &str,
    method: &str,
    total: i64,
    customer_id: &Option<String>,
    actor: &Option<String>,
    now: &str,
) -> Result<Order, String> {
    // pass 2's body, verbatim: INSERT INTO orders + its outbox enqueue, returns
    // the constructed Order for the caller to build OrderWithItems from.
}

async fn apply_line_item(
    tx: &mut Transaction<'_, Sqlite>,
    order_id: &str,
    product: &Product,
    qty: i64,
    line_total: i64,
    actor: &Option<String>,
    now: &str,
) -> Result<OrderItem, String> {
    // one iteration of pass 3's loop body, verbatim: decrement stock + its
    // outbox enqueue, insert stock_movements + its outbox enqueue, insert
    // order_items + its outbox enqueue, returns the constructed OrderItem.
}
```

`do_create_order` keeps its existing signature and the empty-cart/Credit-without-customer
guard checks at the top, then becomes:

```rust
pub(crate) async fn do_create_order(
    pool: &SqlitePool,
    items: Vec<CartItemInput>,
    method: String,
    customer_id: Option<String>,
) -> Result<OrderWithItems, String> {
    if items.is_empty() { return Err("Cart is empty".to_string()); }
    if method == "Credit" && customer_id.is_none() {
        return Err("A customer must be selected for Credit orders".to_string());
    }

    let actor = get_current_actor(pool).await;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let now = crate::time::now_iso();
    let order_id = Uuid::new_v4().to_string();

    let validated = validate_cart(&mut tx, &items).await?;
    let total: i64 = validated.iter().map(|(_, _, line_total)| line_total).sum();
    let order = insert_order_row(&mut tx, &order_id, &method, total, &customer_id, &actor, &now).await?;

    let mut order_items = Vec::new();
    for (product, qty, line_total) in validated {
        order_items.push(apply_line_item(&mut tx, &order_id, &product, qty, line_total, &actor, &now).await?);
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(OrderWithItems { order, items: order_items })
}
```

No SQL, bind order, error message, or outbox payload shape changes — this is purely
extracting the three passes into named, independently-readable (and, since they take
`&mut Transaction` directly, independently unit-testable) functions.

`do_list_all_orders`, `do_list_orders_between`, `do_list_order_items_between`, and their
`#[tauri::command]` wrappers are unchanged — the audit found these were already simple,
single-purpose read functions with no decomposition needed.

## 3. `reports.rs` — split into 3 files by report domain + extract embedded label constants

**Current shape**: one file, three independent report endpoints —
`do_get_monthly_report`/`get_monthly_report` (session/expense/cafe rollups),
`do_get_customer_balances`/`get_customer_balances`, and
`do_get_customer_credit_history`/`get_customer_credit_history` — sharing a file only by
the "reports" label, not by any code dependency between them.

**Fix:**
- `commands/reports/mod.rs` — re-exports the three `#[tauri::command]` functions (`pub
  use sales::get_monthly_report; pub use customer_balances::get_customer_balances; pub use
  credit_history::get_customer_credit_history;`), replacing the current
  `commands/reports.rs` file. `commands/mod.rs`'s existing `pub mod reports;` line needs no
  change — a directory module with `mod.rs` is a drop-in replacement for a single file.
- `commands/reports/sales.rs` — `do_get_monthly_report` + `get_monthly_report`, plus the
  `DailyCategoryTotal`/`DailyExpenseTotal`/`DailyCafeTotal`/`MonthlyReportResult` structs
  and their tests.
- `commands/reports/customer_balances.rs` — `do_get_customer_balances` +
  `get_customer_balances`, plus its tests.
- `commands/reports/credit_history.rs` — `do_get_customer_credit_history` +
  `get_customer_credit_history`, plus the `CustomerHistoryRow` struct and its tests.

**Label constants**, extracted in `credit_history.rs` only (the file with hardcoded
label/direction strings embedded in a SQL `CASE` inside the UNION query):

```rust
const LABEL_SESSION_CHARGE: &str = "Table charge";
const LABEL_CREDIT_GIVEN: &str = "Credit given";
const LABEL_PAYMENT_RECEIVED: &str = "Payment received";
```

The query is built with `format!` substituting these constants into the `CASE` branches
that currently hardcode the string literals directly, so the display text has one source
of truth instead of being embedded only inside a query string; the SQL structure,
column list, and ordering are otherwise unchanged. The credit-balance formula in
`do_get_customer_balances` (session credit + given − paid) already has an explanatory SQL
comment and needs no further change — it's one arithmetic expression, not a repeated
literal, so a named constant wouldn't add clarity.

## Testing

No behavior change is intended anywhere in this sub-project. Verification is:

- `cargo test` in `apps/desktop/src-tauri` — the existing 7 (`sync.rs`) + 12 (`orders.rs`)
  + 10 (`reports.rs`) unit tests must pass unchanged, since every extracted function keeps
  the `do_*`/`#[tauri::command]` signature the tests call directly. These tests are the
  primary regression safety net for this refactor, not new coverage to add.
- `cargo check` / `cargo clippy` — catches any dropped `pub(crate)` visibility or unused
  import from the file split.
- Full desktop e2e suite (`apps/desktop/e2e`), especially `03-cafe.spec.ts` (checkout),
  `06-cross-app-sync.spec.ts` (pull/push sync), and `08-reporting.spec.ts` (all three
  report endpoints) as an integration-level backstop on top of the unit tests.
