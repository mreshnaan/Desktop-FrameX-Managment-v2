mod auth;
mod branding;
mod commands;
mod db;
mod models;
mod money;
mod time;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                let pool = db::init_pool(&handle)
                    .await
                    .expect("failed to initialize sqlite database");
                handle.manage(pool);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            auth::store_auth_tokens,
            auth::get_auth_tokens,
            auth::clear_auth_tokens,
            commands::current_actor::set_current_actor,
            commands::current_actor::clear_current_actor,
            commands::categories::list_categories,
            commands::categories::create_category,
            commands::categories::update_category,
            commands::stations::list_stations,
            commands::stations::create_station,
            commands::stations::update_station,
            commands::backup::backup_now,
            commands::backup::list_backups,
            commands::backup::restore_backup,
            commands::backup::get_backup_dir,
            commands::product_categories::list_product_categories,
            commands::product_categories::create_product_category,
            commands::products::list_products,
            commands::products::create_product,
            commands::products::update_product,
            commands::products::adjust_stock,
            commands::orders::create_order,
            commands::orders::list_all_orders,
            commands::orders::list_orders_between,
            commands::orders::list_order_items_between,
            commands::rates::list_rates,
            commands::rates::upsert_rate,
            commands::customers::list_customers,
            commands::customers::create_customer,
            commands::customers::delete_customer,
            commands::sessions::list_all_sessions,
            commands::sessions::list_sessions_between,
            commands::sessions::list_sessions_for_date,
            commands::sessions::create_session,
            commands::sessions::update_session,
            commands::sessions::delete_session,
            commands::sessions::count_sessions_today,
            commands::expenses::list_expenses_for_date,
            commands::expenses::list_expenses_between,
            commands::expenses::create_expense,
            commands::expenses::update_expense,
            commands::expenses::delete_expense,
            commands::reports::get_monthly_report,
            commands::reports::get_customer_balances,
            commands::reports::get_customer_credit_history,
            commands::credit_entries::list_credit_entries,
            commands::credit_entries::create_credit_entry,
            commands::offers::list_offers,
            commands::offers::create_offer,
            commands::offers::update_offer,
            commands::sync::drain_outbox,
            commands::sync::delete_outbox_entries,
            commands::sync::apply_pulled_rows,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
