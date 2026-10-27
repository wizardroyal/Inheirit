//! NEP-297 events for every will change; the web timeline reads these.
use crate::*;

const EVENT_STANDARD: &str = "heirloom";
const EVENT_STANDARD_VERSION: &str = "1.0.0";

pub fn emit(event: &str, data: serde_json::Value) {
    let event_json = serde_json::json!({
        "standard": EVENT_STANDARD,
        "version": EVENT_STANDARD_VERSION,
        "event": event,
        "data": [data],
    });
    log!("EVENT_JSON:{}", event_json);
}
