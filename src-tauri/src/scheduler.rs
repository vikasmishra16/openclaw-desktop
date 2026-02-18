use tokio_cron_scheduler::{Job, JobScheduler};
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::{AppHandle, Emitter};

use serde::{Serialize, Deserialize};

pub struct SchedulerManager {
    scheduler: Arc<Mutex<JobScheduler>>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct CronJobDef {
    pub id: String,
    pub cron_exp: String,
    pub task_type: String, // "browser", "agent"
    pub payload: String,   // JSON string
}

impl SchedulerManager {
    pub async fn new() -> Self {
        let scheduler = JobScheduler::new().await.unwrap();
        scheduler.start().await.unwrap();
        Self {
            scheduler: Arc::new(Mutex::new(scheduler)),
        }
    }

    pub async fn add_job(&self, app: AppHandle, job_def: CronJobDef) -> Result<String, String> {
        let scheduler = self.scheduler.lock().await;
        
        // Clone for closure
        let task_type = job_def.task_type.clone();
        let payload = job_def.payload.clone();
        let app_handle = app.clone();

        let job = Job::new_async(job_def.cron_exp.as_str(), move |_uuid, _l| {
            let t_type = task_type.clone();
            let t_payload = payload.clone();
            let t_app = app_handle.clone();
            
            Box::pin(async move {
                println!("⏰ Cron Firing: {} - {}", t_type, t_payload);
                
                // Emit event to frontend or run internal logic
                let _ = t_app.emit("cron-event", serde_json::json!({
                    "type": t_type,
                    "payload": t_payload
                }));
            })
        }).map_err(|e| e.to_string())?;

        let id = scheduler.add(job).await.map_err(|e| e.to_string())?;
        
        Ok(id.to_string())
    }
}
